import stringWidth from 'string-width';
import {glyph, theme} from './theme';

// The whole pane is drawn from one thing: a list of lines, each a list of
// coloured segments exactly as wide as the pane. Views build lines, the screen
// draws them, the cursor indexes them and a click maps onto them. Because
// there is only one list, those can never disagree.
//
// There are three row shapes and nothing else: a page row, a row hanging off a
// block's left line (`spineRow`), and a row inside a well. Nothing is a box.

export type Group = 'turn' | 'file' | 'flat';
export type View = 'changes' | 'files' | 'agents' | 'usage';

// What happens when a line, or part of one, is clicked or entered.
export type Act =
  | {type: 'view'; view: View}
  | {type: 'menu'; menu: number}
  | {type: 'item'; menu: number; item: number}
  | {type: 'turn'; key: string}
  | {type: 'file'; key: string}
  | {type: 'toggle'; set: 'more' | 'steps' | 'says' | 'agents' | 'hists' | 'folded'; key: string}
  | {type: 'hunk'; key: string}
  | {type: 'gap'; file: string; group: number; hunk: number}
  | {type: 'node'; path: string; dir: boolean}
  | {type: 'read'; path: string; line?: number}
  // The last row of a peek: show more of the file, or jump to the next change.
  | {type: 'more'; path: string}
  | {type: 'goTurn'; key: string}
  // The pills under the tabs: how the Changes view is grouped, and the filters
  // that can be cleared from where they are shown.
  | {type: 'group'; group: Group}
  | {type: 'filter'; what: 'chat' | 'changedOnly'; on: boolean}
  // How much of the repository the Changes view covers: the folder the pane is
  // in, or every worktree of it.
  | {type: 'scope'; scope: 'mine' | 'all'}
  // The reader's two pills: a markdown file as a page, or as it is written.
  | {type: 'page'; raw: boolean}
  | {type: 'back'}
  | {type: 'none'};

export type Seg = {text: string; color?: string; bg?: string; bold?: boolean; italic?: boolean; underline?: boolean};
export type Zone = {from: number; to: number; act: Act};

export type Line = {
  segs: Seg[];
  // Stable across refreshes, so the cursor stays on the same thing.
  id?: string;
  // The cursor can stop here.
  pick?: boolean;
  act?: Act;
  zones?: Zone[];
  // Lines that stay on screen while this one is visible: its turn, its file.
  pins?: string[];
  // A mark in the scrollbar column, for "there is a change about here".
  rail?: string;
  // For a line of code: where `o` should open it.
  at?: {path: string; line: number};
};

export const width = (text: string): number => stringWidth(text);
export const seg = (text: string, color?: string, more: Omit<Seg, 'text' | 'color'> = {}): Seg => ({text, color, ...more});
export const sp = (n: number, bg?: string): Seg => ({text: ' '.repeat(Math.max(0, n)), bg});
export const widthOf = (segs: Seg[]): number => segs.reduce((n, s) => n + width(s.text), 0);

// Columns [from, to) of a run of segments. A wide character cut in half
// becomes a space, so the grid never shifts.
export function slice(segs: Seg[], from: number, to: number): Seg[] {
  const out: Seg[] = [];
  let at = 0;
  for (const s of segs) {
    let text = '';
    for (const char of s.text) {
      const w = width(char);
      const start = at;
      at += w;
      if (at <= from || start >= to) continue;
      text += start < from || at > to ? ' '.repeat(Math.min(at, to) - Math.max(start, from)) : char;
    }

    if (text) out.push({...s, text});
    if (at >= to) break;
  }

  return out;
}

// Cut to `max` columns, ending in an ellipsis when something was lost.
export function clip(segs: Seg[], max: number): Seg[] {
  if (max <= 0) return [];
  if (widthOf(segs) <= max) return segs;
  const kept = slice(segs, 0, max - 1);
  const last = kept[kept.length - 1];
  return [...kept, {text: glyph.ellipsis, color: theme.faint, bg: last?.bg}];
}

// Left and right content in exactly `total` columns. The right side always
// survives; the left gives way.
export function fit(left: Seg[], right: Seg[], total: number, bg?: string): Seg[] {
  const rightFits = clip(right, total);
  const room = total - widthOf(rightFits);
  // A left side that fills the room gives up one column, so its last word can
  // never run into the first word of the right side.
  const crowded = widthOf(left) >= room && rightFits.some(s => s.text.trim());
  const leftFits = clip(left, Math.max(0, room - (crowded ? 1 : 0)));
  const gap = total - widthOf(leftFits) - widthOf(rightFits);
  return [...leftFits, sp(gap), ...rightFits].map(s => ({...s, bg: s.bg ?? bg}));
}

type RowMore = Omit<Line, 'segs'> & {bg?: string};

// One clear column between the rightmost text and the scrollbar, so nothing
// ever touches the thumb. Every row type leaves it, so the right edges agree.
export const RIGHT_PAD = 1;

// Nested rows. One step in lines up with the label beside a chevron; two steps
// in is the detail that hangs under such a row.
export const INDENT = 2;
export const INDENT2 = 4;

// Every line is `cols - 1` wide: the last column belongs to the scrollbar.
// Column 0 is the margin, so a row's own content runs from column 1.
export function pageRow(cols: number, left: Seg[] = [], right: Seg[] = [], more: RowMore = {}): Line {
  const {bg, ...rest} = more;
  return {...rest, segs: [sp(1), ...fit(left, right, cols - 2 - RIGHT_PAD, bg), sp(RIGHT_PAD, bg)]};
}

// A chevron means one thing everywhere: accent when the cursor is on the row,
// dim otherwise. Whether it is open is the glyph's job, not the colour's.
export const chevron = (isOpen: boolean, here: boolean): Seg =>
  seg(isOpen ? glyph.open : glyph.closed, here ? theme.accent : theme.dim);

// The left line. Column 1 carries a block's own mark on its header row and the
// rail on every row under it, blank rows included, so the line never breaks.
// Column 2 is a space and the content starts at column 3.
const spineMark = (live?: boolean): Seg => seg(glyph.spine, live ? theme.accent : theme.spine);

export function spineRow(
  cols: number,
  left: Seg[] = [],
  right: Seg[] = [],
  more: RowMore & {mark?: Seg; live?: boolean} = {},
): Line {
  const {bg, mark, live, ...rest} = more;
  const first = mark ?? spineMark(live);
  // A two column mark (a tree branch, `├─`) pushes the content one column in
  // and takes that column from the middle, so the right edge never moves.
  const w = width(first.text);
  return {
    ...rest,
    segs: [sp(1), {...first, bg: first.bg ?? bg}, sp(1, bg), ...fit(left, right, cols - 3 - w - RIGHT_PAD, bg), sp(RIGHT_PAD, bg)],
  };
}

// Column 0 is the margin, the mark is column 1, and a stream row's content
// starts at column 4.
export const STREAM_PREFIX = 4;

// The same row with one more column of air: the mark, two spaces, and the
// content from column 4. A block's own rows are read as a group, and a column
// of space between the line and the words is what makes them one; a two column
// mark (a tree branch, `├─`) takes that column back, so every row in a block
// starts its text in the same place and the right edge never moves.
export function streamRow(
  cols: number,
  left: Seg[] = [],
  right: Seg[] = [],
  more: RowMore & {mark?: Seg; live?: boolean} = {},
): Line {
  const {bg, mark, live, ...rest} = more;
  const first = mark ?? spineMark(live);
  const w = width(first.text);
  const gap = Math.max(1, STREAM_PREFIX - 1 - w);
  return {
    ...rest,
    segs: [
      sp(1),
      {...first, bg: first.bg ?? bg},
      sp(gap, bg),
      // Margin, mark, gap, content, pad: `cols - 1` in all, the last column
      // being the scrollbar's.
      ...fit(left, right, cols - 2 - w - gap - RIGHT_PAD, bg),
      sp(RIGHT_PAD, bg),
    ],
  };
}

// A well is the dark inset a diff or a file sits in. It always hangs off a
// left line, so it starts at the content column and ends where every other
// row ends. `wide` is the same well under a `streamRow`, one column further in.
export const wellWidth = (cols: number, wide = false): number => cols - 4 - RIGHT_PAD - (wide ? 1 : 0);

type WellMore = RowMore & {live?: boolean; wide?: boolean};

export function wellRow(cols: number, left: Seg[] = [], right: Seg[] = [], more: WellMore = {}): Line {
  const {bg, live, wide, ...rest} = more;
  const inner = fit(left, right, wellWidth(cols, wide), bg ?? theme.well);
  return {...rest, segs: [sp(1), spineMark(live), sp(wide ? 2 : 1), ...inner, sp(RIGHT_PAD)]};
}

// Half a row of breathing room where the page meets a well.
function wellEdge(cols: number, half: string, more: WellMore): Line {
  const {live, bg, wide, ...rest} = more;
  return {
    ...rest,
    segs: [sp(1), spineMark(live), sp(wide ? 2 : 1), seg(half.repeat(wellWidth(cols, wide)), theme.well), sp(RIGHT_PAD)],
  };
}

export function wellTop(cols: number, more: WellMore = {}): Line {
  return wellEdge(cols, glyph.lower, more);
}

export function wellBottom(cols: number, more: WellMore = {}): Line {
  return wellEdge(cols, glyph.upper, more);
}

export const blankRow = (cols: number): Line => ({segs: [sp(cols - 1)]});

// Lay `over` on top of `base`, starting at column `at`.
export function overlay(base: Seg[], at: number, over: Seg[], total: number): Seg[] {
  const w = widthOf(over);
  return [...slice([...base, sp(total)], 0, at), ...over, ...slice([...base, sp(total)], at + w, total)];
}

// A run of block glyphs is a fill painted as a foreground, so it has to dim
// like a fill. Greying it would leave bright strips behind an open menu.
const BLOCKS = /^[▄▀█▎▐▌▁▂▃▅▆▇]+$/;

// What sits behind an open menu: same shapes, no colour.
export function dimmed(line: Line): Line {
  return {
    ...line,
    segs: line.segs.map(s => ({
      ...s,
      // A fill on a painted panel would vanish into the dimmed surface, so
      // there it keeps the left line's grey: a shape, without a colour.
      color: BLOCKS.test(s.text) ? (s.bg ? theme.spine : theme.scope) : theme.faint,
      bold: false,
      bg: s.bg ? theme.scope : undefined,
    })),
  };
}

// How much is left is the thing the owner glances at, so a meter is coloured
// all the way down: accent while there is room, then warn, then the colour of
// a deletion once nine tenths are gone.
export const meterTone = (part: number): string => (part >= 0.9 ? theme.del : part >= 0.75 ? theme.warn : theme.accent);

// A thick meter: a half-block bar, the used part in `color` and the rest in
// `track`. Faint by default, so the menu bar's meters read as one bar on the
// bare terminal; the Usage view passes a quieter track, because there the bar
// has a painted panel to be measured against.
export function lowerMeter(n: number, part: number, color: string, track: string = theme.faint): Seg[] {
  const used = Math.round(Math.max(0, Math.min(1, part)) * n);
  return [seg(glyph.lower.repeat(used), color), seg(glyph.lower.repeat(Math.max(0, n - used)), track)];
}

// A thin meter: one line, `━` for what is gone and the quiet rule for what is
// left. Half a cell is worth reading at this weight, so a share that lands
// between two columns ends in `╸` rather than being rounded away.
export function thinMeter(n: number, part: number, color: string, track: string = theme.track): Seg[] {
  const halves = Math.round(Math.max(0, Math.min(1, part)) * n * 2);
  const used = glyph.heavy.repeat(Math.floor(halves / 2)) + (halves % 2 ? glyph.heavyHalf : '');
  return [seg(used, color), seg(glyph.rule.repeat(Math.max(0, n - width(used))), track)];
}

// A panel: the run of rows one section of the Usage view sits on. No edges and
// no corners, only full cells — the background covers columns 1 to `cols - 2`,
// exactly the span of a cursor row, and the text sits two columns in from each
// side, so a right-aligned value lands against an edge instead of on air.
export const panelInner = (cols: number): number => cols - 6;

export function panelRow(
  cols: number,
  left: Seg[] = [],
  right: Seg[] = [],
  bg: string = theme.surface,
  more: Omit<Line, 'segs'> = {},
): Line {
  // `pageRow` already leaves `RIGHT_PAD` clear of the scrollbar, so the right
  // inset only has to make that up to the same two columns as the left one.
  return pageRow(cols, [sp(INDENT, bg), ...left], [...right, sp(INDENT - RIGHT_PAD, bg)], {...more, bg});
}

// A panel's title strip: the section's name, what it is counting, and one fact
// on the right. The note is the first thing to go when the pane is narrow.
export function panelTitle(cols: number, name: string, note: string, right: Seg[] = []): Line {
  const rightWide = widthOf(right);
  const room = panelInner(cols) - width(name) - (rightWide ? rightWide + 1 : 0);
  const keep = note && width(note) + 3 <= room;
  return panelRow(
    cols,
    [seg(name, theme.ink, {bold: true}), ...(keep ? [seg(`   ${note}`, theme.dim)] : [])],
    right,
    theme.surface2,
  );
}

// The glyphs of a big number, in order, with anything unprintable dropped.
const bigFont = (text: string): string[][] =>
  [...text].map(char => glyph.digits[char]).filter((font): font is string[] => Boolean(font));

// How many columns `bigDigits` will take. The font is proportional, so this is
// the sum of the glyph widths plus one gap of `scale` between each pair.
export function bigWidth(text: string, scale = 2): number {
  const fonts = bigFont(text);
  if (!fonts.length) return 0;
  return fonts.reduce((n, font) => n + font[0]!.length * scale, 0) + (fonts.length - 1) * scale;
}

// One number in big type: three screen rows of half blocks, `scale` columns a
// pixel and `scale` columns between glyphs. Every cell carries `bg`, blank
// pixels included, so a number can sit on a panel without holes in it. A unit
// (`%`, `k`, `M`, `~`) is not part of the figure, so it takes its own colour.
export function bigDigits(
  text: string,
  color: string = theme.ink,
  more: {bg?: string; scale?: number; unit?: string} = {},
): Seg[][] {
  const {bg, scale = 2, unit = theme.dim} = more;
  const block = glyph.columns[8];
  const chars = [...text].filter(char => glyph.digits[char]);
  return [0, 1, 2].map(row =>
    chars.flatMap((char, i) => {
      const font = glyph.digits[char]!;
      const ink = /[0-9.]/.test(char) ? color : unit;
      // Each screen row is two pixel rows: the top half and the bottom half.
      // The last row has no bottom half, so the figure sits on a baseline.
      const top = font[row * 2]!;
      const bottom = font[row * 2 + 1] ?? '';
      const cells = [...top].map((_, x) => {
        const hi = top[x] === '#';
        const lo = bottom[x] === '#';
        const fill = hi && lo ? block : hi ? glyph.upper : lo ? glyph.lower : '';
        return fill ? seg(fill.repeat(scale), ink, {bg}) : sp(scale, bg);
      });
      return i ? [sp(scale, bg), ...cells] : cells;
    }),
  );
}

// A figure with ground under it: half a cell of the chip's colour, the text,
// then the other half. Two columns wider than the words, no box, and nothing
// painted on the rows above or below.
export function chip(text: string, bg: string, fg: string, more: Omit<Seg, 'text' | 'color' | 'bg'> = {}): Seg[] {
  return [seg(glyph.chipL, bg), seg(text, fg, {...more, bg}), seg(glyph.chipR, bg)];
}

// One bar in several colours. The parts are all the same glyph on the same
// row, because in a terminal they are one run of text: drawing them with
// different glyphs, or on two rows, would break the bar into pieces.
export function splitBar(parts: [number, string][]): Seg[] {
  return parts.filter(([cells]) => cells > 0).map(([cells, color]) => seg(glyph.lower.repeat(cells), color));
}

// How big a change is, in five cells. Lines, not files: a one line fix and a
// rewrite are the two ends of this scale, and the steps are wide because what
// is being read is "small, medium, big", not a number.
export const SIZE_CELLS = 5;

export function sizeLit(total: number): number {
  if (total <= 0) return 0;
  if (total < 10) return 1;
  if (total < 50) return 2;
  if (total < 150) return 3;
  if (total < 500) return 4;
  return SIZE_CELLS;
}

// Which way the change went. A turn that removed anything at all keeps at
// least one red cell, and one that added anything keeps at least one green,
// so neither side is ever rounded out of sight; when there is only one cell to
// share, the larger side has it.
export function sizeSplit(added: number, removed: number): {lit: number; green: number; red: number} {
  const total = added + removed;
  const lit = sizeLit(total);
  if (lit === 0) return {lit: 0, green: 0, red: 0};

  let red = removed ? Math.max(1, Math.round((lit * removed) / total)) : 0;
  if (red >= lit && added > 0) red = lit === 1 ? (removed > added ? 1 : 0) : lit - 1;
  return {lit, green: lit - red, red};
}

export function sizeCells(added: number, removed: number): Seg[] {
  const {green, red} = sizeSplit(added, removed);
  return splitBar([[green, theme.add], [red, theme.del], [SIZE_CELLS - green - red, theme.track]]);
}

// The eighths a turn's size reads as in the day's skyline. Nothing is ever
// zero: a turn that changed nothing is still a turn, and an empty column would
// read as a gap in the day.
const SKYLINE = [1, 2, 3, 5, 6, 8];

// One turn of the day, two columns wide so the chart keeps its shape in a
// narrow pane.
export function skylineCol(lit: number, colour: string): Seg[] {
  const eighths = SKYLINE[Math.max(0, Math.min(SKYLINE.length - 1, lit))]!;
  return [seg(glyph.columns[eighths]!.repeat(2), colour)];
}

// +12 −3, each in its own right-aligned column so a list lines up.
export function counts(added: number, removed: number, w = 5): Seg[] {
  return [
    added ? seg(`+${added}`.padStart(w), theme.add) : sp(w),
    sp(1),
    removed ? seg(`${glyph.minus}${removed}`.padStart(w), theme.del) : sp(w),
  ];
}

export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
