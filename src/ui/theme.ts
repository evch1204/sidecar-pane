import type {Kind} from '../core/highlight';

// One place for every colour and glyph, so the pane keeps one look.
//
// Almost nothing paints its own background. A block of rows is held together
// by a left line, not by a box, and a well's top and bottom are half blocks
// that only set a foreground colour, so the pane floats on whatever terminal
// theme is underneath. The Usage view is the one exception: it paints a panel
// under each section, because a meter is only honest when the part that is
// still free stays quiet, and a quiet track needs ground it can be measured
// against. Accent belongs to the cursor, to something live and to the brand
// mark; everything else is one of the four greys.
export const theme = {
  accent: '#E58C64',
  ink: '#ECEAE6',
  text: '#BDBAB4',
  dim: '#928F89',
  faint: '#5F5C58',
  add: '#4ADE80',
  del: '#F87171',
  warn: '#E5C07B',
  link: '#8FB4E8',
  keyword: '#C6A0F0',
  string: '#A8CF8E',
  // Two more hues that mean nothing on their own, so a fifth and sixth model
  // can be told apart without borrowing a colour that already has a job.
  teal: '#6FC7C1',
  pink: '#E39AC0',

  // The left line that runs under an open turn. Quiet enough to be structure
  // rather than content; the line of a running turn is drawn in `accent`.
  spine: '#3A3835',

  // The part of a meter that is still free. Just off the surface it sits on,
  // so a bar reads as "this much of that", not as a solid band.
  track: '#3A3835',

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

  // The ground under a chip that carries a number: the same hues as the diff
  // tints, but a chip sits on the bare terminal rather than in a well, so they
  // are pitched to read as a tint of the figure on them and nothing more.
  tintAdd: '#12301D',
  tintDel: '#33161A',

  // The wordmark's face runs from `accent` to `gold`, left to right. The
  // same value as `warn`, under its own name, so the gradient does not read
  // as a warning in the code that draws it.
  gold: '#E5C07B',
} as const;

// Models are told apart by colour alone — the same hue carries a model's own
// line, its slice of the stacked bar and its chip in the legend — so this list
// keeps clear of the colours that already mean something: `accent` is the
// cursor, `warn` is a warning, `add` and `del` are an edit.
export const modelColours = [theme.link, theme.string, theme.keyword, theme.teal, theme.pink] as const;

// The same five, under the name the rest of the pane hands them out by: a
// folder in a turn's landed bar, an agent in a turn, a worktree in the map.
// One list, so two things in the same hue are never on screen at once.
export const hues = modelColours;

// One big number, as a proportional pixel font: five pixel rows a glyph, `#`
// lit, drawn on three screen rows of half blocks. A glyph is exactly as wide
// as its rows are long, so `.` costs one pixel and `%` gets the five it needs
// to read as two zeros and a slash rather than as scattered blocks.
const digits: Record<string, string[]> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '..#', '..#'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  k: ['#..', '#.#', '##.', '#.#', '#.#'],
  // Two small zeros with the slash between them, drawn corner to corner.
  '%': ['##..#', '##.#.', '..#..', '.#.##', '#..##'],
  // Both stems, and the middle folded down to a point, so it is not an H.
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  // On the baseline, one pixel wide: `1.7` closes up instead of holding a gap.
  '.': ['.', '.', '.', '.', '#'],
  // A wave across the middle band, so `~` reads as "about" next to a figure.
  '~': ['....', '....', '.#.#', '#.#.', '....'],
  ' ': ['.', '.', '.', '.', '.'],
};

// The pane's name as it opens: six rows a letter, only the seven letters of
// SIDECAR. `█` is the face; every other glyph is the shadow edge, so the
// face can take a colour of its own and the shadow stay quiet. Every row of a
// letter is exactly as wide as its first, which is what lets the rows of a
// word be laid side by side and still line up.
const block: Record<string, string[]> = {
  S: ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝'],
  I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
  D: ['██████╗ ', '██╔══██╗', '██║  ██║', '██║  ██║', '██████╔╝', '╚═════╝ '],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
  C: [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
  A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
};

// The same five pixel rows, for a word rather than a number: the pane's own
// name, drawn once on the first frame. Three pixels wide keeps a long name on
// one line; `M` and `W` get five, because the stems and the fold between them
// need three columns of their own.
const font: Record<string, string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['###', '#..', '#..', '#..', '###'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['###', '#..', '#.#', '#.#', '###'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['###', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: digits.M!,
  // Three columns cannot hold a diagonal, so the stroke is the weight across
  // the top two bands: heavier than H, which only carries its bar in the middle.
  N: ['#.#', '###', '###', '#.#', '#.#'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  P: ['###', '#.#', '###', '#..', '#..'],
  Q: ['###', '#.#', '#.#', '###', '..#'],
  R: ['###', '#.#', '##.', '#.#', '#.#'],
  S: ['###', '#..', '###', '..#', '###'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
};

export const glyph = {
  open: '▾',
  closed: '▸',
  // The left line under an open turn, the guide in a tree, and the branches
  // that hang off either.
  spine: '│',
  guide: '│',
  branch: '├─',
  branchLast: '└─',
  // The same two joints in one column, for a map whose rows are three columns
  // wide and cannot spend two of them on a rule.
  tee: '├',
  teeLast: '└',
  // How far ahead of where it is going a folder is: `↑22`.
  ahead: '↑',
  // The one separator between facts on a row, with two spaces either side.
  sep: '·',
  rule: '─',
  // A heavier line: the rule under a page's title, the used part of a thin meter.
  heavy: '━',
  heavyHalf: '╸',
  dot: '●',
  // A hollow dot: a block that is finished, beside the filled one of a block
  // that is live.
  ring: '○',
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
  // The two half blocks every fill in the pane is made of: a well's top and
  // bottom edge, a meter, and the big numbers in the Usage view.
  lower: '▄',
  upper: '▀',
  // A page of markdown: the boxes of a task list, and the three sides of the
  // frame a code block sits in.
  boxOff: '☐',
  boxOn: '☑',
  codeTop: '┌',
  codeSide: '│',
  codeBottom: '└',
  // What hangs under a row: the step an agent is on, a file it wrote.
  elbow: '⎿',
  // The two ends of a chip. Each is half a cell of the chip's own background
  // colour, drawn as a foreground, so a chip has a soft edge without a box and
  // without painting a whole cell either side of its text.
  chipL: '▐',
  chipR: '▌',
  columns: [' ', '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'],
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  // The side panel's own toggle: fold it away, or open it back out.
  fold: '«',
  unfold: '»',
  // A branch, as git tools draw one: the Workspaces row of the folded panel.
  // `branch` already names the tree joint, so this one is `gitBranch`.
  gitBranch: '⎇',
  // A list of things to read: Files in the folded panel.
  list: '≡',
  // Usage in the folded panel: two bars of a meter in one cell each.
  miniMeter: ['▄', '▆'],
  digits,
  font,
  block,
} as const;

type Style = {color?: string; bold?: boolean; italic?: boolean; underline?: boolean; bg?: string};

export const syntax: Record<Kind, Style> = {
  keyword: {color: theme.keyword},
  string: {color: theme.string},
  number: {color: theme.warn},
  comment: {color: theme.dim, italic: true},
  title: {color: theme.link},
  meta: {color: theme.dim},
  // A heading is weight, not colour: accent is saved for the cursor, live
  // state and the brand mark, so a page of markdown does not shout.
  section: {color: theme.ink, bold: true},
  bullet: {color: theme.dim},
  code: {color: theme.warn},
  strong: {color: theme.ink, bold: true},
  emphasis: {italic: true},
  link: {color: theme.link, underline: true},
  // A struck-out line is work that is done with, and faint says so. A real
  // strikethrough would need a new field on every segment in the pane.
  strike: {color: theme.faint},
  // Inline code on a page, on a chip of recessed ground, the same way a code
  // block sits in a well. `surface2` belongs to the cursor's own row, so a
  // chip drawn on it would disappear the moment the cursor arrived.
  chip: {color: theme.warn, bg: theme.scope},
  // The frame of a code block and the bar beside a quote: structure, not words.
  frame: {color: theme.faint},
};
