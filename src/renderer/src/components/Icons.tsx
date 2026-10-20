import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>
const base = (p: P) => ({
  width: '1em',
  height: '1em',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  ...p
})

export const IconPlay = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <path d="M8 5.6v12.8a1 1 0 0 0 1.52.85l10.2-6.4a1 1 0 0 0 0-1.7L9.52 4.75A1 1 0 0 0 8 5.6Z" />
  </svg>
)
export const IconPlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)
export const IconGrid = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
  </svg>
)
export const IconDots = (p: P) => (
  <svg {...base(p)} fill="currentColor" stroke="none">
    <circle cx="5.5" cy="12" r="1.9" />
    <circle cx="12" cy="12" r="1.9" />
    <circle cx="18.5" cy="12" r="1.9" />
  </svg>
)
export const IconPower = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3.5v8" />
    <path d="M6.6 6.8a7.5 7.5 0 1 0 10.8 0" />
  </svg>
)
export const IconGamepad = (p: P) => (
  <svg {...base(p)}>
    <path d="M7.5 7h9a4.5 4.5 0 0 1 4.4 3.6l.9 4.6a2.6 2.6 0 0 1-4.5 2.2L15.6 15H8.4l-1.7 2.4a2.6 2.6 0 0 1-4.5-2.2l.9-4.6A4.5 4.5 0 0 1 7.5 7Z" />
    <path d="M8 9.8v3M6.5 11.3h3" />
    <circle cx="15.8" cy="10.6" r=".6" fill="currentColor" />
    <circle cx="17.4" cy="12.4" r=".6" fill="currentColor" />
  </svg>
)
export const IconFolder = (p: P) => (
  <svg {...base(p)}>
    <path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.6l2 2.2h7.4a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
  </svg>
)
export const IconStar = ({ filled, ...p }: P & { filled?: boolean }) => (
  <svg {...base(p)} fill={filled ? 'currentColor' : 'none'}>
    <path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8Z" />
  </svg>
)
export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 7h15M9.5 7V5.2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7M6.5 7l.8 11.6a1.6 1.6 0 0 0 1.6 1.4h6.2a1.6 1.6 0 0 0 1.6-1.4L17.5 7" />
  </svg>
)
export const IconReset = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 4.5v3.8h3.8" />
    <path d="M12 8.5V12l2.4 1.6" />
  </svg>
)
export const IconSearch = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6" />
    <path d="m20 20-4.5-4.5" />
  </svg>
)
export const IconImage = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="5" width="17" height="14" rx="2.2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4 17 4.6-4.4a1.4 1.4 0 0 1 1.9 0L16 18M13.5 15.2l2-1.9a1.4 1.4 0 0 1 1.9 0L20 16" />
  </svg>
)
export const IconEdit = (p: P) => (
  <svg {...base(p)}>
    <path d="M14.5 5.5 18.5 9.5M4.5 19.5l1-4.2L15.8 5a1.8 1.8 0 0 1 2.6 0l.6.6a1.8 1.8 0 0 1 0 2.6L8.7 18.5Z" />
  </svg>
)
export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)
export const IconHome = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1Z" />
  </svg>
)
export const IconMonitor = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="4.5" width="18" height="12" rx="2" />
    <path d="M9 20h6M12 16.5V20" />
  </svg>
)
export const IconDisc = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="2.2" />
    <path d="M12 6.2a5.8 5.8 0 0 0-5.8 5.8" opacity=".55" />
  </svg>
)
export const IconMoon = (p: P) => (
  <svg {...base(p)}>
    <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5Z" />
  </svg>
)
export const IconRestart = (p: P) => (
  <svg {...base(p)}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4.5v3.8h-3.8" />
  </svg>
)
export const IconExit = (p: P) => (
  <svg {...base(p)}>
    <path d="M10 5H6.5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2H10M14.5 8l4 4-4 4M18.5 12H9.5" />
  </svg>
)
export const IconCheck = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)
export const IconChevron = ({ dir = 'right', ...p }: P & { dir?: 'left' | 'right' }) => (
  <svg {...base(p)}>
    <path d={dir === 'right' ? 'm9.5 6 6 6-6 6' : 'm14.5 6-6 6 6 6'} />
  </svg>
)
export const IconTrophy = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 4.5h8v5.2a4 4 0 0 1-8 0Z" />
    <path d="M8 6.5H5.2a2.6 2.6 0 0 0 2.9 3.4M16 6.5h2.8a2.6 2.6 0 0 1-2.9 3.4M12 13.7V17M8.5 19.5h7M9.5 17h5v2.5h-5Z" />
  </svg>
)
export const IconDice = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="16" height="16" rx="3.5" />
    <circle cx="8.6" cy="8.6" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15.4" cy="8.6" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="8.6" cy="15.4" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15.4" cy="15.4" r="1.2" fill="currentColor" stroke="none" />
  </svg>
)
export const IconBattery = ({ level, ...p }: P & { level: number }) => (
  <svg {...base(p)}>
    <rect x="3" y="7.5" width="16" height="9" rx="2.2" />
    <path d="M21 10.5v3" />
    {[0, 1, 2].map((i) => (
      <rect key={i} x={5.2 + i * 4.3} y="9.6" width="3.2" height="4.8" rx=".7" fill="currentColor" stroke="none" opacity={i < level ? 1 : 0.18} />
    ))}
  </svg>
)
export const IconPlug = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 4v4M15 4v4M7 8h10v3a5 5 0 0 1-10 0ZM12 16v4" />
  </svg>
)
export const IconVolume = ({ muted, ...p }: P & { muted?: boolean }) => (
  <svg {...base(p)}>
    <path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3Z" />
    {muted ? <path d="m16 9.5 5 5M21 9.5l-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}
  </svg>
)
export const IconHeadphones = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 15v-3a7.5 7.5 0 0 1 15 0v3" />
    <rect x="3.5" y="14" width="4" height="6" rx="1.6" />
    <rect x="16.5" y="14" width="4" height="6" rx="1.6" />
  </svg>
)
export const IconSun = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3.8" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
  </svg>
)
export const IconInfo = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 11v5.2" />
    <circle cx="12" cy="7.9" r="0.6" fill="currentColor" stroke="none" />
  </svg>
)
export const IconClock = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M12 7.4V12l3 2" />
  </svg>
)
export const IconBackspace = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 5.5h10a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5H9L3.5 12 9 5.5Z" />
    <path d="m12 9.5 5 5M17 9.5l-5 5" />
  </svg>
)
export const IconDownload = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 4.5v10.5M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
  </svg>
)
export const IconGlobe = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M3.4 12h17.2M12 3.4c2.4 2.4 3.6 5.3 3.6 8.6s-1.2 6.2-3.6 8.6c-2.4-2.4-3.6-5.3-3.6-8.6S9.6 5.8 12 3.4Z" />
  </svg>
)
