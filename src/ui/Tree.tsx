import path from 'node:path';
import {Box, Text} from 'ink';
import {pathKey, type Change} from '../core/git';
import type {TreeNode} from '../core/tree';
import {thumb} from './layout';
import {glyph, theme} from './theme';
import {fit, spaces, width as widthOf} from './util';

type Props = {
  nodes: TreeNode[];
  cursor: number;
  scroll: number;
  changes: ReadonlyMap<string, Change> | null;
  height: number;
  width: number;
  focused: boolean;
  emptyMessage: string;
};

type Part = {text: string; color?: string};

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
  if (change.added) parts.push({text: ` +${change.added}`, color: theme.add});
  if (change.removed) parts.push({text: ` ${glyph.minus}${change.removed}`, color: theme.del});
  return parts;
}

export function Tree({nodes, cursor, scroll, changes, height, width, focused, emptyMessage}: Props) {
  if (nodes.length === 0) {
    return (
      <Box height={height}>
        <Text color={theme.dim} wrap="truncate-end"> {emptyMessage}</Text>
      </Box>
    );
  }

  const bar = thumb(nodes.length, height, scroll);
  const rows = nodes.slice(scroll, scroll + height);

  return (
    <Box flexDirection="column" height={height}>
      {rows.map((node, i) => {
        const index = scroll + i;
        const selected = index === cursor;
        const track = bar && i >= bar.from && i < bar.to ? glyph.thumb : ' ';
        const guides = glyph.guide.repeat(node.depth);
        const icon = node.isDir ? `${node.open ? glyph.dirOpen : glyph.dirClosed} ` : '  ';
        const right = badge(node, changes);
        const rightWidth = right.reduce((sum, part) => sum + part.text.length, 0);

        // one space of margin, the guides, the icon, then the scrollbar column
        const used = 1 + guides.length + icon.length;
        const room = Math.max(4, width - used - 2 - (rightWidth ? rightWidth + 1 : 0));
        const name = fit(node.name, room);
        const gap = Math.max(1, width - used - widthOf(name) - rightWidth - 2);

        const nameColor = selected && focused ? theme.accent : node.name.startsWith('.') ? theme.dim : theme.ink;

        return (
          <Text key={node.path} wrap="truncate-end" backgroundColor={selected ? theme.selBg : undefined}>
            <Text> </Text>
            <Text color={theme.rule}>{guides}</Text>
            <Text color={theme.ink}>{icon}</Text>
            <Text color={nameColor} bold={node.isDir}>{name}</Text>
            <Text>{spaces(gap)}</Text>
            {right.map((part, n) => (
              <Text key={n} color={part.color}>{part.text}</Text>
            ))}
            <Text> </Text>
            <Text color={theme.dim}>{track}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
