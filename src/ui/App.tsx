import path from 'node:path';
import {useEffect, useMemo, useRef, useState} from 'react';
import {useApp, useInput, useStdout} from 'ink';
import {newAgentState, readAgents, type AgentRun} from '../core/agents';
import {expandGap, loadDiff, type DiffLine, type DiffState} from '../core/diff';
import {readFileView, type FileView} from '../core/file';
import {changedLines, loadGit, pathKey, type GitState} from '../core/git';
import {highlightLines} from '../core/highlight';
import {formatMarkdown, isMarkdown} from '../core/markdown';
import {newReadState, readSessions} from '../core/sessions';
import {openStore, take, type Store} from '../core/snapshot';
import {visibleNodes} from '../core/tree';
import {byFile, fileInTurn, loadTurns, type TurnChange} from '../core/turns';
import {newUsageState, readLimits, readSpends, type Limits, type Spend} from '../core/usage';
import {dimmed, overlay, seg, sp, type Act, type Group, type Line, type Seg, type View} from './cells';
import type {DiffGroup} from './diffrows';
import {follow, scrollFromThumb, thumb} from './layout';
import {footer, menuBar, menuBox, menus, tabRow, type Command} from './menu';
import {DOUBLE_CLICK_MS, MOUSE_OFF, MOUSE_ON, parseMouse, type MouseEvent} from './mouse';
import {Screen} from './Screen';
import {glyph, theme} from './theme';
import {agentsLines, runningAgents} from './views/agents';
import {changesLines, changesSummary, spinner, turnKey, type Open} from './views/changes';
import {changedPlaces, filesLines, lineId, nodeId, PEEK_ROWS, readerHead, readerLines, type Marks} from './views/files';
import {usageExtras, usageLines} from './views/usage';

type Props = {
  root: string;
  interactive: boolean;
  // --mouse-debug: show the last mouse report in the footer. Terminals differ
  // in how they count rows, and this says at a glance whether they agree.
  mouseDebug?: boolean;
};

// Each of these keeps its own cursor and scroll position.
type Slot = View | 'reader';

const NO_MARKS: ReadonlySet<number> = new Set();
const REFRESH_MS = 3000;
const SPIN_MS = 250;
const WHEEL_ROWS = 3;
const GROUPS: Group[] = ['turn', 'file', 'flat'];
const GROUP_NOTE: Record<Group, string> = {turn: 'by turn', file: 'by file', flat: 'all changes'};

const NONE: ReadonlySet<string> = new Set();
const CLOSED: Open = {turns: NONE, files: NONE, more: NONE, steps: NONE, says: NONE, agents: NONE, hists: NONE};

function flipped(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
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

// Run `work` now and then every few seconds, never two at once.
function usePolling(work: () => Promise<void>, deps: unknown[], active: boolean, live: boolean) {
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let busy = false;
    const tick = async () => {
      if (busy || !alive) return;
      busy = true;
      try {
        await work();
      } finally {
        busy = false;
      }
    };

    void tick();
    const timer = live ? setInterval(tick, REFRESH_MS) : undefined;
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [...deps, active, live]);
}

// Git state. `version` ticks on every read so the tree also notices files
// that appeared or vanished.
function useGit(root: string, live: boolean) {
  const [state, setState] = useState<{git: GitState | null; loaded: boolean; version: number}>({git: null, loaded: false, version: 0});
  usePolling(async () => {
    const git = await loadGit(root);
    setState(s => ({git, loaded: true, version: s.version + 1}));
  }, [root], true, live);
  return state;
}

// The whole working tree against the last commit. Only read while Changes is
// open: it costs a `git diff` of everything.
function useDiff(root: string, active: boolean, live: boolean) {
  const [state, setState] = useState<{diff: DiffState | null; version: number}>({diff: null, version: 0});
  usePolling(async () => {
    const diff = await loadDiff(root);
    setState(s => ({diff, version: s.version + 1}));
  }, [root], active, live);
  return state;
}

// Chats, their turns, their subagents, and a snapshot of the project every
// time round. The transcript says which prompt; the snapshots say which lines.
// This runs in every view: a turn that happens while you are looking at Files
// still has to be measured.
function useHistory(root: string, live: boolean) {
  const reader = useRef(newReadState());
  const agentReader = useRef(newAgentState());
  const store = useRef<Store | null>(null);
  const [state, setState] = useState<{changes: TurnChange[]; agents: AgentRun[]; now: number; version: number; loaded: boolean}>({
    changes: [], agents: [], now: Date.now(), version: 0, loaded: false,
  });

  usePolling(async () => {
    store.current ??= openStore(root);
    const now = Date.now();
    const sessions = readSessions(root, reader.current);
    const agents = readAgents(root, agentReader.current);
    if (store.current) await take(store.current, root, now);
    const changes = await loadTurns(root, store.current, sessions, now);
    setState(s => ({changes, agents, now, version: s.version + 1, loaded: true}));
  }, [root], true, live);

  return {...state, store: store.current};
}

function useUsage(active: boolean, live: boolean) {
  const reader = useRef(newUsageState());
  const [spends, setSpends] = useState<Spend[] | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  usePolling(async () => setLimits(readLimits()), [], true, live);
  usePolling(async () => setSpends([...readSpends(reader.current, Date.now())]), [], active, live);
  return {spends, limits};
}

// One file, read, coloured, and marked where it differs from the last commit.
function useFile(root: string, file: string | null, git: GitState | null, version: number) {
  const view = useMemo<FileView | null>(() => (file ? readFileView(file) : null), [file, version]);
  const segments = useMemo(() => (file && view?.kind === 'text' ? highlightLines(file, view.lines) : null), [file, view]);
  const change = file ? git?.changes.get(pathKey(file)) : undefined;
  const [marks, setMarks] = useState<Marks>(NO_MARKS);

  useEffect(() => {
    if (!file || !change) return setMarks(NO_MARKS);
    let alive = true;
    void changedLines(root, file, change).then(next => {
      if (alive) setMarks(next);
    });
    return () => {
      alive = false;
    };
  }, [root, file, change]);

  return {view, segments, marks};
}

export function App({root, interactive, mouseDebug = false}: Props) {
  const {exit} = useApp();
  const {stdout} = useStdout();
  const {cols, rows} = useTerminalSize();

  const [view, setView] = useState<View>('changes');
  const [notice, setNotice] = useState('');
  const [mouse, setMouse] = useState(true);
  const [menu, setMenu] = useState<{open: number; item: number} | null>(null);
  const [frame, setFrame] = useState(0);
  const [sel, setSel] = useState<Record<Slot, string | null>>({changes: null, files: null, agents: null, usage: null, reader: null});
  const [scroll, setScroll] = useState<Record<Slot, number>>({changes: 0, files: 0, agents: 0, usage: 0, reader: 0});

  // Changes.
  const [group, setGroup] = useState<Group>('turn');
  const [chat, setChat] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(CLOSED);
  const [diffs, setDiffs] = useState<ReadonlyMap<string, DiffGroup[]>>(new Map());
  const [folded, setFolded] = useState<ReadonlySet<string>>(NONE);
  const [opened, setOpened] = useState<ReadonlyMap<string, DiffLine[]>>(new Map());
  const [hideSpace, setHideSpace] = useState(false);

  // Files.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(NONE);
  const [changedOnly, setChangedOnly] = useState(false);
  const [peekPath, setPeekPath] = useState<string | null>(null);
  const [peekFrom, setPeekFrom] = useState(0);
  const [readerPath, setReaderPath] = useState<string | null>(null);
  const [raw, setRaw] = useState(false);

  const slot: Slot = view === 'files' && readerPath ? 'reader' : view;

  const {git, loaded, version} = useGit(root, interactive);
  const {diff, version: diffVersion} = useDiff(root, view === 'changes', interactive);
  const history = useHistory(root, interactive);
  const {spends, limits} = useUsage(view === 'usage', interactive);
  const now = history.now;

  const mine = useMemo(() => (chat ? history.changes.filter(c => c.chatId === chat) : history.changes), [history.changes, chat]);
  const histories = useMemo(() => byFile(mine), [mine]);
  const newest = history.changes[history.changes.length - 1];
  const working = Boolean(newest?.running);
  const agentsRunning = runningAgents(history.agents, now);

  // The spinner only ticks while there is something spinning.
  useEffect(() => {
    if (!interactive || (!working && agentsRunning === 0)) return;
    const timer = setInterval(() => setFrame(f => f + 1), SPIN_MS);
    return () => clearInterval(timer);
  }, [interactive, working, agentsRunning]);

  // ---- diffs for the file rows that are open ---------------------------------

  const settled = useRef(new Set<string>());
  useEffect(() => {
    let alive = true;
    const load = async (key: string): Promise<DiffGroup[]> => {
      const at = key.indexOf('|');
      const scope = key.slice(0, at);
      const rel = key.slice(at + 1);
      const fromGit = (note?: string): DiffGroup[] => {
        const found = diff?.files[diff.index.get(pathKey(path.resolve(root, rel))) ?? -1] ?? null;
        return found
          ? [{key: 'git', band: null, file: found, note}]
          : [{key: 'none', band: null, file: null, note: 'Nothing to show: this file matches the last commit.'}];
      };

      if (scope === 'git') return fromGit();
      const change = history.changes.find(c => turnKey(c) === scope);
      if (change?.measured && history.store) {
        const one = await fileInTurn(root, history.store, change, rel);
        // A finished turn's diff never changes, so it is only read once.
        if (!change.running) settled.current.add(key);
        return one ? [{key: 'turn', band: null, file: one}] : [{key: 'none', band: null, file: null, note: 'That turn left no diff for this file.'}];
      }

      return fromGit('Not recorded turn by turn. This is everything since the last commit.');
    };

    void (async () => {
      for (const key of open.files) {
        if (settled.current.has(key) && diffs.has(key)) continue;
        const groups = await load(key);
        if (!alive) return;
        setDiffs(prev => new Map(prev).set(key, groups));
      }
    })();

    return () => {
      alive = false;
    };
  }, [open.files, history.version, diffVersion]);

  // ---- files ------------------------------------------------------------------

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
  const peekFile = useFile(root, peekPath, git, version);
  const readFile = useFile(root, readerPath, git, version);
  const formatted = useMemo(
    () => (readerPath && !raw && isMarkdown(readerPath) && readFile.view?.kind === 'text' ? formatMarkdown(readFile.view.lines, Math.min(cols - 6, 78)) : null),
    [readerPath, raw, readFile.view, cols],
  );
  const historyOf = (file: string | null) => (file ? (histories.find(h => h.path === file) ?? null) : null);

  // A peek opens on the first thing that changed.
  useEffect(() => {
    const total = peekFile.view?.kind === 'text' ? peekFile.view.lines.length : 0;
    const first = changedPlaces(peekFile.marks, total)[0];
    setPeekFrom(first ? Math.max(0, first - 4) : 0);
  }, [peekPath, peekFile.marks]);

  // ---- the lines of the current view -----------------------------------------

  const build = (at: string | null): {head: Line[]; lines: Line[]} => {
    if (slot === 'changes') {
      return {
        head: [],
        lines: changesLines({
          cols, now, frame, root, group, changes: mine, histories, flat: diff ? diff.files : null, agents: history.agents,
          open, diffs, folded, opened, hideSpace, sel: at,
        }),
      };
    }

    if (slot === 'agents') return {head: [], lines: agentsLines({cols, now, frame, root, changes: history.changes, agents: history.agents, open, sel: at})};
    if (slot === 'usage') {
      const last = [...history.changes].sort((a, b) => a.turn.endedAt - b.turn.endedAt).pop();
      return {head: [], lines: usageLines({cols, now, spends, limits, context: last?.turn.context ? {tokens: last.turn.context, model: last.turn.model} : null})};
    }

    if (slot === 'reader' && readerPath && readFile.view) {
      const input = {cols, root, path: readerPath, view: readFile.view, segments: readFile.segments, marks: readFile.marks, history: historyOf(readerPath), sel: at, formatted};
      return {head: readerHead(input), lines: readerLines(input)};
    }

    return {
      head: [],
      lines: filesLines({
        cols, root, nodes, changes: git?.changes ?? null, changedOnly, sel: at,
        peek: peekPath && peekFile.view ? {path: peekPath, view: peekFile.view, segments: peekFile.segments, marks: peekFile.marks, from: peekFrom, history: historyOf(peekPath)} : null,
      }),
    };
  };

  // The cursor is remembered by id, so it stays on the same thing through a
  // refresh. When that thing is gone it falls to the nearest line that is left.
  const lastIndex = useRef<Record<Slot, number>>({changes: 0, files: 0, agents: 0, usage: 0, reader: 0});
  const built = useMemo(() => {
    let made = build(sel[slot]);
    let index = made.lines.findIndex(line => line.pick && line.id === sel[slot]);
    if (index < 0) {
      const picks = made.lines.map((line, i) => (line.pick ? i : -1)).filter(i => i >= 0);
      if (picks.length) {
        index = picks.reduce((best, i) => (Math.abs(i - lastIndex.current[slot]) < Math.abs(best - lastIndex.current[slot]) ? i : best), picks[0]!);
        made = build(made.lines[index]!.id ?? null);
      }
    }

    return {...made, index};
  }, [
    slot, sel, cols, now, frame, group, mine, histories, diff, history.agents, open, diffs, folded, opened, hideSpace,
    nodes, git, changedOnly, peekPath, peekFile.view, peekFile.segments, peekFile.marks, peekFrom,
    readerPath, readFile.view, readFile.segments, readFile.marks, formatted, spends, limits, root,
  ]);

  const {lines, head} = built;
  const cursor = built.index;
  const current: Line | undefined = lines[cursor];
  useEffect(() => {
    if (cursor >= 0) lastIndex.current[slot] = cursor;
    const id = current?.id ?? null;
    if (id !== sel[slot]) setSel(s => ({...s, [slot]: id}));
  }, [cursor, current?.id, slot]);

  // ---- layout -----------------------------------------------------------------

  const roomy = rows >= 28;
  const project = path.basename(root);
  const list = menus({view, group, hideSpace, changedOnly, mouse, agents: agentsRunning});
  const status: Seg[] = working
    ? [seg(spinner(frame), theme.accent), seg(' working', theme.ink)]
    : agentsRunning
      ? [seg(spinner(frame), theme.accent), seg(` ${agentsRunning} agent${agentsRunning === 1 ? '' : 's'}`, theme.ink)]
      : [seg(glyph.dot, theme.faint), seg(' idle', theme.dim)];
  const extras = usageExtras(limits, now);
  const bar = menuBar(cols, list, menu?.open ?? null, [...extras, ...(extras.length ? [sp(3)] : []), ...status]);

  const changedCount = git ? [...git.changes.values()].filter(c => c.status !== 'D').length : 0;
  const tabNote: Seg[] =
    view === 'changes'
      ? [seg(GROUP_NOTE[group], theme.dim), ...(chat ? [seg('  one chat', theme.warn)] : []), ...(group === 'turn' && changesSummary(mine).length ? [seg('  ·  ', theme.faint), ...changesSummary(mine)] : [])]
      : view === 'files'
        ? changedOnly ? [seg('changed only', theme.warn)] : []
        : [];
  const tabs = tabRow(cols, view, {changes: changedCount, agents: agentsRunning}, tabNote);
  const blank: Line = {segs: [sp(cols)]};
  const top: Line[] = roomy ? [bar.line, blank, tabs, blank, ...head, ...(head.length ? [blank] : [])] : [bar.line, tabs, ...head];
  const bottomRows = roomy ? 2 : 1;
  const height = Math.max(3, rows - top.length - bottomRows);
  const most = Math.max(0, lines.length - height);
  const at = Math.min(most, scroll[slot]);

  useEffect(() => {
    if (cursor < 0) return;
    // Leave room above the cursor for the rows pinned over it.
    const pinned = current?.pins?.length ?? 0;
    setScroll(s => {
      const next = follow(s[slot], cursor, height, lines.length);
      const lifted = cursor - next < pinned ? Math.max(0, cursor - pinned) : next;
      return lifted === s[slot] ? s : {...s, [slot]: lifted};
    });
  }, [cursor, height, lines.length, slot]);

  // Rows that stay in view: the turn and the file a long diff belongs to.
  const visible = useMemo(() => {
    let pinned: Line[] = [];
    for (let pass = 0; pass < 3; pass++) {
      const first = lines[at + pinned.length];
      const ids = first?.pins ?? [];
      const next = ids.map(id => lines.findIndex(line => line.id === id)).filter(i => i >= 0 && i < at + pinned.length).map(i => lines[i]!);
      if (next.length === pinned.length) break;
      pinned = next;
    }

    return [...pinned, ...lines.slice(at + pinned.length, at + height)];
  }, [lines, at, height]);

  // ---- doing things -------------------------------------------------------------

  const moveTo = (id: string | null | undefined) => {
    if (id) setSel(s => ({...s, [slot]: id}));
  };

  const openReader = (file: string, line = 0) => {
    setView('files');
    setReaderPath(file);
    // Asked for a line: show the file as written, where line numbers mean something.
    setRaw(line > 0);
    setSel(s => ({...s, reader: line > 0 ? lineId(line) : null}));
    setScroll(s => ({...s, reader: Math.max(0, line - 4)}));
  };

  const reveal = (file: string) => {
    const next = new Set(expanded);
    for (let p = path.dirname(file); p.startsWith(root) && p !== root; p = path.dirname(p)) next.add(p);
    setExpanded(next);
  };

  const run = (command: Command) => {
    setMenu(null);
    switch (command.do) {
      case 'view':
        setReaderPath(null);
        return setView(command.view);
      case 'group':
        setView('changes');
        setGroup(command.group);
        return setNotice(command.group === 'flat' ? 'Showing every change since the last commit.' : `Grouped ${GROUP_NOTE[command.group]}.`);
      case 'chat': {
        const ids = [...new Set(history.changes.map(c => c.chatId))];
        if (ids.length < 2) return setNotice('Only one chat has touched this project.');
        const next = ids[(chat ? ids.indexOf(chat) : -1) + 1] ?? null;
        setChat(next);
        return setNotice(next ? `Showing "${history.changes.find(c => c.chatId === next)?.chat}".` : 'Showing every chat.');
      }

      case 'whitespace':
        setHideSpace(!hideSpace);
        return setNotice(hideSpace ? 'Showing whitespace changes.' : 'Hiding whitespace-only changes.');
      case 'changedOnly':
        if (!git) return setNotice('Not a git repo, so there are no changes to filter by.');
        setView('files');
        return setChangedOnly(!changedOnly);
      case 'foldAll': {
        const owner = [current?.id, ...(current?.pins ?? [])].find(id => id?.startsWith('f:'))?.slice(2);
        const groups = owner ? diffs.get(owner) : undefined;
        if (!owner || !groups) return setNotice('Move into an open diff first.');
        const all = groups.flatMap(g => (g.file?.hunks ?? []).map((_, i) => `${owner}#${g.key}:${i}`));
        const every = all.every(key => folded.has(key));
        const next = new Set(folded);
        for (const key of all) if (every) next.delete(key); else next.add(key);
        return setFolded(next);
      }

      case 'mouse':
        stdout.write(mouse ? MOUSE_OFF : MOUSE_ON);
        setMouse(!mouse);
        return setNotice(mouse ? 'Mouse off. Select and copy freely. Press M to turn it back on.' : 'Mouse on.');
      case 'quit':
        return exit();
    }
  };

  const perform = (act: Act | undefined, how: 'key' | 'click' = 'key') => {
    if (!act) return;
    switch (act.type) {
      case 'view':
        return run({do: 'view', view: act.view});
      case 'menu':
        return setMenu(menu?.open === act.menu ? null : {open: act.menu, item: firstItem(act.menu)});
      case 'item': {
        const item = list[act.menu]?.items[act.item];
        return item && item !== 'rule' ? run(item.command) : undefined;
      }

      case 'turn':
        return setOpen(o => ({...o, turns: flipped(o.turns, act.key)}));
      case 'file':
        return setOpen(o => ({...o, files: flipped(o.files, act.key)}));
      case 'toggle':
        return setOpen(o => ({...o, [act.set]: flipped(o[act.set], act.key)}));
      case 'hunk':
        return setFolded(flipped(folded, act.key));
      case 'gap': {
        const owner = diffs.get(act.file)?.[act.group];
        if (!owner?.file) return;
        const gap = expandGap(owner.file, act.hunk);
        if (gap.length) setOpened(new Map(opened).set(`${act.file}#${owner.key}:${act.hunk}`, gap));
        return;
      }

      case 'node':
        if (act.dir) return changedOnly ? undefined : setExpanded(flipped(expanded, act.path));
        // Enter walks forward: closed, peek, the whole file. A click toggles.
        if (peekPath === act.path) return how === 'key' ? openReader(act.path) : setPeekPath(null);
        return setPeekPath(act.path);
      case 'read':
        return openReader(act.path, act.line);
      case 'goTurn': {
        const isNewest = newest ? turnKey(newest) === act.key : false;
        setReaderPath(null);
        setView('changes');
        setGroup('turn');
        setChat(null);
        setOpen(o => {
          const turns = new Set(o.turns);
          if (isNewest) turns.delete(act.key);
          else turns.add(act.key);
          return {...o, turns};
        });
        return setSel(s => ({...s, changes: `t:${act.key}`}));
      }

      case 'back':
        return setReaderPath(null);
      case 'none':
        return;
    }
  };

  const firstItem = (index: number): number => Math.max(0, (list[index]?.items ?? []).findIndex(item => item !== 'rule'));

  const step = (dir: 1 | -1, by = 1) => {
    let index = cursor;
    for (let n = 0; n < by; n++) {
      let next = index + dir;
      while (next >= 0 && next < lines.length && !lines[next]!.pick) next += dir;
      if (next < 0 || next >= lines.length) break;
      index = next;
    }

    // Nothing to land on, as in Usage: the keys scroll instead.
    if (index === cursor) return setScroll(s => ({...s, [slot]: Math.max(0, Math.min(most, s[slot] + dir * by))}));
    moveTo(lines[index]?.id);
  };

  const jump = (dir: 1 | -1, test: (line: Line) => boolean) => {
    for (let i = cursor + dir; i >= 0 && i < lines.length; i += dir) {
      if (lines[i]!.pick && test(lines[i]!)) return moveTo(lines[i]!.id);
    }
  };

  const nextChange = (dir: 1 | -1) => {
    if (slot === 'reader') {
      // The first line of the next run of marked lines, formatted or not.
      for (let i = cursor + dir; i > 0 && i < lines.length; i += dir) {
        if (lines[i]!.rail && !lines[i - 1]!.rail && lines[i]!.pick) return moveTo(lines[i]!.id);
      }

      return setNotice('No more changes in this file.');
    }

    if (slot === 'files' && peekPath && peekFile.view?.kind === 'text') {
      const places = changedPlaces(peekFile.marks, peekFile.view.lines.length);
      if (places.length === 0) return;
      const to = places.find(n => n > peekFrom + PEEK_ROWS) ?? places[0]!;
      return setPeekFrom(Math.max(0, to - 4));
    }
  };

  // ---- mouse ------------------------------------------------------------------

  const dragging = useRef(false);
  const lastClick = useRef({x: -1, y: -1, at: 0});
  const menuLines = menu ? menuBox(list[menu.open]!, menu.open, menu.item) : [];
  const menuLeft = menu ? Math.min(bar.starts[menu.open] ?? 0, Math.max(0, cols - 30)) : 0;

  const onMouse = (event: MouseEvent) => {
    if (mouseDebug) setNotice(`${event.kind} ${event.button} col ${event.x} row ${event.y}`);
    const inStream = event.y >= top.length && event.y < top.length + height;

    if (event.kind === 'wheel') {
      return setScroll(s => ({...s, [slot]: Math.max(0, Math.min(most, s[slot] + event.wheel * WHEEL_ROWS))}));
    }

    if (event.kind === 'up') {
      dragging.current = false;
      return;
    }

    if (event.kind === 'drag') {
      if (dragging.current) setScroll(s => ({...s, [slot]: scrollFromThumb(lines.length, height, event.y - top.length)}));
      return;
    }

    if (event.kind !== 'down' || event.button !== 'left') return;
    const clickedAt = Date.now();
    const twice = clickedAt - lastClick.current.at < DOUBLE_CLICK_MS && lastClick.current.x === event.x && lastClick.current.y === event.y;
    lastClick.current = {x: event.x, y: event.y, at: clickedAt};
    if (notice && !mouseDebug) setNotice('');

    const zoneOf = (line: Line | undefined): Act | undefined => line?.zones?.find(z => event.x >= z.from && event.x < z.to)?.act;

    if (menu) {
      const row = menuLines[event.y - 1];
      const inside = row && event.x >= menuLeft && event.x < menuLeft + 28;
      if (inside) return perform(row.act, 'click');
      if (event.y === 0 && zoneOf(bar.line)?.type === 'menu') return perform(zoneOf(bar.line), 'click');
      return setMenu(null);
    }

    if (event.y < top.length) return perform(zoneOf(top[event.y]), 'click');
    if (!inStream) return;

    if (event.x >= cols - 1 && lines.length > height) {
      dragging.current = true;
      return setScroll(s => ({...s, [slot]: scrollFromThumb(lines.length, height, event.y - top.length)}));
    }

    const line = visible[event.y - top.length];
    if (!line) return;
    if (line.pick) moveTo(line.id);
    if (twice && line.at) return openReader(line.at.path, line.at.line);
    perform(zoneOf(line) ?? line.act, 'click');
  };

  // ---- keys ---------------------------------------------------------------------

  useInput(
    (input, key) => {
      const event = parseMouse(input);
      if (event) return mouse ? onMouse(event) : undefined;
      if (notice) setNotice('');

      if (menu) {
        const items = list[menu.open]!.items;
        const move = (dir: 1 | -1) => {
          let next = menu.item;
          do next = (next + dir + items.length) % items.length;
          while (items[next] === 'rule');
          setMenu({...menu, item: next});
        };

        if (key.escape || input === 'm') return setMenu(null);
        if (key.upArrow || input === 'k') return move(-1);
        if (key.downArrow || input === 'j') return move(1);
        if (key.leftArrow || key.rightArrow) {
          const to = (menu.open + (key.rightArrow ? 1 : -1) + list.length) % list.length;
          return setMenu({open: to, item: firstItem(to)});
        }

        if (key.return) return perform({type: 'item', menu: menu.open, item: menu.item});
        // Any other key falls through, so a shortcut still works with a menu open.
        setMenu(null);
      }

      if (input === 'q') return exit();
      if (input === 'm') return setMenu({open: 1, item: firstItem(1)});
      if (input === 'M') return run({do: 'mouse'});
      if (input === '1') return run({do: 'view', view: 'changes'});
      if (input === '2') return run({do: 'view', view: 'files'});
      if (input === '3') return run({do: 'view', view: 'agents'});
      if (input === '4') return run({do: 'view', view: 'usage'});

      const page = Math.max(1, height - 2);
      if (key.upArrow || input === 'k') return step(-1);
      if (key.downArrow || input === 'j') return step(1);
      if (key.pageUp || input === 'b') return step(-1, page);
      if (key.pageDown || input === ' ') return step(1, page);
      if (input === 'g') return step(-1, lines.length);
      if (input === 'G') return step(1, lines.length);
      if (key.return || key.rightArrow) return perform(current?.act);

      if (key.escape || key.leftArrow) {
        if (slot === 'reader') return setReaderPath(null);
        // Inside something that is open: go back up to the row that owns it.
        const owner = current?.pins?.[current.pins.length - 1];
        if (owner) return moveTo(owner);
        if (slot === 'files') {
          if (peekPath) return setPeekPath(null);
          const node = nodes.find(n => nodeId(n.path) === current?.id);
          if (node?.isDir && node.open && !changedOnly) return setExpanded(flipped(expanded, node.path));
          const parent = node ? nodes.slice(0, nodes.indexOf(node)).reverse().find(n => n.depth < node.depth) : undefined;
          return moveTo(parent ? nodeId(parent.path) : null);
        }

        // On a row that is open: close it.
        const id = current?.id ?? '';
        const act = current?.act;
        const isOpen =
          (act?.type === 'file' && open.files.has(act.key)) ||
          (act?.type === 'toggle' && open[act.set].has(act.key)) ||
          (act?.type === 'turn' && id.startsWith('t:') && lines[cursor + 1]?.pins?.includes(id) === true);
        return isOpen ? perform(act) : undefined;
      }

      if (input === ']' || input === '[') {
        const dir = input === ']' ? 1 : -1;
        if (slot === 'changes') return jump(dir, line => Boolean(line.id?.startsWith('f:') || line.id?.startsWith('t:') || line.id?.startsWith('h:')));
        return nextChange(dir);
      }

      if (slot === 'changes') {
        if (input === 'v') return run({do: 'group', group: GROUPS[(GROUPS.indexOf(group) + 1) % GROUPS.length]!});
        if (input === 's') return run({do: 'chat'});
        if (input === 'w') return run({do: 'whitespace'});
        if (input === 'z') return run({do: 'foldAll'});
        if (input === 'n') return jump(1, line => line.act?.type === 'hunk');
        if (input === 'N') return jump(-1, line => line.act?.type === 'hunk');
        if (input === 'o') {
          if (!current?.at) return setNotice('Move onto a line of a diff first.');
          reveal(current.at.path);
          return openReader(current.at.path, current.at.line);
        }
      }

      if (slot === 'reader' && input === 'r' && readerPath && isMarkdown(readerPath)) return setRaw(!raw);
      if (view === 'files' && input === 'c') return run({do: 'changedOnly'});
    },
    {isActive: interactive},
  );

  // --snapshot and non-terminal runs wait for the first read, draw and leave.
  useEffect(() => {
    if (interactive || !loaded || !history.loaded) return;
    const timer = setTimeout(exit, 300);
    return () => clearTimeout(timer);
  }, [interactive, loaded, history.loaded, exit]);

  // ---- draw ---------------------------------------------------------------------

  const hints: [string, string][] =
    slot === 'changes'
      ? current?.pins?.some(id => id.startsWith('f:'))
        ? [['↑↓', 'line'], ['n', 'hunk'], ['enter', 'fold'], ['o', 'open'], ['esc', 'back'], ['z', 'fold all'], ['m', 'menu']]
        : [['↑↓', 'move'], ['enter', 'open'], ['v', 'group'], [']', 'next'], ['m', 'menu'], ['q', 'quit']]
      : slot === 'files'
        ? peekPath
          ? [['enter', 'read all'], [']', 'next change'], ['esc', 'close'], ['m', 'menu']]
          : [['↑↓', 'move'], ['enter', 'peek'], ['c', 'changed'], ['m', 'menu'], ['q', 'quit']]
        : slot === 'reader'
          ? [['↑↓', 'line'], [']', 'change'], ['space', 'page'], ...(readerPath && isMarkdown(readerPath) ? [['r', raw ? 'formatted' : 'raw'] as [string, string]] : []), ['esc', 'back']]
          : slot === 'agents'
            ? [['↑↓', 'move'], ['enter', 'open'], ['m', 'menu'], ['q', 'quit']]
            : [['↑↓', 'scroll'], ['m', 'menu'], ['q', 'quit']];

  const where = git?.branch ? `${project} ${glyph.bullet} ${git.branch}` : project;
  const track = thumb(lines.length, height, at);
  const stream: Line[] = Array.from({length: height}, (_, i) => {
    const line = visible[i];
    const mark = line?.rail ? seg(glyph.rail, line.rail) : track && i >= track.from && i < track.to ? seg(glyph.rail, theme.thumb) : sp(1);
    return {segs: [...(line?.segs ?? [sp(cols - 1)]), mark]};
  });

  let screen: Line[] = [...top, ...stream, ...(roomy ? [blank] : []), footer(cols, hints, notice, where)];
  if (menu) {
    screen = screen.map((line, y) => {
      const under = y === 0 ? line : dimmed(line);
      const row = menuLines[y - 1];
      return row ? {...under, segs: overlay(under.segs, menuLeft, row.segs, cols)} : under;
    });
  }

  // `loaded` keeps the first frame from flashing an empty state.
  if (!history.loaded && slot !== 'files') {
    screen = [...top, {segs: [sp(1), seg('Reading your chats…', theme.dim)]}];
  }

  return <Screen lines={screen} cols={cols} rows={rows} />;
}

