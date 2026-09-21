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

// A well is the dark inset a diff or a file sits in. It always hangs off a
// left line, so it starts at the content column and ends where every other
// row ends.
export const wellWidth = (cols: number): number => cols - 4 - RIGHT_PAD;

type WellMore = RowMore & {live?: boolean};

export function wellRow(cols: number, left: Seg[] = [], right: Seg[] = [], more: WellMore = {}): Line {
  const {bg, live, ...rest} = more;
  const inner = fit(left, right, wellWidth(cols), bg ?? theme.well);
  return {...rest, segs: [sp(1), spineMark(live), sp(1), ...inner, sp(RIGHT_PAD)]};
}

// Half a row of breathing room where the page meets a well.
function wellEdge(cols: number, half: string, more: WellMore): Line {
  const {live, bg, ...rest} = more;
  return {...rest, segs: [sp(1), spineMark(live), sp(1), seg(half.repeat(wellWidth(cols)), theme.well), sp(RIGHT_PAD)]};
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
const BLOCKS = /^[▄▀█▎▐▁▂▃▅▆▇]+$/;

// What sits behind an open menu: same shapes, no colour.
export function dimmed(line: Line): Line {
  return {
    ...line,
    segs: line.segs.map(s => ({
      ...s,
      color: BLOCKS.test(s.text) ? theme.scope : theme.faint,
      bold: false,
      bg: s.bg ? theme.scope : undefined,
    })),
  };
}

// A meter is only worth a colour when it is worth worrying about: plain text
// until three quarters are gone, then warn, then the colour of a deletion.
export const meterTone = (part: number): string => (part >= 0.9 ? theme.del : part >= 0.75 ? theme.warn : theme.text);

// A thick meter: a half-block bar, the used part in `color` and the rest left
// faint, so it reads as one bar rather than a bar next to a rule.
export function lowerMeter(n: number, part: number, color: string): Seg[] {
  const used = Math.round(Math.max(0, Math.min(1, part)) * n);
  return [seg(glyph.lower.repeat(used), color), seg(glyph.lower.repeat(Math.max(0, n - used)), theme.faint)];
}

// One number in big type: three rows of half blocks, two columns per pixel,
// two columns between characters. Digits, `%`, `k`, `M`, `~` and `.` only.
export function bigDigits(text: string, color: string = theme.ink, bg?: string): Seg[][] {
  const block = glyph.columns[8];
  const cell = (top: boolean, bottom: boolean): Seg =>
    top && bottom
      ? seg(block.repeat(2), color, {bg})
      : top
        ? seg(glyph.upper.repeat(2), color, {bg})
        : bottom
          ? seg(glyph.lower.repeat(2), color, {bg})
          : sp(2, bg);

  return [0, 1, 2].map(row =>
    [...text].flatMap((char, i) => {
      const font = glyph.digits[char];
      if (!font) return [];
      // Each screen row is two pixel rows: the top half and the bottom half.
      const cells = [0, 1, 2].map(x => cell(font[row * 6 + x] === '1', row < 2 && font[row * 6 + 3 + x] === '1'));
      return i ? [sp(2, bg), ...cells] : cells;
    }),
  );
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
