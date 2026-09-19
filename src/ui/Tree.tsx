import path from 'node:path';
import {Box, Text} from 'ink';
import stringWidth from 'string-width';
import {pathKey, type Change} from '../core/git';
import type {TreeNode} from '../core/tree';
import {glyph, theme} from './theme';

type Props = {
  nodes: TreeNode[];
  cursor: number;
  changes: ReadonlyMap<string, Change> | null;
  height: number;
  width: number;
  focused: boolean;
  emptyMessage: string;
};

type Part = {text: string; color?: string};

// Cut a name to `max` columns, ending in an ellipsis when it does not fit.
function fit(text: string, max: number): string {
  if (stringWidth(text) <= max) return text;
  let out = '';
  for (const char of text) {
    if (stringWidth(out + char) > max - 1) break;
    out += char;
  }

  return out + glyph.ellipsis;
}

// The right-hand column: "M +8 −3" for a changed file, "• 2" for a closed
// folder hiding two changed files.
function badge(node: TreeNode, changes: ReadonlyMap<string, Change> | null): Part[] {
  if (!changes) return [];
  const key = pathKey(node.path);

  if (node.isDir) {
    if (node.open) return [];
    const prefix = key + path.sep;
    let inside = 0;
    for (const [file, change] of changes) if (change.status !== 'D' && file.startsWith(prefix)) inside++;
    return inside ? [{text: `${glyph.bullet} ${inside}`, color: theme.dim}] : [];
  }

  const change = changes.get(key);
  if (!change) return [];
  const parts: Part[] = [{text: change.status, color: change.status === 'A' ? theme.add : theme.warn}];
  if (change.added !== null) parts.push({text: ` +${change.added}`, color: theme.add});
  if (change.removed !== null) parts.push({text: ` ${glyph.minus}${change.removed}`, color: theme.del});
  return parts;
}

export function Tree({nodes, cursor, changes, height, width, focused, emptyMessage}: Props) {
  if (nodes.length === 0) {
    return (
      <Box height={height}>
        <Text color={theme.dim}> {emptyMessage}</Text>
      </Box>
    );
  }

  // Keep the cursor near the middle of the window while scrolling.
  const top = Math.min(Math.max(0, cursor - Math.floor(height / 2)), Math.max(0, nodes.length - height));
  const rows = nodes.slice(top, top + height);

  return (
    <Box flexDirection="column" height={height}>
      {rows.map((node, i) => {
        const selected = top + i === cursor;
        const guides = glyph.guide.repeat(node.depth);
        const icon = node.isDir ? `${node.open ? glyph.dirOpen : glyph.dirClosed} ` : '  ';
        const right = badge(node, changes);
        const rightWidth = right.reduce((sum, part) => sum + part.text.length, 0);

        // one space of margin on each side, and one between name and badge
        const used = 1 + guides.length + icon.length;
        const room = Math.max(4, width - used - 1 - (rightWidth ? rightWidth + 1 : 0));
        const name = fit(node.name, room);
        const gap = Math.max(1, width - used - stringWidth(name) - rightWidth - 1);

        const nameColor = selected && focused ? theme.accent : node.name.startsWith('.') ? theme.dim : theme.ink;

        return (
          <Text key={node.path} wrap="truncate-end" backgroundColor={selected ? theme.selBg : undefined}>
            <Text> </Text>
            <Text color={theme.rule}>{guides}</Text>
            <Text color={theme.ink}>{icon}</Text>
            <Text color={nameColor} bold={node.isDir}>{name}</Text>
            <Text>{' '.repeat(gap)}</Text>
            {right.map((part, n) => (
              <Text key={n} color={part.color}>{part.text}</Text>
            ))}
            <Text> </Text>
          </Text>
        );
      })}
    </Box>
  );
}
