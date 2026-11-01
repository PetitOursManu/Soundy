// ============================================================================
// Serveur Soundy
//  - API des demandes d'ajout de musique (/api/requests)
//  - Sert l'application web compilée (dossier dist/)
//  - (option) Proxy vers Emby (/emby) pour contourner les problèmes de CORS
//
// Variables d'environnement :
//   EMBY_URL      URL interne d'Emby, ex : http://emby:8096   (obligatoire)
//   PORT          Port d'écoute (défaut 8080)
//   DATA_DIR      Dossier de stockage des demandes (défaut ./data)
//   CORS_ORIGINS  Origines autorisées, séparées par des virgules (défaut *)
//   WEBHOOK_URL   (option) Notification à chaque nouvelle demande : Discord, ntfy,
//                 Gotify, Slack, Mattermost… (service détecté d'après l'adresse)
//   WEBHOOK_TYPE  (option) Force le format : discord | slack | gotify | ntfy | json
//   NOTIFY_LANG   (option) Langue des notifications : fr (défaut) | en
//   EMBY_PROXY    (option) "true" pour activer le proxy /emby → EMBY_URL
//   MAX_PENDING   Nombre max de demandes en attente par utilisateur (défaut 20)
// ============================================================================
import express from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
// Adresse d'Emby nettoyée (espaces, guillemets, « / » final, « /web/index.html »)
const EMBY_URL = (process.env.EMBY_URL || '')
  .trim()
  .replace(/^["']|["']$/g, '')
  .replace(/\/web(\/index\.html)?\/?$/i, '')
  .replace(/\/+$/, '');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const DATA_FILE = path.join(DATA_DIR, 'requests.json');
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
const WEBHOOK_URL = (process.env.WEBHOOK_URL || '').trim().replace(/^["']|["']$/g, '');
const EMBY_PROXY = /^(1|true|yes)$/i.test(process.env.EMBY_PROXY || '');
const MAX_PENDING = Number(process.env.MAX_PENDING || 20);

if (!EMBY_URL) {
  console.warn('⚠️  EMBY_URL n’est pas défini : les demandes seront refusées (impossible de vérifier les utilisateurs).');
}

// ----------------------------------------------------------------------------
// Messages d'erreur (français / anglais selon l'en-tête Accept-Language)
// ----------------------------------------------------------------------------
const MESSAGES = {
  authRequired: ['Authentification requise.', 'Authentication required.'],
  misconfigured: ['Serveur mal configuré (EMBY_URL manquant).', 'Server misconfigured (EMBY_URL missing).'],
  embyUnreachable: ['Serveur Emby injoignable.', 'Emby server unreachable.'],
  invalidSession: ['Session Emby invalide.', 'Invalid Emby session.'],
  adminOnly: ['Réservé aux administrateurs.', 'Administrators only.'],
  badType: ['Type de demande invalide.', 'Invalid request type.'],
  needArtist: ["Le nom de l'artiste est obligatoire.", 'The artist name is required.'],
  needAlbum: ["Le nom de l'album est obligatoire.", 'The album name is required.'],
  needTrack: ['Indiquez au moins un titre.', 'Enter at least one track.'],
  tooMany: ['Vous avez déjà {n} demandes en attente. Patientez un peu 🙂', 'You already have {n} pending requests. Please wait a little 🙂'],
  notFound: ['Demande introuvable.', 'Request not found.'],
  badStatus: ['Statut invalide.', 'Invalid status.'],
  forbidden: ['Action non autorisée.', 'Action not allowed.'],
  unknownRoute: ['Route inconnue.', 'Unknown route.'],
  webhookMissing: ["Aucune notification configurée : renseignez la variable WEBHOOK_URL du serveur Soundy.", 'No notification configured: set the WEBHOOK_URL variable on the Soundy server.'],
  webhookFailed: ['Échec de l’envoi ({type}) : {error}. Vérifiez l’adresse WEBHOOK_URL.', 'Sending failed ({type}): {error}. Check the WEBHOOK_URL address.'],
};

function msg(req, key, vars = {}) {
  const en = /^en/i.test(req.get('Accept-Language') || '');
  return MESSAGES[key][en ? 1 : 0].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

/** Erreur portant une clé de message traduisible. */
const fail = (key, status) => Object.assign(new Error(key), { key, status });

// ----------------------------------------------------------------------------
// Stockage JSON (écriture atomique, sérialisée)
// ----------------------------------------------------------------------------
let requests = [];
let writing = Promise.resolve();

async function loadStore() {
  await mkdir(DATA_DIR, { recursive: true });
  if (existsSync(DATA_FILE)) {
    try {
      requests = JSON.parse(await readFile(DATA_FILE, 'utf8'));
    } catch (e) {
      console.error('Fichier de demandes illisible, sauvegarde puis réinitialisation :', e.message);
      await rename(DATA_FILE, `${DATA_FILE}.corrupt-${Date.now()}`);
      requests = [];
    }
  }
}

function saveStore() {
  writing = writing.then(async () => {
    const tmp = `${DATA_FILE}.tmp`;
    await writeFile(tmp, JSON.stringify(requests, null, 2));
    await rename(tmp, DATA_FILE);
  }).catch((e) => console.error('Erreur d’écriture :', e));
  return writing;
}

// ----------------------------------------------------------------------------
// Authentification : on vérifie le jeton Emby auprès du serveur Emby
// ----------------------------------------------------------------------------
const authCache = new Map(); // token → { user, expires }

// ----------------------------------------------------------------------------
// Adresse réelle d'Emby : comme l'application, on essaie aussi le suffixe /emby
// ----------------------------------------------------------------------------
let embyBase = null; // adresse qui répond (null = pas encore trouvée)
let embyCheckedAt = 0;

async function probeEmby(base) {
  try {
    const r = await fetch(`${base}/System/Info/Public`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return false;
    const d = await r.json();
    return !!(d && (d.Id || d.ServerName));
  } catch {
    return false;
  }
}

async function resolveEmby(force = false) {
  if (!EMBY_URL) return null;
  if (embyBase && !force) return embyBase;
  if (!force && Date.now() - embyCheckedAt < 15_000) return embyBase; // évite de marteler un serveur absent
  embyCheckedAt = Date.now();
  for (const candidate of [EMBY_URL, /\/emby$/i.test(EMBY_URL) ? null : `${EMBY_URL}/emby`]) {
    if (candidate && (await probeEmby(candidate))) {
      if (candidate !== embyBase) console.log(`✅ Emby joignable : ${candidate}`);
      embyBase = candidate;
      return embyBase;
    }
  }
  console.warn(`⚠️  Emby injoignable depuis le serveur Soundy (EMBY_URL = ${EMBY_URL}). Vérifiez l'adresse.`);
  return null;
}

async function verifyUser(token, userId) {
  if (!EMBY_URL) throw fail('misconfigured', 500);
  const base = await resolveEmby();
  if (!base) throw fail('embyUnreachable', 502);
  const key = `${token}:${userId}`;
  const cached = authCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.user;

  const res = await fetch(`${base}/Users/${encodeURIComponent(userId)}`, {
    headers: { 'X-Emby-Token': token },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res) throw fail('embyUnreachable', 502);
  if (!res.ok) throw fail('invalidSession', 401);
  const data = await res.json();
  if (data.Id !== userId) throw fail('invalidSession', 401);

  const user = { id: data.Id, name: data.Name, isAdmin: !!data.Policy?.IsAdministrator };
  authCache.set(key, { user, expires: Date.now() + 5 * 60_000 });
  if (authCache.size > 1000) authCache.delete(authCache.keys().next().value);
  return user;
}

async function auth(req, res, next) {
  const token = req.get('X-Emby-Token');
  const userId = req.get('X-Emby-UserId');
  if (!token || !userId) return res.status(401).json({ error: msg(req, 'authRequired') });
  try {
    req.user = await verifyUser(token, userId);
    next();
  } catch (e) {
    res.status(e.status || 500).json({ error: e.key ? msg(req, e.key) : e.message });
  }
}

// ----------------------------------------------------------------------------
// Notification (webhook)
// ----------------------------------------------------------------------------
// Format du message selon le service, détecté d'après l'adresse
// (forçable avec WEBHOOK_TYPE = discord | slack | gotify | ntfy | json)
function webhookType(url) {
  const forced = (process.env.WEBHOOK_TYPE || '').toLowerCase();
  if (forced) return forced;
  if (/discord(app)?\.com\/api\/webhooks/i.test(url)) return 'discord';
  if (/hooks\.slack\.com|\/hooks\//i.test(url)) return 'slack'; // Slack, Mattermost, Rocket.Chat
  if (/\/message\?token=/i.test(url)) return 'gotify';
  if (/ntfy/i.test(url)) return 'ntfy';
  return 'json';
}

/** Envoie une notification ; renvoie { ok, type, status?, error? }. */
async function sendWebhook(title, text) {
  if (!WEBHOOK_URL) return { ok: false, error: 'not-configured' };
  const type = webhookType(WEBHOOK_URL);
  let url = WEBHOOK_URL;
  let init;
  switch (type) {
    case 'discord':
      init = { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Soundy', content: `**${title}**\n${text}` }) };
      break;
    case 'slack':
      init = { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: `*${title}*\n${text}` }) };
      break;
    case 'gotify':
      init = { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, message: text, priority: 5 }) };
      break;
    case 'ntfy':
      // ntfy : le corps est le message ; titre et icône passent dans l'adresse (accents / emojis sûrs)
      url = `${WEBHOOK_URL}${WEBHOOK_URL.includes('?') ? '&' : '?'}title=${encodeURIComponent(title)}&tags=musical_note`;
      init = { headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: text };
      break;
    default:
      init = { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, message: text, text, content: `${title}\n${text}` }) };
  }
  try {
    const res = await fetch(url, { method: 'POST', ...init, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false, type, status: res.status, error: `HTTP ${res.status}` };
    return { ok: true, type };
  } catch (e) {
    return { ok: false, type, error: e.message };
  }
}

/** Langue des notifications envoyées à l'administrateur (NOTIFY_LANG = fr | en). */
const NOTIFY_EN = /^en/i.test(process.env.NOTIFY_LANG || '');

async function notify(r) {
  if (!WEBHOOK_URL) return;
  const quoted = (x) => (NOTIFY_EN ? `“${x}”` : `« ${x} »`);
  const what =
    r.type === 'album'
      ? NOTIFY_EN
        ? `the album ${quoted(r.album)} by ${r.artist}`
        : `l’album ${quoted(r.album)} de ${r.artist}`
      : NOTIFY_EN
        ? `${r.tracks.length} track(s) by ${r.artist}: ${r.tracks.map(quoted).join(', ')}`
        : `${r.tracks.length} titre(s) de ${r.artist} : ${r.tracks.map(quoted).join(', ')}`;
  const title = NOTIFY_EN ? '🎵 New Soundy request' : '🎵 Nouvelle demande Soundy';
  const text = `${r.userName} ${NOTIFY_EN ? 'asks for' : 'demande'} ${what}${r.comment ? `\n💬 ${r.comment}` : ''}`;
  const result = await sendWebhook(title, text);
  if (!result.ok) console.warn(`Notification (${result.type}) en échec :`, result.error);
}

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------
const str = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

function validateNew(body) {
  const type = body?.type === 'tracks' ? 'tracks' : body?.type === 'album' ? 'album' : null;
  if (!type) return { error: 'badType' };
  const artist = str(body.artist, 120);
  const album = str(body.album, 160);
  const tracks = Array.isArray(body.tracks) ? body.tracks.map((t) => str(t, 160)).filter(Boolean).slice(0, 30) : [];
  const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 500) : '';
  if (!artist) return { error: 'needArtist' };
  if (type === 'album' && !album) return { error: 'needAlbum' };
  if (type === 'tracks' && !tracks.length) return { error: 'needTrack' };
  return { value: { type, artist, album: album || undefined, tracks: type === 'tracks' ? tracks : [], comment: comment || undefined } };
}

// ----------------------------------------------------------------------------
// Application
// ----------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

// CORS (nécessaire pour l'application Android ou une app web hébergée ailleurs)
app.use('/api', (req, res, next) => {
  const origin = req.get('Origin');
  if (origin && (CORS_ORIGINS.includes('*') || CORS_ORIGINS.includes(origin))) {
    res.set('Access-Control-Allow-Origin', CORS_ORIGINS.includes('*') ? '*' : origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Emby-Token, X-Emby-UserId, Accept-Language');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.set('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/api', express.json({ limit: '32kb' }));

// Diagnostic (sans aucune donnée sensible) : à ouvrir dans un navigateur
// https://votre-soundy/api/health
app.get('/api/health', async (_req, res) => {
  const base = await resolveEmby();
  res.json({
    ok: true,
    name: 'soundy',
    emby: { configured: !!EMBY_URL, reachable: !!base, url: base ?? (EMBY_URL || null) },
    notify: { configured: !!WEBHOOK_URL, type: WEBHOOK_URL ? webhookType(WEBHOOK_URL) : null },
  });
});

// Notification de test (admin) : vérifie le réglage WEBHOOK_URL
app.post('/api/notify/test', auth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: msg(req, 'adminOnly') });
  if (!WEBHOOK_URL) return res.status(400).json({ error: msg(req, 'webhookMissing') });
  const en = /^en/i.test(req.get('Accept-Language') || '');
  const result = await sendWebhook(
    en ? '🔔 Soundy notification test' : '🔔 Test de notification Soundy',
    en ? `It works! New music requests will be sent here. (${req.user.name})` : `Ça fonctionne ! Les nouvelles demandes de musique arriveront ici. (${req.user.name})`,
  );
  if (!result.ok) return res.status(502).json({ error: msg(req, 'webhookFailed', { type: result.type, error: result.error }) });
  res.json({ ok: true, type: result.type });
});

app.get('/api/notify/status', auth, (req, res) => {
  res.json({ configured: !!WEBHOOK_URL, type: WEBHOOK_URL ? webhookType(WEBHOOK_URL) : null });
});

// Liste des demandes : les miennes, ou toutes (admin)
app.get('/api/requests', auth, (req, res) => {
  const scope = req.query.scope === 'all' ? 'all' : 'mine';
  if (scope === 'all' && !req.user.isAdmin) return res.status(403).json({ error: msg(req, 'adminOnly') });
  const list = scope === 'all' ? requests : requests.filter((r) => r.userId === req.user.id);
  res.json([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});

// Nouvelle demande
app.post('/api/requests', auth, async (req, res) => {
  const { value, error } = validateNew(req.body);
  if (error) return res.status(400).json({ error: msg(req, error) });
  const pending = requests.filter((r) => r.userId === req.user.id && r.status === 'pending').length;
  if (pending >= MAX_PENDING) {
    return res.status(429).json({ error: msg(req, 'tooMany', { n: pending }) });
  }
  const now = new Date().toISOString();
  const r = { id: randomUUID(), ...value, status: 'pending', userId: req.user.id, userName: req.user.name, createdAt: now, updatedAt: now };
  requests.push(r);
  await saveStore();
  notify(r);
  console.log(`[demande] ${r.userName} → ${r.type === 'album' ? r.album : r.tracks.join(', ')} (${r.artist})`);
  res.status(201).json(r);
});

// Mise à jour du statut (admin)
app.patch('/api/requests/:id', auth, async (req, res) => {
  if (!req.user.isAdmin) return res.status(403).json({ error: msg(req, 'adminOnly') });
  const r = requests.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: msg(req, 'notFound') });
  const status = req.body?.status;
  if (!['pending', 'added', 'refused'].includes(status)) return res.status(400).json({ error: msg(req, 'badStatus') });
  r.status = status;
  r.adminNote = typeof req.body.adminNote === 'string' && req.body.adminNote.trim() ? req.body.adminNote.trim().slice(0, 500) : undefined;
  r.updatedAt = new Date().toISOString();
  await saveStore();
  res.json(r);
});

// Suppression : l'auteur (si en attente) ou un admin
app.delete('/api/requests/:id', auth, async (req, res) => {
  const i = requests.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: msg(req, 'notFound') });
  const r = requests[i];
  const own = r.userId === req.user.id && r.status === 'pending';
  if (!own && !req.user.isAdmin) return res.status(403).json({ error: msg(req, 'forbidden') });
  requests.splice(i, 1);
  await saveStore();
  res.json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ error: msg(req, 'unknownRoute') }));

// ----------------------------------------------------------------------------
// Proxy Emby optionnel : https://soundy.exemple.fr/emby/... → EMBY_URL/...
// ----------------------------------------------------------------------------
if (EMBY_PROXY && EMBY_URL) {
  const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'host', 'content-length']);
  app.use('/emby', async (req, res) => {
    const target = `${EMBY_URL}${req.url}`;
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k) && typeof v === 'string') headers[k] = v;
    try {
      const upstream = await fetch(target, {
        method: req.method,
        headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : req,
        duplex: 'half',
        redirect: 'manual',
      });
      res.status(upstream.status);
      upstream.headers.forEach((v, k) => {
        if (!HOP.has(k) && k !== 'content-encoding') res.setHeader(k, v);
      });
      if (upstream.headers.get('content-length') && !upstream.headers.get('content-encoding')) {
        res.setHeader('content-length', upstream.headers.get('content-length'));
      }
      if (!upstream.body) return res.end();
      Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
    } catch (e) {
      res.status(502).json({ error: 'Emby injoignable' });
    }
  });
  console.log(`↪︎  Proxy Emby actif : /emby → ${EMBY_URL}`);
}

// ----------------------------------------------------------------------------
// Application web
// ----------------------------------------------------------------------------
if (existsSync(DIST_DIR)) {
  app.use(
    express.static(DIST_DIR, {
      index: 'index.html',
      setHeaders(res, file) {
        if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        else res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.get('*', (_req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
} else {
  app.get('/', (_req, res) => res.send('Soundy : lancez « npm run build » pour générer l’application web.'));
}

await loadStore();
app.listen(PORT, () => {
  console.log(`🎧 Soundy écoute sur http://0.0.0.0:${PORT}  (Emby : ${EMBY_URL || 'non configuré'})`);
  console.log(`🔔 Notifications des demandes : ${WEBHOOK_URL ? `activées (${webhookType(WEBHOOK_URL)})` : 'désactivées (WEBHOOK_URL vide)'}`);
  void resolveEmby(true);
});
