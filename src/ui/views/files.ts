import path from 'node:path';
import type {FileView} from '../../core/file';
import {pathKey, type Change} from '../../core/git';
import {layoutLine, type Segment} from '../../core/highlight';
import type {MdLine} from '../../core/markdown';
import type {TreeNode} from '../../core/tree';
import type {FileHistory} from '../../core/turns';
import {
  counts, pageRow, RIGHT_PAD, seg, sp, spineRow, wellBottom, wellRow, wellTop, wellWidth, widthOf,
  type Line, type Seg,
} from '../cells';
import {glyph, syntax, theme} from '../theme';
import {wrap} from '../util';
import {clock, turnKey} from './changes';

// The Files view is the tree. Enter on a file opens a peek under its own row,
// starting at the first thing that changed; the peek hangs off the file's row
// on the same left line a turn's diff uses. `o` reads the whole file.

export const PEEK_ROWS = 14;

export type Marks = ReadonlySet<number> | 'all';

export type Peek = {
  path: string;
  view: FileView;
  segments: Segment[][] | null;
  marks: Marks;
  // First line shown, zero-based.
  from: number;
  history: FileHistory | null;
};

const LETTER_COLOUR = {A: theme.add, M: theme.warn, D: theme.del} as const;
const LANGUAGE: Record<string, string> = {
  '.ts': 'TS', '.tsx': 'TSX', '.js': 'JS', '.jsx': 'JSX', '.mjs': 'JS', '.json': 'JSON', '.md': 'Markdown',
  '.css': 'CSS', '.html': 'HTML', '.py': 'Python', '.rs': 'Rust', '.go': 'Go', '.sh': 'Shell', '.yml': 'YAML', '.yaml': 'YAML',
};

const isMarked = (marks: Marks, n: number): boolean => marks === 'all' || marks.has(n);

// The same chevron rule as the Changes view: accent when the cursor is on the
// row, dim otherwise. Whether it is open is the glyph's job, not the colour's.
const chevron = (isOpen: boolean, here: boolean): Seg => seg(isOpen ? glyph.open : glyph.closed, here ? theme.accent : theme.dim);

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
function peekLines(cols: number, root: string, peek: Peek, owner: string): Line[] {
  const pins = [owner];
  const rail = {pins};
  const out: Line[] = [spineRow(cols, crumbs(root, peek.path), [seg(kindOf(peek.path, peek.view), theme.dim)], rail)];
  const touched = lastTouch(peek.history);
  if (touched.length) out.push(spineRow(cols, touched, [], rail));

  if (peek.view.kind === 'notice') {
    for (const text of wrap(deadEnd(peek.view.message), cols - 6)) out.push(spineRow(cols, [seg(text, theme.dim)], [], rail));
    return out;
  }

  const lines = peek.view.lines;
  const digits = Math.max(3, String(lines.length).length);
  const room = wellWidth(cols, true) - digits - 3;
  const places = changedPlaces(peek.marks, lines.length);
  const end = Math.min(lines.length, peek.from + PEEK_ROWS);
  const well = {pins, spine: true};

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

  // The last row of the well opens the file at the first line it does not show.
  const below = places.filter(n => n > end).length;
  const rest = below
    ? `${below} more changed place${below === 1 ? '' : 's'} below`
    : end < lines.length
      ? `${lines.length - end} more lines`
      : '';
  if (rest) {
    const id = `g:${peek.path}`;
    out.push(
      wellRow(cols, [sp(digits + 3), seg(`${glyph.gap} ${rest}`, theme.faint)], [], {
        ...well, id, pick: true, act: {type: 'read', path: peek.path, line: end + 1},
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
    spineRow(cols, hint, close, {
      pins,
      zones: [
        {from: 3, to: 3 + widthOf(hint), act: {type: 'read', path: peek.path}},
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
    const mark = chevron(node.isDir ? node.open : peeking, here);
    const colour = node.isDir || change ? theme.ink : node.name.startsWith('.') ? theme.faint : theme.text;
    out.push(
      pageRow(cols, [...guides, mark, sp(1), seg(node.isDir ? `${node.name}/` : node.name, colour, {bold: node.isDir})], right, {
        bg, id, pick: true, act: {type: 'node', path: node.path, dir: node.isDir},
      }),
    );
    if (peeking && peek) out.push(...peekLines(cols, input.root, peek, id));
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

// The first row of the file itself, so the reader can open on the file rather
// than on the "changed by" list above it. Null when there is nothing to read.
export function firstReadId(input: Pick<ReaderInput, 'view' | 'formatted'>): string | null {
  if (input.formatted) return input.formatted.length ? mdLineId(0) : null;
  return input.view.kind === 'text' && input.view.lines.length ? lineId(1) : null;
}

export function readerHead(input: Pick<ReaderInput, 'cols' | 'root' | 'path' | 'view' | 'formatted'>): Line[] {
  const {cols} = input;
  // A small pill, so "back" looks like something you can press.
  const back = [seg(` ${glyph.back} Files `, theme.dim, {bg: theme.surface2})];
  return [
    pageRow(cols, [...back, sp(2), ...crumbs(input.root, input.path)], [seg(input.formatted ? `Markdown  ${glyph.sep}  formatted` : kindOf(input.path, input.view), theme.dim)], {
      zones: [{from: 1, to: 1 + widthOf(back), act: {type: 'back'}}],
    }),
  ];
}

// The whole file, full height, with the turns that wrote it on top.
export function readerLines(input: ReaderInput): Line[] {
  const {cols, view, history, sel} = input;
  const out: Line[] = [];

  if (history && history.touches.length) {
    const n = history.touches.length;
    out.push(pageRow(cols, [seg(`Changed by ${n} turn${n === 1 ? '' : 's'}`, theme.ink, {bold: true})], history.measured ? counts(history.added, history.removed) : []));
    out.push(wellTop(cols, {spine: true}));
    for (const touch of [...history.touches].reverse().slice(0, 4)) {
      const id = `p:${turnKey(touch.change)}`;
      const here = id === sel;
      out.push(
        wellRow(
          cols,
          [sp(1), seg(clock(touch.change.turn.at), theme.dim), sp(2), seg(touch.change.turn.prompt, here ? theme.ink : theme.text)],
          [
            ...(touch.change.measured ? counts(touch.added, touch.removed) : [seg('not recorded', theme.faint, {italic: true})]),
            // The crumb says this row leaves the reader for the Changes view.
            sp(2), seg(glyph.crumb, here ? theme.accent : theme.faint),
          ],
          {id, pick: true, spine: true, bg: here ? theme.surface2 : undefined, act: {type: 'goTurn', key: turnKey(touch.change)}},
        ),
      );
    }

    out.push(wellBottom(cols, {spine: true}), pageRow(cols));
  }

  if (view.kind === 'notice') {
    for (const text of wrap(deadEnd(view.message), cols - 4)) out.push(pageRow(cols, [seg(text, theme.dim)]));
    return out;
  }

  if (input.formatted) {
    input.formatted.forEach((line, i) => {
      const id = mdLineId(i);
      const here = id === sel;
      let marked = false;
      for (let n = line.from; n <= line.to && !marked; n++) marked = isMarked(input.marks, n);
      const bg = here ? theme.surface2 : undefined;
      out.push(
        pageRow(cols, [seg(marked ? glyph.bar : ' ', theme.accent, {bg}), sp(2, bg), ...line.segments.map(s => ({text: s.text, ...(s.kind ? syntax[s.kind] : {color: theme.text}), bg}))], [], {
          bg, id, pick: true, rail: marked ? theme.accent : undefined,
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
