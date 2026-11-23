// Utilisateurs gérés par Kosmy Board (kosmy.board-users.v1) de bout en bout : un faux Board
// (OpenID Connect, revendication kosmy_board_access) et un faux Emby, puis le vrai serveur Soundy.
//   cd server && npm test
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/* ---------- petits outils ---------- */

function listen(handler) {
  return new Promise((resolve) => {
    const srv = createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}

const body = (req) => new Promise((resolve) => {
  let s = '';
  req.on('data', (c) => (s += c));
  req.on('end', () => resolve(s));
});

const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

/* ---------- faux Board ---------- */

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KID = 'k1';
const CLIENT_ID = 'soundy-client';
const SECRET = 'le-secret';
let board;
let issuer;
const codes = new Map(); // code → { sub, nonce, name, email, access? }

function sign(header, payload) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const data = `${enc({ alg: 'RS256', kid: KID, ...header })}.${enc(payload)}`;
  return `${data}.${createSign('RSA-SHA256').update(data).sign(privateKey).toString('base64url')}`;
}

const now = () => Math.floor(Date.now() / 1000);

function adminToken(sub, method, url, extra = {}) {
  return sign({ typ: 'kb-admin+jwt' }, { iss: issuer, aud: CLIENT_ID, sub, iat: now(), exp: now() + 60, jti: randomUUID(), htm: method, htu: url, name: 'Emanuel', email: 'e@example.test', ...extra });
}

/* ---------- faux Emby ---------- */

const USERS = {
  admin: { Id: 'u-admin', Name: 'admin', Policy: { IsAdministrator: true }, password: 'pw-admin' },
  bob: { Id: 'u-bob', Name: 'bob', Policy: { IsAdministrator: false }, password: 'pw-bob' },
  carol: { Id: 'u-carol', Name: 'carol', Policy: { IsAdministrator: false }, password: 'pw-carol' },
};
const tokens = new Map([['t-admin-app', 'u-admin'], ['t-bob-app', 'u-bob'], ['t-carol-app', 'u-carol']]); // jeton → utilisateur
const loggedOut = [];
let emby;

/* ---------- Soundy ---------- */

let soundy;
let child;
let dataDir;

before(async () => {
  board = await listen(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/oidc/.well-known/openid-configuration') {
      return json(res, 200, { issuer, authorization_endpoint: `${issuer}/auth`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` });
    }
    if (u.pathname === '/oidc/jwks') return json(res, 200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' }] });
    if (u.pathname === '/oidc/token' && req.method === 'POST') {
      const auth = Buffer.from(String(req.headers.authorization || '').replace(/^Basic /, ''), 'base64').toString();
      if (auth !== `${CLIENT_ID}:${SECRET}`) return json(res, 401, { error: 'invalid_client' });
      const p = new URLSearchParams(await body(req));
      const c = codes.get(p.get('code'));
      codes.delete(p.get('code'));
      if (!c || !p.get('code_verifier')) return json(res, 400, { error: 'invalid_grant' });
      const idToken = sign({}, {
        iss: issuer, aud: CLIENT_ID, sub: c.sub, iat: now(), exp: now() + 300, nonce: c.nonce, name: c.name, email: c.email,
        ...(c.access ? { kosmy_board_access: c.access } : {}),
      });
      return json(res, 200, { access_token: 'x', token_type: 'Bearer', id_token: idToken });
    }
    json(res, 404, {});
  });
  issuer = `${board.url}/oidc`;

  emby = await listen(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/System/Info/Public') return json(res, 200, { Id: 'emby', ServerName: 'Emby' });
    if (u.pathname === '/Users/AuthenticateByName' && req.method === 'POST') {
      const b = JSON.parse(await body(req));
      const user = Object.values(USERS).find((x) => x.Name === b.Username && x.password === b.Pw);
      if (!user) return json(res, 401, {});
      const token = `t-${user.Name}-${randomUUID()}`;
      tokens.set(token, user.Id);
      return json(res, 200, { AccessToken: token, User: { Id: user.Id, Name: user.Name, Policy: user.Policy } });
    }
    if (u.pathname === '/Sessions/Logout' && req.method === 'POST') {
      const token = req.headers['x-emby-token'];
      tokens.delete(token);
      loggedOut.push(token);
      res.writeHead(204);
      return res.end();
    }
    const m = /^\/Users\/([^/]+)$/.exec(u.pathname);
    if (m) {
      const owner = tokens.get(req.headers['x-emby-token']);
      if (!owner) return json(res, 401, {});
      const user = Object.values(USERS).find((x) => x.Id === m[1]);
      return json(res, 200, { Id: user.Id, Name: user.Name, Policy: user.Policy });
    }
    json(res, 404, {});
  });

  dataDir = mkdtempSync(path.join(tmpdir(), 'soundy-kb-users-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  soundy = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(here, '..', 'index.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, EMBY_URL: emby.url, WEBHOOK_URL: '', MAX_PENDING: '20' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => String(d).includes('écoute') && resolve());
    child.on('exit', (code) => reject(new Error(`Soundy s'est arrêté (${code})`)));
  });
});

after(() => {
  child?.kill();
  board?.srv.close();
  emby?.srv.close();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

/** Appel de l'API Soundy en tant qu'utilisateur Emby (jeton de l'appli). */
async function api(method, p, { token = 't-admin-app', user = 'u-admin', data, raw, headers = {} } = {}) {
  const res = await fetch(`${soundy}${p}`, {
    method,
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', 'Accept-Language': 'fr', ...(token ? { 'X-Emby-Token': token, 'X-Emby-UserId': user } : {}), ...headers },
    body: raw !== undefined ? raw : data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* pas du JSON */ }
  return { status: res.status, json: j, headers: res.headers };
}

/** Appel du Board : /api/kosmy-board/users[/{sub}] avec un jeton fait pour cette méthode et cette adresse. */
function users(method, sub, { as = EMANUEL.sub, data, raw, lang = 'fr', token } = {}) {
  const p = `/api/kosmy-board/users${sub ? `/${sub}` : ''}`;
  return api(method, p, { token: null, data, raw, headers: { 'Accept-Language': lang, Authorization: `Bearer ${token ?? adminToken(as, method, `${soundy}${p}`)}` } });
}

const cookieOf = (res) => (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ');

/** Retour du Board : simule l'autorisation (code ↔ nonce) puis appelle le callback de Soundy. */
async function boardReturn(authorizeUrl, flowCookie, who) {
  const a = new URL(authorizeUrl);
  const code = randomUUID();
  codes.set(code, { nonce: a.searchParams.get('nonce'), ...who });
  return fetch(`${soundy}/auth/kosmy-board/callback?code=${code}&state=${a.searchParams.get('state')}&iss=${encodeURIComponent(issuer)}`, {
    redirect: 'manual',
    headers: { Cookie: flowCookie },
  });
}

/** Relie le compte Emby (jeton de l'appli) au compte du Board `who`. */
async function link(appToken, userId, password, who) {
  const r = await api('POST', '/api/kosmy-board/link', { token: appToken, user: userId, data: { password, server: 'https://emby.example.test' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const back = await boardReturn(r.json.url, cookieOf(r), who);
  assert.equal(back.headers.get('location'), '/?kb=linked#/settings');
}

/** « Se connecter avec Kosmy Board » : renvoie l'adresse de retour dans l'appli et le ticket éventuel. */
async function boardLogin(who) {
  const start = await fetch(`${soundy}/auth/kosmy-board/login`, { redirect: 'manual' });
  const back = await boardReturn(start.headers.get('location'), cookieOf(start), who);
  return { location: back.headers.get('location'), ticket: cookieOf(back) };
}

const stored = () => JSON.parse(readFileSync(path.join(dataDir, 'kosmy-board.json'), 'utf8'));
const userOf = async (sub) => (await users('GET')).json.users.find((u) => u.sub === sub);

const EMANUEL = { sub: 'board-emanuel', name: 'Emanuel', email: 'e@example.test' };
const BOB = { sub: 'board-bob', name: 'Bob', email: 'bob@example.test' };
const CAROL = { sub: 'board-carol', name: 'Carol', email: 'carol@example.test' };
const NOBODY = 'b0a2c6d4-0000-4000-8000-000000000000';

/* ---------- tests (dans l'ordre) ---------- */

test('mise en place : Board réglé, admin et Bob reliés', async () => {
  // Le serveur cherche Emby au démarrage : on attend qu'il l'ait trouvé.
  for (let i = 0; i < 100; i++) {
    const h = await api('GET', '/api/health', { token: null });
    if (h.json?.emby?.reachable) break;
    await new Promise((res) => setTimeout(res, 30));
  }
  const r = await api('PUT', '/api/kosmy-board/settings', { data: { issuer, clientId: CLIENT_ID, secret: SECRET } });
  assert.equal(r.status, 200);
  await link('t-admin-app', 'u-admin', 'pw-admin', EMANUEL);
  await link('t-bob-app', 'u-bob', 'pw-bob', BOB);
});

test('GET : rôles, restrictions et comptes reliés (rôle lu dans Emby tant que le Board ne l’a pas choisi)', async () => {
  const r = await users('GET');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(r.headers.get('content-type'), /application\/json/);
  assert.equal(r.json.protocol, 'kosmy.board-users.v1');
  assert.deepEqual(r.json.roles.map((x) => [x.value, Boolean(x.admin)]), [['admin', true], ['member', false]]);
  assert.equal(r.json.defaultRole, 'member');
  assert.deepEqual(r.json.fields.map((f) => [f.name, f.type, f.value, f.min]), [['maxPending', 'number', 20, 0]]);
  const bySub = Object.fromEntries(r.json.users.map((u) => [u.sub, u]));
  assert.deepEqual(bySub[EMANUEL.sub], { sub: EMANUEL.sub, role: 'admin', values: { maxPending: 20 }, active: true, account: 'admin' });
  assert.deepEqual(bySub[BOB.sub], { sub: BOB.sub, role: 'member', values: { maxPending: 20 }, active: true, account: 'bob' });
  // Jamais de secret : ni session Emby, ni secret client.
  assert.ok(!/t-(admin|bob)-|le-secret/.test(JSON.stringify(r.json)));

  const en = await users('GET', '', { lang: 'en' });
  assert.equal(en.json.roles[0].label, 'Administrator');
});

test('jeton : absent, invalide, rejoué, mauvaise méthode, mauvaise adresse, compte non relié ou non admin', async () => {
  const p = '/api/kosmy-board/users';
  assert.equal((await api('GET', p, { token: null })).status, 401);
  assert.equal((await users('GET', '', { token: 'pas.un.jeton' })).status, 401);
  const once = adminToken(EMANUEL.sub, 'GET', `${soundy}${p}`);
  assert.equal((await users('GET', '', { token: once })).status, 200);
  const replay = await users('GET', '', { token: once });
  assert.equal(replay.status, 401);
  assert.equal(replay.json.error, 'invalid_token');
  // Fait pour GET, présenté avec PUT ; fait pour /users, présenté sur /users/{sub}.
  assert.equal((await users('PUT', BOB.sub, { data: { role: 'member' }, token: adminToken(EMANUEL.sub, 'GET', `${soundy}${p}/${BOB.sub}`) })).status, 401);
  assert.equal((await users('DELETE', BOB.sub, { token: adminToken(EMANUEL.sub, 'DELETE', `${soundy}${p}`) })).status, 401);
  // Un jeton de l'admin (chemin /admin) ne sert pas ici, ni un ID token.
  assert.equal((await users('GET', '', { token: adminToken(EMANUEL.sub, 'GET', `${soundy}/api/kosmy-board/admin`) })).status, 401);
  const idLike = sign({}, { iss: issuer, aud: CLIENT_ID, sub: EMANUEL.sub, iat: now(), exp: now() + 60, jti: randomUUID(), htm: 'GET', htu: `${soundy}${p}` });
  assert.equal((await users('GET', '', { token: idLike })).status, 401);

  const unknown = await users('GET', '', { as: NOBODY });
  assert.equal(unknown.status, 403);
  assert.equal(unknown.json.error, 'not_linked');
  const member = await users('GET', '', { as: BOB.sub });
  assert.equal(member.status, 403);
  assert.equal(member.json.error, 'forbidden');

  assert.equal((await users('GET', BOB.sub)).status, 405);
  assert.equal((await users('PUT', 'pas_un/sub')).status, 404);
});

test('PUT : sub non relié → 409 qui explique de relier le compte Emby', async () => {
  const r = await users('PUT', NOBODY, { data: { name: 'Zoé', email: 'zoe@example.test', locale: 'fr', role: 'member', values: { maxPending: 3 } } });
  assert.equal(r.status, 409);
  assert.equal(r.json.error, 'conflict');
  assert.match(r.json.message, /Relier à Kosmy Board/);
  const en = await users('PUT', NOBODY, { lang: 'en', data: { role: 'member' } });
  assert.match(en.json.message, /Link to Kosmy Board/);
  assert.equal(await userOf(NOBODY), undefined);
});

test('PUT : valeurs refusées → 422 avec un message', async () => {
  for (const data of [{ role: 'owner' }, { role: 'member', values: { maxPending: -1 } }, { role: 'member', values: { maxPending: 2.5 } }, { role: 'member', values: { maxPending: '3' } }, { role: 'member', values: [] }]) {
    const r = await users('PUT', BOB.sub, { data });
    assert.equal(r.status, 422, JSON.stringify(data));
    assert.equal(r.json.error, 'invalid');
    assert.ok(r.json.message);
  }
  assert.match((await users('PUT', BOB.sub, { lang: 'en', data: { role: 'boss' } })).json.message, /Unknown role/);
  assert.equal((await users('PUT', BOB.sub, { raw: '{pas du json' })).status, 400);
  assert.equal((await users('PUT', BOB.sub, { data: ['member'] })).status, 400);
  // Rien n'a changé.
  assert.deepEqual((await userOf(BOB.sub)).values, { maxPending: 20 });
});

test('PUT : rôle et restriction appliqués par Soundy, idempotent', async () => {
  const put = { name: 'Bob B.', email: 'bob@example.test', locale: 'fr', role: 'member', values: { maxPending: 1 } };
  const r = await users('PUT', BOB.sub, { data: put });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true, status: 'updated', account: 'bob', message: 'Compte mis à jour.' });
  const again = await users('PUT', BOB.sub, { data: put });
  assert.equal(again.json.status, 'updated');
  assert.deepEqual(await userOf(BOB.sub), { sub: BOB.sub, role: 'member', values: { maxPending: 1 }, active: true, account: 'bob' });
  assert.equal(stored().accounts.find((a) => a.sub === BOB.sub).name, 'Bob B.');

  // maxPending = 1 : une demande en attente, pas deux.
  const bob = { token: 't-bob-app', user: 'u-bob' };
  assert.equal((await api('GET', '/api/me', bob)).json.maxPending, 1);
  const first = await api('POST', '/api/requests', { ...bob, data: { type: 'album', artist: 'Air', album: 'Moon Safari' } });
  assert.equal(first.status, 201);
  assert.equal((await api('POST', '/api/requests', { ...bob, data: { type: 'album', artist: 'Air', album: 'Talkie Walkie' } })).status, 429);
  await api('DELETE', `/api/requests/${first.json.id}`, bob);

  // maxPending = 0 : aucune demande. Un champ absent garde sa valeur.
  await users('PUT', BOB.sub, { data: { role: 'member', values: { maxPending: 0 } } });
  const off = await api('POST', '/api/requests', { ...bob, data: { type: 'album', artist: 'Air', album: 'Moon Safari' } });
  assert.equal(off.status, 403);
  assert.match(off.json.error, /ne peut pas faire de demande/);
  await users('PUT', BOB.sub, { data: { role: 'member' } });
  assert.deepEqual((await userOf(BOB.sub)).values, { maxPending: 0 });
  await users('PUT', BOB.sub, { data: { role: 'member', values: { maxPending: 20 } } });
  assert.equal((await api('POST', '/api/requests', { ...bob, data: { type: 'album', artist: 'Air', album: 'Moon Safari' } })).status, 201);
});

test('PUT : le rôle « admin » du Board donne les droits d’administration de Soundy (et « member » les retire)', async () => {
  const bob = { token: 't-bob-app', user: 'u-bob' };
  assert.equal((await api('GET', '/api/requests?scope=all', bob)).status, 403);
  assert.equal((await users('PUT', BOB.sub, { data: { role: 'admin' } })).status, 200);
  assert.equal((await api('GET', '/api/me', bob)).json.isAdmin, true);
  assert.equal((await api('GET', '/api/requests?scope=all', bob)).status, 200);
  assert.equal((await users('GET', '', { as: BOB.sub })).status, 200); // Bob peut maintenant gérer les utilisateurs depuis le Board
  const admin = await api('GET', '/api/kosmy-board/admin', { token: null, headers: { Authorization: `Bearer ${adminToken(BOB.sub, 'GET', `${soundy}/api/kosmy-board/admin`)}` } });
  assert.equal(admin.status, 200);

  // Bob (admin) retire les droits de l'admin Emby dans Soundy : il reste un administrateur (Bob).
  assert.equal((await users('PUT', EMANUEL.sub, { as: BOB.sub, data: { role: 'member' } })).status, 200);
  assert.equal((await api('GET', '/api/me')).json.isAdmin, false);
  assert.equal((await api('GET', '/api/requests?scope=all')).status, 403);
  assert.equal((await users('PUT', EMANUEL.sub, { as: BOB.sub, data: { role: 'admin' } })).status, 200);
  assert.equal((await api('GET', '/api/me')).json.isAdmin, true);

  assert.equal((await users('PUT', BOB.sub, { data: { role: 'member' } })).status, 200);
  assert.equal((await api('GET', '/api/me', bob)).json.isAdmin, false);
});

test('garde-fous : pas d’auto-retrait des droits, pas d’auto-désactivation', async () => {
  const self = await users('PUT', EMANUEL.sub, { data: { role: 'member' } });
  assert.equal(self.status, 409);
  assert.match(self.json.message, /vos propres droits/);
  const del = await users('DELETE', EMANUEL.sub);
  assert.equal(del.status, 409);
  assert.match(del.json.message, /votre propre accès/);
  // Se garder admin en changeant ses restrictions : permis.
  assert.equal((await users('PUT', EMANUEL.sub, { data: { role: 'admin', values: { maxPending: 50 } } })).status, 200);
  assert.equal((await userOf(EMANUEL.sub)).role, 'admin');
});

test('DELETE : accès retiré partout, session dédiée fermée, puis PUT le rétablit', async () => {
  const bobToken = stored().accounts.find((a) => a.sub === BOB.sub).token;
  assert.ok(bobToken);
  const r = await users('DELETE', BOB.sub);
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok(loggedOut.includes(bobToken)); // la session Emby dédiée (celle des connexions par le Board) est fermée
  assert.deepEqual(await userOf(BOB.sub), { sub: BOB.sub, role: 'member', values: { maxPending: 20 }, active: false, account: 'bob' });
  assert.deepEqual(await users('DELETE', BOB.sub).then((x) => x.json), { ok: true }); // déjà fait
  assert.deepEqual(await users('DELETE', NOBODY).then((x) => x.json), { ok: true }); // rien à retirer

  // Session ouverte par mot de passe : refusée par le serveur Soundy (l'appli se déconnecte).
  const bob = { token: 't-bob-app', user: 'u-bob' };
  const me = await api('GET', '/api/me', bob);
  assert.equal(me.status, 403);
  assert.equal(me.json.code, 'account_disabled');
  assert.equal((await api('POST', '/api/requests', { ...bob, data: { type: 'album', artist: 'Air', album: 'Moon Safari' } })).status, 403);
  assert.equal((await api('POST', '/api/kosmy-board/link', { ...bob, data: { password: 'pw-bob', server: 'https://emby.example.test' } })).status, 403);
  // Connexion par le Board : refusée.
  assert.equal((await boardLogin(BOB)).location, '/?kb_error=disabled_account');
  // Admin dans le Board et utilisateurs : refusés.
  const adm = await api('GET', '/api/kosmy-board/admin', { token: null, headers: { Authorization: `Bearer ${adminToken(BOB.sub, 'GET', `${soundy}/api/kosmy-board/admin`)}` } });
  assert.equal(adm.status, 403);
  assert.equal(adm.json.error, 'forbidden');
  // Le délier depuis l'admin du Board lèverait le blocage : refusé.
  const p = '/api/kosmy-board/admin/accounts';
  const accounts = await api('GET', p, { token: null, headers: { Authorization: `Bearer ${adminToken(EMANUEL.sub, 'GET', `${soundy}${p}`)}` } });
  const row = accounts.json.blocks[0].rows.find((x) => x.id === BOB.sub);
  assert.deepEqual(row.actions, []);
  assert.equal(row.cells.access.tone, 'danger');
  const unlink = await api('POST', p, { token: null, data: { action: 'unlink', row: BOB.sub }, headers: { Authorization: `Bearer ${adminToken(EMANUEL.sub, 'POST', `${soundy}${p}`)}` } });
  assert.equal(unlink.status, 409);

  // PUT : réactivé. La session dédiée ayant été fermée, il faudra relier à nouveau pour la connexion par le Board.
  const back = await users('PUT', BOB.sub, { data: { role: 'member', values: { maxPending: 4 } } });
  assert.equal(back.status, 200);
  assert.equal(back.json.status, 'updated');
  assert.match(back.json.message, /relier à nouveau/);
  assert.equal((await userOf(BOB.sub)).active, true);
  assert.equal((await api('GET', '/api/me', bob)).status, 200);
  assert.equal((await boardLogin(BOB)).location, '/?kb_error=expired');
  await link('t-bob-app', 'u-bob', 'pw-bob', BOB);
  // Le rôle et les restrictions suivent le compte du Board d'un lien à l'autre.
  assert.deepEqual(await userOf(BOB.sub), { sub: BOB.sub, role: 'member', values: { maxPending: 4 }, active: true, account: 'bob' });
  const login = await boardLogin(BOB);
  assert.equal(login.location, '/?kb=1');
  const s = await api('POST', '/api/kosmy-board/session', { token: null, headers: { Cookie: login.ticket } });
  assert.equal(s.status, 200);
  assert.equal(s.json.isAdmin, false);
});

test('connexion par le Board : kosmy_board_access appliqué comme un PUT', async () => {
  // Bob reçoit le rôle admin et une restriction dans l'ID token.
  const login = await boardLogin({ ...BOB, access: { role: 'admin', values: { maxPending: 7 } } });
  assert.equal(login.location, '/?kb=1');
  assert.deepEqual(await userOf(BOB.sub), { sub: BOB.sub, role: 'admin', values: { maxPending: 7 }, active: true, account: 'bob' });
  const s = await api('POST', '/api/kosmy-board/session', { token: null, headers: { Cookie: login.ticket } });
  assert.equal(s.json.isAdmin, true);

  // Une revendication refusée par les règles de Soundy est ignorée : la connexion se fait avec l'accès actuel.
  assert.equal((await boardLogin({ ...BOB, access: { role: 'boss' } })).location, '/?kb=1');
  assert.equal((await userOf(BOB.sub)).role, 'admin');

  // Accès retiré puis rendu par le Board : la revendication réactive le compte (la session dédiée, fermée, est à relier).
  await users('DELETE', BOB.sub);
  assert.equal((await boardLogin(BOB)).location, '/?kb_error=disabled_account');
  assert.equal((await boardLogin({ ...BOB, access: { role: 'member', values: { maxPending: 2 } } })).location, '/?kb_error=expired');
  assert.deepEqual(await userOf(BOB.sub), { sub: BOB.sub, role: 'member', values: { maxPending: 2 }, active: true, account: 'bob' });
  await link('t-bob-app', 'u-bob', 'pw-bob', BOB);

  // Sans lien, la revendication ne crée pas de compte (Soundy ne peut pas créer de compte Emby).
  assert.equal((await boardLogin({ ...CAROL, access: { role: 'member' } })).location, '/?kb_error=not_linked');
  // Au moment du lien, elle s'applique.
  const r = await api('POST', '/api/kosmy-board/link', { token: 't-carol-app', user: 'u-carol', data: { password: 'pw-carol', server: 'https://emby.example.test' } });
  await boardReturn(r.json.url, cookieOf(r), { ...CAROL, access: { role: 'member', values: { maxPending: 0 } } });
  assert.deepEqual(await userOf(CAROL.sub), { sub: CAROL.sub, role: 'member', values: { maxPending: 0 }, active: true, account: 'carol' });
  assert.equal((await api('POST', '/api/requests', { token: 't-carol-app', user: 'u-carol', data: { type: 'album', artist: 'Air', album: 'Moon Safari' } })).status, 403);
});

test('connexion par le Board : la revendication ne retire jamais ses droits au dernier administrateur', async () => {
  // Plus qu'un administrateur : l'admin Emby (Bob et Carol sont membres).
  await users('PUT', BOB.sub, { data: { role: 'member' } });
  const login = await boardLogin({ ...EMANUEL, access: { role: 'member' } });
  assert.equal(login.location, '/?kb=1');
  assert.equal((await userOf(EMANUEL.sub)).role, 'admin');
  assert.equal((await api('GET', '/api/me')).json.isAdmin, true);
});
