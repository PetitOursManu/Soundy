import { usePlayer } from '../store/player';
import { Cover } from './Cover';
import { IconX } from './Icons';
import { Sheet } from './Sheet';
import { useT } from '../i18n';

export function QueueSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const { playAt, removeAt } = usePlayer.getState();
  const upcoming = queue.length - index - 1;
  const { t, tn } = useT();

  return (
    <Sheet open={open} onClose={onClose} title={t('queue.title')} description={upcoming > 0 ? tn('queue.upcoming', upcoming) : t('queue.none')}>
      <div className="track-list">
        {queue.map((tr, i) => (
          <div
            key={`${tr.id}-${i}`}
            className={`track-row ${i === index ? 'active' : ''}`}
            style={{ opacity: i < index ? 0.45 : 1 }}
            onClick={() => playAt(i)}
          >
            <Cover imageId={tr.imageId} tag={tr.imageTag} size={100} style={{ width: 42, height: 42 }} />
            <div className="info">
              <div className="t ellipsis">{tr.title}</div>
              <div className="s ellipsis">{tr.artist}</div>
            </div>
            {i !== index && (
              <button
                className="icon-btn sm flat"
                aria-label={t('queue.remove')}
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
