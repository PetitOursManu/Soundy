import { currentLang } from '../i18n';

export function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  const ss = s.toString().padStart(2, '0');
  return h ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (currentLang() === 'en') return h ? `${h} hr ${m} min` : `${m} min`;
  return h ? `${h} h ${m.toString().padStart(2, '0')}` : `${m} min`;
}

export function formatBytes(bytes: number): string {
  const en = currentLang() === 'en';
  const units = en ? ['B', 'KB', 'MB', 'GB', 'TB'] : ['o', 'Ko', 'Mo', 'Go', 'To'];
  if (!bytes) return `0 ${units[0]}`;
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = (bytes / 1024 ** i).toFixed(i >= 2 ? 1 : 0);
  return `${en ? v : v.replace('.', ',')} ${units[i]}`;
}

export function shuffleArray<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}


