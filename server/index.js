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
//   WEBHOOK_URL   (option) Webhook notifié à chaque nouvelle demande
//                 (compatible Discord, Slack, ntfy, Gotify…)
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
const EMBY_URL = (process.env.EMBY_URL || '').replace(/\/+$/, '');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const DATA_FILE = path.join(DATA_DIR, 'requests.json');
const DIST_DIR = path.resolve(__dirname, '..', 'dist');
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean);
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const EMBY_PROXY = /^(1|true|yes)$/i.test(process.env.EMBY_PROXY || '');
const MAX_PENDING = Number(process.env.MAX_PENDING || 20);

if (!EMBY_URL) {
  console.warn('⚠️  EMBY_URL n’est pas défini : les demandes seront refusées (impossible de vérifier les utilisateurs).');
}

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

async function verifyUser(token, userId) {
  if (!EMBY_URL) throw Object.assign(new Error('Serveur mal configuré (EMBY_URL manquant).'), { status: 500 });
  const key = `${token}:${userId}`;
  const cached = authCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.user;

  const res = await fetch(`${EMBY_URL}/Users/${encodeURIComponent(userId)}`, {
    headers: { 'X-Emby-Token': token },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res) throw Object.assign(new Error('Serveur Emby injoignable.'), { status: 502 });
  if (!res.ok) throw Object.assign(new Error('Session Emby invalide.'), { status: 401 });
  const data = await res.json();
  if (data.Id !== userId) throw Object.assign(new Error('Session Emby invalide.'), { status: 401 });

  const user = { id: data.Id, name: data.Name, isAdmin: !!data.Policy?.IsAdministrator };
  authCache.set(key, { user, expires: Date.now() + 5 * 60_000 });
  if (authCache.size > 1000) authCache.delete(authCache.keys().next().value);
  return user;
}

async function auth(req, res, next) {
  const token = req.get('X-Emby-Token');
  const userId = req.get('X-Emby-UserId');
  if (!token || !userId) return res.status(401).json({ error: 'Authentification requise.' });
  try {
    req.user = await verifyUser(token, userId);
    next();
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}

// ----------------------------------------------------------------------------
// Notification (webhook)
// ----------------------------------------------------------------------------
async function notify(r) {
  if (!WEBHOOK_URL) return;
  const what =
    r.type === 'album'
      ? `l’album « ${r.album} » de ${r.artist}`
      : `${r.tracks.length} titre(s) de ${r.artist} : ${r.tracks.map((t) => `« ${t} »`).join(', ')}`;
  const text = `🎵 Nouvelle demande Soundy de ${r.userName} : ${what}${r.comment ? `\n💬 ${r.comment}` : ''}`;
  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // "content" pour Discord, "text" pour Slack/Mattermost, "message" pour Gotify
      body: JSON.stringify({ content: text, text, message: text, title: 'Soundy' }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    console.warn('Webhook en échec :', e.message);
  }
}

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------
const str = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

function validateNew(body) {
  const type = body?.type === 'tracks' ? 'tracks' : body?.type === 'album' ? 'album' : null;
  if (!type) return { error: 'Type de demande invalide.' };
  const artist = str(body.artist, 120);
  const album = str(body.album, 160);
  const tracks = Array.isArray(body.tracks) ? body.tracks.map((t) => str(t, 160)).filter(Boolean).slice(0, 30) : [];
  const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 500) : '';
  if (!artist) return { error: "Le nom de l'artiste est obligatoire." };
  if (type === 'album' && !album) return { error: "Le nom de l'album est obligatoire." };
  if (type === 'tracks' && !tracks.length) return { error: 'Indiquez au moins un titre.' };
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
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-Emby-Token, X-Emby-UserId');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.set('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/api', express.json({ limit: '32kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'soundy', emby: !!EMBY_URL }));

// Liste des demandes : les miennes, ou toutes (admin)
app.get('/api/requests', auth, (req, res) => {
  const scope = req.query.scope === 'all' ? 'all' : 'mine';
  if (scope === 'all' && !req.user.isAdmin) return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  const list = scope === 'all' ? requests : requests.filter((r) => r.userId === req.user.id);
  res.json([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});

// Nouvelle demande
app.post('/api/requests', auth, async (req, res) => {
  const { value, error } = validateNew(req.body);
  if (error) return res.status(400).json({ error });
  const pending = requests.filter((r) => r.userId === req.user.id && r.status === 'pending').length;
  if (pending >= MAX_PENDING) {
    return res.status(429).json({ error: `Vous avez déjà ${pending} demandes en attente. Patientez un peu 🙂` });
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
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  const r = requests.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: 'Demande introuvable.' });
  const status = req.body?.status;
  if (!['pending', 'added', 'refused'].includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
  r.status = status;
  r.adminNote = typeof req.body.adminNote === 'string' && req.body.adminNote.trim() ? req.body.adminNote.trim().slice(0, 500) : undefined;
  r.updatedAt = new Date().toISOString();
  await saveStore();
  res.json(r);
});

// Suppression : l'auteur (si en attente) ou un admin
app.delete('/api/requests/:id', auth, async (req, res) => {
  const i = requests.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Demande introuvable.' });
  const r = requests[i];
  const own = r.userId === req.user.id && r.status === 'pending';
  if (!own && !req.user.isAdmin) return res.status(403).json({ error: 'Action non autorisée.' });
  requests.splice(i, 1);
  await saveStore();
  res.json({ ok: true });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Route inconnue.' }));

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
});
