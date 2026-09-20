import {Box, Text} from 'ink';
import {gapSize, hunkLabel, type DiffLine, type FileDiff} from '../core/diff';
import {layoutLine} from '../core/highlight';
import {thumb} from './layout';
import {glyph, syntax, theme} from './theme';
import {fit, spaces, width as widthOf} from './util';

// One row of the diff as it appears on screen. This array is the single truth:
// the renderer draws it, the cursor indexes into it, and a click maps a screen
// row onto it. Folds, opened gaps and hidden whitespace are all applied here,
// so the three can never disagree.
export type ViewRow =
  | {
      kind: 'hunk';
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
  | {kind: 'gap'; hunk: number; count: number}
  | {kind: 'line'; line: DiffLine}
  | {kind: 'note'; text: string; tone?: 'dim' | 'warn'};

export function viewRows(
  file: FileDiff | null,
  folded: ReadonlySet<number>,
  opened: ReadonlyMap<number, DiffLine[]>,
  hideSpace: boolean,
): ViewRow[] {
  if (!file) return [];
  const out: ViewRow[] = [];

  if (file.binary) {
    out.push({kind: 'note', text: 'Binary file. There is nothing to compare.'});
    return out;
  }

  if (file.status === 'renamed' && file.hunks.length === 0) {
    out.push({kind: 'note', text: 'Renamed. The contents did not change.'});
    return out;
  }

  file.hunks.forEach((hunk, i) => {
    const open = opened.get(i);
    if (open) for (const line of open) out.push({kind: 'line', line});
    else {
      const size = gapSize(file, i);
      if (size > 0) out.push({kind: 'gap', hunk: i, count: size});
    }

    const changed = hunk.lines.filter(l => l.kind !== 'context');
    const label = hunkLabel(hunk.context);
    out.push({
      kind: 'hunk',
      hunk: i,
      label: label || `lines ${hunk.newStart}–${hunk.newStart + Math.max(0, hunk.newCount - 1)}`,
      named: Boolean(label),
      from: hunk.newStart,
      to: hunk.newStart + Math.max(0, hunk.newCount - 1),
      added: changed.filter(l => l.kind === 'add').length,
      removed: changed.filter(l => l.kind === 'del').length,
      folded: folded.has(i),
    });

    if (folded.has(i)) return;
    for (const line of hunk.lines) {
      // With whitespace hidden, a pair that only moved spaces collapses back
      // into the single unchanged line it really is.
      if (hideSpace && line.spaceOnly) {
        if (line.kind === 'del') continue;
        // It is an unchanged line again, so it carries no word marks either.
        out.push({kind: 'line', line: {...line, kind: 'context', oldNo: line.newNo, words: undefined}});
        continue;
      }

      out.push({kind: 'line', line});
    }
  });

  if (file.truncated) out.push({kind: 'note', text: 'Too big to show in full.', tone: 'warn'});
  return out;
}

type Props = {
  rows: ViewRow[];
  scroll: number;
  cursor: number;
  hscroll: number;
  cols: number;
  height: number;
  focused: boolean;
  message: string;
};

function digitsOf(rows: ViewRow[]): number {
  let most = 0;
  for (const row of rows) {
    if (row.kind !== 'line') continue;
    most = Math.max(most, row.line.newNo ?? 0, row.line.oldNo ?? 0);
  }

  return Math.max(3, String(most).length);
}

export function Diff({rows, scroll, cursor, hscroll, cols, height, focused, message}: Props) {
  if (rows.length === 0) {
    return (
      <Box flexDirection="column" height={height}>
        {message.split('\n').map((line, i) => (
          <Text key={i} color={theme.dim} wrap="truncate-end">
            {' '}
            {line}
          </Text>
        ))}
      </Box>
    );
  }

  const digits = digitsOf(rows);
  // change bar, line number, space, sign, space
  const gutter = 1 + digits + 3;
  const text = Math.max(8, cols - gutter - 1);
  const bar = thumb(rows.length, height, scroll);
  const shown = rows.slice(scroll, scroll + height);

  return (
    <Box flexDirection="column" height={height}>
      {shown.map((row, i) => {
        const index = scroll + i;
        const here = focused && index === cursor;
        const track = bar && i >= bar.from && i < bar.to ? glyph.thumb : ' ';

        if (row.kind === 'hunk') {
          const counts = `${row.added ? `+${row.added}` : ''}${row.added && row.removed ? ' ' : ''}${
            row.removed ? `${glyph.minus}${row.removed}` : ''
          }`;
          // An unnamed hunk already says its line range on the left, so the
          // right-hand side drops it rather than printing it twice.
          const range = row.named && cols >= 56 ? `${row.from}–${row.to}` : '';
          const tail = range ? `${range}  ${counts}` : counts;
          const label = fit(row.label, Math.max(6, cols - gutter - widthOf(tail) - 4));
          const pad = Math.max(1, cols - gutter - widthOf(label) - widthOf(tail) - 2);

          return (
            <Text key={index} wrap="truncate-end" backgroundColor={here ? theme.selBg : undefined}>
              <Text color={theme.dim}>{spaces(gutter - 2)}</Text>
              <Text color={here ? theme.accent : theme.dim}>{row.folded ? glyph.dirClosed : glyph.dirOpen} </Text>
              <Text color={theme.ink} bold>{label}</Text>
              <Text>{spaces(pad)}</Text>
              <Text color={theme.dim}>{range ? `${range}  ` : ''}</Text>
              <Text color={theme.add}>{row.added ? `+${row.added}` : ''}</Text>
              <Text color={theme.del}>{row.removed ? `${row.added ? ' ' : ''}${glyph.minus}${row.removed}` : ''}</Text>
              <Text> </Text>
              <Text color={theme.dim}>{track}</Text>
            </Text>
          );
        }

        if (row.kind === 'gap') {
          const label = `${glyph.gap}  ${row.count} unchanged line${row.count === 1 ? '' : 's'}`;
          return (
            <Text key={index} wrap="truncate-end" backgroundColor={here ? theme.selBg : undefined}>
              <Text>{spaces(gutter)}</Text>
              <Text color={here ? theme.accent : theme.dim}>{fit(label, text)}</Text>
              <Text>{spaces(Math.max(0, text - widthOf(fit(label, text))))}</Text>
              <Text color={theme.dim}>{track}</Text>
            </Text>
          );
        }

        if (row.kind === 'note') {
          return (
            <Text key={index} wrap="truncate-end">
              <Text>{spaces(gutter)}</Text>
              <Text color={row.tone === 'warn' ? theme.warn : theme.dim}>{fit(row.text, text)}</Text>
            </Text>
          );
        }

        const line = row.line;
        const add = line.kind === 'add';
        const del = line.kind === 'del';
        const tint = add ? theme.addBg : del ? theme.delBg : undefined;
        const wordBg = add ? theme.addWordBg : theme.delWordBg;
        const gutterBg = here ? theme.selBg : tint;
        const bodyBg = here && !tint ? theme.selBg : tint;
        const number = del ? line.oldNo : line.newNo;
        const room = text - (hscroll > 0 ? 1 : 0);
        const cut = [...line.text].length > hscroll + room;
        const pieces = layoutLine(line.text, line.segments ?? null, line.words, hscroll, cut ? room - 1 : room);
        const drawn = pieces.reduce((sum, piece) => sum + widthOf(piece.text), 0) + (cut ? 1 : 0);

        return (
          <Text key={index} wrap="truncate-end">
            <Text color={add ? theme.add : del ? theme.del : theme.rule} backgroundColor={gutterBg}>
              {add || del ? glyph.changedBar : ' '}
            </Text>
            <Text
              color={here ? theme.accent : add ? theme.addDim : del ? theme.delDim : theme.dim}
              backgroundColor={gutterBg}
            >
              {String(number ?? '').padStart(digits)}
            </Text>
            <Text backgroundColor={gutterBg}> </Text>
            <Text color={add ? theme.add : del ? theme.del : theme.dim} backgroundColor={gutterBg} bold={add || del}>
              {add ? glyph.plus : del ? '-' : ' '}
            </Text>
            <Text backgroundColor={gutterBg}> </Text>
            {hscroll > 0 ? <Text color={theme.dim} backgroundColor={bodyBg}>‹</Text> : null}
            {pieces.map((piece, n) => (
              <Text
                key={n}
                {...(piece.kind ? syntax[piece.kind] : {})}
                backgroundColor={piece.marked ? wordBg : bodyBg}
              >
                {piece.text}
              </Text>
            ))}
            {cut ? <Text color={theme.dim} backgroundColor={bodyBg}>{glyph.ellipsis}</Text> : null}
            <Text backgroundColor={bodyBg}>{spaces(room - drawn)}</Text>
            <Text color={theme.dim}>{track}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
