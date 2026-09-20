import {Box, Text} from 'ink';
import type {ChangedFile} from '../core/turns';
import {thumb} from './layout';
import {glyph, theme} from './theme';
import {clock, type ListRow} from './turnrows';
import {fit, fitPath, spaces, width as widthOf} from './util';

type Props = {
  rows: ListRow[];
  cursor: number;
  scroll: number;
  cols: number;
  height: number;
  focused: boolean;
  empty: string;
};

const LETTER = {added: 'A', modified: 'M', deleted: 'D', renamed: 'R'} as const;

function statusColour(status: ChangedFile['status']): string {
  if (status === 'added') return theme.add;
  if (status === 'deleted') return theme.del;
  if (status === 'renamed') return theme.link;
  return theme.warn;
}

function counts(added: number, removed: number) {
  return (
    <>
      <Text color={theme.add}>{added ? `+${added}` : ''}</Text>
      <Text color={theme.del}>{removed ? `${added ? ' ' : ''}${glyph.minus}${removed}` : ''}</Text>
    </>
  );
}

function countWidth(added: number, removed: number): number {
  return (added ? String(added).length + 1 : 0) + (removed ? String(removed).length + 2 : 0);
}

export function TurnList({rows, cursor, scroll, cols, height, focused, empty}: Props) {
  if (rows.length === 0) {
    return (
      <Box height={height}>
        <Text color={theme.dim} wrap="truncate-end"> {empty}</Text>
      </Box>
    );
  }

  const bar = thumb(rows.length, height, scroll);
  const shown = rows.slice(scroll, scroll + height);
  const W = cols - 1;

  return (
    <Box flexDirection="column" height={height}>
      {shown.map((row, i) => {
        const index = scroll + i;
        const here = index === cursor;
        const track = bar && i >= bar.from && i < bar.to ? glyph.thumb : ' ';
        const bg = here ? theme.selBg : undefined;
        const key = `${index}`;

        if (row.kind === 'section') {
          const fill = Math.max(2, W - 9 - widthOf(row.label) - widthOf(row.when));
          return (
            <Text key={key} wrap="truncate-end">
              <Text color={theme.rule}> {glyph.rule}{glyph.rule} </Text>
              <Text color={theme.ink} bold>{row.label}</Text>
              <Text color={theme.rule}> {glyph.rule.repeat(fill)} </Text>
              <Text color={theme.dim}>{row.when}</Text>
              <Text color={theme.rule}> {glyph.rule}{glyph.rule}</Text>
              <Text color={theme.dim}>{track}</Text>
            </Text>
          );
        }

        if (row.kind === 'turn') {
          const {change} = row;
          const tail = change.running
            ? 'running'
            : change.measured
              ? `${change.files.length} file${change.files.length === 1 ? '' : 's'}  `
              : `${change.files.length} file${change.files.length === 1 ? '' : 's'}  not recorded`;
          const numbers = change.measured && !change.running ? countWidth(change.added, change.removed) : 0;
          const time = clock(change.turn.at);
          const room = Math.max(8, W - 13 - widthOf(tail) - numbers);
          const prompt = fit(row.change.turn.prompt, room);
          const pad = Math.max(1, W - 12 - widthOf(prompt) - widthOf(tail) - numbers);

          return (
            <Text key={key} wrap="truncate-end" backgroundColor={bg}>
              <Text> </Text>
              <Text color={change.running ? theme.add : here && focused ? theme.accent : theme.dim}>
                {change.running ? glyph.dot : row.open ? glyph.dirOpen : glyph.dirClosed}
              </Text>
              <Text>{'  '}</Text>
              <Text color={change.running ? theme.accent : theme.dim}>{time}</Text>
              <Text>{'  '}</Text>
              <Text color={here && focused ? theme.accent : theme.ink} bold={change.running}>
                {prompt}
              </Text>
              <Text>{spaces(pad)}</Text>
              <Text color={change.running ? theme.warn : theme.dim}>{tail}</Text>
              {change.measured && !change.running ? counts(change.added, change.removed) : null}
              <Text> </Text>
              <Text color={theme.dim}>{track}</Text>
            </Text>
          );
        }

        if (row.kind === 'file' || row.kind === 'fileHead') {
          const file = row.kind === 'file' ? row.file : row.history;
          const lead = row.kind === 'file' ? ' │  ' : ' ';
          const measured = row.kind === 'fileHead' ? row.history.measured : (row.change?.measured ?? false);
          const turns =
            row.kind === 'fileHead'
              ? `${row.history.touches.length} turn${row.history.touches.length === 1 ? '' : 's'}  ${
                  measured ? '' : 'not recorded'
                }`
              : '';
          const numbers = measured ? countWidth(file.added, file.removed) : 0;
          const room = Math.max(6, W - lead.length - 4 - widthOf(turns) - numbers);
          const shownPath = fitPath(file.rel, room);
          const cut = shownPath.length - (file.rel.split('/').pop() ?? '').length;
          const pad = Math.max(1, W - lead.length - 3 - widthOf(shownPath) - widthOf(turns) - numbers);

          return (
            <Text key={key} wrap="truncate-end" backgroundColor={bg}>
              <Text color={theme.rule}>{lead}</Text>
              <Text color={statusColour(file.status)} bold>
                {row.kind === 'fileHead' ? LETTER[row.history.status] : LETTER[row.file.status]}
              </Text>
              <Text> </Text>
              <Text color={theme.dim}>{shownPath.slice(0, Math.max(0, cut))}</Text>
              <Text color={here && focused ? theme.accent : measured ? theme.ink : theme.dim}>
                {shownPath.slice(Math.max(0, cut))}
              </Text>
              <Text>{spaces(pad)}</Text>
              <Text color={theme.dim}>{turns}</Text>
              {measured ? counts(file.added, file.removed) : null}
              <Text> </Text>
              <Text color={theme.dim}>{track}</Text>
            </Text>
          );
        }

        if (row.kind === 'touch') {
          const time = clock(row.change.turn.at);
          const numbers = countWidth(row.added, row.removed);
          const room = Math.max(8, W - 13 - numbers);
          const prompt = fit(row.change.turn.prompt, room);
          const pad = Math.max(1, W - 12 - widthOf(prompt) - numbers);
          return (
            <Text key={key} wrap="truncate-end" backgroundColor={bg}>
              <Text color={theme.rule}>{'    '}</Text>
              <Text color={theme.dim}>{time}</Text>
              <Text>{'  '}</Text>
              <Text color={here && focused ? theme.accent : theme.ink}>{prompt}</Text>
              <Text>{spaces(pad)}</Text>
              {counts(row.added, row.removed)}
              <Text> </Text>
              <Text color={theme.dim}>{track}</Text>
            </Text>
          );
        }

        if (row.kind === 'more') {
          return (
            <Text key={key} wrap="truncate-end" backgroundColor={bg}>
              <Text color={theme.rule}> │  </Text>
              <Text color={here && focused ? theme.accent : theme.dim}>{row.text}</Text>
            </Text>
          );
        }

        return (
          <Text key={key} wrap="truncate-end" color={theme.dim}>
            {' '}
            {row.text}
          </Text>
        );
      })}
    </Box>
  );
}
