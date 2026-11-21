// ============================================================================
// Admin de Soundy dans Kosmy Board (protocole kosmy.board-admin.v1,
// docs/admin-api.md de Kosmy Board).
//
//   GET  /api/kosmy-board/admin            le sommaire (sections)
//   GET  /api/kosmy-board/admin/{section}  le contenu d'une section
//   POST /api/kosmy-board/admin/{section}  une action dans cette section
//
// Le serveur du Board appelle ces adresses avec un jeton signé (kb-admin+jwt).
// Soundy retrouve le compte relié (`sub`) puis vérifie auprès d'Emby, avec la
// session reliée, que ce compte est administrateur d'Emby : le Board ne donne
// aucun droit. Les actions passent par les mêmes fonctions que l'appli.
// ============================================================================
import { OidcError } from './kosmy-board.js';

export const PROTOCOL = 'kosmy.board-admin.v1';
export const ADMIN_PATH = '/api/kosmy-board/admin';
const MAX_ROWS = 500;

const TEXTS = {
  overview: ['Vue d’ensemble', 'Overview'],
  requests: ['Demandes', 'Requests'],
  notifications: ['Notifications', 'Notifications'],
  accounts: ['Comptes reliés', 'Linked accounts'],
  admin: ['Administrateur Emby', 'Emby administrator'],
  inBrief: ['En bref', 'At a glance'],
  pending: ['En attente', 'Pending'],
  added: ['Ajoutées', 'Added'],
  refused: ['Refusées', 'Refused'],
  total: ['Au total', 'In total'],
  server: ['Serveur', 'Server'],
  version: ['Version', 'Version'],
  embyAddress: ['Adresse d’Emby (vue du serveur)', 'Emby address (seen from the server)'],
  embyState: ['Emby', 'Emby'],
  reachable: ['Joignable', 'Reachable'],
  unreachable: ['Injoignable', 'Unreachable'],
  notSet: ['Non réglée', 'Not set'],
  notifState: ['Notifications des demandes', 'Request notifications'],
  on: ['Activées ({type})', 'On ({type})'],
  off: ['Désactivées', 'Off'],
  linkedCount: ['Comptes Kosmy Board reliés', 'Linked Kosmy Board accounts'],
  embyDown: ['Emby est injoignable', 'Emby is unreachable'],
  embyDownText: [
    'Le serveur Soundy n’arrive pas à joindre Emby (variable EMBY_URL) : personne ne peut faire de demande.',
    'The Soundy server cannot reach Emby (EMBY_URL variable): nobody can make a request.',
  ],
  requestsDesc: [
    'Les demandes d’ajout de musique des utilisateurs. Les demandes en attente sont en premier.',
    'Users’ music requests. Pending requests come first.',
  ],
  colRequest: ['Demande', 'Request'],
  colUser: ['Par', 'By'],
  colDate: ['Date', 'Date'],
  colStatus: ['Statut', 'Status'],
  colComment: ['Commentaire', 'Comment'],
  colNote: ['Réponse', 'Reply'],
  album: ['Album', 'Album'],
  tracks: ['Titres', 'Tracks'],
  stPending: ['En attente', 'Pending'],
  stAdded: ['Ajoutée', 'Added'],
  stRefused: ['Refusée', 'Refused'],
  markAdded: ['Marquer comme ajoutée', 'Mark as added'],
  refuse: ['Refuser', 'Refuse'],
  reopen: ['Remettre en attente', 'Back to pending'],
  delete: ['Supprimer', 'Delete'],
  deleteConfirm: ['Supprimer cette demande ? Son auteur ne la verra plus.', 'Delete this request? Its author will no longer see it.'],
  note: ['Réponse à l’utilisateur', 'Reply to the user'],
  noteHelp: ['Facultatif. Visible par l’auteur de la demande dans Soundy.', 'Optional. Shown to the request’s author in Soundy.'],
  noRequests: ['Aucune demande.', 'No requests.'],
  doneAdded: ['Demande marquée comme ajoutée.', 'Request marked as added.'],
  doneRefused: ['Demande refusée.', 'Request refused.'],
  donePending: ['Demande remise en attente.', 'Request back to pending.'],
  doneDeleted: ['Demande supprimée.', 'Request deleted.'],
  notifDesc: [
    'Une notification à chaque nouvelle demande, pour les administrateurs : dans la cloche de Kosmy Board et sur Kosmy Mobile. En plus, si vous le souhaitez, un webhook (Discord, ntfy, Gotify, Slack…).',
    'A notification for each new request, for administrators: in Kosmy Board’s bell and on Kosmy Mobile. Optionally, a webhook too (Discord, ntfy, Gotify, Slack…).',
  ],
  boardNotif: ['Kosmy Board et Kosmy Mobile', 'Kosmy Board and Kosmy Mobile'],
  boardNotifOn: ['Activées · administrateurs reliés au Board', 'On · administrators linked to the Board'],
  webhookNotif: ['Webhook (WEBHOOK_URL)', 'Webhook (WEBHOOK_URL)'],
  notifHowTitle: ['Webhook facultatif', 'Optional webhook'],
  notifHow: [
    'Les notifications passent par Kosmy Board. Pour les recevoir aussi ailleurs (Discord, ntfy…), réglez la variable WEBHOOK_URL du serveur Soundy, puis redéployez.',
    'Notifications go through Kosmy Board. To also get them elsewhere (Discord, ntfy…), set the WEBHOOK_URL variable on the Soundy server, then redeploy.',
  ],
  service: ['Service', 'Service'],
  language: ['Langue des notifications', 'Notification language'],
  test: ['Envoyer une notification de test', 'Send a test notification'],
  testDesc: ['Vérifie que les notifications arrivent bien.', 'Checks that notifications arrive.'],
  testTitle: ['🔔 Test de notification Soundy', '🔔 Soundy notification test'],
  testText: ['Ça fonctionne ! Les nouvelles demandes de musique arriveront ici. ({name}, depuis Kosmy Board)', 'It works! New music requests will be sent here. ({name}, from Kosmy Board)'],
  testSent: ['Notification de test envoyée.', 'Test notification sent.'],
  testFailed: ['Échec de l’envoi ({type}) : {error}. Vérifiez WEBHOOK_URL.', 'Sending failed ({type}): {error}. Check WEBHOOK_URL.'],
  testBoardFailed: ['Kosmy Board : {error}', 'Kosmy Board: {error}'],
  boardNoAdmin: ['aucun compte administrateur Emby n’est relié au Board.', 'no Emby administrator account is linked to the Board.'],
  boardUnsupported: ['ce Kosmy Board ne reçoit pas encore de notifications : mettez-le à jour.', 'this Kosmy Board cannot receive notifications yet: update it.'],
  boardUnreachable: ['le Board est injoignable depuis le serveur Soundy.', 'the Board is unreachable from the Soundy server.'],
  testOff: ['Aucune notification réglée (WEBHOOK_URL).', 'No notification set (WEBHOOK_URL).'],
  actions: ['Actions', 'Actions'],
  accountsDesc: [
    'Comptes Kosmy Board reliés à un compte Emby. Chacun relie le sien dans les réglages de Soundy ; le délier ferme sa session « Soundy (Kosmy Board) » dans Emby.',
    'Kosmy Board accounts linked to an Emby account. Each person links their own in Soundy’s settings; unlinking closes its “Soundy (Kosmy Board)” session in Emby.',
  ],
  colBoard: ['Compte Kosmy Board', 'Kosmy Board account'],
  colEmby: ['Compte Emby', 'Emby account'],
  colLinked: ['Relié le', 'Linked on'],
  colLast: ['Dernière connexion', 'Last sign-in'],
  never: ['Jamais', 'Never'],
  unlink: ['Délier', 'Unlink'],
  unlinkConfirm: ['Délier ce compte ? Il ne pourra plus ouvrir Soundy depuis Kosmy Board sans être relié à nouveau.', 'Unlink this account? It will no longer open Soundy from Kosmy Board until it is linked again.'],
  unlinked: ['Compte délié.', 'Account unlinked.'],
  noAccounts: ['Aucun compte relié.', 'No linked accounts.'],
  notSelf: ['Vous ne pouvez pas délier votre propre compte depuis le Board : faites-le dans les réglages de Soundy.', 'You cannot unlink your own account from the Board: do it in Soundy’s settings.'],
  unknownSection: ['Section inconnue.', 'Unknown section.'],
  unknownAction: ['Action inconnue.', 'Unknown action.'],
  unknownRow: ['Cette ligne n’existe plus.', 'This row no longer exists.'],
  noteTooLong: ['Réponse trop longue (500 caractères au plus).', 'Reply too long (500 characters at most).'],
  invalidToken: ['Soundy a refusé le jeton du Board.', 'Soundy refused the Board’s token.'],
  disabled: ['La connexion avec Kosmy Board n’est pas réglée dans Soundy.', 'Sign-in with Kosmy Board is not set up in Soundy.'],
  notLinked: [
    'Votre compte Kosmy Board n’est relié à aucun compte Soundy. Reliez-le dans les réglages de Soundy (« Relier à Kosmy Board »).',
    'Your Kosmy Board account is not linked to a Soundy account. Link it in Soundy’s settings (“Link to Kosmy Board”).',
  ],
  expired: [
    'La session Emby reliée à votre compte n’est plus valide : reliez-le à nouveau dans les réglages de Soundy.',
    'The Emby session linked to your account is no longer valid: link it again in Soundy’s settings.',
  ],
  forbidden: ['Votre compte Emby n’est pas administrateur.', 'Your Emby account is not an administrator.'],
  unreachableBoard: ['Soundy n’arrive pas à joindre Kosmy Board pour vérifier le jeton.', 'Soundy cannot reach Kosmy Board to check the token.'],
  embyUnreachable: ['Emby est injoignable depuis le serveur Soundy.', 'Emby is unreachable from the Soundy server.'],
};

const SERVICE_NAMES = { discord: 'Discord', slack: 'Slack / Mattermost', gotify: 'Gotify', ntfy: 'ntfy', json: 'Webhook' };

class AdminError extends Error {
  constructor(status, error, message) {
    super(message);
    this.status = status;
    this.error = error;
  }
}

/**
 * @param {object} o
 * @param {object} o.kb module kosmy-board.js
 * @param {object} o.deps { version, requests(), setStatus(r, status, note), remove(id), embyBase(), embyUrl, checkEmby(token, userId),
 *                         webhook: { configured, type, lang },
 *                         notifyAdmins(title, text) → { board?, webhook? } }
 */
export function createKosmyBoardAdmin({ kb, deps }) {
  function texts(req) {
    const en = /^en/i.test(req.get('Accept-Language') || '');
    return (key, vars = {}) => TEXTS[key][en ? 1 : 0].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  }

  const dateOf = (iso, lang) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: process.env.TZ || 'Europe/Paris' });
  };

  const STATUS_TONE = { pending: 'warning', added: 'success', refused: 'muted' };
  const STATUS_LABEL = { pending: 'stPending', added: 'stAdded', refused: 'stRefused' };
  const ROW_ACTIONS = { pending: ['mark-added', 'refuse', 'delete'], added: ['reopen', 'refuse', 'delete'], refused: ['reopen', 'mark-added', 'delete'] };

  /* ---------- sections ---------- */

  async function overview(t) {
    const list = deps.requests();
    const count = (s) => list.filter((r) => r.status === s).length;
    const base = await deps.embyBase();
    const blocks = [];
    if (!base) blocks.push({ type: 'notice', tone: 'danger', title: t('embyDown'), text: t('embyDownText') });
    blocks.push(
      {
        type: 'stats',
        title: t('inBrief'),
        items: [
          { label: t('pending'), value: count('pending') },
          { label: t('added'), value: count('added') },
          { label: t('refused'), value: count('refused') },
          { label: t('total'), value: list.length },
        ],
      },
      {
        type: 'fields',
        title: t('server'),
        items: [
          { label: t('version'), value: deps.version },
          { label: t('embyState'), value: base ? t('reachable') : t('unreachable') },
          { label: t('embyAddress'), value: base || deps.embyUrl || t('notSet') },
          { label: t('notifState'), value: t('on', { type: ['Kosmy Board', ...(deps.webhook.configured ? [SERVICE_NAMES[deps.webhook.type] || deps.webhook.type] : [])].join(' + ') }) },
          { label: t('linkedCount'), value: kb.accounts().length },
        ],
      },
    );
    return { id: 'overview', title: t('overview'), blocks };
  }

  function describe(r, t) {
    const what = r.type === 'album' ? `${t('album')} · ${r.album}` : `${t('tracks')} · ${r.tracks.join(', ')}`;
    return `${r.artist} — ${what}`;
  }

  function requestsSection(t, lang) {
    const order = { pending: 0, added: 1, refused: 2 };
    const list = [...deps.requests()]
      .sort((a, b) => order[a.status] - order[b.status] || b.createdAt.localeCompare(a.createdAt))
      .slice(0, MAX_ROWS);
    const noteField = (value) => ({ name: 'adminNote', label: t('note'), type: 'textarea', maxLength: 500, help: t('noteHelp'), ...(value !== undefined ? { value } : {}) });
    return {
      id: 'requests',
      title: t('requests'),
      description: t('requestsDesc'),
      blocks: [
        {
          type: 'table',
          id: 'requests',
          columns: [
            { key: 'request', label: t('colRequest') },
            { key: 'user', label: t('colUser') },
            { key: 'date', label: t('colDate') },
            { key: 'status', label: t('colStatus') },
            { key: 'comment', label: t('colComment') },
            { key: 'note', label: t('colNote') },
          ],
          rows: list.map((r) => ({
            id: r.id,
            cells: {
              request: describe(r, t),
              user: r.userName,
              date: dateOf(r.createdAt, lang),
              status: { text: t(STATUS_LABEL[r.status]), tone: STATUS_TONE[r.status] },
              comment: r.comment || '',
              note: r.adminNote || '',
            },
            values: { adminNote: r.adminNote || '' },
            actions: ROW_ACTIONS[r.status] || [],
          })),
          rowActions: [
            { id: 'mark-added', label: t('markAdded'), fields: [noteField()] },
            { id: 'refuse', label: t('refuse'), fields: [noteField()] },
            { id: 'reopen', label: t('reopen') },
            { id: 'delete', label: t('delete'), danger: true, confirm: t('deleteConfirm') },
          ],
          empty: t('noRequests'),
        },
      ],
    };
  }

  function notificationsSection(t) {
    const w = deps.webhook;
    const blocks = [];
    if (!w.configured) blocks.push({ type: 'notice', tone: 'info', title: t('notifHowTitle'), text: t('notifHow') });
    blocks.push({
      type: 'fields',
      items: [
        // L'admin dans le Board passe par la connexion unique : elle est donc réglée, et les notifications du Board aussi.
        { label: t('boardNotif'), value: t('boardNotifOn') },
        { label: t('webhookNotif'), value: w.configured ? t('on', { type: SERVICE_NAMES[w.type] || w.type }) : t('off') },
        { label: t('language'), value: w.lang === 'en' ? 'English' : 'Français' },
      ],
    });
    blocks.push({ type: 'actions', title: t('actions'), items: [{ id: 'send-test', label: t('test'), description: t('testDesc') }] });
    return { id: 'notifications', title: t('notifications'), description: t('notifDesc'), blocks };
  }

  function accountsSection(t, lang, me) {
    return {
      id: 'accounts',
      title: t('accounts'),
      description: t('accountsDesc'),
      blocks: [
        {
          type: 'table',
          id: 'accounts',
          columns: [
            { key: 'board', label: t('colBoard') },
            { key: 'emby', label: t('colEmby') },
            { key: 'linked', label: t('colLinked') },
            { key: 'last', label: t('colLast') },
          ],
          rows: kb.accounts().slice(0, MAX_ROWS).map((a) => ({
            id: a.sub,
            cells: {
              board: [a.name, a.email && a.email !== a.name ? a.email : ''].filter(Boolean).join(' · ') || a.sub,
              emby: a.embyUserName,
              linked: dateOf(a.linkedAt, lang),
              last: a.lastLogin ? dateOf(a.lastLogin, lang) : { text: t('never'), tone: 'muted' },
            },
            actions: a.sub === me ? [] : ['unlink'],
          })),
          rowActions: [{ id: 'unlink', label: t('unlink'), danger: true, confirm: t('unlinkConfirm') }],
          empty: t('noAccounts'),
        },
      ],
    };
  }

  const SECTIONS = ['overview', 'requests', 'notifications', 'accounts'];

  async function section(id, t, lang, ctx) {
    switch (id) {
      case 'overview': return overview(t);
      case 'requests': return requestsSection(t, lang);
      case 'notifications': return notificationsSection(t);
      case 'accounts': return accountsSection(t, lang, ctx.claims.sub);
      default: throw new AdminError(404, 'not_found', t('unknownSection'));
    }
  }

  /* ---------- actions ---------- */

  async function act(id, body, t, ctx) {
    const action = typeof body?.action === 'string' ? body.action : '';
    const row = typeof body?.row === 'string' ? body.row : '';
    const values = body?.values && typeof body.values === 'object' ? body.values : {};

    if (id === 'requests' && ['mark-added', 'refuse', 'reopen', 'delete'].includes(action)) {
      const r = deps.requests().find((x) => x.id === row);
      if (!r) throw new AdminError(404, 'not_found', t('unknownRow'));
      if (action === 'delete') {
        await deps.remove(r.id);
        return { message: t('doneDeleted') };
      }
      const status = action === 'mark-added' ? 'added' : action === 'refuse' ? 'refused' : 'pending';
      let note = r.adminNote;
      if (action !== 'reopen') {
        note = typeof values.adminNote === 'string' ? values.adminNote : '';
        if (note.trim().length > 500) throw new AdminError(422, 'invalid', t('noteTooLong'));
      }
      await deps.setStatus(r, status, note);
      return { message: t(status === 'added' ? 'doneAdded' : status === 'refused' ? 'doneRefused' : 'donePending') };
    }

    if (id === 'notifications' && action === 'send-test') {
      const res = await deps.notifyAdmins(t('testTitle'), t('testText', { name: ctx.user.name }));
      const boardKey = { no_admin: 'boardNoAdmin', unsupported: 'boardUnsupported', unreachable: 'boardUnreachable' };
      const errors = [];
      if (res.board && !res.board.ok) errors.push(t('testBoardFailed', { error: boardKey[res.board.error] ? t(boardKey[res.board.error]) : res.board.error }));
      if (res.webhook && !res.webhook.ok) errors.push(t('testFailed', { type: res.webhook.type, error: res.webhook.error }));
      if (!res.board && !res.webhook) return { message: t('testOff'), tone: 'warning' };
      if (errors.length) return { message: errors.join(' · '), tone: res.board?.ok || res.webhook?.ok ? 'warning' : 'danger' };
      return { message: t('testSent') };
    }

    if (id === 'accounts' && action === 'unlink') {
      if (row === ctx.claims.sub) throw new AdminError(409, 'conflict', t('notSelf'));
      const removed = await kb.unlink(row);
      if (!removed) throw new AdminError(404, 'not_found', t('unknownRow'));
      return { message: t('unlinked') };
    }

    if (!SECTIONS.includes(id)) throw new AdminError(404, 'not_found', t('unknownSection'));
    throw new AdminError(404, 'not_found', t('unknownAction'));
  }

  /* ---------- authentification ---------- */

  async function authenticate(req, t) {
    let ctx;
    try {
      ctx = await kb.authenticateAdmin({ authorization: req.get('Authorization'), method: req.method, path: req.path.replace(/\/+$/, '') });
    } catch (e) {
      if (!(e instanceof OidcError)) throw e;
      if (e.code === 'not_linked') throw new AdminError(403, 'not_linked', t('notLinked'));
      if (e.code === 'disabled') throw new AdminError(401, 'invalid_token', t('disabled'));
      if (e.code === 'network' || e.code === 'discovery') throw new AdminError(503, 'board_unreachable', t('unreachableBoard'));
      throw new AdminError(401, 'invalid_token', `${t('invalidToken')} (${e.message})`);
    }
    let user;
    try {
      user = await deps.checkEmby(ctx.account.token, ctx.account.embyUserId);
    } catch (e) {
      if (e?.key === 'invalidSession') throw new AdminError(403, 'not_linked', t('expired'));
      throw new AdminError(503, 'emby_unreachable', t('embyUnreachable'));
    }
    if (!user.isAdmin) throw new AdminError(403, 'forbidden', t('forbidden'));
    return { ...ctx, user };
  }

  /** Middleware Express pour /api/kosmy-board/admin[/{section}]. */
  return async function handler(req, res, next) {
    const m = /^\/api\/kosmy-board\/admin(?:\/([^/]*))?\/?$/.exec(req.path);
    if (!m) return next();
    res.set('Cache-Control', 'no-store');
    const t = texts(req);
    const lang = /^en/i.test(req.get('Accept-Language') || '') ? 'en' : 'fr';
    try {
      if (req.method !== 'GET' && req.method !== 'POST') throw new AdminError(405, 'method_not_allowed', 'Method not allowed.');
      const id = m[1];
      if (id !== undefined && !/^[a-z0-9-]{1,40}$/.test(id)) throw new AdminError(404, 'not_found', t('unknownSection'));
      if (id === undefined && req.method !== 'GET') throw new AdminError(405, 'method_not_allowed', 'Method not allowed.');
      const ctx = await authenticate(req, t);

      if (id === undefined) {
        return res.json({
          protocol: PROTOCOL,
          app: { name: 'Soundy', version: deps.version },
          user: { name: ctx.user.name, role: t('admin') },
          sections: SECTIONS.map((s) => ({ id: s, title: t(s) })),
        });
      }
      if (!SECTIONS.includes(id)) throw new AdminError(404, 'not_found', t('unknownSection'));
      if (req.method === 'GET') return res.json(await section(id, t, lang, ctx));

      const result = await act(id, req.body, t, ctx);
      console.log(`[kosmy-board admin] ${ctx.user.name} (${ctx.claims.email || ctx.claims.name || ctx.claims.sub}) : ${id}/${req.body?.action}`);
      return res.json({ ok: true, ...result, section: await section(id, t, lang, ctx) });
    } catch (e) {
      if (e instanceof AdminError) return res.status(e.status).json({ error: e.error, message: e.message });
      console.error('[kosmy-board admin]', e);
      return res.status(500).json({ error: 'server_error', message: 'Erreur du serveur Soundy.' });
    }
  };
}
