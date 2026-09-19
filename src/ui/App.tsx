import os from 'node:os';
import path from 'node:path';
import {useEffect, useMemo, useState} from 'react';
import {Box, Text, useApp, useInput, useStdout} from 'ink';
import {readFileView} from '../core/file';
import {changedLines, loadGit, pathKey, type GitState} from '../core/git';
import {highlightLines} from '../core/highlight';
import {visibleNodes} from '../core/tree';
import {Preview} from './Preview';
import {Tree} from './Tree';
import {glyph, theme} from './theme';

type Focus = 'tree' | 'preview';

type Props = {
  root: string;
  interactive: boolean;
};

const NO_MARKS: ReadonlySet<number> = new Set();
const GIT_REFRESH_MS = 3000;

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

// Git state, re-read on a timer. `version` ticks on every read so the tree
// also notices files that appeared or vanished.
function useGit(root: string, live: boolean) {
  const [git, setGit] = useState<GitState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      const next = await loadGit(root);
      busy = false;
      if (!alive) return;
      setGit(next);
      setLoaded(true);
      setVersion(v => v + 1);
    };

    void refresh();
    const timer = live ? setInterval(refresh, GIT_REFRESH_MS) : undefined;
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [root, live]);

  return {git, loaded, version};
}

export function App({root, interactive}: Props) {
  const {exit} = useApp();
  const {cols, rows} = useTerminalSize();
  const {git, loaded, version} = useGit(root, interactive);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>('tree');
  const [scroll, setScroll] = useState(0);
  const [changedOnly, setChangedOnly] = useState(false);
  const [notice, setNotice] = useState('');
  const [marks, setMarks] = useState<ReadonlySet<number> | 'all'>(NO_MARKS);

  // Changed files plus every folder above them, for the "changed only" filter.
  const only = useMemo(() => {
    if (!changedOnly || !git) return undefined;
    const rootKey = pathKey(root);
    const keep = new Set<string>();
    for (const [file, change] of git.changes) {
      if (change.status === 'D' || !file.startsWith(rootKey + path.sep)) continue;
      for (let p = file; p.length > rootKey.length; p = path.dirname(p)) keep.add(p);
    }

    return keep;
  }, [changedOnly, git, root]);

  const nodes = useMemo(() => visibleNodes(root, expanded, only), [root, expanded, only, version]);
  const found = nodes.findIndex(node => node.path === selected);
  const cursor = found >= 0 ? found : 0;
  const current = nodes[cursor];
  const openPath = current && !current.isDir ? current.path : null;
  const change = openPath ? git?.changes.get(pathKey(openPath)) : undefined;

  const view = useMemo(() => (openPath ? readFileView(openPath) : null), [openPath, version]);
  const segments = useMemo(
    () => (openPath && view?.kind === 'text' ? highlightLines(openPath, view.lines) : null),
    [openPath, view],
  );
  const lineCount = view?.kind === 'text' ? view.lines.length : 0;

  // title, rule, rule, preview header, rule, footer (+ the filter line)
  const chrome = 6 + (changedOnly ? 1 : 0);
  const space = Math.max(8, rows - chrome);
  const treeHeight = focus === 'tree' ? Math.max(4, Math.min(space - 3, Math.floor(space * 0.55))) : Math.min(5, space - 3);
  const previewHeight = space - treeHeight;
  const maxScroll = Math.max(0, lineCount - previewHeight);

  // A new file always starts at its first line.
  useEffect(() => setScroll(0), [openPath]);

  // Which lines of the open file differ from the last commit.
  useEffect(() => {
    if (!openPath || !change) return setMarks(NO_MARKS);
    let alive = true;
    void changedLines(root, openPath, change).then(next => {
      if (alive) setMarks(next);
    });
    return () => {
      alive = false;
    };
  }, [root, openPath, change]);

  // --snapshot and non-terminal runs wait for git, draw one frame and leave.
  useEffect(() => {
    if (interactive || !loaded) return;
    const timer = setTimeout(exit, 300);
    return () => clearTimeout(timer);
  }, [interactive, loaded, exit]);

  const toggle = (dir: string, open: boolean) => {
    const next = new Set(expanded);
    if (open) next.add(dir);
    else next.delete(dir);
    setExpanded(next);
  };

  useInput(
    (input, key) => {
      if (notice) setNotice('');
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

      if (input === 'c') {
        if (!git) return setNotice('Not a git repo, so there are no changes to filter by.');
        return setChangedOnly(!changedOnly);
      }

      if (up) setSelected(nodes[Math.max(0, cursor - 1)]?.path ?? null);
      else if (down) setSelected(nodes[Math.min(nodes.length - 1, cursor + 1)]?.path ?? null);
      else if (!current) return;
      else if (key.rightArrow || key.return) {
        if (!current.isDir) setFocus('preview');
        else if (!changedOnly) toggle(current.path, !current.open);
      } else if (key.leftArrow) {
        if (current.isDir && current.open && !changedOnly) return toggle(current.path, false);
        // Otherwise jump to the parent folder's row.
        for (let i = cursor - 1; i >= 0; i--) {
          if (nodes[i]!.depth < current.depth) return setSelected(nodes[i]!.path);
        }
      }
    },
    {isActive: interactive},
  );

  const rule = glyph.rule.repeat(cols);
  const crumb = current ? path.relative(root, current.path).split(path.sep).join(' / ') : 'Nothing selected';
  const position =
    lineCount > 0 ? `${scroll + 1}-${Math.min(lineCount, scroll + previewHeight)} of ${lineCount}` : '';
  const folderHint = current?.isDir
    ? changedOnly
      ? 'A folder.'
      : `A folder. Press Enter to ${current.open ? 'close' : 'open'} it.`
    : 'Move onto a file to preview it here.';
  const keys =
    focus === 'tree'
      ? '↑↓ move   enter open   c changed only   q quit'
      : '↑↓ scroll   space page   g/G ends   esc back   q quit';

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      <Text wrap="truncate-end">
        <Text color={theme.accent} bold> sidecar</Text>
        <Text color={theme.dim}>  {shortPath(root)}</Text>
        <Text color={theme.dim}>  {git ? git.branch : loaded ? 'no git' : ''}</Text>
      </Text>
      <Text color={theme.rule}>{rule}</Text>

      {changedOnly && <Text color={theme.warn}> changed files only</Text>}
      <Tree
        nodes={nodes}
        cursor={cursor}
        changes={git?.changes ?? null}
        height={treeHeight}
        width={cols}
        focused={focus === 'tree'}
        emptyMessage={changedOnly ? 'Nothing has changed since the last commit.' : 'This folder is empty.'}
      />

      <Text color={theme.rule}>{rule}</Text>
      <Box justifyContent="space-between" width={cols}>
        <Text wrap="truncate-end" color={focus === 'preview' ? theme.accent : theme.dim}> {crumb}</Text>
        <Text color={theme.dim}>{position} </Text>
      </Box>
      <Preview
        view={view}
        message={folderHint}
        segments={segments}
        marks={marks}
        scroll={scroll}
        height={previewHeight}
      />

      <Text color={theme.rule}>{rule}</Text>
      <Text color={notice ? theme.warn : theme.dim} wrap="truncate-end"> {notice || keys}</Text>
    </Box>
  );
}
