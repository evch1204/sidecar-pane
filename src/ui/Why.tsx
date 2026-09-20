import {Box, Text} from 'ink';
import type {TurnChange} from '../core/turns';
import {thumb} from './layout';
import {glyph, theme} from './theme';
import {fitPath, spaces, width as widthOf, wrap} from './util';

// The body of a selected turn: your own words, what Claude did about them,
// and what measurably changed. This is the answer to "why did this file move?"

type Seg = {text: string; color?: string; bold?: boolean};
type Row = {segs: Seg[]; tail?: Seg[]};

const TOOL_COLOUR: Record<string, string> = {
  Agent: theme.link,
  Task: theme.link,
  Bash: theme.warn,
  Edit: theme.add,
  Write: theme.add,
  Read: theme.dim,
  Grep: theme.dim,
  Glob: theme.dim,
};

const LETTER = {added: 'A', modified: 'M', deleted: 'D', renamed: 'R'} as const;

export function whyRows(change: TurnChange, cols: number): Row[] {
  const width = cols - 2;
  const rows: Row[] = [];
  const heading = (text: string, tail?: Seg[]) => rows.push({segs: [{text: `  ${text}`, color: theme.dim}], tail});

  heading('you asked');
  for (const line of wrap(change.turn.prompt, width - 4)) {
    rows.push({segs: [{text: `    ${line}`, color: theme.ink}]});
  }

  rows.push({segs: []});

  const wrote = change.turn.actions.filter(a => a.wrote).length;
  const minutes = Math.max(0, Math.round((change.turn.endedAt - change.turn.at) / 60_000));
  heading('what Claude did', [
    {text: `${change.turn.actions.length} steps`, color: theme.dim},
    {text: `  ${wrote} wrote`, color: theme.dim},
    {text: minutes ? `  ${minutes} min` : '', color: theme.dim},
  ]);

  if (change.turn.actions.length === 0) {
    rows.push({segs: [{text: '    nothing — Claude only answered', color: theme.dim}]});
  }

  for (const action of change.turn.actions) {
    const label = action.why || (action.file ? action.file.split(/[\\/]/).pop()! : '');
    rows.push({
      segs: [
        {text: '    '},
        {text: action.tool.padEnd(7), color: TOOL_COLOUR[action.tool] ?? theme.dim},
        {text: ' '},
        {text: label.slice(0, Math.max(8, width - 13)), color: action.wrote ? theme.ink : theme.dim},
      ],
    });
  }

  rows.push({segs: []});

  heading('what changed', [
    {text: change.measured ? 'measured' : 'not recorded', color: change.measured ? theme.dim : theme.warn},
    ...(change.measured
      ? [
          {text: `  +${change.added}`, color: theme.add},
          {text: change.removed ? ` ${glyph.minus}${change.removed}` : '', color: theme.del},
        ]
      : []),
  ]);

  if (change.files.length === 0) {
    rows.push({segs: [{text: '    no files', color: theme.dim}]});
  }

  for (const file of change.files) {
    rows.push({
      segs: [
        {text: '    '},
        {
          text: LETTER[file.status],
          color: file.status === 'added' ? theme.add : file.status === 'deleted' ? theme.del : theme.warn,
          bold: true,
        },
        {text: ' '},
        {text: fitPath(file.rel, Math.max(10, width - 20)), color: change.measured ? theme.ink : theme.dim},
      ],
      tail: change.measured
        ? [
            {text: file.added ? `+${file.added}` : '', color: theme.add},
            {text: file.removed ? `${file.added ? ' ' : ''}${glyph.minus}${file.removed}` : '', color: theme.del},
          ]
        : undefined,
    });
  }

  if (!change.measured) {
    rows.push({segs: []});
    rows.push({
      segs: [
        {
          text: '    Sidecar was not watching when this turn ran, so these',
          color: theme.dim,
        },
      ],
    });
    rows.push({segs: [{text: '    files come from the chat, not from the files.', color: theme.dim}]});
  }

  return rows;
}

type Props = {
  rows: Row[];
  scroll: number;
  cols: number;
  height: number;
};

export function Why({rows, scroll, cols, height}: Props) {
  const bar = thumb(rows.length, height, scroll);
  const shown = rows.slice(scroll, scroll + height);

  return (
    <Box flexDirection="column" height={height}>
      {shown.map((row, i) => {
        const track = bar && i >= bar.from && i < bar.to ? glyph.thumb : ' ';
        const left = row.segs.reduce((n, s) => n + widthOf(s.text), 0);
        const right = (row.tail ?? []).reduce((n, s) => n + widthOf(s.text), 0);
        const pad = Math.max(1, cols - 1 - left - right - 1);

        return (
          <Text key={scroll + i} wrap="truncate-end">
            {row.segs.map((seg, n) => (
              <Text key={n} color={seg.color} bold={seg.bold}>
                {seg.text}
              </Text>
            ))}
            <Text>{spaces(pad)}</Text>
            {(row.tail ?? []).map((seg, n) => (
              <Text key={`t${n}`} color={seg.color} bold={seg.bold}>
                {seg.text}
              </Text>
            ))}
            <Text> </Text>
            <Text color={theme.dim}>{track}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
