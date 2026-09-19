import type {Kind} from '../core/highlight';

// One place for every colour and glyph, so the pane keeps one look.
// The palette matches the design mockup: warm neutrals, one orange accent.
export const theme = {
  accent: '#E58C64',
  ink: '#E2DDD5',
  dim: '#958F87',
  rule: '#3A3530',
  add: '#86DDA0',
  del: '#F2958F',
  warn: '#DDBB5E',
  link: '#8FB4E8',
  keyword: '#C6A0F0',
  string: '#A8CF8E',
  selBg: '#3D2B21',
} as const;

export const glyph = {
  dirOpen: '▾',
  dirClosed: '▸',
  guide: '│ ',
  rule: '─',
  dot: '●',
  bullet: '•',
  changedBar: '▎',
  minus: '−',
  ellipsis: '…',
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
