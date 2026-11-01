// Navigation « en roue » : les titres sont posés sur un grand cercle dont le
// centre est à droite de l'écran. Le titre au point le plus à gauche est mis
// en avant (pastille + bouton Lire) ; les autres s'inclinent en suivant le
// cercle, comme sur une molette.
// Commandes : molette / trackpad, flèches du clavier, glisser au doigt ou à la souris.
// Menu d'un titre : clic droit ou appui long (et bouton ⋯ au survol sur ordinateur).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Track } from '../api/emby';
import { formatTime } from '../lib/format';
import { useDownloads } from '../store/downloads';
import { useNetwork } from '../store/network';
import { usePlayer } from '../store/player';
import { Cover } from './Cover';
import { IconDownloaded, IconMore, IconPause } from './Icons';
import { ProgressRing } from './ProgressRing';
import { TrackMenu } from './TrackRow';

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

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function isTyping(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

/** Dimensions calculées à partir de la largeur disponible. */
function geometry(width: number) {
  const w = Math.min(width, MAX_WIDTH);
  const cover = clamp(Math.round(w * 0.25), 78, 118);
  const spacing = Math.round(cover * 1.2);
  return { w, cover, spacing, radius: spacing / Math.sin(STEP) };
}

export function TrackWheel({ tracks, mode, onPlay, onNearEnd, total, storageKey, label = 'Liste des titres', multiDisc }: Props) {
  const max = Math.max(0, tracks.length - 1);
  const currentId = usePlayer((s) => s.queue[s.index]?.id);

  const initial = () => {
    const saved = storageKey ? Number(sessionStorage.getItem(`wheel:${storageKey}`)) : NaN;
    if (Number.isFinite(saved) && saved > 0) return clamp(saved, 0, max);
    const playing = tracks.findIndex((t) => t.id === currentId);
    return playing > 0 ? playing : 0;
  };

  const [pos, setPos] = useState(initial);
  const posRef = useRef(pos);
  const target = useRef(Math.round(pos));
  const maxRef = useRef(max);
  maxRef.current = max;
  const raf = useRef(0);
  const ref = useRef<HTMLDivElement>(null);
  const [geo, setGeo] = useState(() => geometry(window.innerWidth));
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const [menu, setMenu] = useState<Track | null>(null);
  const focus = clamp(Math.round(pos), 0, max);
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;

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

  // --- Animation vers la cible (amortie) ---------------------------------
  const animate = useCallback(() => {
    cancelAnimationFrame(raf.current);
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const diff = target.current - posRef.current;
      if (Math.abs(diff) < 0.002) {
        posRef.current = target.current;
        setPos(target.current);
        return;
      }
      posRef.current += diff * (1 - Math.exp((-dt * 13) / 1000));
      setPos(posRef.current);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, []);

  const goTo = useCallback(
    (i: number) => {
      target.current = clamp(Math.round(i), 0, maxRef.current);
      animate();
    },
    [animate],
  );

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

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
    let acc = 0;
    let lastStep = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      const now = performance.now();
      if (Math.abs(delta) >= 50) {
        // Molette de souris : un cran = un titre
        if (now - lastStep < 40) return;
        lastStep = now;
        acc = 0;
        goTo(target.current + Math.sign(delta));
      } else {
        // Trackpad : petits déplacements cumulés
        acc += delta;
        if (Math.abs(acc) >= 38) {
          goTo(target.current + Math.sign(acc));
          acc = 0;
        }
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [goTo]);

  // --- Clavier ---------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (document.querySelector('.backdrop')) return; // une feuille est ouverte
      const t = target.current;
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
          onPlayRef.current(t);
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
          navigator.vibrate?.(15);
          setMenu(tracks[Number(item.dataset.index)]);
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
      cancelAnimationFrame(raf.current);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    let p = d.start - dy / geoRef.current.spacing;
    // Effet élastique aux extrémités
    if (p < 0) p = p / 3;
    if (p > maxRef.current) p = maxRef.current + (p - maxRef.current) / 3;
    posRef.current = p;
    setPos(p);
    const now = performance.now();
    d.samples.push({ t: now, p });
    d.samples = d.samples.filter((s) => now - s.t < 120);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    clearTimeout(longPress.current);
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId || !d.moved) return;
    suppressNextClick();
    const s = d.samples;
    const v = s.length > 1 ? (s[s.length - 1].p - s[0].p) / ((s[s.length - 1].t - s[0].t) / 1000 || 1) : 0; // titres / s
    goTo(posRef.current + clamp(v, -40, 40) * 0.22);
  };

  const from = Math.max(0, focus - VISIBLE);
  const to = Math.min(max, focus + VISIBLE);
  const items = [];
  for (let i = from; i <= to; i++) items.push(i);
  const count = total ?? tracks.length;
  const trackNumber = (t: Track, i: number) =>
    multiDisc ? `${t.disc ?? 1}-${String(t.index ?? i + 1).padStart(2, '0')}` : String(t.index ?? i + 1);

  return (
    <>
      <div
        ref={ref}
        className="wheel"
        role="listbox"
        tabIndex={0}
        aria-label={`${label} — molette, flèches ou glisser pour naviguer`}
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
        <div className="wheel-track" style={{ width: geo.w }}>
          {items.map((i) => (
            <WheelItem
              key={tracks[i].id}
              index={i}
              track={tracks[i]}
              offset={i - pos}
              geo={geo}
              subtitle={mode === 'album' ? `Piste ${trackNumber(tracks[i], i)} · ${formatTime(tracks[i].duration)}` : tracks[i].artist}
              focused={i === focus}
              onSelect={() => (i === focus ? onPlay(i) : goTo(i))}
              onPlay={() => onPlay(i)}
              onMenu={() => setMenu(tracks[i])}
            />
          ))}
        </div>
      </div>

      {count > 1 && (
        <div className="wheel-scroll" aria-hidden>
          <i style={{ top: `${(clamp(pos, 0, max) / Math.max(1, count - 1)) * 100}%` }} />
        </div>
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
  offset: number;
  geo: ReturnType<typeof geometry>;
  subtitle: string;
  focused: boolean;
  onSelect: () => void;
  onPlay: () => void;
  onMenu: () => void;
}

function WheelItem({ index, track, offset, geo, subtitle, focused, onSelect, onPlay, onMenu }: ItemProps) {
  const isCurrent = usePlayer((s) => s.queue[s.index]?.id === track.id);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const toggle = usePlayer((s) => s.toggle);
  const downloaded = useDownloads((s) => !!s.downloaded[track.id]);
  const task = useDownloads((s) => s.tasks.find((t) => t.track.id === track.id));
  const online = useNetwork((s) => s.online);
  const unavailable = !online && !downloaded;

  // Position sur le cercle (centre du cercle à droite)
  const ad = Math.abs(offset);
  const theta = clamp(offset, -VISIBLE - 1, VISIBLE + 1) * STEP;
  const y = geo.radius * Math.sin(theta);
  const x = geo.radius * (1 - Math.cos(theta));
  const rot = (-theta * 0.75 * 180) / Math.PI; // au-dessus : penché vers le bas à droite
  const near = Math.max(0, 1 - ad); // 1 = titre centré
  const scale = 1 - Math.min(ad, 3) * 0.03;
  const opacity = Math.max(0, 1 - ad * 0.14) * (unavailable ? 0.45 : 1);

  return (
    <div
      id={`wheel-${track.id}`}
      data-index={index}
      role="option"
      aria-selected={focused}
      className={`wheel-item ${focused ? 'focused' : ''} ${isCurrent ? 'current' : ''}`}
      style={{
        height: geo.cover,
        transform: `translate(${x}px, calc(-50% + ${y}px)) rotate(${rot}deg) scale(${scale})`,
        opacity,
        zIndex: 100 - Math.round(ad * 10),
      }}
      onClick={onSelect}
    >
      <span className="wheel-pill" style={{ opacity: near, left: geo.cover * 0.45 }} />
      <span className="wheel-disc">
        <Cover imageId={track.imageId} tag={track.imageTag} size={240} style={{ width: '100%', height: '100%' }} alt="" />
      </span>
      <span className="wheel-text" style={{ paddingRight: near * 108 }}>
        <span className="wt ellipsis">{track.title}</span>
        <span className="ws">
          {task ? <ProgressRing value={task.progress} size={13} /> : downloaded && <IconDownloaded aria-label="Téléchargé" />}
          <span className="ellipsis">{subtitle}</span>
        </span>
      </span>
      <span className="wheel-actions" style={{ opacity: near, pointerEvents: near > 0.6 ? 'auto' : 'none' }}>
        <button
          className="icon-btn sm flat wheel-more"
          aria-label="Plus d'options"
          tabIndex={focused ? 0 : -1}
          onClick={(e) => {
            e.stopPropagation();
            onMenu();
          }}
        >
          <IconMore />
        </button>
        <button
          className={`play-pill ${isCurrent ? 'on' : ''}`}
          aria-label={isCurrent && isPlaying ? 'Pause' : 'Lire'}
          tabIndex={focused ? 0 : -1}
          disabled={unavailable}
          onClick={(e) => {
            e.stopPropagation();
            if (isCurrent) toggle();
            else onPlay();
          }}
        >
          {isCurrent && isPlaying ? (
            <>
              <IconPause /> <span className="lbl">Pause</span>
            </>
          ) : (
            <span className="lbl">Lire</span>
          )}
        </button>
      </span>
    </div>
  );
}
