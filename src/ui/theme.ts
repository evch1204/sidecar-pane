import type {Kind} from '../core/highlight';

// One place for every colour and glyph, so the pane keeps one look.
//
// The pane never paints its own background. A card is a slightly lighter fill
// with half-block edges, and those edge glyphs only set a foreground colour,
// so cards float on whatever terminal theme is underneath.
export const theme = {
  accent: '#E58C64',
  ink: '#ECEAE6',
  text: '#BDBAB4',
  dim: '#928F89',
  faint: '#5F5C58',
  rule: '#2E2C2A',
  add: '#4ADE80',
  del: '#F87171',
  warn: '#E5C07B',
  link: '#8FB4E8',
  keyword: '#C6A0F0',
  string: '#A8CF8E',

  // Surfaces, from the ground up: a card, the row under the cursor, the well a
  // diff sits in, and the strip a hunk header sits on.
  surface: '#181817',
  surface2: '#262523',
  well: '#000000',
  scope: '#121211',
  thumb: '#4A4743',
  menu: '#232220',
  menuInk: '#1A1210',

  // Diff. The line tints sit just far enough off the well to read as a band
  // without drowning the syntax colours on top of them. The word tints are the
  // same hues pushed harder, so the exact edit stands out inside the line.
  addBg: '#0D2616',
  delBg: '#2B1013',
  addWordBg: '#1F5A33',
  delWordBg: '#6B2227',
  markBg: '#15100D',
} as const;

// Subagents are told apart by a label first and a colour second.
export const agentColours = [theme.link, theme.string, theme.warn, theme.keyword] as const;

export const glyph = {
  open: '▾',
  closed: '▸',
  rule: '─',
  heavy: '━',
  heavyHalf: '╸',
  dot: '●',
  bullet: '•',
  diamond: '◆',
  thought: '✦',
  bar: '▎',
  rail: '▐',
  minus: '−',
  plus: '+',
  ellipsis: '…',
  gap: '⋯',
  wrap: '↪',
  back: '‹',
  crumb: '›',
  check: '✓',
  cross: '✗',
  warn: '⚠',
  square: '■',
  // Half blocks and quadrants: the whole card look is these six characters.
  lower: '▄',
  upper: '▀',
  cornerTL: '▗',
  cornerTR: '▖',
  cornerBL: '▝',
  cornerBR: '▘',
  columns: [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
} as const;

type Style = {color?: string; bold?: boolean; italic?: boolean; underline?: boolean};

export const syntax: Record<Kind, Style> = {
  keyword: {color: theme.keyword},
  string: {color: theme.string},
  number: {color: theme.warn},
  comment: {color: theme.dim, italic: true},
  title: {color: theme.link},
  meta: {color: theme.dim},
  section: {color: theme.accent, bold: true},
  bullet: {color: theme.accent},
  code: {color: theme.warn},
  strong: {bold: true},
  emphasis: {italic: true},
  link: {color: theme.link, underline: true},
};
