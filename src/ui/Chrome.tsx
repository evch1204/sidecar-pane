import {Text} from 'ink';
import {tabStops, type View} from './layout';
import {glyph, theme} from './theme';
import {fit, spaces, width} from './util';

type TabsProps = {
  view: View;
  changedCount: number;
  project: string;
  branch: string;
  cols: number;
  filtered: boolean;
  note?: string;
};

// The one title row. The tabs are just words: the bright one is the view you
// are in. No brackets, no box, so the pane reads as one screen with the CLI
// beside it.
export function Tabs({view, changedCount, project, branch, cols, filtered, note}: TabsProps) {
  const stops = tabStops(changedCount);
  const right = branch ? `${project} ${glyph.bullet} ${branch}` : project;
  const used = stops[1]!.end + (filtered ? 10 : 0) + (note ? note.length + 3 : 0);
  const room = cols - used - 2;
  const tail = room >= width(right) ? right : room >= width(project) ? project : '';

  return (
    <Text wrap="truncate-end">
      <Text color={theme.accent} bold> sidecar</Text>
      <Text>   </Text>
      <Text color={view === 'files' ? theme.ink : theme.dim} bold={view === 'files'}>
        {stops[0]!.label}
      </Text>
      <Text>   </Text>
      <Text color={view === 'changes' ? theme.ink : theme.dim} bold={view === 'changes'}>
        {stops[1]!.label}
      </Text>
      {filtered ? <Text color={theme.warn}>  changed</Text> : null}
      {note ? <Text color={theme.dim}>{'  '}{glyph.bullet} {note}</Text> : null}
      <Text>{spaces(cols - used - width(tail) - 1)}</Text>
      <Text color={theme.dim}>{tail}</Text>
    </Text>
  );
}

export function Rule({cols}: {cols: number}) {
  return <Text color={theme.rule}>{glyph.rule.repeat(Math.max(0, cols))}</Text>;
}

type DividerProps = {
  cols: number;
  label: string;
  note?: string;
  noteColor?: string;
  right?: string;
  focused: boolean;
};

// The rule between the two halves doubles as the header for the lower one, so
// the pane spends one row where most tools spend two. It is also the handle
// you drag to resize the split.
export function Divider({cols, label, note, noteColor, right, focused}: DividerProps) {
  const rightText = right ?? '';
  const noteWidth = note ? width(note) + 3 : 0;
  const rightWidth = rightText ? width(rightText) + 1 : 0;
  const name = fit(label, Math.max(4, cols - 6 - noteWidth - rightWidth));
  const fill = Math.max(1, cols - 5 - width(name) - noteWidth - rightWidth);

  return (
    <Text wrap="truncate-end">
      <Text color={theme.rule}>{glyph.rule} </Text>
      <Text color={focused ? theme.accent : theme.ink}>{name}</Text>
      {note ? (
        <>
          <Text color={theme.rule}> {glyph.bullet} </Text>
          <Text color={noteColor ?? theme.dim}>{note}</Text>
        </>
      ) : null}
      <Text color={theme.rule}> {glyph.rule.repeat(fill)} </Text>
      {rightText ? <Text color={theme.dim}>{rightText} </Text> : null}
      <Text color={theme.rule}>{glyph.rule}</Text>
    </Text>
  );
}

export function Footer({cols, text, notice}: {cols: number; text: string; notice: string}) {
  return (
    <Text wrap="truncate-end" color={notice ? theme.warn : theme.dim}>
      {' '}
      {fit(notice || text, cols - 2)}
    </Text>
  );
}
