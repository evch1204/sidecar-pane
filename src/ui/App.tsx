import path from 'node:path';
import {useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useApp, useInput, useStdout} from 'ink';
import {expandGap, loadDiff, type DiffLine, type DiffState} from '../core/diff';
import {newReadState, readSessions} from '../core/sessions';
import {openStore, take, type Store} from '../core/snapshot';
import {byFile, fileInTurn, loadTurns, type TurnChange} from '../core/turns';
import {readFileView} from '../core/file';
import {changedLines, loadGit, pathKey, type GitState} from '../core/git';
import {highlightLines} from '../core/highlight';
import {visibleNodes} from '../core/tree';
import {ChangeList} from './ChangeList';
import {Divider, Footer, Rule, Tabs} from './Chrome';
import {Diff, viewRows, type DiffGroup} from './Diff';
import {computeLayout, hitTest, scrollFromThumb, type Half, type View} from './layout';
import {DOUBLE_CLICK_MS, MOUSE_OFF, MOUSE_ON, parseMouse, type MouseEvent} from './mouse';
import {Preview} from './Preview';
import {theme} from './theme';
import {TurnList} from './TurnList';
import {clock, fileRows, targetOf, turnKey, turnRows, type ListRow, type Target} from './turnrows';
import {width as textWidth} from './util';
import {Tree} from './Tree';
import {Why, whyRows} from './Why';

type Group = 'turn' | 'file' | 'flat';

const GROUP_NOTE: Record<Group, string> = {
  turn: 'by turn',
  file: 'by file',
  flat: 'all changes',
};

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

// Chats, their turns, and a snapshot of the project taken every time the
// session moves. The transcript says which prompt; the snapshots say which
// lines. Only the Changes view needs either.
function useHistory(root: string, active: boolean, live: boolean) {
  const reader = useRef(newReadState());
  const store = useRef<Store | null>(null);
  const [changes, setChanges] = useState<TurnChange[]>([]);
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!active) return;
    store.current ??= openStore(root);
    let alive = true;
    let busy = false;

    const tick = async () => {
      if (busy) return;
      busy = true;
      const now = Date.now();
      const sessions = readSessions(root, reader.current);
      if (store.current) await take(store.current, root, now);
      const next = await loadTurns(root, store.current, sessions, now);
      busy = false;
      if (!alive) return;
      setChanges(next);
      setLoadedAt(now);
      setVersion(v => v + 1);
    };

    void tick();
    const timer = live ? setInterval(tick, REFRESH_MS) : undefined;
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [root, active, live]);

  return {changes, store: store.current, loadedAt, version};
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
  const {changes, store, loadedAt, version: histVersion} = useHistory(root, view === 'changes', interactive);
  const [group, setGroup] = useState<Group>('turn');
  const [chat, setChat] = useState<string | null>(null);
  const [openTurns, setOpenTurns] = useState<ReadonlySet<string>>(new Set());
  const [showAll, setShowAll] = useState<ReadonlySet<string>>(new Set());
  const [openFiles, setOpenFiles] = useState<ReadonlySet<string>>(new Set());
  const [groups, setGroups] = useState<DiffGroup[]>([]);
  const [fileIndex, setFileIndex] = useState(0);
  const [listScroll, setListScroll] = useState(0);
  const [rowCursor, setRowCursor] = useState(0);
  const [rowScroll, setRowScroll] = useState(0);
  const [hscroll, setHscroll] = useState(0);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<ReadonlyMap<string, DiffLine[]>>(new Map());
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
  const flatFile = files[Math.min(fileIndex, Math.max(0, files.length - 1))] ?? null;

  // One chat at a time, or all of them.
  const mine = useMemo(() => (chat ? changes.filter(c => c.chatId === chat) : changes), [changes, chat]);
  const histories = useMemo(() => byFile(mine), [mine]);
  const listRows: ListRow[] = useMemo(() => {
    if (group === 'turn') return turnRows(mine, openTurns, showAll, loadedAt);
    if (group === 'file') return fileRows(histories, openFiles);
    return [];
  }, [group, mine, histories, openTurns, showAll, openFiles, loadedAt]);

  const listLength = group === 'flat' ? files.length : listRows.length;
  // Section headers are labels, not rows you can act on, so the cursor steps
  // over them rather than stopping on one.
  const pickable = (at: number): boolean => group === 'flat' || listRows[at]?.kind !== 'section';
  const settle = (at: number, dir: 1 | -1): number => {
    for (let i = at; i >= 0 && i < listLength; i += dir) if (pickable(i)) return i;
    for (let i = at; i >= 0 && i < listLength; i -= dir) if (pickable(i)) return i;
    return at;
  };

  const listCursor = settle(Math.min(fileIndex, Math.max(0, listLength - 1)), 1);
  const target: Target = group === 'flat' ? {kind: 'none'} : targetOf(listRows[listCursor]);

  // What the body is showing, as one string, so it only reloads when it moves.
  const targetKey =
    group === 'flat'
      ? `flat:${flatFile?.rel ?? ''}`
      : target.kind === 'file'
        ? `file:${target.change ? turnKey(target.change) : 'git'}:${target.rel}`
        : target.kind === 'history'
          ? `hist:${target.history.rel}:${target.history.touches.length}`
          : target.kind === 'why'
            ? `why:${turnKey(target.change)}`
            : 'none';

  useEffect(() => {
    let alive = true;
    const build = async () => {
      if (group === 'flat') {
        return alive && setGroups(flatFile ? [{key: 'flat', band: null, file: flatFile}] : []);
      }

      if (target.kind === 'file') {
        if (target.change?.measured && store) {
          const one = await fileInTurn(root, store, target.change, target.rel);
          if (alive) {
            setGroups(
              one
                ? [{key: 'turn', band: null, file: one}]
                : [{key: 'none', band: null, file: null, note: 'That turn left no diff for this file.'}],
            );
          }

          return;
        }

        const found = diff?.files[diff.index.get(pathKey(target.path)) ?? -1] ?? null;
        if (alive) {
          setGroups(
            found
              ? [{key: 'git', band: null, file: found}]
              : [{key: 'none', band: null, file: null, note: 'Nothing to show: this file matches the last commit.'}],
          );
        }

        return;
      }

      if (target.kind === 'history') {
        // One band per turn that touched the file, newest first.
        const out: DiffGroup[] = [];
        for (const touch of [...target.history.touches].reverse()) {
          if (!touch.change.measured || !store) continue;
          const one = await fileInTurn(root, store, touch.change, target.history.rel);
          if (!one) continue;
          out.push({
            key: turnKey(touch.change),
            band: {
              time: clock(touch.change.turn.at),
              prompt: touch.change.turn.prompt,
              added: touch.added,
              removed: touch.removed,
              measured: true,
            },
            file: one,
          });
        }

        if (out.length === 0) {
          const found = diff?.files[diff.index.get(pathKey(target.history.path)) ?? -1] ?? null;
          if (found) {
            out.push({
              key: 'git',
              band: null,
              file: found,
              note: 'Not recorded turn by turn. This is everything since the last commit.',
            });
          }
        }

        if (alive) setGroups(out);
        return;
      }

      if (alive) setGroups([]);
    };

    void build();
    return () => {
      alive = false;
    };
  }, [targetKey, histVersion, diffVersion, group]);

  const rowsOfDiff = useMemo(
    () => viewRows(groups, folded, opened, hideSpace),
    [groups, folded, opened, hideSpace],
  );
  const why = useMemo(
    () => (target.kind === 'why' ? whyRows(target.change, cols) : []),
    [targetKey, cols, histVersion],
  );
  const bodyCount = target.kind === 'why' ? why.length : rowsOfDiff.length;

  const listCount = view === 'files' ? nodes.length : listLength;
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
  const shape = groups.map(g => `${g.key}:${g.file?.hunks.length ?? 0}:${g.file?.added ?? 0}`).join('|');
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
    setListScroll(s => follow(s, listCursor, layout.listHeight, listLength));
  }, [listCursor, layout.listHeight, listLength]);
  useEffect(() => {
    setRowCursor(c => Math.max(0, Math.min(c, bodyCount - 1)));
    setRowScroll(s => follow(s, rowCursor, layout.bodyHeight, bodyCount));
  }, [rowCursor, layout.bodyHeight, bodyCount]);

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
  const maxRowScroll = Math.max(0, bodyCount - layout.bodyHeight);

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

    // Past the last hunk, carry on to the next row of the list: this is the
    // review flow, so holding `n` should walk the whole change set.
    const next = listCursor + direction;
    if (next >= 0 && next < listLength) {
      setFileIndex(next);
      setNotice('');
    }
  };

  const activate = (index: number) => {
    const row = rowsOfDiff[index];
    if (!row) return;
    if (row.kind === 'hunk' || row.kind === 'gap') {
      const owner = groups[row.group];
      if (!owner?.file) return;
      const key = `${owner.key}:${row.hunk}`;
      if (row.kind === 'hunk') {
        const next = new Set(folded);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return setFolded(next);
      }

      const lines = expandGap(owner.file, row.hunk);
      if (lines.length === 0) return;
      return setOpened(new Map(opened).set(key, lines));
    }
  };

  // Enter on a row of the list: open a turn, show every file, or go to the diff.
  const openRow = (at: number = listCursor) => {
    const row = listRows[at];
    if (!row) return setFocus('body');
    if (row.kind === 'turn') {
      const key = turnKey(row.change);
      const next = new Set(openTurns);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return setOpenTurns(next);
    }

    if (row.kind === 'fileHead') {
      const next = new Set(openFiles);
      if (next.has(row.history.rel)) next.delete(row.history.rel);
      else next.add(row.history.rel);
      return setOpenFiles(next);
    }

    if (row.kind === 'more') {
      const next = new Set(showAll);
      next.add(row.owner);
      return setShowAll(next);
    }

    return setFocus('body');
  };

  const bodyFile = (): {path: string; deleted: boolean} | null => {
    if (group === 'flat') return flatFile ? {path: flatFile.path, deleted: flatFile.status === 'deleted'} : null;
    if (target.kind === 'file') return {path: target.path, deleted: false};
    if (target.kind === 'history') return {path: target.history.path, deleted: target.history.status === 'deleted'};
    return null;
  };

  const openInFiles = () => {
    const where = bodyFile();
    if (!where) return setNotice('Move onto a file first.');
    const row = rowsOfDiff[rowCursor];
    const line = row?.kind === 'line' ? (row.line.newNo ?? 0) : 0;
    if (where.deleted) return setNotice('That file was deleted, so there is nothing to open.');
    reveal(where.path, line);
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
        if (at >= listLength) return;
        setFileIndex(at);
        if (group === 'flat') return;
        const row = listRows[at];
        if (row?.kind === 'section') return;
        // A turn, a file group and a "… more" row are buttons.
        if (row && (row.kind === 'turn' || row.kind === 'fileHead' || row.kind === 'more')) openRow(at);
        else if (twice) setFocus('body');
        return;
      }

      case 'body': {
        setFocus('body');
        if (view === 'files' || target.kind === 'why') return;
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
      if (input === 'v') {
        const next: Group = group === 'turn' ? 'file' : group === 'file' ? 'flat' : 'turn';
        setGroup(next);
        setFileIndex(0);
        return setNotice(next === 'flat' ? 'Showing every change since the last commit.' : `Grouped ${GROUP_NOTE[next]}.`);
      }

      if (input === 's') {
        const ids = [...new Set(changes.map(c => c.chatId))];
        if (ids.length < 2) return setNotice('Only one chat has touched this project.');
        const at = chat ? ids.indexOf(chat) : -1;
        const next = at + 1 >= ids.length ? null : ids[at + 1]!;
        setChat(next);
        setFileIndex(0);
        const title = changes.find(c => c.chatId === next)?.chat;
        return setNotice(next ? `Showing "${title}".` : 'Showing every chat.');
      }

      if (input === 'n') return jumpHunk(1);
      if (input === 'N') return jumpHunk(-1);
      if (input === ']') return setFileIndex(settle(Math.min(listLength - 1, listCursor + 1), 1));
      if (input === '[') return setFileIndex(settle(Math.max(0, listCursor - 1), -1));
      if (input === 'w') {
        setHideSpace(!hideSpace);
        return setNotice(hideSpace ? 'Showing whitespace changes.' : 'Hiding whitespace-only changes.');
      }

      if (focus === 'list') {
        if (up) setFileIndex(settle(Math.max(0, listCursor - 1), -1));
        else if (down) setFileIndex(settle(Math.min(listLength - 1, listCursor + 1), 1));
        else if (input === 'g') setFileIndex(settle(0, 1));
        else if (input === 'G') setFileIndex(settle(Math.max(0, listLength - 1), -1));
        else if (key.return) openRow();
        else if (key.rightArrow) setFocus('body');
        return;
      }

      if (up) setRowCursor(Math.max(0, rowCursor - 1));
      else if (down) setRowCursor(Math.min(bodyCount - 1, rowCursor + 1));
      else if (key.pageUp || input === 'b') setRowCursor(Math.max(0, rowCursor - page));
      else if (key.pageDown || input === ' ') setRowCursor(Math.min(bodyCount - 1, rowCursor + page));
      else if (input === 'g') setRowCursor(0);
      else if (input === 'G') setRowCursor(Math.max(0, bodyCount - 1));
      else if (input === 'h') setHscroll(Math.max(0, hscroll - HSCROLL_STEP));
      else if (input === 'l') setHscroll(hscroll + HSCROLL_STEP);
      else if (input === '0') setHscroll(0);
      else if (input === 'z') {
        const all = groups.flatMap(g => (g.file?.hunks ?? []).map((_, i) => `${g.key}:${i}`));
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
      ? '↑↓ move  enter open  → diff  v group  s chat  q quit'
      : '↑↓ line  n/N hunk  enter fold  o open  esc back  q quit';
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

  // What the divider over the body says.
  const head = (): {label: string; note?: string; noteColor?: string} => {
    if (group === 'flat') {
      if (!flatFile) return {label: 'No file'};
      if (flatFile.binary) return {label: flatFile.rel, note: 'binary'};
      if (flatFile.status === 'added') return {label: flatFile.rel, note: 'new file', noteColor: theme.add};
      if (flatFile.status === 'deleted') return {label: flatFile.rel, note: 'deleted', noteColor: theme.del};
      if (flatFile.status === 'renamed' && flatFile.fromRel) {
        return {label: flatFile.rel, note: `from ${flatFile.fromRel}`, noteColor: theme.link};
      }

      if (flatFile.spaceOnly) return {label: flatFile.rel, note: 'whitespace only', noteColor: theme.warn};
      return {label: flatFile.rel};
    }

    if (target.kind === 'why') {
      return {
        label: `${clock(target.change.turn.at)}  ${target.change.turn.prompt}`,
        note: target.change.running ? 'running' : 'why',
        noteColor: target.change.running ? theme.warn : theme.dim,
      };
    }

    if (target.kind === 'file') {
      return {
        label: target.rel,
        note: target.change?.measured ? clock(target.change.turn.at) : 'since the last commit',
        noteColor: target.change?.measured ? theme.accent : theme.dim,
      };
    }

    if (target.kind === 'history') {
      const n = target.history.touches.length;
      return {label: target.history.rel, note: `${n} turn${n === 1 ? '' : 's'}`, noteColor: theme.link};
    }

    return {label: listRows.length === 0 ? 'Nothing yet' : 'No file'};
  };

  const hunkCount = groups.reduce((n, g) => n + (g.file?.hunks.length ?? 0), 0);
  const diffPosition =
    bodyCount === 0
      ? ''
      : `${target.kind !== 'why' && hunkCount > 1 ? `hunk ${Math.max(1, hunkAt(rowCursor) + 1)}/${hunkCount}  ` : ''}${
          rowScroll + 1
        }-${Math.min(bodyCount, rowScroll + layout.bodyHeight)} of ${bodyCount}`;

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      <Tabs
        view={view}
        changedCount={changedCount}
        project={project}
        branch={git ? git.branch : loaded ? 'no git' : ''}
        cols={cols}
        filtered={view === 'files' && changedOnly}
        note={view === 'changes' ? GROUP_NOTE[group] : undefined}
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
          {group === 'flat' ? (
            <ChangeList
              files={files}
              cursor={listCursor}
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
          ) : (
            <TurnList
              rows={listRows}
              cursor={listCursor}
              scroll={listScroll}
              cols={cols}
              height={layout.listHeight}
              focused={focus === 'list'}
              empty={
                changes.length === 0
                  ? 'No Claude chats have touched this project yet.'
                  : 'Nothing changed in these turns.'
              }
            />
          )}
          <Divider cols={cols} right={diffPosition} focused={focus === 'body'} {...head()} />
          {target.kind === 'why' ? (
            <Why rows={why} scroll={rowScroll} cols={cols} height={layout.bodyHeight} />
          ) : (
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
                  : group === 'flat'
                    ? 'When Claude edits a file it shows up here.'
                    : 'Move onto a turn to see why, or a file to see the diff.'
              }
            />
          )}
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
