// Icônes SVG (trait arrondi, style « line »)
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

const base = (props: P, children: React.ReactNode, fill = false) => (
  <svg
    viewBox="0 0 24 24"
    fill={fill ? 'currentColor' : 'none'}
    stroke={fill ? 'none' : 'currentColor'}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    {children}
  </svg>
);

export const IconPlay = (p: P) => base(p, <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z" />, true);
export const IconPause = (p: P) =>
  base(
    p,
    <>
      <rect x="5.5" y="4" width="4.5" height="16" rx="1.5" />
      <rect x="14" y="4" width="4.5" height="16" rx="1.5" />
    </>,
    true,
  );
export const IconPrev = (p: P) =>
  base(
    p,
    <>
      <path d="M18.5 5.2v13.6a1 1 0 0 1-1.55.83L7.5 13.2a1.4 1.4 0 0 1 0-2.4l9.45-6.43a1 1 0 0 1 1.55.83Z" />
      <rect x="4" y="4.5" width="2.6" height="15" rx="1.3" />
    </>,
    true,
  );
export const IconNext = (p: P) =>
  base(
    p,
    <>
      <path d="M5.5 5.2v13.6a1 1 0 0 0 1.55.83l9.45-6.43a1.4 1.4 0 0 0 0-2.4L7.05 4.37a1 1 0 0 0-1.55.83Z" />
      <rect x="17.4" y="4.5" width="2.6" height="15" rx="1.3" />
    </>,
    true,
  );
export const IconBack = (p: P) => base(p, <path d="m15 18-6-6 6-6" />);
export const IconDown = (p: P) => base(p, <path d="m6 9 6 6 6-6" />);
export const IconChevronRight = (p: P) => base(p, <path d="m9 18 6-6-6-6" />);
export const IconMore = (p: P) =>
  base(
    p,
    <>
      <circle cx="5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" />
    </>,
  );
export const IconDisc = (p: P) =>
  base(
    p,
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 6.5a5.5 5.5 0 0 0-5.5 5.5" />
    </>,
  );
export const IconMusic = (p: P) =>
  base(
    p,
    <>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="17" cy="16" r="3" />
    </>,
  );
export const IconList = (p: P) =>
  base(
    p,
    <>
      <path d="M8 6h13M8 12h13M8 18h8" />
      <circle cx="3.5" cy="6" r="1" fill="currentColor" />
      <circle cx="3.5" cy="12" r="1" fill="currentColor" />
      <circle cx="3.5" cy="18" r="1" fill="currentColor" />
    </>,
  );
export const IconQueue = (p: P) =>
  base(
    p,
    <>
      <path d="M3 6h12M3 12h12M3 18h7" />
      <path d="M17 13.5v6.5l4.5-3.25Z" fill="currentColor" />
    </>,
  );
export const IconSearch = (p: P) =>
  base(
    p,
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>,
  );
export const IconDownload = (p: P) =>
  base(
    p,
    <>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </>,
  );
export const IconDownloaded = (p: P) =>
  base(
    p,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 2.8 2.8L16.5 9.5" />
    </>,
  );
export const IconInbox = (p: P) =>
  base(
    p,
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z" />
    </>,
  );
export const IconPlus = (p: P) => base(p, <path d="M12 5v14M5 12h14" />);
export const IconX = (p: P) => base(p, <path d="M18 6 6 18M6 6l12 12" />);
export const IconCheck = (p: P) => base(p, <path d="m5 12.5 4.5 4.5L19 7.5" />);
export const IconTrash = (p: P) =>
  base(
    p,
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </>,
  );
export const IconShuffle = (p: P) =>
  base(
    p,
    <>
      <path d="M16 3h5v5" />
      <path d="M4 20 21 3" />
      <path d="M21 16v5h-5" />
      <path d="m15 15 6 6" />
      <path d="M4 4l5 5" />
    </>,
  );
export const IconRepeat = (p: P) =>
  base(
    p,
    <>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </>,
  );
export const IconRepeatOne = (p: P) =>
  base(
    p,
    <>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
      <path d="M11 10.5h1.5V15" />
    </>,
  );
export const IconBluetooth = (p: P) => base(p, <path d="m7 7 10 10-5 5V2l5 5L7 17" />);
export const IconSpeaker = (p: P) =>
  base(
    p,
    <>
      <rect x="5" y="2" width="14" height="20" rx="3" />
      <circle cx="12" cy="14" r="4" />
      <circle cx="12" cy="6.5" r="1" fill="currentColor" />
    </>,
  );
export const IconSettings = (p: P) =>
  base(
    p,
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </>,
  );
export const IconLogout = (p: P) =>
  base(
    p,
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </>,
  );
export const IconCloudOff = (p: P) =>
  base(
    p,
    <>
      <path d="m2 2 20 20" />
      <path d="M5.78 5.78A7 7 0 0 0 6 19h11a4.5 4.5 0 0 0 1.92-.43" />
      <path d="M21.5 15.5A4.5 4.5 0 0 0 17.5 10h-1.26A7 7 0 0 0 9.5 5.2" />
    </>,
  );
export const IconCloud = (p: P) => base(p, <path d="M17.5 19H7a5 5 0 1 1 1.1-9.88A6 6 0 0 1 19.6 11 4 4 0 0 1 17.5 19Z" />);
export const IconUser = (p: P) =>
  base(
    p,
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>,
  );
export const IconServer = (p: P) =>
  base(
    p,
    <>
      <rect x="3" y="3" width="18" height="7" rx="2" />
      <rect x="3" y="14" width="18" height="7" rx="2" />
      <path d="M7 6.5h.01M7 17.5h.01" />
    </>,
  );
export const IconLock = (p: P) =>
  base(
    p,
    <>
      <rect x="4" y="11" width="16" height="10" rx="2.5" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>,
  );
export const IconAlert = (p: P) =>
  base(
    p,
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4.5M12 16h.01" />
    </>,
  );
export const IconSend = (p: P) =>
  base(
    p,
    <>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4Z" />
    </>,
  );
export const IconPlayNext = (p: P) =>
  base(
    p,
    <>
      <path d="M3 6h10M3 12h10M3 18h6" />
      <path d="M19 9v10M14 14h10" />
    </>,
  );
export const IconSun = (p: P) =>
  base(
    p,
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </>,
  );
export const IconWave = (p: P) => base(p, <path d="M2 12h2M6 8v8M10 4v16M14 7v10M18 10v4M22 12h0" />);
export const IconHeart = (p: P) =>
  base(p, <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.4 1.1 5 2.9 1.6-1.8 3-2.9 5-2.9 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2Z" />);
export const IconHeartFilled = (p: P) =>
  base(p, <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 7.9 3.6 4.5 7 4.5c2 0 3.4 1.1 5 2.9 1.6-1.8 3-2.9 5-2.9 3.4 0 5.6 3.4 4.3 6.8-1.8 4.6-9.3 9.2-9.3 9.2Z" />, true);
