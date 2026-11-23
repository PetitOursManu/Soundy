// ============================================================================
// Utilisateurs de Soundy gérés par Kosmy Board (protocole kosmy.board-users.v1,
// docs/users-api.md de Kosmy Board).
//
//   GET    /api/kosmy-board/users         rôles, restrictions et comptes reliés
//   PUT    /api/kosmy-board/users/{sub}   rôle et restrictions du compte relié à {sub} (le réactive)
//   DELETE /api/kosmy-board/users/{sub}   retire l'accès à Soundy du compte relié à {sub}
//
// Même jeton que l'admin dans le Board (kb-admin+jwt, une requête, htm/htu/jti) ; le `sub` du jeton
// doit être relié à un compte administrateur de Soundy.
//
// Les comptes de Soundy sont ceux d'Emby, et Soundy n'a aucun droit d'administration sur Emby : il ne garde
// que des sessions Emby ouvertes avec le mot de passe de chacun. Il ne peut donc ni créer un compte Emby, ni en
// ouvrir une session sans mot de passe. Le Board gère ici les comptes Emby **déjà reliés** à Kosmy Board
// (Réglages → Relier à Kosmy Board) ; un `sub` qui ne l'est pas reçoit un 409 qui l'explique.
//
// Rôles : « admin » (administre Soundy : toutes les demandes, réglages, admin dans le Board) et « member ».
// Ils remplacent, dans Soundy seulement, le statut d'administrateur d'Emby (Emby n'est pas modifié).
// Restriction : `maxPending`, le nombre de demandes d'ajout de musique en attente (0 : aucune demande).
// ============================================================================
import { AdminError, authenticateBoard, TEXTS as ADMIN_TEXTS, textsFor } from './kosmy-board-admin.js';

export const USERS_PROTOCOL = 'kosmy.board-users.v1';
export const USERS_PATH = '/api/kosmy-board/users';
const SUB = /^[A-Za-z0-9-]{1,64}$/;
const MAX_USERS = 500;
export const ROLES = ['admin', 'member'];

const TEXTS = {
  ...ADMIN_TEXTS,
  roleAdmin: ['Administrateur', 'Administrator'],
  roleAdminDesc: [
    'Administre Soundy : toutes les demandes de musique, les réglages et l’admin dans le Board. Ne change rien dans Emby.',
    'Manages Soundy: all music requests, the settings and the admin in the Board. Changes nothing in Emby.',
  ],
  roleMember: ['Membre', 'Member'],
  roleMemberDesc: ['Écoute la musique et fait des demandes d’ajout.', 'Listens to music and makes requests.'],
  maxPending: ['Demandes en attente au plus', 'Pending requests at most'],
  maxPendingHelp: ['Demandes d’ajout de musique en attente en même temps. 0 : ne peut pas faire de demande.', 'Music requests pending at the same time. 0: cannot make requests.'],
  badBody: ['Requête illisible : un objet JSON est attendu.', 'Unreadable request: a JSON object is expected.'],
  badRole: ['Rôle inconnu : « admin » ou « member ».', 'Unknown role: “admin” or “member”.'],
  badValues: ['Restrictions illisibles.', 'Unreadable restrictions.'],
  badMaxPending: ['{label} : un nombre entier entre {min} et {max}.', '{label}: a whole number between {min} and {max}.'],
  notLinkedTarget: [
    'Cette personne n’a pas encore relié son compte Emby à Kosmy Board : elle doit d’abord se connecter à Soundy avec son compte Emby, puis cliquer « Relier à Kosmy Board » dans les Réglages. Son rôle et ses restrictions s’appliqueront ensuite (à sa connexion par le Board, ou avec « Resynchroniser »). Soundy ne peut pas créer de compte Emby.',
    'This person has not linked their Emby account to Kosmy Board yet: they must first sign in to Soundy with their Emby account, then click “Link to Kosmy Board” in the Settings. Their role and restrictions will then apply (when they sign in through the Board, or with “Resync”). Soundy cannot create Emby accounts.',
  ],
  notSelfAdmin: ['Vous ne pouvez pas vous retirer vos propres droits d’administration.', 'You cannot remove your own administrator rights.'],
  notSelfDelete: ['Vous ne pouvez pas retirer votre propre accès.', 'You cannot remove your own access.'],
  lastAdmin: ['Il doit rester au moins un administrateur actif de Soundy relié au Board.', 'At least one active Soundy administrator linked to the Board must remain.'],
  updated: ['Compte mis à jour.', 'Account updated.'],
  reactivated: ['Accès rétabli.', 'Access restored.'],
  relink: [
    'Accès rétabli. Sa session Emby dédiée a été fermée au retrait de l’accès : pour se connecter par le Board, la personne doit relier à nouveau son compte Emby dans les Réglages de Soundy.',
    'Access restored. Their dedicated Emby session was closed when access was removed: to sign in through the Board, the person must link their Emby account again in Soundy’s Settings.',
  ],
  removed: ['Accès retiré : le compte ne peut plus ouvrir Soundy et ses sessions ouvertes par le Board sont fermées.', 'Access removed: the account can no longer open Soundy and its sessions opened by the Board are closed.'],
  methodNotAllowed: ['Méthode non prise en charge.', 'Method not allowed.'],
  notFound: ['Adresse inconnue.', 'Unknown address.'],
};

/** Erreur de règle (rôle ou restriction refusés) : `key` et `vars` sont traduits par l'appelant. */
class RuleError extends Error {
  constructor(key, vars = {}) {
    super(key);
    this.key = key;
    this.vars = vars;
  }
}

/**
 * Les rôles et restrictions de Soundy, et leur vérification (PUT du Board et revendication `kosmy_board_access`).
 * @param {object} o
 * @param {number} o.maxPending valeur par défaut des demandes en attente (MAX_PENDING)
 */
export function createAccessRules({ maxPending }) {
  const max = Math.max(1000, maxPending);
  const defaults = () => ({ maxPending });

  /** { role, values } vérifiés ; un champ absent garde sa valeur actuelle (sinon sa valeur par défaut). Lève une RuleError. */
  function clean(body, current) {
    if (!ROLES.includes(body?.role)) throw new RuleError('badRole');
    const values = { ...defaults(), ...(current && typeof current === 'object' ? current : {}) };
    const raw = body.values;
    if (raw != null) {
      if (typeof raw !== 'object' || Array.isArray(raw)) throw new RuleError('badValues');
      if ('maxPending' in raw) {
        const v = raw.maxPending;
        if (!Number.isInteger(v) || v < 0 || v > max) throw new RuleError('badMaxPending', { min: 0, max });
        values.maxPending = v;
      }
    }
    // Seuls les champs connus sont gardés.
    return { role: body.role, values: { maxPending: values.maxPending } };
  }

  const roles = (t) => [
    { value: 'admin', label: t('roleAdmin'), description: t('roleAdminDesc'), admin: true },
    { value: 'member', label: t('roleMember'), description: t('roleMemberDesc') },
  ];
  const fields = (t) => [
    { name: 'maxPending', label: t('maxPending'), type: 'number', value: maxPending, min: 0, max, step: 1, help: t('maxPendingHelp') },
  ];

  return { defaults, clean, roles, fields };
}

/**
 * @param {object} o
 * @param {object} o.kb module kosmy-board.js
 * @param {object} o.rules createAccessRules()
 * @param {Function} o.checkUser (token, userId) → utilisateur Emby vérifié, avec l'accès du Board appliqué
 */
export function createKosmyBoardUsers({ kb, rules, checkUser }) {
  async function list(t) {
    const linked = await kb.linkedAccess();
    return {
      protocol: USERS_PROTOCOL,
      roles: rules.roles(t),
      defaultRole: 'member',
      fields: rules.fields(t),
      users: linked.slice(0, MAX_USERS).map((a) => ({
        sub: a.sub,
        role: a.role,
        values: { ...rules.defaults(), ...(a.managed && a.values ? a.values : {}) },
        active: !a.disabled,
        account: a.embyUserName || undefined,
      })),
    };
  }

  async function put(target, body, me, t) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AdminError(400, 'invalid', t('badBody'));
    const account = kb.accounts().find((a) => a.sub === target);
    let access;
    try {
      access = rules.clean(body, account?.role ? account.values : null);
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      throw new AdminError(422, 'invalid', t(e.key, { label: t('maxPending'), ...e.vars }));
    }
    if (!account) throw new AdminError(409, 'conflict', t('notLinkedTarget'));

    if (access.role !== 'admin') {
      const current = (await kb.linkedAccess()).find((a) => a.sub === target);
      const isAdmin = current && !current.disabled && current.role === 'admin';
      if (isAdmin && target === me) throw new AdminError(409, 'conflict', t('notSelfAdmin'));
      if (isAdmin && !(await kb.otherAdmin(target))) throw new AdminError(409, 'conflict', t('lastAdmin'));
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' && /^[^\s@]+@[^\s@]+$/.test(body.email.trim()) ? body.email.trim() : '';
    const done = kb.setAccess(target, { ...access, name, email });
    const message = done.reactivated ? t(done.session ? 'reactivated' : 'relink') : !done.session ? t('relink') : t('updated');
    return { ok: true, status: 'updated', account: done.embyUserName || undefined, message };
  }

  async function remove(target, me, t) {
    const account = kb.accounts().find((a) => a.sub === target);
    if (!account || account.disabled) return { ok: true };
    if (target === me) throw new AdminError(409, 'conflict', t('notSelfDelete'));
    const current = (await kb.linkedAccess()).find((a) => a.sub === target);
    if (current?.role === 'admin' && !(await kb.otherAdmin(target))) throw new AdminError(409, 'conflict', t('lastAdmin'));
    await kb.disable(target);
    return { ok: true, message: t('removed') };
  }

  /** Middleware Express pour /api/kosmy-board/users[/{sub}]. */
  return async function handler(req, res, next) {
    const m = /^\/api\/kosmy-board\/users(?:\/([^/]*))?\/?$/.exec(req.path);
    if (!m) return next();
    res.set('Cache-Control', 'no-store');
    const t = textsFor(req, TEXTS);
    try {
      const target = m[1];
      if (target === undefined && req.method !== 'GET') throw new AdminError(405, 'method_not_allowed', t('methodNotAllowed'));
      if (target !== undefined && req.method !== 'PUT' && req.method !== 'DELETE') throw new AdminError(405, 'method_not_allowed', t('methodNotAllowed'));
      if (target !== undefined && !SUB.test(target)) throw new AdminError(404, 'not_found', t('notFound'));
      const ctx = await authenticateBoard({ kb, checkUser }, req, t);
      const me = ctx.claims.sub;
      const who = `${ctx.user.name} (${ctx.claims.email || ctx.claims.name || me})`;

      if (target === undefined) return res.json(await list(t));
      if (req.method === 'PUT') {
        const result = await put(target, req.body, me, t);
        console.log(`[kosmy-board users] ${who} : accès de ${target} → ${req.body.role}`);
        return res.json(result);
      }
      const result = await remove(target, me, t);
      if (result.message) console.log(`[kosmy-board users] ${who} : accès de ${target} retiré`);
      return res.json(result);
    } catch (e) {
      if (e instanceof AdminError) return res.status(e.status).json({ error: e.error, message: e.message });
      console.error('[kosmy-board users]', e);
      return res.status(500).json({ error: 'server_error', message: 'Erreur du serveur Soundy.' });
    }
  };
}
