import path from 'node:path';
import {Box, Text} from 'ink';
import type {FileDiff} from '../core/diff';
import {thumb} from './layout';
import {glyph, theme} from './theme';
import {fitPath, spaces, width as widthOf} from './util';

type Props = {
  files: FileDiff[];
  cursor: number;
  scroll: number;
  cols: number;
  height: number;
  focused: boolean;
  empty: string;
};

const LETTER = {added: 'A', modified: 'M', deleted: 'D', renamed: 'R'} as const;

function letterColour(file: FileDiff): string {
  if (file.status === 'added') return theme.add;
  if (file.status === 'deleted') return theme.del;
  if (file.status === 'renamed') return theme.link;
  return theme.warn;
}

export function ChangeList({files, cursor, scroll, cols, height, focused, empty}: Props) {
  if (files.length === 0) {
    return (
      <Box height={height}>
        <Text color={theme.dim} wrap="truncate-end"> {empty}</Text>
      </Box>
    );
  }

  const bar = thumb(files.length, height, scroll);
  const shown = files.slice(scroll, scroll + height);

  return (
    <Box flexDirection="column" height={height}>
      {shown.map((file, i) => {
        const index = scroll + i;
        const here = index === cursor;
        const track = bar && i >= bar.from && i < bar.to ? glyph.thumb : ' ';

        const counts = file.binary
          ? 'bin'
          : `${file.added ? `+${file.added}` : ''}${file.added && file.removed ? ' ' : ''}${
              file.removed ? `${glyph.minus}${file.removed}` : ''
            }`;

        const room = cols - 4 - widthOf(counts) - 3;
        const shownPath = fitPath(file.rel, Math.max(6, room));
        const cut = shownPath.length - path.basename(file.rel).length;
        const dir = shownPath.slice(0, Math.max(0, cut));
        const name = shownPath.slice(Math.max(0, cut));
        const pad = Math.max(1, cols - 4 - widthOf(shownPath) - widthOf(counts) - 2);

        return (
          <Text key={file.rel} wrap="truncate-end" backgroundColor={here ? theme.selBg : undefined}>
            <Text> </Text>
            <Text color={letterColour(file)} bold>{LETTER[file.status]}</Text>
            <Text> </Text>
            <Text color={theme.dim}>{dir}</Text>
            <Text color={here && focused ? theme.accent : theme.ink}>{name}</Text>
            <Text>{spaces(pad)}</Text>
            <Text color={file.binary ? theme.dim : theme.add}>{file.binary ? counts : file.added ? `+${file.added}` : ''}</Text>
            <Text color={theme.del}>
              {file.binary ? '' : file.removed ? `${file.added ? ' ' : ''}${glyph.minus}${file.removed}` : ''}
            </Text>
            <Text> </Text>
            <Text color={theme.dim}>{track}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
