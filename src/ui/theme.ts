// One place for every colour and glyph, so the pane keeps one look.
// The palette matches the concept mockup: warm neutrals, one orange accent.
export const theme = {
  accent: '#E58C64',
  ink: '#E2DDD5',
  dim: '#958F87',
  rule: '#3A3530',
  add: '#86DDA0',
  del: '#F2958F',
  warn: '#DDBB5E',
  selBg: '#3D2B21',
} as const;

export const glyph = {
  dirOpen: '▾',
  dirClosed: '▸',
  rule: '─',
  dot: '●',
} as const;
