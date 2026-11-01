import { usePlayer } from '../store/player';
import { Cover } from './Cover';
import { IconX } from './Icons';
import { Sheet } from './Sheet';

export function QueueSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const { playAt, removeAt } = usePlayer.getState();
  const upcoming = queue.length - index - 1;

  return (
    <Sheet open={open} onClose={onClose} title="File d'attente" description={upcoming > 0 ? `${upcoming} titre${upcoming > 1 ? 's' : ''} à venir` : 'Aucun titre à venir'}>
      <div className="track-list">
        {queue.map((t, i) => (
          <div
            key={`${t.id}-${i}`}
            className={`track-row ${i === index ? 'active' : ''}`}
            style={{ opacity: i < index ? 0.45 : 1 }}
            onClick={() => playAt(i)}
          >
            <Cover imageId={t.imageId} tag={t.imageTag} size={100} style={{ width: 42, height: 42 }} />
            <div className="info">
              <div className="t ellipsis">{t.title}</div>
              <div className="s ellipsis">{t.artist}</div>
            </div>
            {i !== index && (
              <button
                className="icon-btn sm flat"
                aria-label="Retirer de la file"
                onClick={(e) => {
                  e.stopPropagation();
                  removeAt(i);
                }}
              >
                <IconX />
              </button>
            )}
          </div>
        ))}
      </div>
    </Sheet>
  );
}
