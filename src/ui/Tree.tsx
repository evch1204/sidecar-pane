import {Box, Text} from 'ink';
import type {TreeNode} from '../core/tree';
import {glyph, theme} from './theme';

type Props = {
  nodes: TreeNode[];
  cursor: number;
  expanded: ReadonlySet<string>;
  height: number;
  width: number;
  focused: boolean;
};

export function Tree({nodes, cursor, expanded, height, width, focused}: Props) {
  if (nodes.length === 0) {
    return (
      <Box height={height}>
        <Text color={theme.dim}> This folder is empty.</Text>
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
        const icon = node.isDir ? (expanded.has(node.path) ? glyph.dirOpen : glyph.dirClosed) : ' ';
        const label = ` ${'  '.repeat(node.depth)}${icon} ${node.name}`;
        const hidden = node.name.startsWith('.');

        return (
          <Text
            key={node.path}
            wrap="truncate-end"
            bold={node.isDir}
            color={selected && focused ? theme.accent : hidden ? theme.dim : theme.ink}
            backgroundColor={selected ? theme.selBg : undefined}
          >
            {selected ? label.padEnd(width) : label}
          </Text>
        );
      })}
    </Box>
  );
}
