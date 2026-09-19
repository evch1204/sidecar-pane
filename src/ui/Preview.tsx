import {Box, Text} from 'ink';
import type {FileView} from '../core/file';
import type {Segment} from '../core/highlight';
import {glyph, syntax, theme} from './theme';

type Props = {
  view: FileView | null;
  message: string;
  segments: Segment[][] | null;
  marks: ReadonlySet<number> | 'all';
  scroll: number;
  height: number;
};

export function Preview({view, message, segments, marks, scroll, height}: Props) {
  if (!view || view.kind === 'notice') {
    return (
      <Box height={height}>
        <Text color={theme.dim}> {view ? view.message : message}</Text>
      </Box>
    );
  }

  const gutter = Math.max(3, String(view.lines.length).length);
  const rows = view.lines.slice(scroll, scroll + height);

  return (
    <Box flexDirection="column" height={height}>
      {rows.map((line, i) => {
        const number = scroll + i + 1;
        const changed = marks === 'all' || marks.has(number);
        const parts = segments?.[scroll + i];

        return (
          <Text key={number} wrap="truncate-end" color={theme.ink}>
            <Text color={theme.add}>{changed ? glyph.changedBar : ' '}</Text>
            <Text color={theme.dim}>{String(number).padStart(gutter)}  </Text>
            {parts
              ? parts.map((part, n) => (
                  <Text key={n} {...(part.kind ? syntax[part.kind] : {})}>
                    {part.text}
                  </Text>
                ))
              : line}
          </Text>
        );
      })}
    </Box>
  );
}
