// Kosmy Board de bout en bout : un faux Board (OpenID Connect) et un faux Emby,
// puis le vrai serveur Soundy lancé à côté.
//   cd server && npm test
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
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
const codes = new Map(); // code → { sub, nonce }

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
  broken: { Id: 'u-broken', Name: 'broken', Policy: { IsAdministrator: false }, password: 'pw' },
};
const tokens = new Map([['t-admin-app', 'u-admin'], ['t-bob-app', 'u-bob'], ['t-broken-app', 'u-broken']]); // jeton → utilisateur
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
      const idToken = sign({}, { iss: issuer, aud: CLIENT_ID, sub: c.sub, iat: now(), exp: now() + 300, nonce: c.nonce, name: c.name, email: c.email });
      return json(res, 200, { access_token: 'x', token_type: 'Bearer', id_token: idToken });
    }
    json(res, 404, {});
  });
  issuer = `${board.url}/oidc`;

  emby = await listen(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/System/Info/Public') return json(res, 200, { Id: 'emby', ServerName: 'Emby' });
    if (u.pathname === '/Users/AuthenticateByName' && req.method === 'POST') {
      // Comme le vrai Emby : 400 si l'en-tête d'identification n'est pas en ASCII.
      if (!/^[\x20-\x7e]+$/.test(req.headers['x-emby-authorization'] || '')) return json(res, 400, {});
      const b = JSON.parse(await body(req));
      if (b.Username === 'broken') return json(res, 500, {});
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

  dataDir = mkdtempSync(path.join(tmpdir(), 'soundy-kb-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  soundy = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(here, '..', 'index.js')], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, EMBY_URL: emby.url, WEBHOOK_URL: '' },
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
async function api(method, p, { token = 't-admin-app', user = 'u-admin', data, headers = {} } = {}) {
  const res = await fetch(`${soundy}${p}`, {
    method,
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', 'Accept-Language': 'fr', ...(token ? { 'X-Emby-Token': token, 'X-Emby-UserId': user } : {}), ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* pas du JSON */ }
  return { status: res.status, json: j, headers: res.headers };
}

const cookieOf = (res) => (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).filter((c) => !c.endsWith('=')).join('; ');

/** Retour du Board : simule l'autorisation (code ↔ nonce) puis appelle le callback de Soundy. */
async function boardReturn(authorizeUrl, flowCookie, who) {
  const a = new URL(authorizeUrl);
  assert.equal(a.searchParams.get('client_id'), CLIENT_ID);
  assert.equal(a.searchParams.get('code_challenge_method'), 'S256');
  const code = randomUUID();
  codes.set(code, { nonce: a.searchParams.get('nonce'), ...who });
  const res = await fetch(`${soundy}/auth/kosmy-board/callback?code=${code}&state=${a.searchParams.get('state')}&iss=${encodeURIComponent(issuer)}`, {
    redirect: 'manual',
    headers: { Cookie: flowCookie },
  });
  return res;
}

const EMANUEL = { sub: 'board-emanuel', name: 'Emanuel', email: 'e@example.test' };
const BOB = { sub: 'board-bob', name: 'Bob', email: 'bob@example.test' };

/* ---------- tests ---------- */

test('réglages : réservés aux admins Emby, secret jamais renvoyé', async () => {
  assert.equal((await api('GET', '/api/auth/kosmy-board', { token: null })).json.enabled, false);
  assert.equal((await api('GET', '/api/kosmy-board/settings', { token: 't-bob-app', user: 'u-bob' })).status, 403);
  assert.equal((await api('PUT', '/api/kosmy-board/settings', { data: { issuer: 'pas une adresse' } })).status, 400);
  const r = await api('PUT', '/api/kosmy-board/settings', { data: { issuer: `${issuer}/`, clientId: CLIENT_ID, secret: SECRET } });
  assert.equal(r.status, 200);
  assert.equal(r.json.issuer, issuer);
  assert.equal(r.json.enabled, true);
  assert.equal(r.json.secretSet, true);
  assert.ok(!JSON.stringify(r.json).includes(SECRET));
  assert.match(r.json.redirectUri, /\/auth\/kosmy-board\/callback$/);
  assert.equal((await api('GET', '/api/auth/kosmy-board', { token: null })).json.enabled, true);
});

test('admin dans le Board : un compte non relié est refusé', async () => {
  const url = `${soundy}/api/kosmy-board/admin`;
  const r = await api('GET', '/api/kosmy-board/admin', { token: null, headers: { Authorization: `Bearer ${adminToken(EMANUEL.sub, 'GET', url)}` } });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'not_linked');
});

test('connexion par le Board : sans lien, retour avec une erreur', async () => {
  const start = await fetch(`${soundy}/auth/kosmy-board/login?iss=${encodeURIComponent(issuer)}`, { redirect: 'manual' });
  assert.equal(start.status, 303);
  const res = await boardReturn(start.headers.get('location'), cookieOf(start), EMANUEL);
  assert.equal(res.headers.get('location'), '/?kb_error=not_linked');
});

test('relier : mauvais mot de passe refusé, puis lien avec une session Emby dédiée', async () => {
  const bad = await api('POST', '/api/kosmy-board/link', { data: { password: 'faux', server: 'https://emby.example.test' } });
  assert.equal(bad.status, 401);
  assert.match(bad.json.error, /Mot de passe/);

  const r = await api('POST', '/api/kosmy-board/link', { data: { password: 'pw-admin', server: 'https://emby.example.test/' } });
  assert.equal(r.status, 200);
  const back = await boardReturn(r.json.url, cookieOf(r), EMANUEL);
  assert.equal(back.status, 303);
  assert.equal(back.headers.get('location'), '/?kb=linked#/settings');

  const me = await api('GET', '/api/kosmy-board/me');
  assert.equal(me.json.account.sub, EMANUEL.sub);
  assert.equal(me.json.account.embyUserName, 'admin');
  assert.ok(!('token' in me.json.account));
});

test('relier : un refus d’Emby donne un message lisible, jamais un 502', async () => {
  const r = await api('POST', '/api/kosmy-board/link', { token: 't-broken-app', user: 'u-broken', data: { password: 'pw', server: 'https://emby.example.test' } });
  assert.equal(r.status, 424);
  assert.match(r.json.error, /Emby a refusé .*code 500/);
});

test('un parcours ne sert qu’une fois et reste lié au navigateur', async () => {
  const start = await fetch(`${soundy}/auth/kosmy-board/login`, { redirect: 'manual' });
  const res = await boardReturn(start.headers.get('location'), 'soundy_kb_flow=autre-navigateur', EMANUEL);
  assert.equal(res.headers.get('location'), '/?kb_error=state');
  const again = await boardReturn(start.headers.get('location'), cookieOf(start), EMANUEL);
  assert.equal(again.headers.get('location'), '/?kb_error=state');
});

test('connexion par le Board : le ticket donne la session reliée, une seule fois', async () => {
  const start = await fetch(`${soundy}/auth/kosmy-board/login?iss=${encodeURIComponent(issuer)}&target_link_uri=x`, { redirect: 'manual' });
  const back = await boardReturn(start.headers.get('location'), cookieOf(start), EMANUEL);
  assert.equal(back.headers.get('location'), '/?kb=1');
  const ticket = cookieOf(back);
  assert.match(ticket, /^soundy_kb_ticket=/);

  const s = await api('POST', '/api/kosmy-board/session', { token: null, headers: { Cookie: ticket } });
  assert.equal(s.status, 200);
  assert.equal(s.json.userId, 'u-admin');
  assert.equal(s.json.server, 'https://emby.example.test');
  assert.equal(s.json.isAdmin, true);
  assert.ok(tokens.has(s.json.token));
  assert.notEqual(s.json.token, 't-admin-app');

  assert.equal((await api('POST', '/api/kosmy-board/session', { token: null, headers: { Cookie: ticket } })).status, 401);
});

test('un autre émetteur est refusé au lancement', async () => {
  const start = await fetch(`${soundy}/auth/kosmy-board/login?iss=${encodeURIComponent('https://autre.example.test/oidc')}`, { redirect: 'manual' });
  assert.equal(start.headers.get('location'), '/?kb_error=issuer');
});

test('admin dans le Board : sommaire, demandes et action', async () => {
  const created = await api('POST', '/api/requests', { token: 't-bob-app', user: 'u-bob', data: { type: 'album', artist: 'Daft Punk', album: 'Discovery' } });
  assert.equal(created.status, 201);

  const call = (method, section = '', data) => {
    const p = `/api/kosmy-board/admin${section ? `/${section}` : ''}`;
    return api(method, p, { token: null, data, headers: { Authorization: `Bearer ${adminToken(EMANUEL.sub, method, `${soundy}${p}`)}` } });
  };

  const home = await call('GET');
  assert.equal(home.status, 200);
  assert.equal(home.json.protocol, 'kosmy.board-admin.v1');
  assert.deepEqual(home.json.sections.map((s) => s.id), ['overview', 'requests', 'notifications', 'accounts']);
  assert.equal(home.json.user.name, 'admin');

  const overview = await call('GET', 'overview');
  assert.equal(overview.json.blocks.find((b) => b.type === 'stats').items[0].value, 1);

  const list = await call('GET', 'requests');
  const row = list.json.blocks[0].rows[0];
  assert.equal(row.id, created.json.id);
  assert.deepEqual(row.actions, ['mark-added', 'refuse', 'delete']);

  const done = await call('POST', 'requests', { action: 'mark-added', row: row.id, values: { adminNote: 'C’est fait !' } });
  assert.equal(done.status, 200);
  assert.equal(done.json.ok, true);
  assert.equal(done.json.section.blocks[0].rows[0].cells.status.tone, 'success');
  const mine = await api('GET', '/api/requests', { token: 't-bob-app', user: 'u-bob' });
  assert.equal(mine.json[0].status, 'added');
  assert.equal(mine.json[0].adminNote, 'C’est fait !');

  assert.equal((await call('POST', 'requests', { action: 'mark-added', row: 'inconnue' })).status, 404);
  assert.equal((await call('GET', 'inconnue')).status, 404);
  const test = await call('POST', 'notifications', { action: 'send-test' });
  assert.equal(test.json.tone, 'warning');

  // On ne se délie pas soi-même depuis le Board.
  const accounts = await call('GET', 'accounts');
  assert.deepEqual(accounts.json.blocks[0].rows[0].actions, []);
  assert.equal((await call('POST', 'accounts', { action: 'unlink', row: EMANUEL.sub })).status, 409);
});

test('admin dans le Board : jeton rejoué, mauvais typ, mauvaise adresse', async () => {
  const p = '/api/kosmy-board/admin';
  const token = adminToken(EMANUEL.sub, 'GET', `${soundy}${p}`);
  assert.equal((await api('GET', p, { token: null, headers: { Authorization: `Bearer ${token}` } })).status, 200);
  assert.equal((await api('GET', p, { token: null, headers: { Authorization: `Bearer ${token}` } })).status, 401);
  const idLike = sign({}, { iss: issuer, aud: CLIENT_ID, sub: EMANUEL.sub, iat: now(), exp: now() + 60, jti: randomUUID(), htm: 'GET', htu: `${soundy}${p}` });
  assert.equal((await api('GET', p, { token: null, headers: { Authorization: `Bearer ${idLike}` } })).status, 401);
  const other = adminToken(EMANUEL.sub, 'GET', `${soundy}${p}/requests`);
  assert.equal((await api('GET', p, { token: null, headers: { Authorization: `Bearer ${other}` } })).status, 401);
});

test('admin dans le Board : un compte Emby non administrateur est refusé', async () => {
  const r = await api('POST', '/api/kosmy-board/link', { token: 't-bob-app', user: 'u-bob', data: { password: 'pw-bob', server: 'https://emby.example.test' } });
  const back = await boardReturn(r.json.url, cookieOf(r), BOB);
  assert.equal(back.headers.get('location'), '/?kb=linked#/settings');
  const p = '/api/kosmy-board/admin';
  const res = await api('GET', p, { token: null, headers: { Authorization: `Bearer ${adminToken(BOB.sub, 'GET', `${soundy}${p}`)}` } });
  assert.equal(res.status, 403);
  assert.equal(res.json.error, 'forbidden');
});

test('délier : depuis le Board pour un autre compte, ou soi-même ; la session Emby dédiée est fermée', async () => {
  const p = '/api/kosmy-board/admin/accounts';
  const call = (data) => api('POST', p, { token: null, data, headers: { Authorization: `Bearer ${adminToken(EMANUEL.sub, 'POST', `${soundy}${p}`)}` } });
  const before = loggedOut.length;
  const r = await call({ action: 'unlink', row: BOB.sub });
  assert.equal(r.status, 200);
  assert.equal(r.json.section.blocks[0].rows.length, 1);
  assert.equal(loggedOut.length, before + 1);
  assert.equal((await api('GET', '/api/kosmy-board/me', { token: 't-bob-app', user: 'u-bob' })).json.account, null);

  assert.equal((await api('DELETE', '/api/kosmy-board/me')).status, 200);
  assert.equal(loggedOut.length, before + 2);
  assert.equal((await api('DELETE', '/api/kosmy-board/me')).status, 404);
});
