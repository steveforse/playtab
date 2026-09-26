import type { ReactNode } from 'react';

// Playtab's self-contained icon set: 24 × 24 inline SVG drawn with
// `currentColor`, so icons follow the button's text colour and need no
// network fetch. Icons are decorative; the button carries the name.

const note = (flags: number, filled = true, stem = true, x = 0): ReactNode => {
  const stemX = 12.6 + x;
  return <>
    <ellipse cx={9 + x} cy={17.5} rx={3.6} ry={2.6} transform={`rotate(-20 ${9 + x} 17.5)`} fill={filled ? 'currentColor' : 'none'} />
    {stem && <path d={`M${stemX} 16.6V3.5`} />}
    {Array.from({ length: flags }, (_, index) => {
      const y = 3.5 + index * (flags > 2 ? 2.6 : 3.4);
      return <path key={index} d={`M${stemX} ${y}c.6 2.2 4.4 3 4.4 6.2`} />;
    })}
  </>;
};
const text = (value: string, x = 12, y = 16.5, size = 12) =>
  <text x={x} y={y} fontSize={size} fontWeight={700} textAnchor="middle" fill="currentColor" stroke="none" fontFamily="DM Sans, sans-serif">{value}</text>;

const ICONS = {
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></>,
  redo: <><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></>,
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" />,
  pause: <path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor" />,
  restart: <><path d="M6 5v14" /><path d="M19 5.5v13L9 12z" fill="currentColor" /></>,
  loop: <><path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></>,
  metronome: <><path d="M8.5 3h7L19 21H5z" /><path d="m12 16 5-9" /><path d="M7 17h10" /></>,
  'duration-1': note(0, false, false),
  'duration-2': note(0, false),
  'duration-4': note(0),
  'duration-8': note(1),
  'duration-16': note(2),
  'duration-32': note(3),
  'duration-64': note(4),
  dotted: <>{note(0, true, true, -2)}<circle cx={17.5} cy={17} r={1.6} fill="currentColor" stroke="none" /></>,
  triplet: <><path d="M4 9V6h16v3" />{text('3', 12, 20, 11)}</>,
  rest: <path d="m10 3 4.5 5-4 4 4.5 5c-2.5-1.2-5-.2-3.5 3.5" />,
  'make-rest': <path d="m10 3 4.5 5-4 4 4.5 5c-2.5-1.2-5-.2-3.5 3.5" />,
  'split-rest': <><path d="m6 4 3 3.5-2.5 3 3 3.5c-1.5-.8-3.2 0-2.2 2.5" /><path d="m15 4 3 3.5-2.5 3 3 3.5c-1.5-.8-3.2 0-2.2 2.5" /><path d="M12 3v18" strokeDasharray="2 2" /></>,
  tie: <><circle cx={5} cy={11} r={2.2} fill="currentColor" /><circle cx={19} cy={11} r={2.2} fill="currentColor" /><path d="M4 15c4 5 12 5 16 0" /></>,
  'hammer-on': <><path d="M4 9c4-5 12-5 16 0" />{text('H', 12, 21)}</>,
  'pull-off': <><path d="M4 9c4-5 12-5 16 0" />{text('P', 12, 21)}</>,
  slide: <><circle cx={5} cy={18} r={2.2} fill="currentColor" /><circle cx={19} cy={6} r={2.2} fill="currentColor" /><path d="M7.5 16 16.5 8" /></>,
  bend: <><path d="M4 20h5c4 0 7-5 7-14" /><path d="m12.5 9.5 3.5-3.5 3.5 3.5" /></>,
  grace: <><ellipse cx={10} cy={17} rx={2.8} ry={2} transform="rotate(-20 10 17)" fill="currentColor" /><path d="M12.6 16.3V5c.5 1.8 3.4 2.4 3.4 5" /><path d="m8.5 13 7.5-5" /></>,
  'add-note': <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  apply: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  move: <><path d="M12 3v18" /><path d="m8 7 4-4 4 4" /><path d="m8 17 4 4 4-4" /></>,
  'remove-note': <><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="m6 7 1 13h10l1-13" /><path d="M9 7V4h6v3" /></>,
  'insert-beat': <><circle cx={12} cy={12} r={9} /><path d="M12 8v8M8 12h8" /></>,
  tempo: <>{note(0, true, true, -3)}<path d="M14.5 10h6M14.5 14h6" /></>,
  'select-measure': <><path d="M4 5h16v14H4z" strokeDasharray="3 2" /><path d="M9 5v14" /></>,
  'insert-measure-before': <><path d="M11 5h9v14h-9z" /><path d="M6 9v6M3 12h6" /></>,
  'insert-measure-after': <><path d="M4 5h9v14H4z" /><path d="M18 9v6M15 12h6" /></>,
  'duplicate-measure': <><path d="M8 8h12v12H8z" /><path d="M4 16V4h12" /></>,
  'delete-measure': <><path d="M4 5h16v14H4z" /><path d="m9 9 6 6m0-6-6 6" /></>,
  repeat: <><path d="M5 4v16" strokeWidth={3} /><path d="M9.5 4v16" /><circle cx={14} cy={9.5} r={1.4} fill="currentColor" stroke="none" /><circle cx={14} cy={14.5} r={1.4} fill="currentColor" stroke="none" /></>,
  'time-signature': <>{text('4', 12, 11.5, 11)}{text('4', 12, 21.5, 11)}</>,
  pickup: <><path d="M17 4v16" />{note(0, true, true, -1)}</>,
  chord: <><path d="M6 4h12v16H6z" /><path d="M10 4v16M14 4v16M6 9h12M6 14h12" /><circle cx={10} cy={11.5} r={1.6} fill="currentColor" stroke="none" /></>,
  section: <><path d="M4 4h16v16H4z" />{text('A', 12, 16.5, 11)}</>,
  words: <><path d="M4 6h16" /><path d="M4 12h11" /><path d="M4 18h14" /></>,
  lyric: <><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" /><path d="M19 11a7 7 0 0 1-14 0" /><path d="M12 18v3" /></>,
  'lyrics-chords': <><path d="M6 3h9l4 4v14H6z" /><path d="M14 3v5h5" /><path d="M9 13h7M9 17h7" /></>,
  copy: <><path d="M9 9h11v11H9z" /><path d="M5 15H4V4h11v1" /></>,
  cut: <><circle cx={6} cy={6} r={3} /><circle cx={6} cy={18} r={3} /><path d="M20 4 8.1 15.9" /><path d="M14.5 14.5 20 20" /><path d="M8.1 8.1 12 12" /></>,
  paste: <><path d="M9 3h6v3H9z" /><path d="M15 4.5h3V21H6V4.5h3" /></>,
  'range-start': <><path d="M9 4H6v16h3" /><path d="M12 12h8m-3-3 3 3-3 3" /></>,
  'range-end': <><path d="M15 4h3v16h-3" /><path d="M4 12h8m-3-3 3 3-3 3" /></>,
  clear: <path d="M18 6 6 18M6 6l12 12" />,
  export: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
  settings: <><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx={15} cy={6} r={2} /><circle cx={9} cy={12} r={2} /><circle cx={17} cy={18} r={2} /></>,
  keyboard: <><path d="M3 6h18v12H3z" /><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" /></>,
  'edit-tools': <><path d="M16 3l5 5L8 21H3v-5z" /><path d="m13 6 5 5" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
  minus: <path d="M5 12h14" />,
  more: <path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3} />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export function isIconName(name: string): name is IconName {
  return Object.hasOwn(ICONS, name);
}

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{ICONS[name]}</svg>;
}
