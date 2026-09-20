import path from 'node:path';
import {useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useApp, useInput, useStdout} from 'ink';
import {expandGap, loadDiff, type DiffLine, type DiffState} from '../core/diff';
import {readFileView} from '../core/file';
import {changedLines, loadGit, pathKey, type GitState} from '../core/git';
import {highlightLines} from '../core/highlight';
import {visibleNodes} from '../core/tree';
import {ChangeList} from './ChangeList';
import {Divider, Footer, Rule, Tabs} from './Chrome';
import {Diff, viewRows} from './Diff';
import {computeLayout, hitTest, scrollFromThumb, type Half, type View} from './layout';
import {DOUBLE_CLICK_MS, MOUSE_OFF, MOUSE_ON, parseMouse, type MouseEvent} from './mouse';
import {Preview} from './Preview';
import {theme} from './theme';
import {width as textWidth} from './util';
import {Tree} from './Tree';

type Props = {
  root: string;
  interactive: boolean;
  // --mouse-debug: show the last mouse report in the footer. Terminals differ
  // in how they count rows, and this says at a glance whether they agree.
  mouseDebug?: boolean;
};

const NO_MARKS: ReadonlySet<number> = new Set();
const REFRESH_MS = 3000;
const WHEEL_ROWS = 3;
const HSCROLL_STEP = 16;

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
    const timer = live ? setInterval(refresh, REFRESH_MS) : undefined;
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [root, live]);

  return {git, loaded, version};
}

// The diff is only read while the Changes view is open: it costs a `git diff`
// of the whole working tree and nothing else needs it.
function useDiff(root: string, active: boolean, live: boolean) {
  const [diff, setDiff] = useState<DiffState | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    let busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      const next = await loadDiff(root);
      busy = false;
      if (!alive) return;
      setDiff(next);
      setVersion(v => v + 1);
    };

    void refresh();
    const timer = live ? setInterval(refresh, REFRESH_MS) : undefined;
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [root, active, live]);

  return {diff, version};
}

// Keep `cursor` on screen with as little movement as possible.
function follow(scroll: number, cursor: number, height: number, total: number): number {
  const most = Math.max(0, total - height);
  if (cursor < scroll) return Math.min(most, cursor);
  if (cursor >= scroll + height) return Math.min(most, cursor - height + 1);
  return Math.min(most, scroll);
}

export function App({root, interactive, mouseDebug = false}: Props) {
  const {exit} = useApp();
  const {stdout} = useStdout();
  const {cols, rows} = useTerminalSize();
  const {git, loaded, version} = useGit(root, interactive);

  const [view, setView] = useState<View>('files');
  const [focus, setFocus] = useState<Half>('list');
  const [override, setOverride] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [mouse, setMouse] = useState(true);

  // Files view.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [treeScroll, setTreeScroll] = useState(0);
  const [previewScroll, setPreviewScroll] = useState(0);
  const [changedOnly, setChangedOnly] = useState(false);
  const [marks, setMarks] = useState<ReadonlySet<number> | 'all'>(NO_MARKS);

  // Changes view.
  const {diff, version: diffVersion} = useDiff(root, view === 'changes', interactive);
  const [fileIndex, setFileIndex] = useState(0);
  const [listScroll, setListScroll] = useState(0);
  const [rowCursor, setRowCursor] = useState(0);
  const [rowScroll, setRowScroll] = useState(0);
  const [hscroll, setHscroll] = useState(0);
  const [folded, setFolded] = useState<ReadonlySet<number>>(new Set());
  const [opened, setOpened] = useState<ReadonlyMap<number, DiffLine[]>>(new Map());
  const [hideSpace, setHideSpace] = useState(false);

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
  const treeCursor = found >= 0 ? found : 0;
  const current = nodes[treeCursor];
  const openPath = current && !current.isDir ? current.path : null;
  const change = openPath ? git?.changes.get(pathKey(openPath)) : undefined;

  const preview = useMemo(() => (openPath ? readFileView(openPath) : null), [openPath, version]);
  const segments = useMemo(
    () => (openPath && preview?.kind === 'text' ? highlightLines(openPath, preview.lines) : null),
    [openPath, preview],
  );
  const lineCount = preview?.kind === 'text' ? preview.lines.length : 0;

  const files = diff?.files ?? [];
  const file = files[Math.min(fileIndex, Math.max(0, files.length - 1))] ?? null;
  const rowsOfDiff = useMemo(
    () => viewRows(file, folded, opened, hideSpace),
    [file, folded, opened, hideSpace, diffVersion],
  );

  const listCount = view === 'files' ? nodes.length : files.length;
  const layout = computeLayout(cols, rows, listCount, focus, override);
  const changedCount = git ? [...git.changes.values()].filter(c => c.status !== 'D').length : 0;

  // A new file always starts at its first line.
  useEffect(() => setPreviewScroll(0), [openPath]);

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

  // Folds and opened gaps belong to one file's diff. They survive a re-read
  // that found the same diff, and go when the diff itself changes: otherwise
  // the three-second refresh would throw away what you were reading.
  const shape = file ? `${file.rel}:${file.hunks.length}:${file.added}:${file.removed}` : '';
  useEffect(() => {
    setFolded(new Set());
    setOpened(new Map());
    setRowCursor(0);
    setRowScroll(0);
    setHscroll(0);
  }, [shape]);

  // Keep every cursor on screen.
  useEffect(() => {
    setTreeScroll(s => follow(s, treeCursor, layout.listHeight, nodes.length));
  }, [treeCursor, layout.listHeight, nodes.length]);
  useEffect(() => {
    setListScroll(s => follow(s, fileIndex, layout.listHeight, files.length));
  }, [fileIndex, layout.listHeight, files.length]);
  useEffect(() => {
    setRowCursor(c => Math.max(0, Math.min(c, rowsOfDiff.length - 1)));
    setRowScroll(s => follow(s, rowCursor, layout.bodyHeight, rowsOfDiff.length));
  }, [rowCursor, layout.bodyHeight, rowsOfDiff.length]);

  // --snapshot and non-terminal runs wait for git, draw one frame and leave.
  useEffect(() => {
    if (interactive || !loaded) return;
    const timer = setTimeout(exit, 300);
    return () => clearTimeout(timer);
  }, [interactive, loaded, exit]);

  const toggleDir = (dir: string, open: boolean) => {
    const next = new Set(expanded);
    if (open) next.add(dir);
    else next.delete(dir);
    setExpanded(next);
  };

  // Show a file in the Files view, opening every folder above it.
  const reveal = (target: string, line = 0) => {
    const next = new Set(expanded);
    for (let p = path.dirname(target); p.startsWith(root) && p !== root; p = path.dirname(p)) next.add(p);
    setExpanded(next);
    setSelected(target);
    setView('files');
    setFocus(line > 0 ? 'body' : 'list');
    setPreviewScroll(Math.max(0, line - 3));
  };

  const maxPreviewScroll = Math.max(0, lineCount - layout.bodyHeight);
  const maxRowScroll = Math.max(0, rowsOfDiff.length - layout.bodyHeight);

  const hunkAt = (index: number): number => {
    let at = -1;
    for (let i = 0; i <= index && i < rowsOfDiff.length; i++) if (rowsOfDiff[i]!.kind === 'hunk') at++;
    return at;
  };

  const jumpHunk = (direction: 1 | -1) => {
    setFocus('body');
    for (let i = rowCursor + direction; i >= 0 && i < rowsOfDiff.length; i += direction) {
      if (rowsOfDiff[i]!.kind === 'hunk') return setRowCursor(i);
    }

    // Past the last hunk of a file, carry on into the next file: this is the
    // review flow, so holding `n` should walk the whole change set.
    const next = fileIndex + direction;
    if (next >= 0 && next < files.length) {
      setFileIndex(next);
      setNotice('');
    }
  };

  const activate = (index: number) => {
    const row = rowsOfDiff[index];
    if (!row || !file) return;
    if (row.kind === 'hunk') {
      const next = new Set(folded);
      if (next.has(row.hunk)) next.delete(row.hunk);
      else next.add(row.hunk);
      return setFolded(next);
    }

    if (row.kind === 'gap') {
      const lines = expandGap(file, row.hunk);
      if (lines.length === 0) return;
      return setOpened(new Map(opened).set(row.hunk, lines));
    }

  };

  const openInFiles = () => {
    const row = rowsOfDiff[rowCursor];
    if (!file) return;
    const line = row?.kind === 'line' ? (row.line.newNo ?? 0) : 0;
    if (file.status === 'deleted') return setNotice('That file was deleted, so there is nothing to open.');
    reveal(file.path, line);
  };

  // ---- mouse ----------------------------------------------------------------

  const drag = useRef<{what: 'divider' | 'list' | 'body'} | null>(null);
  const lastClick = useRef({x: -1, y: -1, at: 0});

  const scrollHalf = (half: Half, by: number) => {
    if (half === 'list') {
      if (view === 'files') setTreeScroll(s => Math.max(0, Math.min(Math.max(0, nodes.length - layout.listHeight), s + by)));
      else setListScroll(s => Math.max(0, Math.min(Math.max(0, files.length - layout.listHeight), s + by)));
      return;
    }

    if (view === 'files') setPreviewScroll(s => Math.max(0, Math.min(maxPreviewScroll, s + by)));
    else setRowScroll(s => Math.max(0, Math.min(maxRowScroll, s + by)));
  };

  const rowsIn = (half: Half) =>
    half === 'list'
      ? view === 'files'
        ? nodes.length
        : files.length
      : view === 'files'
        ? lineCount
        : rowsOfDiff.length;

  const onMouse = (event: MouseEvent) => {
    let spot = hitTest(layout, event.x, event.y, changedCount);
    // The last column is only a scrollbar when there is something to scroll.
    if (spot.region === 'scrollbar') {
      const height = spot.half === 'list' ? layout.listHeight : layout.bodyHeight;
      if (rowsIn(spot.half) <= height) {
        spot = spot.half === 'list' ? {region: 'list', index: spot.index} : {region: 'body', index: spot.index};
      }
    }
    if (mouseDebug) setNotice(`${event.kind} ${event.button} col ${event.x} row ${event.y} -> ${spot.region}`);

    if (event.kind === 'wheel') {
      const by = event.wheel * WHEEL_ROWS;
      if (spot.region === 'list' || (spot.region === 'scrollbar' && spot.half === 'list')) return scrollHalf('list', by);
      if (spot.region === 'divider') return scrollHalf('body', by);
      return scrollHalf('body', by);
    }

    if (event.kind === 'up') {
      drag.current = null;
      return;
    }

    if (event.kind === 'drag') {
      if (drag.current?.what === 'divider') {
        return setOverride(Math.max(2, Math.min(rows - 8, event.y - layout.listTop)));
      }

      if (drag.current?.what === 'list') {
        const to = scrollFromThumb(rowsIn('list'), layout.listHeight, event.y - layout.listTop);
        return view === 'files' ? setTreeScroll(to) : setListScroll(to);
      }

      if (drag.current?.what === 'body') {
        const to = scrollFromThumb(rowsIn('body'), layout.bodyHeight, event.y - layout.bodyTop);
        return view === 'files' ? setPreviewScroll(to) : setRowScroll(to);
      }

      return;
    }

    if (event.kind !== 'down' || event.button !== 'left') return;

    const now = Date.now();
    const twice =
      now - lastClick.current.at < DOUBLE_CLICK_MS &&
      lastClick.current.x === event.x &&
      lastClick.current.y === event.y;
    lastClick.current = {x: event.x, y: event.y, at: now};
    if (notice && !mouseDebug) setNotice('');

    switch (spot.region) {
      case 'tabs':
        if (spot.tab) setView(spot.tab);
        return;

      case 'divider':
        if (twice) return setOverride(null);
        drag.current = {what: 'divider'};
        return;

      case 'scrollbar': {
        drag.current = {what: spot.half};
        const total = rowsIn(spot.half);
        const height = spot.half === 'list' ? layout.listHeight : layout.bodyHeight;
        const to = scrollFromThumb(total, height, spot.index);
        if (spot.half === 'list') return view === 'files' ? setTreeScroll(to) : setListScroll(to);
        return view === 'files' ? setPreviewScroll(to) : setRowScroll(to);
      }

      case 'list': {
        setFocus('list');
        if (view === 'files') {
          const node = nodes[treeScroll + spot.index];
          if (!node) return;
          setSelected(node.path);
          if (node.isDir && !changedOnly) toggleDir(node.path, !node.open);
          else if (twice && !node.isDir) setFocus('body');
          return;
        }

        const at = listScroll + spot.index;
        if (at < files.length) setFileIndex(at);
        return;
      }

      case 'body': {
        setFocus('body');
        if (view === 'files') return;
        const at = rowScroll + spot.index;
        if (at >= rowsOfDiff.length) return;
        setRowCursor(at);
        const row = rowsOfDiff[at]!;
        // Headers and gaps are buttons: one click does the obvious thing.
        if (row.kind === 'hunk' || row.kind === 'gap') activate(at);
        else if (twice) openInFiles();
        return;
      }

      default:
        return;
    }
  };

  // ---- keys -----------------------------------------------------------------

  useInput(
    (input, key) => {
      const event = parseMouse(input);
      if (event) return mouse ? onMouse(event) : undefined;

      if (notice) setNotice('');
      if (input === 'q') return exit();
      if (input === '1') return setView('files');
      if (input === '2') return setView('changes');
      if (input === 'm') {
        stdout.write(mouse ? MOUSE_OFF : MOUSE_ON);
        setMouse(!mouse);
        return setNotice(
          mouse ? 'Mouse off. Select and copy freely. Press m to turn it back on.' : 'Mouse on.',
        );
      }

      if (key.tab) return setFocus(focus === 'list' ? 'body' : 'list');

      const up = key.upArrow || input === 'k';
      const down = key.downArrow || input === 'j';
      const page = Math.max(1, layout.bodyHeight - 2);

      if (view === 'files') {
        if (focus === 'body') {
          if (up) setPreviewScroll(Math.max(0, previewScroll - 1));
          else if (down) setPreviewScroll(Math.min(maxPreviewScroll, previewScroll + 1));
          else if (key.pageUp || input === 'b') setPreviewScroll(Math.max(0, previewScroll - page));
          else if (key.pageDown || input === ' ') setPreviewScroll(Math.min(maxPreviewScroll, previewScroll + page));
          else if (input === 'g') setPreviewScroll(0);
          else if (input === 'G') setPreviewScroll(maxPreviewScroll);
          else if (key.leftArrow || key.escape) setFocus('list');
          return;
        }

        if (input === 'c') {
          if (!git) return setNotice('Not a git repo, so there are no changes to filter by.');
          return setChangedOnly(!changedOnly);
        }

        if (up) setSelected(nodes[Math.max(0, treeCursor - 1)]?.path ?? null);
        else if (down) setSelected(nodes[Math.min(nodes.length - 1, treeCursor + 1)]?.path ?? null);
        else if (!current) return;
        else if (key.rightArrow || key.return) {
          if (!current.isDir) setFocus('body');
          else if (!changedOnly) toggleDir(current.path, !current.open);
        } else if (key.leftArrow) {
          if (current.isDir && current.open && !changedOnly) return toggleDir(current.path, false);
          for (let i = treeCursor - 1; i >= 0; i--) {
            if (nodes[i]!.depth < current.depth) return setSelected(nodes[i]!.path);
          }
        }

        return;
      }

      // Changes view.
      if (input === 'n') return jumpHunk(1);
      if (input === 'N') return jumpHunk(-1);
      if (input === ']') return setFileIndex(Math.min(files.length - 1, fileIndex + 1));
      if (input === '[') return setFileIndex(Math.max(0, fileIndex - 1));
      if (input === 'w') {
        setHideSpace(!hideSpace);
        return setNotice(hideSpace ? 'Showing whitespace changes.' : 'Hiding whitespace-only changes.');
      }

      if (focus === 'list') {
        if (up) setFileIndex(Math.max(0, fileIndex - 1));
        else if (down) setFileIndex(Math.min(files.length - 1, fileIndex + 1));
        else if (input === 'g') setFileIndex(0);
        else if (input === 'G') setFileIndex(Math.max(0, files.length - 1));
        else if (key.rightArrow || key.return) setFocus('body');
        return;
      }

      if (up) setRowCursor(Math.max(0, rowCursor - 1));
      else if (down) setRowCursor(Math.min(rowsOfDiff.length - 1, rowCursor + 1));
      else if (key.pageUp || input === 'b') setRowCursor(Math.max(0, rowCursor - page));
      else if (key.pageDown || input === ' ') setRowCursor(Math.min(rowsOfDiff.length - 1, rowCursor + page));
      else if (input === 'g') setRowCursor(0);
      else if (input === 'G') setRowCursor(Math.max(0, rowsOfDiff.length - 1));
      else if (input === 'h') setHscroll(Math.max(0, hscroll - HSCROLL_STEP));
      else if (input === 'l') setHscroll(hscroll + HSCROLL_STEP);
      else if (input === '0') setHscroll(0);
      else if (input === 'z') {
        const all = file?.hunks.map((_, i) => i) ?? [];
        setFolded(folded.size === all.length ? new Set() : new Set(all));
      } else if (input === 'o') openInFiles();
      else if (key.return) activate(rowCursor);
      else if (key.leftArrow || key.escape) setFocus('list');
    },
    {isActive: interactive},
  );

  // ---- render ---------------------------------------------------------------

  const project = path.basename(root);
  const filesFooter =
    focus === 'list'
      ? '↑↓ move  enter open  c changed  2 changes  q quit'
      : '↑↓ scroll  space page  g/G ends  esc back  q quit';
  const changesFooter =
    focus === 'list'
      ? '↑↓ file  enter diff  n/N hunk  1 files  q quit'
      : '↑↓ line  n/N hunk  ]/[ file  enter fold  o open  esc back  q quit';
  // Hints are added while they fit, so a narrow pane keeps the ones that matter.
  const extras =
    view === 'changes' && focus === 'body'
      ? ['z fold all', 'w whitespace', 'm mouse', 'shift-drag selects']
      : ['m mouse', 'shift-drag selects'];
  let hints = view === 'files' ? filesFooter : changesFooter;
  for (const hint of extras) {
    if (textWidth(hints) + 2 + textWidth(hint) > cols - 2) break;
    hints += `  ${hint}`;
  }

  const previewPosition =
    lineCount > 0
      ? `${previewScroll + 1}-${Math.min(lineCount, previewScroll + layout.bodyHeight)} of ${lineCount}`
      : '';

  const note = (): {note?: string; noteColor?: string} => {
    if (!file) return {};
    if (file.binary) return {note: 'binary'};
    if (file.status === 'added') return {note: 'new file', noteColor: theme.add};
    if (file.status === 'deleted') return {note: 'deleted', noteColor: theme.del};
    if (file.status === 'renamed' && file.fromRel) return {note: `from ${file.fromRel}`, noteColor: theme.link};
    if (file.spaceOnly) return {note: 'whitespace only', noteColor: theme.warn};
    return {};
  };

  const hunkCount = file?.hunks.length ?? 0;
  const diffPosition =
    rowsOfDiff.length === 0
      ? ''
      : `${hunkCount > 1 ? `hunk ${Math.max(1, hunkAt(rowCursor) + 1)}/${hunkCount}  ` : ''}${
          rowScroll + 1
        }-${Math.min(rowsOfDiff.length, rowScroll + layout.bodyHeight)} of ${rowsOfDiff.length}`;

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      <Tabs
        view={view}
        changedCount={changedCount}
        project={project}
        branch={git ? git.branch : loaded ? 'no git' : ''}
        cols={cols}
        filtered={view === 'files' && changedOnly}
      />
      <Rule cols={cols} />

      {view === 'files' ? (
        <>
          <Tree
            nodes={nodes}
            cursor={treeCursor}
            scroll={treeScroll}
            changes={git?.changes ?? null}
            height={layout.listHeight}
            width={cols}
            focused={focus === 'list'}
            emptyMessage={changedOnly ? 'Nothing has changed since the last commit.' : 'This folder is empty.'}
          />
          <Divider
            cols={cols}
            label={current ? path.relative(root, current.path).split(path.sep).join('/') : 'Nothing selected'}
            right={previewPosition}
            focused={focus === 'body'}
          />
          <Preview
            view={preview}
            message={
              current?.isDir
                ? changedOnly
                  ? 'A folder.'
                  : `A folder. Press Enter to ${current.open ? 'close' : 'open'} it.`
                : 'Move onto a file to preview it here.'
            }
            segments={segments}
            marks={marks}
            scroll={previewScroll}
            height={layout.bodyHeight}
            cols={cols}
          />
        </>
      ) : (
        <>
          <ChangeList
            files={files}
            cursor={fileIndex}
            scroll={listScroll}
            cols={cols}
            height={layout.listHeight}
            focused={focus === 'list'}
            empty={
              diff === null
                ? 'This folder is not a git repo.'
                : `Nothing has changed since the last commit${git?.branch ? ` on ${git.branch}` : ''}.`
            }
          />
          <Divider
            cols={cols}
            label={file ? file.rel : 'No file'}
            right={diffPosition}
            focused={focus === 'body'}
            {...note()}
          />
          <Diff
            rows={rowsOfDiff}
            scroll={rowScroll}
            cursor={rowCursor}
            hscroll={hscroll}
            cols={cols}
            height={layout.bodyHeight}
            focused={focus === 'body'}
            message={
              diff === null
                ? 'Sidecar compares files with the last commit, so there is\nnothing to compare yet.'
                : 'When Claude edits a file it shows up here.'
            }
          />
        </>
      )}

      <Rule cols={cols} />
      <Footer
        cols={cols}
        text={hints}
        notice={notice}
      />
    </Box>
  );
}
