import { lazy, Suspense, useEffect, useRef } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { onBackButton } from './lib/backButton';
import { BottomNav } from './components/BottomNav';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MiniPlayer } from './components/MiniPlayer';
import { Toasts } from './components/Toasts';
import Library from './pages/Library';
import Login from './pages/Login';
import { useAuth } from './store/auth';
import { useDownloads } from './store/downloads';
import { usePlayer } from './store/player';
import { useSettings } from './store/settings';
import { toast } from './store/toast';
import { EmbyError } from './api/emby';

const AlbumPage = lazy(() => import('./pages/AlbumPage'));
const Search = lazy(() => import('./pages/Search'));
const Requests = lazy(() => import('./pages/Requests'));
const Settings = lazy(() => import('./pages/Settings'));
const Player = lazy(() => import('./pages/Player'));

function useTheme() {
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
    const apply = () => {
      const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

function Shell() {
  const location = useLocation();
  const onPlayer = location.pathname === '/player';
  const hasMini = usePlayer((s) => s.queue.length > 0);

  // Bouton retour d'Android : écran précédent, ou bibliothèque, ou arrière-plan
  const navigate = useNavigate();
  const locRef = useRef(location);
  locRef.current = location;
  useEffect(
    () =>
      onBackButton(() => {
        const loc = locRef.current;
        if (loc.key !== 'default') {
          navigate(-1);
          return true;
        }
        if (loc.pathname !== '/') {
          navigate('/', { replace: true });
          return true;
        }
        return false; // écran principal → l'appli passe en arrière-plan
      }),
    [navigate],
  );

  // Remonte en haut à chaque changement de page (sauf retour arrière géré par la page)
  useEffect(() => {
    if (!onPlayer) window.scrollTo(0, 0);
  }, [location.pathname, onPlayer]);

  return (
    <div className={hasMini ? 'has-mini' : ''}>
      <ErrorBoundary key={location.pathname}>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/album/:id" element={<AlbumPage />} />
          <Route path="/search" element={<Search />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/player" element={<Player />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      </ErrorBoundary>
      {!onPlayer && (
        <>
          <MiniPlayer />
          <BottomNav />
        </>
      )}
    </div>
  );
}

export default function App() {
  const session = useAuth((s) => s.session);
  useTheme();

  useEffect(() => {
    void useDownloads.getState().init();
  }, []);

  // Session expirée → retour à l'écran de connexion
  useEffect(() => {
    const onError = (e: PromiseRejectionEvent) => {
      if (e.reason instanceof EmbyError && e.reason.status === 401) {
        toast('Session expirée, veuillez vous reconnecter.', 'error');
        useAuth.getState().logout();
      }
    };
    window.addEventListener('unhandledrejection', onError);
    return () => window.removeEventListener('unhandledrejection', onError);
  }, []);

  return (
    <div className="app">
      <Toasts />
      {session ? (
        <HashRouter>
          <Shell />
        </HashRouter>
      ) : (
        <Login />
      )}
    </div>
  );
}
