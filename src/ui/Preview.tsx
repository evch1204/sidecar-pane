import {Box, Text} from 'ink';
import type {FileView} from '../core/file';
import {layoutLine, type Segment} from '../core/highlight';
import {thumb} from './layout';
import {glyph, syntax, theme} from './theme';
import {spaces} from './util';

type Props = {
  view: FileView | null;
  message: string;
  segments: Segment[][] | null;
  marks: ReadonlySet<number> | 'all';
  scroll: number;
  height: number;
  cols: number;
};

export function Preview({view, message, segments, marks, scroll, height, cols}: Props) {
  if (!view || view.kind === 'notice') {
    return (
      <Box height={height}>
        <Text color={theme.dim} wrap="truncate-end"> {view ? view.message : message}</Text>
      </Box>
    );
  }

  const gutter = Math.max(3, String(view.lines.length).length);
  const rows = view.lines.slice(scroll, scroll + height);
  const bar = thumb(view.lines.length, height, scroll);

  return (
    <Box flexDirection="column" height={height}>
      {rows.map((line, i) => {
        const number = scroll + i + 1;
        const changed = marks === 'all' || marks.has(number);
        const parts = segments?.[scroll + i];
        const track = bar && i >= bar.from && i < bar.to ? glyph.thumb : ' ';
        const room = Math.max(4, cols - gutter - 4);
        // Cut the text here rather than letting the row overflow, or a long
        // line pushes the scrollbar column off the edge.
        const cut = [...line].length > room;
        const pieces = layoutLine(line, parts ?? null, undefined, 0, cut ? room - 1 : room);
        const drawn = pieces.reduce((sum, piece) => sum + piece.text.length, 0) + (cut ? 1 : 0);

        return (
          <Text key={number} wrap="truncate-end" color={theme.ink}>
            <Text color={theme.add}>{changed ? glyph.changedBar : ' '}</Text>
            <Text color={theme.dim}>{String(number).padStart(gutter)}  </Text>
            {pieces.map((piece, n) => (
              <Text key={n} {...(piece.kind ? syntax[piece.kind] : {})}>
                {piece.text}
              </Text>
            ))}
            {cut ? <Text color={theme.dim}>{glyph.ellipsis}</Text> : null}
            <Text>{spaces(room - drawn)}</Text>
            <Text color={theme.dim}>{track}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
