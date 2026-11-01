import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { BottomNav } from './components/BottomNav';
import { MiniPlayer } from './components/MiniPlayer';
import { Toasts } from './components/Toasts';
import Library from './pages/Library';
import Login from './pages/Login';
import { useAuth } from './store/auth';
import { useDownloads } from './store/downloads';
import { useSettings } from './store/settings';
import { toast } from './store/toast';
import { EmbyError } from './api/emby';

const AlbumPage = lazy(() => import('./pages/AlbumPage'));
const Search = lazy(() => import('./pages/Search'));
const Downloads = lazy(() => import('./pages/Downloads'));
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

  // Remonte en haut à chaque changement de page (sauf retour arrière géré par la page)
  useEffect(() => {
    if (!onPlayer) window.scrollTo(0, 0);
  }, [location.pathname, onPlayer]);

  return (
    <>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/album/:id" element={<AlbumPage />} />
          <Route path="/search" element={<Search />} />
          <Route path="/downloads" element={<Downloads />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/player" element={<Player />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      {!onPlayer && (
        <>
          <MiniPlayer />
          <BottomNav />
        </>
      )}
    </>
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
