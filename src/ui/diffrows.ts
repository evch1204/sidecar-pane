import {gapSize, hunkLabel, type DiffLine, type FileDiff} from '../core/diff';
import {layoutLine} from '../core/highlight';
import {counts, seg, sp, wellBottom, wellRow, wellTop, wellWidth, type Line, type Seg} from './cells';
import {glyph, syntax, theme} from './theme';

// One row of the diff as it appears on screen. This array is the single truth:
// the renderer draws it, the cursor indexes into it, and a click maps a screen
// row onto it. Folds, opened gaps and hidden whitespace are all applied here,
// so the three can never disagree.
export type Band = {
  time: string;
  prompt: string;
  added: number;
  removed: number;
  measured: boolean;
};

// A file's diff can arrive in several pieces, one per turn that touched it.
export type DiffGroup = {
  key: string;
  band: Band | null;
  file: FileDiff | null;
  note?: string;
};

export type ViewRow =
  | {kind: 'band'; band: Band}
  | {
      kind: 'hunk';
      group: number;
      hunk: number;
      label: string;
      // False when git found nothing worth naming and the label is a line range.
      named: boolean;
      from: number;
      to: number;
      added: number;
      removed: number;
      folded: boolean;
    }
  | {kind: 'gap'; group: number; hunk: number; count: number}
  | {kind: 'line'; line: DiffLine}
  | {kind: 'note'; text: string; tone?: 'dim' | 'warn'};

export function viewRows(
  groups: DiffGroup[],
  folded: ReadonlySet<string>,
  opened: ReadonlyMap<string, DiffLine[]>,
  hideSpace: boolean,
): ViewRow[] {
  const out: ViewRow[] = [];

  groups.forEach((group, g) => {
    if (group.band) out.push({kind: 'band', band: group.band});
    if (group.note) out.push({kind: 'note', text: group.note});

    const file = group.file;
    if (!file) return;

    if (file.binary) {
      out.push({kind: 'note', text: 'Binary file. There is nothing to compare.'});
      return;
    }

    if (file.status === 'renamed' && file.hunks.length === 0) {
      out.push({kind: 'note', text: 'Renamed. The contents did not change.'});
      return;
    }

    file.hunks.forEach((hunk, i) => {
      const key = `${group.key}:${i}`;
      const open = opened.get(key);
      if (open) for (const line of open) out.push({kind: 'line', line});
      else {
        const size = gapSize(file, i);
        if (size > 0) out.push({kind: 'gap', group: g, hunk: i, count: size});
      }

      const changed = hunk.lines.filter(l => l.kind !== 'context');
      const label = hunkLabel(hunk.context);
      out.push({
        kind: 'hunk',
        group: g,
        hunk: i,
        label: label || `lines ${hunk.newStart}–${hunk.newStart + Math.max(0, hunk.newCount - 1)}`,
        named: Boolean(label),
        from: hunk.newStart,
        to: hunk.newStart + Math.max(0, hunk.newCount - 1),
        added: changed.filter(l => l.kind === 'add').length,
        removed: changed.filter(l => l.kind === 'del').length,
        folded: folded.has(key),
      });

      if (folded.has(key)) return;
      for (const line of hunk.lines) {
        // With whitespace hidden, a pair that only moved spaces collapses back
        // into the single unchanged line it really is.
        if (hideSpace && line.spaceOnly) {
          if (line.kind === 'del') continue;
          out.push({kind: 'line', line: {...line, kind: 'context', oldNo: line.newNo, words: undefined}});
          continue;
        }

        out.push({kind: 'line', line});
      }
    });

    if (file.truncated) out.push({kind: 'note', text: 'Too big to show in full.', tone: 'warn'});
  });

  return out;
}

function digitsOf(rows: ViewRow[]): number {
  let most = 0;
  for (const row of rows) {
    if (row.kind !== 'line') continue;
    most = Math.max(most, row.line.newNo ?? 0, row.line.oldNo ?? 0);
  }

  return Math.max(3, String(most).length);
}

// Where a long changed line breaks. It breaks after a space when there is one
// in the second half of the row, so words stay whole.
function windows(chars: string[], first: number, rest: number): [number, number][] {
  const out: [number, number][] = [];
  let from = 0;
  while (from < chars.length) {
    const room = Math.max(4, out.length === 0 ? first : rest);
    let to = Math.min(chars.length, from + room);
    if (to < chars.length) {
      for (let i = to - 1; i > from + room / 2; i--) {
        if (chars[i] === ' ') {
          to = i + 1;
          break;
        }
      }
    }

    out.push([from, to]);
    from = to;
  }

  return out.length ? out : [[0, 0]];
}

type Draw = {
  cols: number;
  // Unique per open file: line ids and fold keys are built on it.
  fileKey: string;
  path: string | null;
  // The id of the line under the cursor.
  sel: string | null;
  pins: string[];
};

// A file's diff as lines of the stream, sitting in a well under its own row.
export function diffLines(rows: ViewRow[], groups: DiffGroup[], draw: Draw): Line[] {
  const {cols, fileKey, sel, pins} = draw;
  const out: Line[] = [wellTop(cols, {pins})];
  const digits = digitsOf(rows);
  // change bar, line number, space, sign, space
  const gutter = 1 + digits + 3;
  const room = wellWidth(cols) - gutter;

  rows.forEach((row, index) => {
    const id = `${fileKey}#${index}`;
    const here = id === sel;

    if (row.kind === 'band') {
      out.push(
        wellRow(
          cols,
          [sp(1), seg(row.band.time, theme.accent), sp(2), seg(row.band.prompt, row.band.measured ? theme.text : theme.dim)],
          [...counts(row.band.added, row.band.removed, 4), sp(1)],
          {bg: theme.scope, pins},
        ),
      );
      return;
    }

    if (row.kind === 'hunk') {
      const owner = groups[row.group];
      out.push(
        wellRow(
          cols,
          [sp(1), seg(row.folded ? glyph.closed : glyph.open, here ? theme.accent : theme.faint), sp(1), seg(row.label, theme.link)],
          [
            ...(row.named ? [seg(`${row.from}–${row.to}`, theme.faint), sp(2)] : []),
            ...(row.added ? [seg(`+${row.added}`, theme.add)] : []),
            ...(row.removed ? [sp(row.added ? 1 : 0), seg(`${glyph.minus}${row.removed}`, theme.del)] : []),
            sp(1),
          ],
          {bg: here ? theme.surface2 : theme.scope, id, pick: true, pins, act: {type: 'hunk', key: `${owner?.key}:${row.hunk}`}},
        ),
      );
      return;
    }

    if (row.kind === 'gap') {
      out.push(
        wellRow(
          cols,
          [sp(gutter), seg(`${glyph.gap} ${row.count} unchanged line${row.count === 1 ? '' : 's'}`, here ? theme.accent : theme.faint)],
          [],
          {bg: here ? theme.surface2 : undefined, id, pick: true, pins, act: {type: 'gap', file: fileKey, group: row.group, hunk: row.hunk}},
        ),
      );
      return;
    }

    if (row.kind === 'note') {
      out.push(wellRow(cols, [sp(gutter), seg(row.text, row.tone === 'warn' ? theme.warn : theme.dim)], [], {pins}));
      return;
    }

    const line = row.line;
    const add = line.kind === 'add';
    const del = line.kind === 'del';
    const tint = add ? theme.addBg : del ? theme.delBg : undefined;
    const gutterBg = here ? theme.surface2 : tint;
    const number = del ? line.oldNo : line.newNo;
    const chars = [...line.text];
    // Changed lines wrap so the edit is never cut off. Unchanged lines are
    // only there for bearings, so they truncate.
    const parts: [number, number][] = add || del ? windows(chars, room, room - 2) : [[0, Math.min(chars.length, room)]];
    const cut = !(add || del) && chars.length > room;

    parts.forEach(([from, to], n) => {
      const first = n === 0;
      const pieces = layoutLine(line.text, line.segments ?? null, line.words, from, (cut ? room - 1 : to) - from);
      const code: Seg[] = pieces.map(piece => ({
        text: piece.text,
        ...(piece.kind ? syntax[piece.kind] : {color: add || del ? theme.ink : theme.text}),
        bg: piece.marked ? (add ? theme.addWordBg : theme.delWordBg) : tint,
      }));
      out.push(
        wellRow(
          cols,
          [
            seg(add || del ? glyph.bar : ' ', add ? theme.add : theme.del, {bg: gutterBg}),
            seg(first ? String(number ?? '').padStart(digits) : ' '.repeat(digits), here ? theme.accent : add || del ? theme.dim : theme.faint, {bg: gutterBg}),
            sp(1, gutterBg),
            first
              ? seg(add ? glyph.plus : del ? glyph.minus : ' ', add ? theme.add : theme.del, {bg: gutterBg})
              : seg(glyph.wrap, theme.faint, {bg: gutterBg}),
            sp(1, gutterBg),
            ...(first ? [] : [sp(2, tint)]),
            ...code,
            ...(cut ? [seg(glyph.ellipsis, theme.faint, {bg: tint})] : []),
          ],
          [],
          {
            bg: tint,
            pins,
            ...(first ? {id, pick: true, at: draw.path ? {path: draw.path, line: line.newNo ?? line.oldNo ?? 0} : undefined} : {}),
          },
        ),
      );
    });
  });

  out.push(wellBottom(cols, {pins}));
  return out;
}
