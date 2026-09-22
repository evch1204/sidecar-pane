import path from 'node:path';
import type {FileView} from '../../core/file';
import {pathKey, type Change} from '../../core/git';
import {layoutLine, type Segment} from '../../core/highlight';
import {isMarkdown, type MdKind, type MdLine} from '../../core/markdown';
import type {TreeNode} from '../../core/tree';
import type {FileHistory} from '../../core/turns';
import {
  chevron, counts, pageRow, RIGHT_PAD, seg, slice, sp, STREAM_PREFIX, streamRow, wellBottom, wellRow, wellTop, wellWidth, widthOf,
  type Line, type Seg, type Zone,
} from '../cells';
import {glyph, syntax, theme} from '../theme';
import {wrap} from '../util';
import {clock, turnKey} from './changes';

// The Files view is the tree. Enter on a file opens a peek under its own row,
// starting at the first thing that changed; the peek hangs off the file's row
// on the same left line a turn's diff uses. `o` reads the whole file.

export const PEEK_ROWS = 14;
// What one press of the peek's last row adds. Enough to be worth the press,
// small enough that the lines you asked for are still one screen away.
export const MORE_ROWS = 40;

export type Marks = ReadonlySet<number> | 'all';

export type Peek = {
  path: string;
  view: FileView;
  segments: Segment[][] | null;
  marks: Marks;
  // First line shown, zero-based.
  from: number;
  // Rows the "more lines" row has added to the fourteen it starts with.
  extra: number;
  history: FileHistory | null;
};

// The line after the last one a peek shows, one-based, so the tree row and the
// keys that jump through a file agree on where the window ends.
export const peekEnd = (total: number, from: number, extra: number): number =>
  Math.min(total, from + PEEK_ROWS + Math.max(0, extra));

const LETTER_COLOUR = {A: theme.add, M: theme.warn, D: theme.del} as const;
const LANGUAGE: Record<string, string> = {
  '.ts': 'TS', '.tsx': 'TSX', '.js': 'JS', '.jsx': 'JSX', '.mjs': 'JS', '.json': 'JSON', '.md': 'Markdown',
  '.css': 'CSS', '.html': 'HTML', '.py': 'Python', '.rs': 'Rust', '.go': 'Go', '.sh': 'Shell', '.yml': 'YAML', '.yaml': 'YAML',
};

const isMarked = (marks: Marks, n: number): boolean => marks === 'all' || marks.has(n);

// The one separator between facts on a row.
const sep = (): Seg => seg(`  ${glyph.sep}  `, theme.faint);

// The first line of each run of changed lines, one-based.
export function changedPlaces(marks: Marks, total: number): number[] {
  if (marks === 'all') return total ? [1] : [];
  const sorted = [...marks].sort((a, b) => a - b);
  return sorted.filter((n, i) => i === 0 || n !== sorted[i - 1]! + 1);
}

function crumbs(root: string, file: string): Seg[] {
  const parts = path.relative(root, file).split(path.sep);
  return parts.flatMap((part, i) => [
    ...(i ? [seg(` ${glyph.crumb} `, theme.faint)] : []),
    seg(part, i === parts.length - 1 ? theme.ink : theme.dim, {bold: i === parts.length - 1}),
  ]);
}

function kindOf(file: string, view: FileView): string {
  const language = LANGUAGE[path.extname(file).toLowerCase()];
  const lines = view.kind === 'text' ? `${view.lines.length} line${view.lines.length === 1 ? '' : 's'}` : '';
  return [language, lines].filter(Boolean).join(`  ${glyph.sep}  `);
}

// A dead end has to say what to do next. The fact comes from core; only the
// next step is added here.
function deadEnd(message: string): string {
  if (/binary/i.test(message)) return 'Binary file, so there are no lines to read. Pick a text file instead.';
  if (/too large/i.test(message)) return `${message} Open it in your editor to read it all.`;
  if (/no longer exists/i.test(message)) return 'This file is gone. Pick another file from the tree.';
  if (/empty/i.test(message)) return 'This file is empty, so there is nothing to read.';
  return `${message} Pick another file from the tree.`;
}

function code(text: string, segments: Segment[] | null, room: number, bg?: string): Seg[] {
  const cut = [...text].length > room;
  const pieces = layoutLine(text, segments, undefined, 0, cut ? room - 1 : room);
  return [
    ...pieces.map(piece => ({text: piece.text, ...(piece.kind ? syntax[piece.kind] : {color: theme.text}), bg})),
    ...(cut ? [seg(glyph.ellipsis, theme.faint, {bg})] : []),
  ];
}

function lastTouch(history: FileHistory | null): Seg[] {
  const touch = history?.touches[history.touches.length - 1];
  if (!touch) return [];
  return [seg(`last changed ${clock(touch.change.turn.at)}`, theme.dim), sep(), seg(touch.change.turn.prompt, theme.text)];
}

// The peek hangs under the file's own row: a rail in the mark column, the file
// itself in a well, and one hint row. No card, no fills.
function peekLines(cols: number, root: string, peek: Peek, owner: string, sel: string | null): Line[] {
  const pins = [owner];
  const rail = {pins};
  const out: Line[] = [streamRow(cols, crumbs(root, peek.path), [seg(kindOf(peek.path, peek.view), theme.dim)], rail)];
  const touched = lastTouch(peek.history);
  if (touched.length) out.push(streamRow(cols, touched, [], rail));

  if (peek.view.kind === 'notice') {
    for (const text of wrap(deadEnd(peek.view.message), cols - 6)) out.push(streamRow(cols, [seg(text, theme.dim)], [], rail));
    return out;
  }

  const lines = peek.view.lines;
  const digits = Math.max(3, String(lines.length).length);
  const room = wellWidth(cols, true) - digits - 3;
  const places = changedPlaces(peek.marks, lines.length);
  const end = peekEnd(lines.length, peek.from, peek.extra);
  // The peek hangs off the same three column prefix the Changes view uses, so
  // the four views line up.
  const well = {pins, wide: true};

  out.push(wellTop(cols, well));
  if (places.length) {
    out.push(wellRow(cols, [sp(1), seg(`lines ${peek.from + 1}–${end}`, theme.link)], [seg(`${places.length} changed place${places.length === 1 ? '' : 's'}`, theme.faint), sp(1)], {...well, bg: theme.scope}));
  }

  for (let i = peek.from; i < end; i++) {
    const marked = isMarked(peek.marks, i + 1);
    const bg = marked ? theme.markBg : undefined;
    out.push(
      wellRow(cols, [seg(marked ? glyph.bar : ' ', theme.accent, {bg}), seg(String(i + 1).padStart(digits), marked ? theme.dim : theme.faint, {bg}), sp(2, bg), ...code(lines[i]!, peek.segments?.[i] ?? null, room, bg)], [], {...well, bg}),
    );
  }

  // The last row of the well grows the peek in place, or jumps to the next
  // changed place when there is one below. It says which, and what it costs.
  const below = places.filter(n => n > end).length;
  const left = lines.length - end;
  const rest = below
    ? `${below} more changed place${below === 1 ? '' : 's'} below`
    : left > 0
      ? `${left} more line${left === 1 ? '' : 's'}`
      : '';
  if (rest) {
    const id = `g:${peek.path}`;
    const here = id === sel;
    const bg = here ? theme.surface2 : undefined;
    const what = below ? 'enter jumps' : `enter shows ${Math.min(MORE_ROWS, left)}`;
    const label = [seg(`${glyph.gap} ${rest}`, here ? theme.accent : theme.faint, {bg}), seg(`  ${glyph.sep}  ${what}`, theme.faint, {bg})];
    // The hint is the first thing to go in a narrow pane: the count matters more.
    const room = wellWidth(cols, true) - digits - 3;
    out.push(
      wellRow(cols, [sp(digits + 3, bg), ...(widthOf(label) <= room ? label : [label[0]!])], [], {
        ...well, bg, id, pick: true, act: {type: 'more', path: peek.path},
      }),
    );
  }

  out.push(wellBottom(cols, well));

  // Two hints, two zones: the left one reads the file, the right one closes the
  // peek. The columns come from the text, never from a guess.
  const hint = [seg('o', theme.text), seg(' read all', theme.dim)];
  const close = [seg('esc', theme.text), seg(' close', theme.dim)];
  const rightEnd = cols - 1 - RIGHT_PAD;
  out.push(
    streamRow(cols, hint, close, {
      pins,
      zones: [
        {from: STREAM_PREFIX, to: STREAM_PREFIX + widthOf(hint), act: {type: 'read', path: peek.path}},
        {from: rightEnd - widthOf(close), to: rightEnd, act: {type: 'node', path: peek.path, dir: false}},
      ],
    }),
  );
  return out;
}

export type FilesInput = {
  cols: number;
  root: string;
  nodes: TreeNode[];
  changes: ReadonlyMap<string, Change> | null;
  changedOnly: boolean;
  sel: string | null;
  peek: Peek | null;
};

export const nodeId = (file: string): string => `n:${file}`;

export function filesLines(input: FilesInput): Line[] {
  const {cols, nodes, changes, sel, peek} = input;
  const out: Line[] = [];

  if (nodes.length === 0) {
    const message = input.changedOnly
      ? changes === null
        ? 'This folder is not a git repo, so nothing can be marked as changed. Press c to see every file.'
        : 'Nothing has changed since the last commit. Press c to see every file.'
      : 'This folder is empty, so there is nothing to read. Start the pane in a project folder.';
    return wrap(message, cols - 4).map(text => pageRow(cols, [seg(text, theme.dim)]));
  }

  for (const node of nodes) {
    const id = nodeId(node.path);
    const here = id === sel;
    const peeking = peek?.path === node.path;
    const bg = here ? theme.surface2 : undefined;
    const guides: Seg[] = Array.from({length: node.depth}, () => seg(`${glyph.guide} `, theme.faint));
    const change = changes?.get(pathKey(node.path));

    let right: Seg[] = [];
    if (node.isDir) {
      if (!node.open && changes) {
        const prefix = pathKey(node.path) + path.sep;
        let inside = 0;
        for (const [file, c] of changes) if (c.status !== 'D' && file.startsWith(prefix)) inside++;
        if (inside) right = [seg(`${inside} changed`, theme.faint)];
      }
    } else if (change) {
      right = [...counts(change.added ?? 0, change.removed ?? 0), sp(2), seg(change.status, LETTER_COLOUR[change.status])];
    }

    // Folders and files both open, so both carry a chevron; a folder is bold
    // and ends in a slash, so the two can never be read as the same thing.
    // With "changed only" on the tree is already open all the way down to
    // every changed file: a folder is then a heading, not a control, so it
    // gets no chevron rather than one that does nothing.
    const fixed = input.changedOnly && node.isDir;
    const mark = fixed ? sp(1) : chevron(node.isDir ? node.open : peeking, here);
    const colour = node.isDir || change ? theme.ink : node.name.startsWith('.') ? theme.faint : theme.text;
    out.push(
      pageRow(cols, [...guides, mark, sp(1), seg(node.isDir ? `${node.name}/` : node.name, colour, {bold: node.isDir})], right, {
        bg, id, pick: true, act: fixed ? {type: 'none'} : {type: 'node', path: node.path, dir: node.isDir},
      }),
    );
    if (peeking && peek) out.push(...peekLines(cols, input.root, peek, id, sel));
  }

  return out;
}

export type ReaderInput = {
  cols: number;
  root: string;
  path: string;
  view: FileView;
  segments: Segment[][] | null;
  marks: Marks;
  history: FileHistory | null;
  sel: string | null;
  // Markdown laid out for reading. Null shows the file as it is written.
  formatted: MdLine[] | null;
};

export const lineId = (n: number): string => `r:${n}`;
export const mdLineId = (i: number): string => `r:m${i}`;

// Reader rows and source lines, both ways. A raw row is its own line; a
// formatted row covers a range of them. This is how `r` keeps its place and
// how `o` lands on a line it was given.
export function readerLineOf(id: string | null | undefined, formatted: MdLine[] | null): number {
  if (!id?.startsWith('r:')) return 0;
  const rest = id.slice(2);
  if (!rest.startsWith('m')) return Number(rest) || 0;
  return formatted?.[Number(rest.slice(1))]?.from ?? 0;
}

export function readerIdAt(line: number, formatted: MdLine[] | null): string | null {
  if (line <= 0) return null;
  if (!formatted) return lineId(line);
  // The row whose source lines hold this one. A fence marker and a table rule
  // are not written out at all, so anything missed falls to the row before it.
  const hit = formatted.findIndex(md => md.from <= line && line <= md.to);
  if (hit >= 0) return mdLineId(hit);
  let before = -1;
  formatted.forEach((md, i) => {
    if (md.from <= line) before = i;
  });
  return before >= 0 ? mdLineId(before) : formatted.length ? mdLineId(0) : null;
}

// The first row of the file itself, so the reader can open on the file rather
// than on the "changed by" list above it. Null when there is nothing to read.
export function firstReadId(input: Pick<ReaderInput, 'view' | 'formatted'>): string | null {
  if (input.formatted) {
    // The page starts with a blank paper row: the cursor belongs on the title.
    const first = input.formatted.findIndex(row => row.kind !== 'blank');
    return input.formatted.length ? mdLineId(Math.max(0, first)) : null;
  }

  return input.view.kind === 'text' && input.view.lines.length ? lineId(1) : null;
}

// One state of the reader, as a button, in the same shape the pills under the
// tabs use: the one you are in is lit, the other is a word you can press.
const readPill = (label: string, on: boolean): Seg[] => [
  seg(` ${label} `, on ? theme.ink : theme.dim, {bold: on, bg: on ? theme.surface2 : undefined}),
];

export function readerHead(input: Pick<ReaderInput, 'cols' | 'root' | 'path' | 'view' | 'formatted'>): Line[] {
  const {cols} = input;
  // A small pill, so "back" looks like something you can press.
  const back = [seg(` ${glyph.back} Files `, theme.dim, {bg: theme.surface2})];
  const note = [seg(kindOf(input.path, input.view), theme.dim)];
  const zones: Zone[] = [{from: 1, to: 1 + widthOf(back), act: {type: 'back'}}];

  // Only a markdown file has two ways to be read, so only it gets the pills.
  if (!isMarkdown(input.path)) return [pageRow(cols, [...back, sp(2), ...crumbs(input.root, input.path)], note, {zones})];

  const page = readPill('Page', Boolean(input.formatted));
  const source = readPill('Source', !input.formatted);
  const pills = [...page, sp(1), ...source];
  // The kind and the line count give way before the pills do: the pills are a
  // control, and the note is a fact you can do without.
  const withNote = [...note, sp(2), ...pills];
  const room = cols - 2 - RIGHT_PAD - widthOf(back) - 2;
  const right = widthOf(withNote) + 10 <= room ? withNote : pills;

  // The columns come from the text that was really drawn, never from a guess.
  const rightEnd = cols - 1 - RIGHT_PAD;
  if (widthOf(right) <= room) {
    const sourceFrom = rightEnd - widthOf(source);
    zones.push(
      {from: sourceFrom - widthOf(page) - 1, to: sourceFrom - 1, act: {type: 'page', raw: false}},
      {from: sourceFrom, to: rightEnd, act: {type: 'page', raw: true}},
    );
  }

  return [pageRow(cols, [...back, sp(2), ...crumbs(input.root, input.path)], right, {zones})];
}

// ---- the page ---------------------------------------------------------------

// The sheet a markdown file is read on: a lit fill with three columns of
// margin each side, centred in the pane when the pane is wider than it is.
const MARGIN = 3;

// The text measure. Wide enough for a table, never wider than a column of
// prose should be, and the same number the page is laid out to in core.
export const paperMeasure = (cols: number): number => Math.max(12, Math.min(72, cols - 2 * MARGIN - 2));

type Paper = {left: number; width: number; measure: number};

function paperOf(cols: number): Paper {
  const measure = paperMeasure(cols);
  const width = measure + 2 * MARGIN;
  // Column 0 and the scrollbar column are never painted, so the sheet lives
  // in columns 1 to cols - 2 and is centred inside them.
  return {left: 1 + Math.max(0, Math.floor((cols - 2 - width) / 2)), width, measure};
}

// One row of the page, exactly the sheet's width every time, so the right
// margin is a straight edge and the fill never has a hole in it. The change
// bar sits in the first margin column, where a line number would be.
function paperRow(
  cols: number,
  sheet: Paper,
  body: Seg[],
  more: Omit<Line, 'segs'> & {bg?: string; fill?: string; mark?: Seg} = {},
): Line {
  const {bg, fill, mark, ...rest} = more;
  const page = bg ?? theme.surface;
  const inner = fill ?? page;
  const text = widthOf(body) > sheet.measure ? slice(body, 0, sheet.measure) : body;
  return {
    ...rest,
    segs: [
      sp(sheet.left),
      mark ? {...mark, bg: page} : sp(1, page),
      sp(MARGIN - 1, page),
      ...text.map(s => ({...s, bg: s.bg ?? inner})),
      sp(sheet.measure - widthOf(text), inner),
      sp(MARGIN, page),
      sp(cols - 1 - sheet.left - sheet.width),
    ],
  };
}

type PageStyle = {color?: string; bold?: boolean; italic?: boolean; fill?: string};

// The page's typography. A terminal has one font size, so a heading is weight,
// spacing and a rule; only code and a table header get ground of their own.
const PAGE: Record<MdKind, PageStyle> = {
  blank: {},
  heading1: {color: theme.ink, bold: true},
  heading2: {color: theme.ink, bold: true},
  heading3: {color: theme.text, bold: true},
  heading4: {color: theme.dim, bold: true},
  ruleHeavy: {color: theme.faint},
  ruleThin: {color: theme.faint},
  para: {color: theme.text},
  list: {color: theme.text},
  quote: {color: theme.dim, italic: true},
  codeLabel: {color: theme.faint},
  code: {color: theme.text, fill: theme.well},
  codeEnd: {color: theme.faint},
  // The header's strip is recessed, like the one over a peek. The row under
  // the cursor owns `surface2`, and two bands of one colour read as one thing.
  tableHead: {color: theme.ink, bold: true, fill: theme.scope},
  tableRule: {color: theme.faint},
  tableRow: {color: theme.text},
};

// The row's kind says how the page reads; a word's kind says what the word is.
// The word wins wherever it has an opinion of its own.
function ink(row: PageStyle, part: Segment): Seg {
  const style = part.kind ? syntax[part.kind] : {};
  return {
    text: part.text,
    color: style.color ?? row.color,
    bold: style.bold ?? row.bold,
    italic: style.italic ?? row.italic,
    underline: style.underline,
    bg: style.bg,
  };
}

// The whole file, full height, with the turns that wrote it on top.
// The columns a turn row's crumb takes, so the header's counts sit above the rows'.
const CRUMB_TAIL = 3;

export function readerLines(input: ReaderInput): Line[] {
  const {cols, view, history, sel} = input;
  const out: Line[] = [];

  if (history && history.touches.length) {
    const n = history.touches.length;
    out.push(pageRow(cols, [seg(`Changed by ${n} turn${n === 1 ? '' : 's'}`, theme.ink, {bold: true})], history.measured ? [...counts(history.added, history.removed), sp(CRUMB_TAIL)] : []));
    out.push(wellTop(cols, {}));
    for (const touch of [...history.touches].reverse().slice(0, 4)) {
      const id = `p:${turnKey(touch.change)}`;
      const here = id === sel;
      out.push(
        wellRow(
          cols,
          [sp(1), seg(clock(touch.change.turn.at), theme.dim), sp(2), seg(touch.change.turn.prompt, here ? theme.ink : theme.text)],
          [
            ...(touch.known ? counts(touch.added, touch.removed) : [seg('not recorded', theme.faint, {italic: true})]),
            // The crumb says this row leaves the reader for the Changes view.
            sp(CRUMB_TAIL - 1), seg(glyph.crumb, here ? theme.accent : theme.faint),
          ],
          {id, pick: true, bg: here ? theme.surface2 : undefined, act: {type: 'goTurn', key: turnKey(touch.change)}},
        ),
      );
    }

    out.push(wellBottom(cols, {}), pageRow(cols));
  }

  if (view.kind === 'notice') {
    for (const text of wrap(deadEnd(view.message), cols - 4)) out.push(pageRow(cols, [seg(text, theme.dim)]));
    return out;
  }

  if (input.formatted) {
    const sheet = paperOf(cols);
    input.formatted.forEach((line, i) => {
      const id = mdLineId(i);
      const here = id === sel;
      let marked = false;
      for (let n = line.from; n <= line.to && !marked; n++) marked = isMarked(input.marks, n);
      const style = PAGE[line.kind];
      out.push(
        paperRow(cols, sheet, line.segments.map(part => ink(style, part)), {
          // The cursor row is one colour right across the sheet, code and
          // table strips included, or it would read as two rows.
          bg: here ? theme.surface2 : undefined,
          fill: here ? theme.surface2 : style.fill,
          mark: seg(marked ? glyph.bar : ' ', theme.accent),
          id, pick: true, rail: marked ? theme.accent : undefined,
        }),
      );
    });
    return out;
  }

  const digits = Math.max(3, String(view.lines.length).length);
  const room = cols - 2 - RIGHT_PAD - digits - 3;
  view.lines.forEach((text, i) => {
    const id = lineId(i + 1);
    const here = id === sel;
    const marked = isMarked(input.marks, i + 1);
    const bg = here ? theme.surface2 : undefined;
    out.push(
      pageRow(cols, [seg(marked ? glyph.bar : ' ', theme.accent, {bg}), seg(String(i + 1).padStart(digits), here ? theme.accent : marked ? theme.dim : theme.faint, {bg}), sp(2, bg), ...code(text, input.segments?.[i] ?? null, room, bg)], [], {
        bg, id, pick: true, rail: marked ? theme.accent : undefined,
      }),
    );
  });
  return out;
}
