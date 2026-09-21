import {Box, Text} from 'ink';
import type {Line, Seg} from './cells';

// Neighbouring segments that look the same are drawn as one, which keeps the
// number of nodes Ink lays out per frame small.
function merged(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    if (!s.text) continue;
    const last = out[out.length - 1];
    if (
      last &&
      last.color === s.color &&
      last.bg === s.bg &&
      Boolean(last.bold) === Boolean(s.bold) &&
      Boolean(last.italic) === Boolean(s.italic) &&
      Boolean(last.underline) === Boolean(s.underline)
    ) {
      last.text += s.text;
    } else {
      out.push({...s});
    }
  }

  return out;
}

export function Screen({lines, cols, rows}: {lines: Line[]; cols: number; rows: number}) {
  return (
    <Box flexDirection="column" width={cols} height={rows}>
      {lines.slice(0, rows).map((line, y) => (
        <Text key={y} wrap="truncate-end">
          {merged(line.segs).map((s, x) => (
            <Text key={x} color={s.color} backgroundColor={s.bg} bold={s.bold} italic={s.italic} underline={s.underline}>
              {s.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}
