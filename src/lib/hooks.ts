import { useCallback, useEffect, useRef, useState } from 'react';
import type { Page } from '../api/emby';

interface PagedState<T> {
  items: T[];
  total: number;
  done: boolean;
}

// Cache mémoire : on garde les listes quand on navigue (retour depuis un album…)
const cache = new Map<string, PagedState<unknown>>();

export function clearPagedCache() {
  cache.clear();
}

/** Liste paginée avec chargement progressif (défilement infini). */
export function usePaged<T>(key: string | null, fetchPage: (start: number, signal: AbortSignal) => Promise<Page<T>>) {
  const [state, setState] = useState<PagedState<T>>(() => (key && (cache.get(key) as PagedState<T>)) || { items: [], total: 0, done: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const ctrl = useRef<AbortController>();
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const cached = key ? (cache.get(key) as PagedState<T> | undefined) : undefined;
    setState(cached ?? { items: [], total: 0, done: false });
    setError(null);
    busy.current = false;
    ctrl.current?.abort();
    return () => ctrl.current?.abort();
  }, [key]);

  const loadMore = useCallback(async () => {
    if (!key || busy.current || stateRef.current.done) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    const c = new AbortController();
    ctrl.current = c;
    try {
      const start = stateRef.current.items.length;
      const page = await fetchRef.current(start, c.signal);
      if (c.signal.aborted) return;
      const items = [...stateRef.current.items, ...page.items];
      const next = { items, total: page.total, done: items.length >= page.total || page.items.length === 0 };
      cache.set(key, next);
      setState(next);
    } catch (e) {
      if (!c.signal.aborted) setError((e as Error).message || 'Erreur de chargement');
    } finally {
      if (!c.signal.aborted) {
        busy.current = false;
        setLoading(false);
      }
    }
  }, [key]);

  const reload = useCallback(() => {
    if (key) cache.delete(key);
    busy.current = false;
    setState({ items: [], total: 0, done: false });
  }, [key]);

  return { ...state, loading, error, loadMore, reload };
}

/** Déclenche `onVisible` quand l'élément sentinelle entre dans l'écran. */
export function useSentinel(onVisible: () => void, enabled = true, dep: unknown = null) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onVisible);
  cb.current = onVisible;
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && cb.current(), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, dep]);
  return ref;
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** Mémorise et restaure la position de défilement d'une page. */
export function useScrollRestore(key: string, ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const saved = Number(sessionStorage.getItem(`scroll:${key}`) || 0);
    if (saved) requestAnimationFrame(() => window.scrollTo(0, saved));
    const save = () => sessionStorage.setItem(`scroll:${key}`, String(window.scrollY));
    window.addEventListener('scroll', save, { passive: true });
    return () => window.removeEventListener('scroll', save);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);
}
