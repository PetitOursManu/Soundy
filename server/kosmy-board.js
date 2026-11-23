// ============================================================================
// « Se connecter avec Kosmy Board » : Soundy client OpenID Connect de Kosmy Board
//
// Les comptes de Soundy sont ceux d'Emby, et Emby n'ouvre une session qu'avec le
// mot de passe. Le lien se fait donc une fois, depuis Soundy :
//   1. connecté avec Emby, on clique « Relier à Kosmy Board » et on confirme son
//      mot de passe Emby ;
//   2. le serveur Soundy ouvre auprès d'Emby une session dédiée (appareil
//      « Soundy (Kosmy Board) ») et la garde, avec le compte du Board (`sub`) ;
//   3. ensuite, « Ouvrir » dans le Board (ou « Se connecter avec Kosmy Board »)
//      redonne cette session au navigateur, sans mot de passe.
// Le mot de passe n'est jamais gardé. Délier ferme la session dédiée dans Emby.
//
// Parcours (docs/integration.md de Kosmy Board) : state, nonce et PKCE S256 ;
// `iss` vérifié au lancement et au retour ; échange du code en client_secret_basic ;
// ID token RS256 vérifié avec les clés de `jwks_uri` (signature, iss, aud, exp, nonce).
// Le state ne sert qu'une fois et il est lié au navigateur par un cookie.
//
// Admin dans le Board (kosmy-board-admin.js) : verifyAdminToken vérifie le jeton
// kb-admin+jwt avec les mêmes réglages et les mêmes clés (docs/admin-api.md du Board).
//
// Utilisateurs gérés par le Board (kosmy-board-users.js, docs/users-api.md du Board) : un compte relié peut
// recevoir du Board un rôle propre à Soundy (`role` : admin | member), des restrictions (`values`) et être
// désactivé (`disabled`). applyAccess() les applique à l'utilisateur Emby partout où Soundy vérifie un compte.
// Les comptes Emby eux-mêmes ne sont ni créés ni modifiés : Soundy n'a aucun droit d'administration sur Emby.
//
// Notifications (docs/notifications.md du Board) : envoyées aux comptes du Board reliés à un administrateur
// Emby, à l'adresse `kosmy_notifications_endpoint` de la découverte, avec le secret client (Basic).
// Le Board les montre dans sa cloche et Kosmy Mobile sur le téléphone.
//
// Réglages et comptes reliés dans DATA_DIR/kosmy-board.json (mode 600).
// Le secret client et les sessions Emby ne sont jamais renvoyés tels quels.
// ============================================================================
import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const LOGIN_PATH = '/auth/kosmy-board/login';
export const CALLBACK_PATH = '/auth/kosmy-board/callback';
export const FLOW_COOKIE = 'soundy_kb_flow';
export const TICKET_COOKIE = 'soundy_kb_ticket';
export const SESSION_PATH = '/api/kosmy-board/session';
const FLOW_TTL = 10 * 60_000;
const TICKET_TTL = 2 * 60_000;
const DISCOVERY_TTL = 60 * 60_000;
const MAX_FLOWS = 500;
const MAX_ACCOUNTS = 500;
const NET_TIMEOUT = 10_000;
const CLOCK_SKEW = 60; // secondes
// Admin dans le Board : jeton à usage unique, valable 60 s, 30 s de tolérance d'horloge.
const ADMIN_TYP = 'kb-admin+jwt';
const ADMIN_SKEW = 30;
const ADMIN_MAX_AGE = 120;
const KEYS_REFRESH_DELAY = 60_000;

export class OidcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/* ---------------- petits outils ---------------- */

const random = (n = 32) => randomBytes(n).toString('base64url');
export const pkceChallenge = (verifier) => createHash('sha256').update(verifier).digest('base64url');

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Émetteur nettoyé (sans « / » final), ou null si ce n'est pas une adresse http(s) simple. */
export function cleanIssuer(value) {
  const v = String(value ?? '').trim().replace(/\/+$/, '');
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.search || u.hash || u.username || u.password) return null;
    return v;
  } catch {
    return null;
  }
}

/** Adresse d'Emby donnée au navigateur : http(s), sans identifiants ni paramètres. */
export function cleanServer(value) {
  const v = String(value ?? '').trim().replace(/\/+$/, '');
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.search || u.hash || u.username || u.password || v.length > 300) return null;
    return v;
  } catch {
    return null;
  }
}

/** Identifiants du client en HTTP Basic, encodés comme le veut RFC 6749 § 2.3.1. */
export function basicAuth(clientId, secret) {
  const enc = (s) => encodeURIComponent(s).replace(/%20/g, '+');
  return `Basic ${Buffer.from(`${enc(clientId)}:${enc(secret)}`).toString('base64')}`;
}

export function readCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function cookie(name, value, { maxAge, secure, path: p = '/' }) {
  return `${name}=${value}; Path=${p}; Max-Age=${Math.floor(maxAge / 1000)}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

const decodePart = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/**
 * Vérifie la signature d'un JWT du Board : RS256 seulement, avec une des clés de `jwks_uri`.
 * Renvoie { header, payload }, ou lève une OidcError (code « key » si la clé est inconnue : le Board a pu en changer).
 */
function verifySignature(jwt, keys) {
  const parts = String(jwt || '').split('.');
  if (parts.length !== 3) throw new OidcError('token', 'Jeton illisible.');
  let header;
  let payload;
  try {
    header = decodePart(parts[0]);
    payload = decodePart(parts[1]);
  } catch {
    throw new OidcError('token', 'Jeton illisible.');
  }
  if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') throw new OidcError('token', 'Jeton illisible.');
  if (header.alg !== 'RS256') throw new OidcError('token', `Algorithme de signature refusé : ${header.alg}.`);
  const rsa = (keys || []).filter((k) => k && k.kty === 'RSA' && (!k.use || k.use === 'sig') && (!k.alg || k.alg === 'RS256'));
  const key = header.kid ? rsa.find((k) => k.kid === header.kid) : rsa.length === 1 ? rsa[0] : null;
  if (!key) throw new OidcError('key', 'Clé de signature inconnue.');
  let pub;
  try {
    pub = createPublicKey({ key: { kty: key.kty, n: key.n, e: key.e }, format: 'jwk' });
  } catch {
    throw new OidcError('token', 'Clé de signature illisible.');
  }
  const ok = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), pub, Buffer.from(parts[2], 'base64url'));
  if (!ok) throw new OidcError('token', 'Signature du jeton invalide.');
  return { header, payload };
}

/** ID token : signature, puis iss, aud, exp, nonce et sub. Renvoie ses revendications. */
export function verifyIdToken(idToken, { keys, issuer, clientId, nonce, now = Date.now() }) {
  const { header, payload: c } = verifySignature(idToken, keys);
  if (String(header.typ || '').toLowerCase().includes(ADMIN_TYP)) throw new OidcError('token', 'Ce n’est pas un ID token.');
  if (c.iss !== issuer) throw new OidcError('token', 'ID token d’un autre émetteur.');
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(clientId)) throw new OidcError('token', 'ID token destiné à une autre appli.');
  if (aud.length > 1 && c.azp !== clientId) throw new OidcError('token', 'ID token destiné à une autre appli.');
  const sec = Math.floor(now / 1000);
  if (typeof c.exp !== 'number' || c.exp + CLOCK_SKEW < sec) throw new OidcError('token', 'ID token expiré.');
  if (typeof c.iat === 'number' && c.iat - CLOCK_SKEW > sec) throw new OidcError('token', 'ID token daté du futur.');
  if (!c.nonce || !same(c.nonce, nonce)) throw new OidcError('token', 'Nonce invalide.');
  if (typeof c.sub !== 'string' || !c.sub) throw new OidcError('token', 'ID token sans identifiant (sub).');
  return c;
}

/**
 * Jeton de l'admin dans le Board (kosmy.board-admin.v1) : signature RS256, `typ` = kb-admin+jwt,
 * iss, aud, exp (30 s de tolérance), âge, `htm` = méthode, chemin de `htu` terminé par le chemin demandé.
 * Le `jti` à usage unique est contrôlé par l'appelant.
 */
export function verifyAdminToken(token, { keys, issuer, clientId, method, path: wanted, now = Date.now() }) {
  const { header, payload: c } = verifySignature(token, keys);
  const typ = String(header.typ || '').toLowerCase().replace(/^application\//, '');
  if (typ !== ADMIN_TYP) throw new OidcError('token', 'Ce n’est pas un jeton d’admin du Board.');
  if (c.iss !== issuer) throw new OidcError('token', 'Jeton d’un autre émetteur.');
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(clientId)) throw new OidcError('token', 'Jeton destiné à une autre appli.');
  const sec = Math.floor(now / 1000);
  if (typeof c.exp !== 'number' || c.exp + ADMIN_SKEW < sec) throw new OidcError('token', 'Jeton expiré.');
  if (typeof c.iat !== 'number' || c.iat - ADMIN_SKEW > sec || sec - c.iat > ADMIN_MAX_AGE + ADMIN_SKEW) {
    throw new OidcError('token', 'Jeton trop ancien ou daté du futur.');
  }
  if (c.htm !== method) throw new OidcError('token', 'Jeton fait pour une autre méthode.');
  let htu = '';
  try { htu = new URL(c.htu).pathname.replace(/\/+$/, ''); } catch { /* refusé juste en dessous */ }
  if (!htu || !htu.endsWith(wanted)) throw new OidcError('token', 'Jeton fait pour une autre adresse.');
  if (typeof c.jti !== 'string' || !c.jti || c.jti.length > 200) throw new OidcError('token', 'Jeton sans identifiant (jti).');
  if (typeof c.sub !== 'string' || !c.sub) throw new OidcError('token', 'Jeton sans identifiant de compte (sub).');
  return c;
}

/* ---------------- module ---------------- */

/**
 * @param {object} o
 * @param {string} o.dataDir dossier des données
 * @param {object} o.emby { base(): adresse d'Emby vue du serveur (ou null), authenticate(user, password, deviceId), check(token, userId), logout(token) }
 * @param {Function} [o.fetchImpl] pour les tests
 * @param {Function} [o.now] pour les tests
 * @param {object} [o.rules] règles de l'accès géré par le Board (kosmy-board-users.js) : { clean({ role, values }, current) }
 */
export function createKosmyBoard({ dataDir, emby, rules = null, fetchImpl = (...a) => fetch(...a), now = () => Date.now() }) {
  const file = path.join(dataDir, 'kosmy-board.json');
  const flows = new Map(); // state → { verifier, nonce, issuer, mode, browser, link?, exp }
  const tickets = new Map(); // ticket → { sub, exp }
  const discoveries = new Map(); // émetteur → { doc, keys, at }

  function read() {
    let r = {};
    try { r = JSON.parse(readFileSync(file, 'utf8')); } catch { /* premier lancement */ }
    return {
      issuer: typeof r.issuer === 'string' ? r.issuer : '',
      clientId: typeof r.clientId === 'string' ? r.clientId : '',
      secret: typeof r.secret === 'string' ? r.secret : '',
      accounts: Array.isArray(r.accounts) ? r.accounts.filter((a) => a && typeof a.sub === 'string' && a.sub && typeof a.token === 'string') : [],
    };
  }

  function write(r) {
    mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(r, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  }

  const enabled = (r = read()) => Boolean(r.issuer && r.clientId && r.secret);

  /** Un compte relié, sans la session Emby. */
  const publicAccount = (a) => ({
    sub: a.sub,
    name: a.name || '',
    email: a.email || '',
    embyUserId: a.embyUserId,
    embyUserName: a.embyUserName || '',
    linkedAt: a.linkedAt || '',
    lastLogin: a.lastLogin || '',
    // Accès géré par le Board : rôle propre à Soundy (sinon celui d'Emby) et compte désactivé.
    role: a.role || null,
    values: a.role && a.values ? a.values : null,
    disabled: Boolean(a.disabled),
  });

  /** Réglages montrés aux administrateurs Emby (jamais le secret). */
  function settings(base) {
    const r = read();
    return {
      issuer: r.issuer,
      clientId: r.clientId,
      secretSet: Boolean(r.secret),
      enabled: enabled(r),
      redirectUri: `${base}${CALLBACK_PATH}`,
      loginUri: `${base}${LOGIN_PATH}`,
      accounts: r.accounts.length,
    };
  }

  /** Enregistre les réglages. Lève une erreur { status, message } si la saisie est refusée. */
  function saveSettings(body, base) {
    if (!body || typeof body !== 'object') throw Object.assign(new Error('Réglages attendus.'), { status: 400 });
    const r = read();
    if (body.issuer !== undefined) {
      if (String(body.issuer ?? '').trim() === '') r.issuer = '';
      else {
        const i = cleanIssuer(body.issuer);
        if (!i) throw Object.assign(new Error('issuer'), { status: 400, key: 'kbBadIssuer' });
        r.issuer = i;
      }
    }
    if (body.clientId !== undefined) {
      const id = String(body.clientId ?? '').trim();
      if (id.length > 200) throw Object.assign(new Error('clientId'), { status: 400, key: 'kbBadClientId' });
      r.clientId = id;
    }
    // Secret en écriture seule : une chaîne vide le garde, null le retire.
    if (body.secret === null) r.secret = '';
    else if (typeof body.secret === 'string' && body.secret.trim()) {
      if (body.secret.length > 500) throw Object.assign(new Error('secret'), { status: 400, key: 'kbBadSecret' });
      r.secret = body.secret.trim();
    }
    write(r);
    discoveries.clear();
    return settings(base);
  }

  const accountOf = (embyUserId) => {
    const a = read().accounts.find((x) => x.embyUserId === embyUserId);
    return a ? publicAccount(a) : null;
  };
  const accountBySub = (sub) => read().accounts.find((x) => x.sub === sub) || null;
  const accounts = () => read().accounts.map(publicAccount);

  /* ---------- accès géré par le Board ---------- */

  /**
   * Applique à un utilisateur Emby vérifié ({ id, name, isAdmin }) l'accès décidé dans le Board :
   * `isAdmin` vient du rôle choisi dans le Board (sinon d'Emby), `disabled` dit si l'accès à Soundy est retiré.
   */
  function applyAccess(user) {
    if (!user) return user;
    const a = read().accounts.find((x) => x.embyUserId === user.id);
    if (!a) return { ...user, disabled: false };
    return { ...user, isAdmin: a.role ? a.role === 'admin' : user.isAdmin, disabled: Boolean(a.disabled) };
  }

  /** Restrictions d'un utilisateur Emby (`values` du Board), ou null si son accès n'est pas géré par le Board. */
  function valuesOf(embyUserId) {
    const a = read().accounts.find((x) => x.embyUserId === embyUserId);
    return a?.role && a.values && typeof a.values === 'object' ? a.values : null;
  }

  /** Vérifie la session auprès d'Emby, puis applique l'accès décidé dans le Board. */
  const check = async (token, userId) => applyAccess(await emby.check(token, userId));

  /**
   * Les comptes reliés avec leur rôle réel : celui choisi dans le Board, sinon celui d'Emby (demandé à Emby
   * avec la session reliée ; null si elle ne répond plus). Pour la liste du Board et la règle « au moins un admin ».
   */
  async function linkedAccess() {
    return Promise.all(read().accounts.map(async (a) => {
      let role = a.role || null;
      if (!role && !a.disabled) {
        const u = await emby.check(a.token, a.embyUserId).catch(() => null);
        role = u ? (u.isAdmin ? 'admin' : 'member') : null;
      }
      return { sub: a.sub, embyUserName: a.embyUserName || '', role, managed: Boolean(a.role), values: a.values || null, disabled: Boolean(a.disabled) };
    }));
  }

  /** Reste-t-il un administrateur actif parmi les comptes reliés, sans compter `sub` ? */
  async function otherAdmin(sub) {
    return (await linkedAccess()).some((a) => a.sub !== sub && !a.disabled && a.role === 'admin');
  }

  /**
   * Accès décidé dans le Board pour le compte relié à `sub` : rôle et restrictions, nom et e-mail du Board,
   * compte réactivé. Renvoie le compte (public) avec `reactivated` et `session` (la session dédiée existe encore), ou null.
   */
  function setAccess(sub, { role, values, name, email }) {
    const r = read();
    const a = r.accounts.find((x) => x.sub === sub);
    if (!a) return null;
    const reactivated = Boolean(a.disabled);
    a.role = role;
    a.values = values;
    a.disabled = false;
    if (name) a.name = String(name).slice(0, 120);
    if (email) a.email = String(email).slice(0, 200);
    write(r);
    return { ...publicAccount(a), reactivated, session: Boolean(a.token) };
  }

  /**
   * Retire l'accès du compte relié à `sub` : désactivé (refusé partout dans Soundy) et sa session Emby dédiée
   * fermée, ce qui ferme aussi les sessions ouvertes par le Board dans les navigateurs. Le lien reste, pour qu'un
   * PUT du Board le réactive. Renvoie le compte (public), ou null si aucun compte n'est relié à `sub`.
   */
  async function disable(sub) {
    const r = read();
    const a = r.accounts.find((x) => x.sub === sub);
    if (!a) return null;
    const token = a.token;
    a.disabled = true;
    a.token = '';
    write(r);
    if (token) await emby.logout(token).catch(() => {});
    return publicAccount(a);
  }

  /** Revendication `kosmy_board_access` de l'ID token, revérifiée avec les règles de Soundy (null si absente ou refusée). */
  function accessClaim(claims, current) {
    const c = claims.kosmy_board_access;
    if (!rules || !c || typeof c !== 'object' || Array.isArray(c)) return null;
    try {
      return rules.clean({ role: c.role, values: c.values }, current);
    } catch (e) {
      console.warn(`[kosmy-board] revendication kosmy_board_access refusée (${e.message}) : ignorée.`);
      return null;
    }
  }

  /** Délie un compte (par `sub`) et ferme sa session dédiée dans Emby. Renvoie le compte retiré, ou null. */
  async function unlink(sub) {
    const r = read();
    const a = r.accounts.find((x) => x.sub === sub);
    if (!a) return null;
    r.accounts = r.accounts.filter((x) => x.sub !== sub);
    write(r);
    await emby.logout(a.token).catch(() => {});
    return publicAccount(a);
  }

  /* ---------- OpenID Connect ---------- */

  async function getJson(url, options = {}) {
    let res;
    try {
      res = await fetchImpl(url, { ...options, headers: { Accept: 'application/json', ...(options.headers || {}) }, signal: AbortSignal.timeout(NET_TIMEOUT) });
    } catch {
      throw new OidcError('network', 'Kosmy Board est injoignable depuis le serveur Soundy.');
    }
    let json = null;
    try { json = await res.json(); } catch { /* corps vide ou illisible */ }
    return { ok: res.ok, status: res.status, json };
  }

  async function discover(issuer, { refreshKeys = false } = {}) {
    let d = discoveries.get(issuer);
    if (!d || now() - d.at > DISCOVERY_TTL) {
      const r = await getJson(`${issuer}/.well-known/openid-configuration`);
      if (!r.ok || !r.json) throw new OidcError('discovery', `Découverte OpenID Connect impossible (code ${r.status}).`);
      const doc = r.json;
      if (doc.issuer !== issuer) throw new OidcError('discovery', 'L’émetteur annoncé par Kosmy Board ne correspond pas à celui réglé.');
      for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) {
        if (typeof doc[k] !== 'string') throw new OidcError('discovery', `Découverte OpenID Connect incomplète (${k}).`);
      }
      d = { doc, keys: null, at: now() };
      discoveries.set(issuer, d);
    }
    if (!d.keys || refreshKeys) {
      const r = await getJson(d.doc.jwks_uri);
      if (!r.ok || !r.json || !Array.isArray(r.json.keys)) throw new OidcError('discovery', 'Clés de signature de Kosmy Board introuvables.');
      d.keys = r.json.keys;
    }
    return d;
  }

  function purge() {
    const t = now();
    for (const [k, v] of flows) {
      if (v.exp < t) {
        flows.delete(k);
        if (v.link) void emby.logout(v.link.token).catch(() => {});
      }
    }
    while (flows.size >= MAX_FLOWS) flows.delete(flows.keys().next().value);
    for (const [k, v] of tickets) if (v.exp < t) tickets.delete(k);
  }

  /**
   * Prépare la demande d'autorisation. `mode` : « login » (rouvre la session reliée) ou « link »
   * (relie le compte Emby `link` au compte du Board qui va se connecter).
   * Renvoie l'adresse du Board et l'en-tête Set-Cookie qui lie ce parcours au navigateur.
   */
  async function start({ base, iss, mode = 'login', link = null }) {
    const r = read();
    if (!enabled(r)) throw new OidcError('disabled', 'La connexion avec Kosmy Board n’est pas réglée dans Soundy.');
    if (iss && iss !== r.issuer) throw new OidcError('issuer', 'Cette demande vient d’un autre Kosmy Board que celui réglé dans Soundy.');
    const { doc } = await discover(r.issuer);
    purge();
    const state = random(16);
    const verifier = random(32);
    const nonce = random(16);
    const browser = random(16);
    flows.set(state, { verifier, nonce, issuer: r.issuer, mode, link, browser, exp: now() + FLOW_TTL });
    const url = new URL(doc.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: r.clientId,
      redirect_uri: `${base}${CALLBACK_PATH}`,
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: 'S256',
    }).toString();
    return {
      url: url.href,
      cookie: cookie(FLOW_COOKIE, browser, { maxAge: FLOW_TTL, secure: base.startsWith('https:'), path: '/auth/kosmy-board' }),
    };
  }

  /**
   * Retour du Board. Vérifie tout, puis relie le compte (mode « link ») ou prépare la session
   * (mode « login ») : un ticket à usage unique, dans un cookie, que l'appli échange contre la session.
   * Renvoie { mode, account, cookies } ou lève une OidcError.
   */
  async function finish({ base, query, req }) {
    const state = String(query.state || '');
    const f = state ? flows.get(state) : null;
    if (f) flows.delete(state); // à usage unique, même en cas d'échec
    const browser = readCookies(req)[FLOW_COOKIE] || '';
    const secure = base.startsWith('https:');
    const clearFlow = cookie(FLOW_COOKIE, '', { maxAge: 0, secure, path: '/auth/kosmy-board' });
    try {
      if (!f || f.exp < now() || !browser || !same(browser, f.browser)) {
        throw new OidcError('state', 'Connexion expirée ou inconnue. Recommencez depuis Soundy ou depuis Kosmy Board.');
      }
      if (query.error) {
        if (query.error === 'access_denied') throw new OidcError('denied', 'Kosmy Board a refusé l’accès : cet espace Soundy n’est pas dans votre Board.');
        throw new OidcError('denied', `Kosmy Board a refusé la connexion : ${String(query.error_description || query.error).slice(0, 200)}`);
      }
      const r = read();
      if (!enabled(r) || r.issuer !== f.issuer) throw new OidcError('disabled', 'La connexion avec Kosmy Board a changé pendant la connexion. Recommencez.');
      // RFC 9207 : la réponse doit venir de l'émetteur attendu.
      if (query.iss !== undefined && query.iss !== r.issuer) throw new OidcError('issuer', 'Réponse d’un autre émetteur que celui réglé.');
      if (!query.code) throw new OidcError('code', 'Réponse de Kosmy Board sans code d’autorisation.');

      let d = await discover(r.issuer);
      const exchange = await getJson(d.doc.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth(r.clientId, r.secret) },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: String(query.code), redirect_uri: `${base}${CALLBACK_PATH}`, code_verifier: f.verifier }).toString(),
      });
      if (!exchange.ok || !exchange.json || typeof exchange.json.id_token !== 'string') {
        const e = exchange.json || {};
        const hint = e.error === 'invalid_client' ? ' Vérifiez l’identifiant et le secret client.' : '';
        throw new OidcError('exchange', `Kosmy Board a refusé l’échange du code (${e.error || exchange.status}).${hint}`);
      }
      const opts = { issuer: r.issuer, clientId: r.clientId, nonce: f.nonce, now: now() };
      let claims;
      try {
        claims = verifyIdToken(exchange.json.id_token, { ...opts, keys: d.keys });
      } catch (err) {
        if (!(err instanceof OidcError) || err.code !== 'key') throw err;
        // Clé inconnue : le Board a peut-être changé de clé. On relit les clés une fois.
        d = await discover(r.issuer, { refreshKeys: true });
        claims = verifyIdToken(exchange.json.id_token, { ...opts, keys: d.keys });
      }

      const date = new Date(now()).toISOString();
      const name = String(claims.name || claims.preferred_username || claims.email || '').slice(0, 120);
      const email = String(claims.email || '').slice(0, 200);
      const cookies = [clearFlow];

      if (f.mode === 'link') {
        const fresh = read();
        // Un compte du Board ↔ un compte Emby : on remplace un lien existant de part et d'autre.
        const replaced = fresh.accounts.filter((a) => a.sub === claims.sub || a.embyUserId === f.link.embyUserId);
        fresh.accounts = fresh.accounts.filter((a) => !replaced.includes(a));
        if (fresh.accounts.length >= MAX_ACCOUNTS) throw new OidcError('full', 'Trop de comptes reliés.');
        // L'accès géré par le Board suit le compte du Board : gardé d'un lien à l'autre, ou donné par l'ID token.
        const prev = replaced.find((a) => a.sub === claims.sub);
        const kept = prev?.role ? { role: prev.role, values: prev.values, disabled: Boolean(prev.disabled) } : {};
        const given = accessClaim(claims, prev?.values);
        const access = given ? { ...given, disabled: false } : kept;
        const account = { sub: claims.sub, name, email, ...f.link, ...access, linkedAt: date, lastLogin: '' };
        fresh.accounts.push(account);
        write(fresh);
        f.link = null; // gardée : ne pas la fermer
        for (const a of replaced) if (a.token !== account.token) void emby.logout(a.token).catch(() => {});
        return { mode: 'link', account: publicAccount(account), cookies };
      }

      const fresh = read();
      const account = fresh.accounts.find((a) => a.sub === claims.sub);
      // Le compte Emby ne peut pas être créé par Soundy (il faut son mot de passe pour ouvrir une session) :
      // sans lien, même avec `kosmy_board_access`, la personne doit d'abord relier son compte dans Soundy.
      if (!account) throw new OidcError('not_linked', 'Ce compte Kosmy Board n’est relié à aucun compte Soundy.');
      // Accès donné par le Board (`kosmy_board_access`) : appliqué comme un PUT (compte réactivé), sauf s'il
      // retirait ses droits au dernier administrateur.
      const given = accessClaim(claims, account.values);
      const user = account.token ? await emby.check(account.token, account.embyUserId).catch(() => null) : null;
      if (given) {
        const wasAdmin = !account.disabled && (account.role ? account.role === 'admin' : Boolean(user?.isAdmin));
        if (!wasAdmin || given.role === 'admin' || (await otherAdmin(claims.sub))) {
          Object.assign(account, given, { disabled: false });
          write(fresh);
        }
      }
      if (account.disabled) throw new OidcError('disabled_account', 'Ce compte est désactivé dans Soundy.');
      if (!user) throw new OidcError('expired', 'La session Emby reliée à ce compte n’est plus valide. Reliez-le à nouveau depuis les réglages de Soundy.');
      account.name = name;
      account.email = email;
      account.embyUserName = user.name;
      account.lastLogin = date;
      write(fresh);
      purge();
      const ticket = random(24);
      tickets.set(ticket, { sub: claims.sub, exp: now() + TICKET_TTL });
      cookies.push(cookie(TICKET_COOKIE, ticket, { maxAge: TICKET_TTL, secure, path: SESSION_PATH }));
      return { mode: 'login', account: publicAccount(account), cookies };
    } finally {
      // Un lien abandonné en route : on ferme la session Emby ouverte pour lui.
      if (f?.link) void emby.logout(f.link.token).catch(() => {});
    }
  }

  /**
   * Échange le ticket du cookie contre la session Emby reliée (une seule fois).
   * Renvoie { session, cookie } ou lève une OidcError.
   */
  async function redeem({ base, req }) {
    const ticket = readCookies(req)[TICKET_COOKIE] || '';
    const t = ticket ? tickets.get(ticket) : null;
    if (t) tickets.delete(ticket);
    if (!t || t.exp < now()) throw new OidcError('state', 'Connexion expirée. Recommencez depuis Kosmy Board.');
    const account = accountBySub(t.sub);
    if (!account) throw new OidcError('not_linked', 'Ce compte Kosmy Board n’est relié à aucun compte Soundy.');
    if (account.disabled) throw new OidcError('disabled_account', 'Ce compte est désactivé dans Soundy.');
    const user = await check(account.token, account.embyUserId).catch(() => null);
    if (!user) throw new OidcError('expired', 'La session Emby reliée à ce compte n’est plus valide.');
    return {
      session: { server: account.server, userId: account.embyUserId, userName: user.name, token: account.token, isAdmin: user.isAdmin },
      cookie: cookie(TICKET_COOKIE, '', { maxAge: 0, secure: base.startsWith('https:'), path: SESSION_PATH }),
    };
  }

  /**
   * Prépare un lien pour la personne connectée : ouvre la session Emby dédiée avec son mot de passe
   * (vérifié tout de suite), puis lance le parcours du Board en mode « link ».
   */
  async function startLink({ base, user, password, server }) {
    if (!enabled()) throw new OidcError('disabled', 'La connexion avec Kosmy Board n’est pas réglée dans Soundy.');
    const publicServer = cleanServer(server);
    if (!publicServer) throw new OidcError('server', 'Adresse du serveur Emby invalide.');
    const auth = await emby.authenticate(user.name, password, `soundy-kosmy-board-${user.id}`);
    if (!auth || auth.userId !== user.id) {
      if (auth) await emby.logout(auth.token).catch(() => {});
      throw new OidcError('password', 'Mot de passe Emby incorrect.');
    }
    const link = { embyUserId: user.id, embyUserName: user.name, token: auth.token, server: publicServer };
    try {
      return await start({ base, mode: 'link', link });
    } catch (e) {
      await emby.logout(auth.token).catch(() => {});
      throw e;
    }
  }

  /* ---------- notifications ---------- */

  /**
   * Envoie une notification aux administrateurs de Soundy, par Kosmy Board. `url` : une page de Soundy
   * (relative, par exemple « /#/requests »). Renvoie { ok, delivered } ou { ok: false, error } :
   * « disabled » (Board non réglé), « unsupported » (Board trop ancien), « no_admin » (aucun administrateur
   * Emby relié), « unreachable », ou le code d'erreur du Board.
   */
  async function notifyAdmins({ title, body, url }) {
    const r = read();
    if (!enabled(r)) return { ok: false, error: 'disabled' };
    let endpoint;
    try {
      endpoint = (await discover(r.issuer)).doc.kosmy_notifications_endpoint;
    } catch {
      return { ok: false, error: 'unreachable' };
    }
    if (typeof endpoint !== 'string' || !/^https?:\/\//.test(endpoint)) return { ok: false, error: 'unsupported' };
    // Les administrateurs d'aujourd'hui : rôle choisi dans le Board, sinon on demande à Emby avec la session reliée.
    const checks = await Promise.all(
      r.accounts.filter((a) => !a.disabled).map((a) => check(a.token, a.embyUserId).then((u) => (u?.isAdmin ? a.sub : null)).catch(() => null)),
    );
    const to = checks.filter(Boolean);
    if (!to.length) return { ok: false, error: 'no_admin' };
    let res;
    try {
      res = await getJson(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: basicAuth(r.clientId, r.secret) },
        body: JSON.stringify({ title, body, url, to }),
      });
    } catch {
      return { ok: false, error: 'unreachable' };
    }
    if (!res.ok) return { ok: false, error: res.json?.error || `HTTP ${res.status}` };
    return { ok: true, delivered: Number(res.json?.delivered) || 0 };
  }

  /* ---------- admin dans le Board ---------- */

  const seenJti = new Map(); // jti → fin de validité (ms) : un jeton d'admin ne sert qu'une fois
  let keysRefreshedAt = 0;

  /**
   * Authentifie une requête de l'admin dans le Board : jeton (voir verifyAdminToken), jti jamais vu,
   * puis `sub` → compte relié. Renvoie { claims, account } (le compte complet, avec sa session Emby).
   * Lève une OidcError : « disabled », « token », « not_linked », ou une erreur de découverte.
   */
  async function authenticateAdmin({ authorization, method, path: wanted }) {
    const r = read();
    if (!enabled(r)) throw new OidcError('disabled', 'La connexion avec Kosmy Board n’est pas réglée dans Soundy.');
    const m = /^Bearer\s+([\w-]+\.[\w-]+\.[\w-]+)$/i.exec(String(authorization || ''));
    if (!m) throw new OidcError('token', 'Jeton du Board absent.');
    let d = await discover(r.issuer);
    const opts = { issuer: r.issuer, clientId: r.clientId, method, path: wanted, now: now() };
    let claims;
    try {
      claims = verifyAdminToken(m[1], { ...opts, keys: d.keys });
    } catch (err) {
      if (!(err instanceof OidcError) || err.code !== 'key' || now() - keysRefreshedAt < KEYS_REFRESH_DELAY) throw err;
      keysRefreshedAt = now();
      d = await discover(r.issuer, { refreshKeys: true });
      claims = verifyAdminToken(m[1], { ...opts, keys: d.keys });
    }
    const t = now();
    for (const [jti, end] of seenJti) if (end < t) seenJti.delete(jti);
    if (seenJti.has(claims.jti)) throw new OidcError('token', 'Jeton déjà utilisé.');
    seenJti.set(claims.jti, claims.exp * 1000 + ADMIN_SKEW * 1000);

    const account = r.accounts.find((a) => a.sub === claims.sub);
    if (!account) throw new OidcError('not_linked', 'Ce compte Kosmy Board n’est relié à aucun compte Soundy.');
    if (account.disabled) throw new OidcError('disabled_account', 'Ce compte est désactivé dans Soundy.');
    return { claims, account };
  }

  return {
    enabled: () => enabled(),
    settings,
    saveSettings,
    accountOf,
    accounts,
    unlink,
    start,
    finish,
    redeem,
    startLink,
    authenticateAdmin,
    notifyAdmins,
    publicAccount,
    applyAccess,
    valuesOf,
    linkedAccess,
    otherAdmin,
    setAccess,
    disable,
  };
}
