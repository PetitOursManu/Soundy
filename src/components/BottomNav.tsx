import { NavLink } from 'react-router-dom';
import { useDownloads } from '../store/downloads';
import { usePlayer } from '../store/player';
import { IconDisc, IconInbox, IconSearch } from './Icons';
import { useT } from '../i18n';

export function BottomNav() {
  const active = useDownloads((s) => s.tasks.filter((t) => t.status !== 'error').length);
  const hasMini = usePlayer((s) => s.queue.length > 0);
  const { t } = useT();
  const items = [
    { to: '/', label: t('nav.library'), icon: <IconDisc />, end: true, badge: active },
    { to: '/search', label: t('nav.search'), icon: <IconSearch /> },
    { to: '/requests', label: t('nav.requests'), icon: <IconInbox /> },
  ];
  return (
    <div className={`bottom-nav ${hasMini ? 'with-mini' : ''}`}>
      <nav aria-label={t('nav.main')}>
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
