import { NavLink } from 'react-router-dom';
import { useDownloads } from '../store/downloads';
import { usePlayer } from '../store/player';
import { IconDisc, IconInbox, IconSearch } from './Icons';

export function BottomNav() {
  const active = useDownloads((s) => s.tasks.filter((t) => t.status !== 'error').length);
  const hasMini = usePlayer((s) => s.queue.length > 0);
  const items = [
    { to: '/', label: 'Bibliothèque', icon: <IconDisc />, end: true, badge: active },
    { to: '/search', label: 'Recherche', icon: <IconSearch /> },
    { to: '/requests', label: 'Demandes', icon: <IconInbox /> },
  ];
  return (
    <div className={`bottom-nav ${hasMini ? 'with-mini' : ''}`}>
      <nav aria-label="Navigation principale">
        {items.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            {it.icon}
            <span>{it.label}</span>
            {!!it.badge && <span className="dot">{it.badge}</span>}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
