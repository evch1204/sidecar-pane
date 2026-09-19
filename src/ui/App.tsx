import os from 'node:os';
import path from 'node:path';
import {useEffect, useMemo, useState} from 'react';
import {Box, Text, useApp, useInput, useStdout} from 'ink';
import {readFileView} from '../core/file';
import {visibleNodes} from '../core/tree';
import {Preview} from './Preview';
import {Tree} from './Tree';
import {glyph, theme} from './theme';

type Focus = 'tree' | 'preview';

type Props = {
  root: string;
  interactive: boolean;
};

function shortPath(p: string): string {
  const home = os.homedir();
  const shown = p.startsWith(home) ? `~${p.slice(home.length)}` : p;
  return shown.replaceAll('\\', '/');
}

function useTerminalSize() {
  const {stdout} = useStdout();
  const read = () => ({cols: stdout.columns || 80, rows: stdout.rows || 30});
  const [size, setSize] = useState(read);

  useEffect(() => {
    const onResize = () => setSize(read());
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return size;
}

export function App({root, interactive}: Props) {
  const {exit} = useApp();
  const {cols, rows} = useTerminalSize();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [focus, setFocus] = useState<Focus>('tree');
  const [scroll, setScroll] = useState(0);

  const nodes = useMemo(() => visibleNodes(root, expanded), [root, expanded]);
  const current = nodes[Math.min(cursor, nodes.length - 1)];
  const openPath = current && !current.isDir ? current.path : null;
  const view = useMemo(() => (openPath ? readFileView(openPath) : null), [openPath]);
  const lineCount = view?.kind === 'text' ? view.lines.length : 0;

  // header, FILES label, rule, preview title, rule, footer
  const chrome = 6;
  const treeHeight = Math.max(4, Math.floor((rows - chrome) * 0.4));
  const previewHeight = Math.max(3, rows - chrome - treeHeight);
  const maxScroll = Math.max(0, lineCount - previewHeight);

  // A new file always starts at its first line.
  useEffect(() => setScroll(0), [openPath]);

  // --snapshot and non-terminal runs draw one frame and leave.
  useEffect(() => {
    if (interactive) return;
    const timer = setTimeout(exit, 50);
    return () => clearTimeout(timer);
  }, [interactive, exit]);

  const toggle = (dir: string, open: boolean) => {
    const next = new Set(expanded);
    if (open) next.add(dir);
    else next.delete(dir);
    setExpanded(next);
  };

  useInput(
    (input, key) => {
      if (input === 'q') return exit();
      if (key.tab) return setFocus(focus === 'tree' ? 'preview' : 'tree');

      const up = key.upArrow || input === 'k';
      const down = key.downArrow || input === 'j';

      if (focus === 'preview') {
        const page = Math.max(1, previewHeight - 2);
        if (up) setScroll(Math.max(0, scroll - 1));
        else if (down) setScroll(Math.min(maxScroll, scroll + 1));
        else if (key.pageUp || input === 'b') setScroll(Math.max(0, scroll - page));
        else if (key.pageDown || input === ' ') setScroll(Math.min(maxScroll, scroll + page));
        else if (input === 'g') setScroll(0);
        else if (input === 'G') setScroll(maxScroll);
        else if (key.leftArrow || key.escape) setFocus('tree');
        return;
      }

      if (up) setCursor(Math.max(0, cursor - 1));
      else if (down) setCursor(Math.min(nodes.length - 1, cursor + 1));
      else if (!current) return;
      else if (key.rightArrow || key.return) {
        if (current.isDir) toggle(current.path, true);
        else setFocus('preview');
      } else if (key.leftArrow) {
        if (current.isDir && expanded.has(current.path)) return toggle(current.path, false);
        // Otherwise jump to the parent folder's row.
        for (let i = cursor - 1; i >= 0; i--) {
          if (nodes[i]!.depth < current.depth) return setCursor(i);
        }
      }
    },
    {isActive: interactive},
  );

  const rule = glyph.rule.repeat(cols);
  const title = openPath ? shortPath(path.relative(root, openPath)) : 'PREVIEW';
  const keys =
    focus === 'tree'
      ? '↑↓ move   → open   ← close   tab preview   q quit'
      : '↑↓ scroll   space/b page   g/G ends   tab files   q quit';

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      <Text wrap="truncate-end">
        <Text color={theme.accent} bold> sidecar</Text>
        <Text color={theme.dim}>  {shortPath(root)}</Text>
      </Text>

      <Text color={focus === 'tree' ? theme.accent : theme.dim}> FILES</Text>
      <Tree
        nodes={nodes}
        cursor={cursor}
        expanded={expanded}
        height={treeHeight}
        width={cols}
        focused={focus === 'tree'}
      />

      <Text color={theme.rule}>{rule}</Text>
      <Text wrap="truncate-end">
        <Text color={focus === 'preview' ? theme.accent : theme.dim}> {title}</Text>
        {lineCount > 0 && (
          <Text color={theme.dim}>
            {'  '}
            {scroll + 1}-{Math.min(lineCount, scroll + previewHeight)} of {lineCount}
          </Text>
        )}
      </Text>
      <Preview view={view} scroll={scroll} height={previewHeight} />

      <Text color={theme.rule}>{rule}</Text>
      <Text color={theme.dim} wrap="truncate-end"> {keys}</Text>
    </Box>
  );
}
