import { useEffect, useState } from 'react';
import { login } from '../api/emby';
import { onBackButton } from '../lib/backButton';
import { Brand } from '../components/Brand';
import { IconLock, IconServer, IconUser } from '../components/Icons';
import { useAuth } from '../store/auth';
import { useNetwork } from '../store/network';

const LAST_SERVER = 'soundy.lastServer';

export default function Login() {
  const setSession = useAuth((s) => s.setSession);
  const online = useNetwork((s) => s.online);
  const [step, setStep] = useState<'intro' | 'form'>(localStorage.getItem(LAST_SERVER) ? 'form' : 'intro');
  const [server, setServer] = useState(localStorage.getItem(LAST_SERVER) ?? import.meta.env.VITE_EMBY_URL ?? '');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bouton retour d'Android : formulaire → écran d'accueil
  useEffect(
    () =>
      onBackButton(() => {
        if (step !== 'form') return false;
        setStep('intro');
        return true;
      }),
    [step],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!server.trim() || !user.trim()) return setError("Renseignez l'adresse du serveur et votre identifiant.");
    setLoading(true);
    try {
      const session = await login(server, user.trim(), password);
      localStorage.setItem(LAST_SERVER, session.server);
      setSession(session);
    } catch (err) {
      setError((err as Error).message || 'Connexion impossible.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`welcome ${step === 'form' ? 'form' : ''}`}>
      <Brand size={44} />
      <div className="discs" aria-hidden>
        <div className="half" />
        <div className="half" />
        <div className="cd" />
      </div>
      {step === 'intro' && (
        <div className="cassette" aria-hidden>
          <div className="lbl">
            S <small>SOUNDY · TYPE I</small>
          </div>
          <div className="reels">
            <i />
            <i />
          </div>
        </div>
      )}

      {step === 'intro' ? (
        <>
          <h1 className="headline">
            <span>Le nouvel</span>
            <span>âge de la</span>
            <span>musique</span>
          </h1>
          <p className="tagline">Toute votre bibliothèque Emby, en streaming ou hors ligne, sur tous vos appareils.</p>
          <button className="btn block" onClick={() => setStep('form')} style={{ height: 60, fontSize: 16 }}>
            Commencer
          </button>
        </>
      ) : (
        <form className="login-card" onSubmit={submit} style={{ marginTop: 'auto', marginBottom: 'auto', paddingTop: 20 }}>
          <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em' }}>Connexion</h1>
          <p className="tagline" style={{ margin: '8px 0 28px' }}>
            Connectez-vous avec votre compte Emby.
          </p>

          <div className="field">
            <label htmlFor="server">Adresse du serveur Emby</label>
            <div className="input-wrap">
              <IconServer />
              <input
                id="server"
                type="url"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://musique.mondomaine.fr"
                value={server}
                onChange={(e) => setServer(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="user">Identifiant</label>
            <div className="input-wrap">
              <IconUser />
              <input id="user" autoComplete="username" autoCapitalize="off" value={user} onChange={(e) => setUser(e.target.value)} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="password">Mot de passe</label>
            <div className="input-wrap">
              <IconLock />
              <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </div>

          {!online && <p className="error-text">Aucune connexion Internet.</p>}
          {error && <p className="error-text">{error}</p>}

          <button className="btn accent block" type="submit" disabled={loading || !online} style={{ marginTop: 18, height: 58 }}>
            {loading ? <span className="loader" style={{ width: 20, height: 20 }} /> : 'Se connecter'}
          </button>
          <button type="button" className="btn block" style={{ marginTop: 18, boxShadow: 'none', color: 'var(--text-2)' }} onClick={() => setStep('intro')}>
            Retour
          </button>
        </form>
      )}
    </div>
  );
}
