import {Box, Text} from 'ink';
import type {FileView} from '../core/file';
import {theme} from './theme';

type Props = {
  view: FileView | null;
  scroll: number;
  height: number;
};

export function Preview({view, scroll, height}: Props) {
  if (!view) {
    return (
      <Box height={height} flexDirection="column">
        <Text color={theme.dim}> Move onto a file to preview it here.</Text>
      </Box>
    );
  }

  if (view.kind === 'notice') {
    return (
      <Box height={height}>
        <Text color={theme.dim}> {view.message}</Text>
      </Box>
    );
  }

  const gutter = String(view.lines.length).length;
  const rows = view.lines.slice(scroll, scroll + height);

  return (
    <Box flexDirection="column" height={height}>
      {rows.map((line, i) => (
        <Text key={scroll + i} wrap="truncate-end" color={theme.ink}>
          <Text color={theme.dim}> {String(scroll + i + 1).padStart(gutter)}  </Text>
          {line}
        </Text>
      ))}
    </Box>
  );
}
