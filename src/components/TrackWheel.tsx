// Navigation « en roue » : les titres sont posés sur un grand cercle dont le
// centre est à droite de l'écran. Le titre au point le plus à gauche est mis
// en avant (pastille) ; un appui dessus lance la lecture ; les autres s'inclinent en suivant le
// cercle, comme sur une molette.
//
// Performance : pendant l'animation, React n'est PAS sollicité. Les positions
// sont écrites directement dans le DOM (transform / opacity uniquement, donc
// traitées par le GPU). React ne refait un rendu que lorsque le titre centré
// change.
//
// Commandes : molette / trackpad, flèches du clavier, glisser au doigt ou à la souris.
// Menu d'un titre : clic droit ou appui long (et bouton ⋯ au survol sur ordinateur).
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Track } from '../api/emby';
import { formatTime } from '../lib/format';
import { hapticHeavy, hapticTick } from '../lib/haptics';
import { useDownloads } from '../store/downloads';
import { useNetwork } from '../store/network';
import { usePlayer } from '../store/player';
import { Cover } from './Cover';
import { IconDownloaded, IconMore } from './Icons';
import { ProgressRing } from './ProgressRing';
import { TrackMenu } from './TrackRow';
import { useT } from '../i18n';
import { FavoriteButton } from './FavoriteButton';

interface Props {
  tracks: Track[];
  /** "album" : sous-titre « Piste n · durée » au lieu de l'artiste. */
  mode: 'album' | 'tracks';
  onPlay: (index: number) => void;
  /** Appelé quand on approche de la fin de la liste (chargement progressif). */
  onNearEnd?: () => void;
  /** Nombre total de titres (si la liste est chargée par morceaux). */
  total?: number;
  /** Clé de mémorisation de la position (retour sur la page). */
  storageKey?: string;
  label?: string;
  /** Album sur plusieurs disques : numéro affiché sous la forme 2-05. */
  multiDisc?: boolean;
}

const STEP = (18 * Math.PI) / 180; // angle entre deux titres sur le cercle
const VISIBLE = 5; // titres rendus de chaque côté du titre centré
const MAX_WIDTH = 540; // largeur maximale de la roue (px)
const ITEM_RIGHT = 18; // marge droite des lignes (px), cf. .wheel-item
const ARC_SPACE = 42; // largeur occupée par la barre courbe + respiration (px)

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// Barre de défilement courbe : arc (courbe de Bézier) creusé vers la gauche, comme la roue
const ARC = { x0: 54, y0: 8, cx: -30, cy: 150, x1: 54, y1: 292 };
const ARC_PATH = `M ${ARC.x0} ${ARC.y0} Q ${ARC.cx} ${ARC.cy} ${ARC.x1} ${ARC.y1}`;
function arcPoint(t: number) {
  const u = 1 - t;
  return [u * u * ARC.x0 + 2 * u * t * ARC.cx + t * t * ARC.x1, u * u * ARC.y0 + 2 * u * t * ARC.cy + t * t * ARC.y1];
}
/** Petit segment de l'arc centré sur la position t (0 → 1). */
function arcSegment(t: number) {
  const half = 0.045;
  const a = clamp(t - half, 0, 1 - 2 * half);
  const pts = [0, 0.25, 0.5, 0.75, 1].map((k) => arcPoint(a + k * 2 * half));
  return 'M ' + pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ');
}

function isTyping(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

/** Dimensions calculées à partir de la largeur disponible. */
function geometry(width: number) {
  const w = Math.min(width, MAX_WIDTH);
  const cover = clamp(Math.round(w * 0.25), 78, 118);
  const spacing = Math.round(cover * 1.2);
  // Place réservée à droite pour la barre de défilement courbe : sur mobile la roue
  // occupe toute la largeur, on raccourcit donc les lignes pour qu'elles ne passent
  // pas sous la barre (sur grand écran, la marge autour de la roue suffit).
  const reserve = Math.max(0, ARC_SPACE - ITEM_RIGHT - (width - w) / 2);
  return { w, cover, spacing, radius: spacing / Math.sin(STEP), reserve };
}

interface ItemNodes {
  el: HTMLDivElement;
  pill: HTMLElement | null;
  text: HTMLElement | null;
  actions: HTMLElement | null;
}

export function TrackWheel({ tracks, mode, onPlay, onNearEnd, total, storageKey, label, multiDisc }: Props) {
  const { t } = useT();
  const max = Math.max(0, tracks.length - 1);
  const currentId = usePlayer((s) => s.queue[s.index]?.id);

  const initial = () => {
    const saved = storageKey ? Number(sessionStorage.getItem(`wheel:${storageKey}`)) : NaN;
    if (Number.isFinite(saved) && saved > 0) return clamp(saved, 0, max);
    const playing = tracks.findIndex((t) => t.id === currentId);
    return playing > 0 ? playing : 0;
  };

  // Seul le titre centré (entier) passe par l'état React
  const [focus, setFocus] = useState(initial);
  const focusRef = useRef(focus);
  const posRef = useRef<number>(focus); // position continue (animée)
  const target = useRef<number>(focus);
  const maxRef = useRef(max);
  maxRef.current = max;
  const raf = useRef(0);
  const ref = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<SVGPathElement>(null);
  const nodes = useRef(new Map<number, ItemNodes>());
  const [geo, setGeo] = useState(() => geometry(window.innerWidth));
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const [menu, setMenu] = useState<Track | null>(null);
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;
  const count = total ?? tracks.length;
  const countRef = useRef(count);
  countRef.current = count;

  // --- Placement des titres (appelé à chaque image) ---------------------------
  const apply = useCallback(() => {
    const pos = posRef.current;
    const g = geoRef.current;
    nodes.current.forEach((n, i) => {
      const offset = i - pos;
      const ad = Math.abs(offset);
      const theta = clamp(offset, -VISIBLE - 1, VISIBLE + 1) * STEP;
      const y = g.radius * Math.sin(theta);
      const x = g.radius * (1 - Math.cos(theta));
      const rot = -theta * 0.75; // au-dessus : penché vers le bas à droite
      const scale = 1 - Math.min(ad, 3) * 0.03;
      const near = Math.max(0, 1 - ad);
      const dim = n.el.dataset.dim === '1' ? 0.45 : 1;
      n.el.style.transform = `translate3d(${x.toFixed(2)}px, ${(y - g.cover / 2).toFixed(2)}px, 0) rotate(${rot.toFixed(4)}rad) scale(${scale.toFixed(4)})`;
      n.el.style.opacity = String(Math.max(0, 1 - ad * 0.14) * dim);
      if (n.pill) n.pill.style.opacity = String(near);
      if (n.actions) n.actions.style.opacity = String(near);
    });
    if ((window as unknown as { __soundyDebug?: boolean }).__soundyDebug) (window as unknown as { __wheelPos: number }).__wheelPos = pos;
    if (thumbRef.current) {
      // Curseur : petit segment posé sur la courbe, à la position de lecture
      const t = clamp(pos, 0, maxRef.current) / Math.max(1, countRef.current - 1);
      thumbRef.current.setAttribute('d', arcSegment(t));
    }
    const f = clamp(Math.round(pos), 0, maxRef.current);
    if (f !== focusRef.current) {
      focusRef.current = f;
      setFocus(f);
      hapticTick(); // petite vibration douce à chaque titre
    }
  }, []);

  const register = useCallback(
    (i: number, el: HTMLDivElement | null) => {
      if (!el) {
        nodes.current.delete(i);
        return;
      }
      nodes.current.set(i, {
        el,
        pill: el.querySelector<HTMLElement>('.wheel-pill'),
        text: el.querySelector<HTMLElement>('.wheel-text'),
        actions: el.querySelector<HTMLElement>('.wheel-actions'),
      });
    },
    [],
  );

  // Après chaque rendu React (nouveaux titres visibles…), on replace tout avant l'affichage
  useLayoutEffect(() => {
    apply();
  });

  // Taille de la roue selon la largeur de l'écran
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setGeo(geometry(el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // --- Animation vers la cible (ressort amorti) -----------------------------
  const velocity = useRef(0);
  // "follow" : la roue colle au geste (trackpad / inertie) ; "spring" : calage doux sur un titre
  const motion = useRef<'follow' | 'spring'>('spring');
  const animate = useCallback(() => {
    if (raf.current) return; // une seule boucle d'animation à la fois
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      const diff = target.current - posRef.current;
      if (motion.current === 'follow') {
        // Lissage très court (~25 ms) : suit le doigt sans retard perceptible
        const move = diff * (1 - Math.exp(-dt * 40));
        velocity.current = dt > 0 ? move / dt : 0;
        posRef.current += move;
      } else {
        // Ressort critique : mouvement doux, sans rebond
        const k = 190;
        const c = 2 * Math.sqrt(k);
        velocity.current += (k * diff - c * velocity.current) * dt;
        posRef.current += velocity.current * dt;
      }
      apply();
      if (Math.abs(target.current - posRef.current) < 0.0008 && Math.abs(velocity.current) < 0.02) {
        posRef.current = target.current;
        velocity.current = 0;
        apply();
        raf.current = 0;
        return;
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [apply]);

  const stopAnimation = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
  }, []);

  const goTo = useCallback(
    (i: number) => {
      const t = clamp(Math.round(i), 0, maxRef.current);
      target.current = t;
      motion.current = 'spring';
      // Grand saut (Début / Fin, Page…) : on se place à 4 titres de la cible puis on glisse,
      // pour éviter d'afficher des dizaines de pochettes en une seconde
      const diff = t - posRef.current;
      if (Math.abs(diff) > 6) {
        posRef.current = t - Math.sign(diff) * 4;
        velocity.current = 0;
        apply();
      }
      animate();
    },
    [animate, apply],
  );

  useEffect(() => stopAnimation, [stopAnimation]);

  // Sur ordinateur, la roue reçoit directement le focus clavier
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) ref.current?.focus({ preventScroll: true });
  }, []);

  // Liste raccourcie (changement de tri…) : on reste dans les bornes
  useEffect(() => {
    if (target.current > max) goTo(max);
  }, [max, goTo]);

  // Mémorise la position + chargement progressif
  useEffect(() => {
    if (storageKey) sessionStorage.setItem(`wheel:${storageKey}`, String(focus));
    if (onNearEnd && focus >= tracks.length - 15) onNearEnd();
  }, [focus, storageKey, onNearEnd, tracks.length]);

  // --- Molette / trackpad --------------------------------------------------
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let snapTimer = 0;
    let gestureStart = 0;
    const isMouseNotch = (e: WheelEvent) => {
      if (e.deltaMode !== 0) return true; // Firefox : défilement par lignes = molette
      const d = Math.abs(e.deltaY);
      // Molette classique : multiples exacts de 100 (Chrome/Edge) ou 120 (Windows)
      return d >= 100 && Number.isInteger(e.deltaY) && (d % 100 === 0 || d % 120 === 0) && Math.abs(e.deltaX) === 0;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (isMouseNotch(e)) {
        // Un cran = un titre (plusieurs crans rapides s'additionnent)
        clearTimeout(snapTimer);
        const base = motion.current === 'spring' ? target.current : Math.round(posRef.current);
        goTo(Math.round(base) + Math.sign(e.deltaY));
        return;
      }
      // Trackpad / souris à défilement fin : la roue suit le geste en continu…
      const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (motion.current === 'spring') {
        target.current = posRef.current;
        gestureStart = Math.round(posRef.current);
      }
      motion.current = 'follow';
      target.current = clamp(target.current + delta / geoRef.current.spacing, -0.4, maxRef.current + 0.4);
      animate();
      // …puis se cale sur le titre le plus proche quand le geste (et son inertie) s'arrête
      clearTimeout(snapTimer);
      snapTimer = window.setTimeout(() => {
        const projected = target.current + clamp(velocity.current, -20, 20) * 0.05;
        let dest = Math.round(projected);
        // Petit geste volontaire (ex. souris Mac à défilement fin) : au moins un titre
        if (dest === gestureStart && Math.abs(projected - gestureStart) > 0.06) dest += Math.sign(projected - gestureStart);
        goTo(dest);
      }, 90);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      clearTimeout(snapTimer);
    };
  }, [goTo, animate]);

  // --- Clavier ---------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (document.querySelector('.backdrop')) return; // une feuille est ouverte
      const t = Math.round(target.current);
      const nav = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'PageDown', 'PageUp', 'Home', 'End'];
      // La roue prend le focus clavier dès qu'on navigue avec les flèches
      if (nav.includes(e.key)) ref.current?.focus({ preventScroll: true });
      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowRight':
          goTo(t + 1);
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
          goTo(t - 1);
          break;
        case 'PageDown':
          goTo(t + 5);
          break;
        case 'PageUp':
          goTo(t - 5);
          break;
        case 'Home':
          goTo(0);
          break;
        case 'End':
          goTo(maxRef.current);
          break;
        case 'Enter':
          if (e.target !== ref.current && ['BUTTON', 'A'].includes((e.target as HTMLElement)?.tagName)) return;
          onPlayRef.current(focusRef.current);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo]);

  // --- Glisser (doigt ou souris) + appui long -------------------------------
  const drag = useRef<{ id: number; y: number; start: number; moved: boolean; samples: { t: number; p: number }[] } | null>(null);
  const suppressClick = useRef(false);
  const longPress = useRef<number>();

  const suppressNextClick = () => {
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag.current = { id: e.pointerId, y: e.clientY, start: posRef.current, moved: false, samples: [] };
    // Appui long (tactile) sur un titre → menu
    const item = (e.target as HTMLElement).closest<HTMLElement>('[data-index]');
    clearTimeout(longPress.current);
    if (item && e.pointerType !== 'mouse') {
      longPress.current = window.setTimeout(() => {
        if (drag.current && !drag.current.moved) {
          drag.current = null;
          suppressNextClick();
          hapticHeavy();
          setMenu(tracksRef.current[Number(item.dataset.index)]);
        }
      }, 550);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.abs(dy) < 6) return;
      d.moved = true;
      clearTimeout(longPress.current);
      stopAnimation();
      velocity.current = 0;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    let p = d.start - dy / geoRef.current.spacing;
    // Effet élastique aux extrémités
    if (p < 0) p = p / 3;
    if (p > maxRef.current) p = maxRef.current + (p - maxRef.current) / 3;
    posRef.current = p;
    target.current = p;
    motion.current = 'follow';
    apply();
    const now = performance.now();
    d.samples.push({ t: now, p });
    d.samples = d.samples.filter((s) => now - s.t < 100);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    clearTimeout(longPress.current);
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || !d.moved) return;
    suppressNextClick();
    const s = d.samples;
    const v = s.length > 1 ? (s[s.length - 1].p - s[0].p) / ((s[s.length - 1].t - s[0].t) / 1000 || 1) : 0; // titres / s
    // Élan : la roue continue sur sa lancée puis se cale sur un titre
    velocity.current = clamp(v, -30, 30) * 0.6;
    goTo(posRef.current + clamp(v, -40, 40) * 0.22);
  };

  // Gestionnaires stables (évite de redessiner tous les titres)
  const selectIndex = useCallback((i: number) => (i === focusRef.current ? onPlayRef.current(i) : goTo(i)), [goTo]);
  const menuIndex = useCallback((i: number) => setMenu(tracksRef.current[i]), []);

  const from = Math.max(0, focus - VISIBLE);
  const to = Math.min(max, focus + VISIBLE);
  const items = [];
  for (let i = from; i <= to; i++) items.push(i);
  const trackNumber = (t: Track, i: number) =>
    multiDisc ? `${t.disc ?? 1}-${String(t.index ?? i + 1).padStart(2, '0')}` : String(t.index ?? i + 1);

  return (
    <>
      <div
        ref={ref}
        className="wheel"
        role="listbox"
        tabIndex={0}
        aria-label={t('wheel.help', { label: label ?? t('wheel.list') })}
        aria-activedescendant={tracks[focus] ? `wheel-${tracks[focus].id}` : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => {
          const item = (e.target as HTMLElement).closest<HTMLElement>('[data-index]');
          if (!item) return;
          e.preventDefault();
          setMenu(tracks[Number(item.dataset.index)]);
        }}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            e.stopPropagation();
            e.preventDefault();
          }
        }}
        style={{ ['--cover' as string]: `${geo.cover}px` }}
      >
        <div className="wheel-track" style={{ width: geo.w, ['--arc-reserve' as string]: `${geo.reserve}px` }}>
          {items.map((i) => (
            <WheelItem
              key={tracks[i].id}
              index={i}
              track={tracks[i]}
              cover={geo.cover}
              subtitle={mode === 'album' ? t('album.track', { n: trackNumber(tracks[i], i), duration: formatTime(tracks[i].duration) }) : tracks[i].artist}
              focused={i === focus}
              depth={Math.abs(i - focus)}
              register={register}
              onSelect={selectIndex}
              onMenu={menuIndex}
            />
          ))}
        </div>
      </div>

      {/* Fondu haut / bas (plus léger qu'un masque CSS) */}
      <div className="wheel-fade top" aria-hidden />
      <div className="wheel-fade bottom" aria-hidden />

      {count > 1 && (
        <svg className="wheel-scroll-arc" viewBox="0 0 60 300" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="wheel-thumb" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" />
              <stop offset="1" stopColor="var(--accent-2)" />
            </linearGradient>
          </defs>
          {/* Rainure en creux qui suit la courbure de la roue */}
          <path className="groove-shadow" d={ARC_PATH} />
          <path className="groove" d={ARC_PATH} />
          <path ref={thumbRef} className="thumb" d={arcSegment(0)} stroke="url(#wheel-thumb)" />
        </svg>
      )}
      <div className="wheel-counter" aria-live="polite">
        {focus + 1} / {count}
      </div>

      {menu && <TrackMenu track={menu} onClose={() => setMenu(null)} />}
    </>
  );
}

interface ItemProps {
  index: number;
  track: Track;
  cover: number;
  subtitle: string;
  focused: boolean;
  depth: number;
  register: (i: number, el: HTMLDivElement | null) => void;
  onSelect: (i: number) => void;
  onMenu: (i: number) => void;
}

const WheelItem = memo(function WheelItem({ index, track, cover, subtitle, focused, depth, register, onSelect, onMenu }: ItemProps) {
  const isCurrent = usePlayer((s) => s.queue[s.index]?.id === track.id);
  const { t } = useT();
  const downloaded = useDownloads((s) => !!s.downloaded[track.id]);
  const progress = useDownloads((s) => s.tasks.find((t) => t.track.id === track.id)?.progress);
  const online = useNetwork((s) => s.online);
  const unavailable = !online && !downloaded;
  const setRef = useCallback((el: HTMLDivElement | null) => register(index, el), [register, index]);

  return (
    <div
      ref={setRef}
      id={`wheel-${track.id}`}
      data-index={index}
      data-dim={unavailable ? '1' : '0'}
      role="option"
      aria-selected={focused}
      className={`wheel-item ${focused ? 'focused' : ''} ${isCurrent ? 'current' : ''}`}
      style={{ height: cover, zIndex: 100 - depth * 10 }}
      onClick={() => onSelect(index)}
    >
      <span className="wheel-pill" style={{ left: cover * 0.45 }} />
      <span className="wheel-disc">
        <Cover imageId={track.imageId} tag={track.imageTag} size={240} style={{ width: '100%', height: '100%' }} alt="" />
        {/* ❤ au centre de la jaquette (translucide, rose en favori) */}
        <FavoriteButton item={track} className="wheel-fav" />
      </span>
      <span className="wheel-text">
        <span className="wt ellipsis">{track.title}</span>
        <span className="ws">
          {progress !== undefined ? <ProgressRing value={progress} size={13} /> : downloaded && <IconDownloaded aria-label={t('common.downloaded')} />}
          <span className="ellipsis">{subtitle}</span>
        </span>
      </span>
      <span className="wheel-actions">
        <button
          className="icon-btn sm flat wheel-more"
          aria-label={t('common.more')}
          tabIndex={focused ? 0 : -1}
          onClick={(e) => {
            e.stopPropagation();
            onMenu(index);
          }}
        >
          <IconMore />
        </button>
      </span>
    </div>
  );
});
