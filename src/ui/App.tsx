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
import {dimmed, overlay, seg, sp, widthOf, type Act, type Group, type Line, type Seg, type View} from './cells';
import type {DiffGroup} from './diffrows';
import {follow, scrollFromThumb, thumb} from './layout';
import {footer, isAction, MENU_WIDTH, menuBar, menuBox, menus, pillRow, tabRow, type Command, type Hint, type Pill} from './menu';
import {DOUBLE_CLICK_MS, MOUSE_OFF, MOUSE_ON, parseMouse, type MouseEvent} from './mouse';
import {Screen} from './Screen';
import {glyph, theme} from './theme';
import {agentsBadge, agentsLines, agentsTabVisible, runningAgents} from './views/agents';
import {changesLines, spinner, turnKey, type Open} from './views/changes';
import {
  changedPlaces, filesLines, firstReadId, MORE_ROWS, nodeId, peekEnd, readerHead, readerIdAt, readerLineOf, readerLines,
  type Marks,
} from './views/files';
import {usageExtras, usageLines, type ExtrasRoom} from './views/usage';

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
// Usage is read in every view, so the menu bar's meters are never blank; only
// the view itself needs it fresh.
const SLOW_MS = 30_000;
const SPIN_MS = 250;
const WHEEL_ROWS = 3;
const GROUPS: Group[] = ['turn', 'file', 'flat'];
const GROUP_PILL: Record<Group, string> = {turn: 'By turn', file: 'By file', flat: 'All'};

const NONE: ReadonlySet<string> = new Set();
const CLOSED: Open = {turns: NONE, files: NONE, more: NONE, steps: NONE, says: NONE, agents: NONE, folded: NONE, hists: NONE};

type Notice = {text: string; warn?: boolean};

// Acts that add or remove lines. The row they were aimed at has to stay where
// it was, or the next click lands on something else.
const TOGGLING: ReadonlySet<Act['type']> = new Set(['turn', 'file', 'toggle', 'hunk', 'gap', 'node']);

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
function usePolling(work: () => Promise<void>, deps: unknown[], active: boolean, live: boolean, every = REFRESH_MS) {
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
    const timer = live ? setInterval(tick, every) : undefined;
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [...deps, active, live, every]);
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

// The tokens and the limits are read in every view, because the right end of
// the menu bar shows them everywhere. Only the Usage view needs them fresh.
function useUsage(showing: boolean, live: boolean) {
  const reader = useRef(newUsageState());
  const [spends, setSpends] = useState<Spend[] | null>(null);
  const [limits, setLimits] = useState<Limits | null>(null);
  usePolling(async () => setLimits(readLimits()), [], true, live);
  usePolling(async () => setSpends([...readSpends(reader.current, Date.now())]), [], true, live, showing ? REFRESH_MS : SLOW_MS);
  return {spends, limits};
}

// Two mark sets that say the same thing. Git is read every few seconds and
// hands back a new set every time; anything watching the marks must not be
// woken by a set that has not actually changed.
function sameMarks(a: Marks, b: Marks): boolean {
  if (a === 'all' || b === 'all') return a === b;
  if (a.size !== b.size) return false;
  for (const n of a) if (!b.has(n)) return false;
  return true;
}

// One file, read, coloured, and marked where it differs from the last commit.
function useFile(root: string, file: string | null, git: GitState | null, version: number) {
  const view = useMemo<FileView | null>(() => (file ? readFileView(file) : null), [file, version]);
  const segments = useMemo(() => (file && view?.kind === 'text' ? highlightLines(file, view.lines) : null), [file, view]);
  const change = file ? git?.changes.get(pathKey(file)) : undefined;
  const [marks, setMarks] = useState<Marks>(NO_MARKS);

  useEffect(() => {
    if (!file || !change) return setMarks(prev => (sameMarks(prev, NO_MARKS) ? prev : NO_MARKS));
    let alive = true;
    void changedLines(root, file, change).then(next => {
      if (alive) setMarks(prev => (sameMarks(prev, next) ? prev : next));
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
  const [notice, setNotice] = useState<Notice | null>(null);
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
  // Rows the peek's last row has added. It is the peek that grows, not the
  // page that changes: the tree stays, and so does the file's own row.
  const [peekRows, setPeekRows] = useState(0);
  const [readerPath, setReaderPath] = useState<string | null>(null);
  // The line the reader was asked for, in source lines. Resolved into a row
  // once the file has been read, and again when formatting is toggled.
  const [target, setTarget] = useState(0);
  const [raw, setRaw] = useState(false);

  const slot: Slot = view === 'files' && readerPath ? 'reader' : view;

  const {git, loaded, version} = useGit(root, interactive);
  const {diff, version: diffVersion} = useDiff(root, view === 'changes', interactive);
  const history = useHistory(root, interactive);
  const {spends, limits} = useUsage(view === 'usage', interactive);
  const say = (text: string) => setNotice({text});
  const refuse = (text: string) => setNotice({text, warn: true});
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
      // `dead` is what to say when there is nothing left to show at all.
      const fromGit = (note?: string, dead?: string): DiffGroup[] => {
        const found = diff?.files[diff.index.get(pathKey(path.resolve(root, rel))) ?? -1] ?? null;
        return found
          ? [{key: 'git', band: null, file: found, note}]
          : [{key: 'none', band: null, file: null, note: dead ?? 'Nothing to show: this file matches the last commit.'}];
      };

      if (scope === 'git') return fromGit();
      const change = history.changes.find(c => turnKey(c) === scope);
      // Snapshots or commits, whichever recorded this turn; a file only the
      // transcript named has neither, so it falls through.
      if (change?.measured && change.files.find(f => f.rel === rel)?.known) {
        const one = await fileInTurn(root, history.store, change, rel);
        // A finished turn's diff never changes, so it is only read once.
        if (!change.running) settled.current.add(key);
        return one ? [{key: 'turn', band: null, file: one}] : [{key: 'none', band: null, file: null, note: 'That turn left no diff for this file.'}];
      }

      return fromGit(
        'Not recorded turn by turn. This is everything since the last commit.',
        'Not recorded: the pane was not open during this turn and no commit holds this change.',
      );
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
  // Markdown is laid out whether or not it is being shown, because `r` has to
  // map the row under the cursor onto its source line and back.
  const mdLines = useMemo(
    () => (readerPath && isMarkdown(readerPath) && readFile.view?.kind === 'text' ? formatMarkdown(readFile.view.lines, Math.min(cols - 6, 78)) : null),
    [readerPath, readFile.view, cols],
  );
  const formatted = raw ? null : mdLines;
  const historyOf = (file: string | null) => (file ? (histories.find(h => h.path === file) ?? null) : null);

  // A peek opens on the first thing that changed, and then stays where you put
  // it. Positioning once per file is the whole point: git is read every few
  // seconds, and a reset on every read undid `]` a moment after it landed.
  const placed = useRef<string | null>(null);
  useEffect(() => {
    if (!peekPath) {
      placed.current = null;
      return;
    }

    const total = peekFile.view?.kind === 'text' ? peekFile.view.lines.length : 0;
    const first = changedPlaces(peekFile.marks, total)[0];
    // The marks arrive after the file does, so the first place is part of the
    // key: the peek is positioned again the once, when it is finally known.
    const key = `${peekPath}|${first ?? 0}`;
    if (placed.current === key) return;
    placed.current = key;
    setPeekFrom(first ? Math.max(0, first - 4) : 0);
  }, [peekPath, peekFile.view, peekFile.marks]);

  // Growing the peek is about this window on this file, so a new file or a
  // jump to another changed place starts over.
  useEffect(() => setPeekRows(0), [peekPath, peekFrom]);

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
      // The cache hit belongs to this chat, so the chat's own id goes with it.
      const context = last?.turn.context ? {tokens: last.turn.context, model: last.turn.model, chat: last.turn.sessionId} : null;
      return {head: [], lines: usageLines({cols, now, spends, limits, context})};
    }

    if (slot === 'reader' && readerPath && readFile.view) {
      const input = {cols, root, path: readerPath, view: readFile.view, segments: readFile.segments, marks: readFile.marks, history: historyOf(readerPath), sel: at, formatted};
      return {head: readerHead(input), lines: readerLines(input)};
    }

    return {
      head: [],
      lines: filesLines({
        cols, root, nodes, changes: git?.changes ?? null, changedOnly, sel: at,
        peek: peekPath && peekFile.view
          ? {path: peekPath, view: peekFile.view, segments: peekFile.segments, marks: peekFile.marks, from: peekFrom, extra: peekRows, history: historyOf(peekPath)}
          : null,
      }),
    };
  };

  // The cursor is remembered by id, so it stays on the same thing through a
  // refresh. When that thing is gone it falls to the nearest line that is left.
  const lastIndex = useRef<Record<Slot, number>>({changes: 0, files: 0, agents: 0, usage: 0, reader: 0});
  // The row a toggle was aimed at, and the screen row it was on. `waits` lets
  // it stand for a render or two while the row it names is still being built.
  const anchor = useRef<{id: string; y: number; slot: Slot; waits?: number} | null>(null);
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
    nodes, git, changedOnly, peekPath, peekFile.view, peekFile.segments, peekFile.marks, peekFrom, peekRows,
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
  const chatName = chat ? (history.changes.find(c => c.chatId === chat)?.chat ?? 'one chat') : null;
  const inDiff = Boolean(current?.pins?.some(id => id.startsWith('f:')));
  const markdown = slot === 'reader' && Boolean(readerPath && isMarkdown(readerPath));
  const list = menus({view, group, hideSpace, changedOnly, chat: chatName, inDiff, markdown, raw, mouse});
  const status: Seg[] = working
    ? [seg(spinner(frame), theme.accent), seg(' working', theme.ink)]
    : agentsRunning
      ? [seg(spinner(frame), theme.accent), seg(` ${agentsRunning} agent${agentsRunning === 1 ? '' : 's'}`, theme.ink)]
      : [seg(glyph.dot, theme.faint), seg(' idle', theme.dim)];
  // What is left of the bar once the menus and the status have had their
  // columns. The meters shrink in steps and then go, so the menus always fit.
  const barLeft = 2 + list.reduce((n, m) => n + m.title.length + 2, 0);
  const metersRoom = cols - barLeft - 2 - widthOf(status) - 3;
  const room: ExtrasRoom = metersRoom >= 30 ? 'full' : metersRoom >= 24 ? 'noWeek' : 'plain';
  const extras = usageExtras(limits, now, {spends, room});
  const bar = menuBar(cols, list, menu?.open ?? null, {meters: widthOf(extras) <= metersRoom ? extras : [], status});

  const uncommitted = git ? [...git.changes.values()].filter(c => c.status !== 'D').length : 0;
  const showAgents = agentsTabVisible(history.changes, history.agents, now) || view === 'agents';
  const tabs = tabRow(cols, view, {agents: agentsBadge(history.agents, now, frame)}, {agents: !showAgents});

  // The pills carry the state the tab row used to describe in dim words: they
  // say what is showing and change it in one click.
  const pills: Pill[] =
    view === 'changes'
      ? [
          ...GROUPS.map(g => ({label: GROUP_PILL[g], on: group === g, act: {type: 'group', group: g} as Act})),
          ...(chatName ? [{label: `Chat: ${chatName}`, on: true, tone: theme.warn, clear: true, act: {type: 'filter', what: 'chat', on: false} as Act}] : []),
        ]
      : view === 'files'
        ? [
            {label: 'All', on: !changedOnly, act: {type: 'filter', what: 'changedOnly', on: false}},
            {label: uncommitted ? `Changed ${uncommitted}` : 'Changed', on: changedOnly, act: {type: 'filter', what: 'changedOnly', on: true}},
          ]
        : [];
  const note: Seg[] = view === 'changes' && uncommitted ? [seg(`${uncommitted} uncommitted`, theme.dim)] : [];
  const pillsLine = pills.length ? pillRow(cols, pills, note) : null;
  const blank: Line = {segs: [sp(cols)]};
  const top: Line[] = roomy
    ? [bar.line, blank, tabs, ...(pillsLine ? [pillsLine] : []), blank, ...head, ...(head.length ? [blank] : [])]
    : [bar.line, tabs, ...(pillsLine ? [pillsLine] : []), ...head];
  const bottomRows = roomy ? 2 : 1;
  const height = Math.max(3, rows - top.length - bottomRows);
  const most = Math.max(0, lines.length - height);
  // A toggled row keeps its place on screen: worked out here and not in an
  // effect, which would paint one frame at the old offset first.
  const anchored = ((): number | null => {
    const want = anchor.current;
    if (!want) return null;
    const index = lines.findIndex(line => line.id === want.id);
    return index < 0 ? null : Math.max(0, Math.min(most, index - want.y));
  })();
  const at = anchored ?? Math.min(most, scroll[slot]);

  // What the page last followed. The wheel and the scrollbar move the page
  // without moving the cursor, so only a change to one of these pulls it back.
  const followed = useRef({cursor: -1, height: 0, total: 0, slot: slot as string});
  useEffect(() => {
    const was = followed.current;
    const moved = was.cursor !== cursor || was.height !== height || was.total !== lines.length || was.slot !== slot;
    followed.current = {cursor, height, total: lines.length, slot};

    const want = anchor.current;
    if (want) {
      // A row the reader was opened on only exists once the file has been
      // read, so the anchor waits rather than being thrown away. It never
      // waits for long: a line past the end of the file must not jam the page.
      const found = lines.some(line => line.id === want.id);
      const waits = (want.waits ?? 0) + 1;
      anchor.current = found || want.slot !== slot || waits > 2 ? null : {...want, waits};
      setScroll(s => (s[slot] === at ? s : {...s, [slot]: at}));
      return;
    }

    if (!moved || cursor < 0) return;
    // Leave room above the cursor for the rows pinned over it.
    const pinned = current?.pins?.length ?? 0;
    setScroll(s => {
      const next = follow(s[slot], cursor, height, lines.length);
      const lifted = cursor - next < pinned ? Math.max(0, cursor - pinned) : next;
      return lifted === s[slot] ? s : {...s, [slot]: lifted};
    });
  }, [cursor, height, lines, slot, at]);

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
    setTarget(line);
    // The cursor lands once the file has been read; the effect below does it,
    // because nothing is loaded on the render that asked for it.
    setSel(s => ({...s, reader: null}));
    if (line <= 0) setScroll(s => ({...s, reader: 0}));
  };

  // The reader opens on the line it was asked for, and otherwise on the file
  // itself rather than on the "Changed by" rows above it.
  useEffect(() => {
    if (!readerPath || sel.reader || !readFile.view) return;
    const asked = target > 0 ? readerIdAt(target, formatted) : null;
    const id = asked ?? firstReadId({view: readFile.view, formatted});
    if (!id) return;
    // Those rows mean a line's row is not its line number, so the screen row
    // is set here instead of guessed from the number.
    if (asked) anchor.current = {id, y: 3, slot: 'reader'};
    setSel(s => ({...s, reader: id}));
  }, [readerPath, readFile.view, formatted, sel.reader, target]);

  const reveal = (file: string) => {
    const next = new Set(expanded);
    for (let p = path.dirname(file); p.startsWith(root) && p !== root; p = path.dirname(p)) next.add(p);
    setExpanded(next);
  };

  const run = (command: Command) => {
    setMenu(null);
    switch (command.do) {
      case 'view':
        // The reader is kept when you look at something else, so coming back
        // to Files returns to the file you were reading. Choosing Files while
        // already there is the way out of it.
        if (command.view === 'files' && view === 'files') setReaderPath(null);
        return setView(command.view);
      case 'group':
        // No notice: the pill under the tabs already says which grouping.
        setView('changes');
        return setGroup(command.group);
      case 'chat': {
        const ids = [...new Set(history.changes.map(c => c.chatId))];
        if (command.to !== undefined) return setChat(command.to);
        if (ids.length < 2) return refuse('Only one chat has touched this project.');
        return setChat(ids[(chat ? ids.indexOf(chat) : -1) + 1] ?? null);
      }

      case 'whitespace':
        setHideSpace(!hideSpace);
        return say(hideSpace ? 'Showing whitespace changes.' : 'Hiding whitespace-only changes.');
      case 'changedOnly':
        if (!git) return refuse('Not a git repo, so there are no changes to filter by.');
        setView('files');
        return setChangedOnly(command.on ?? !changedOnly);
      case 'raw': {
        if (!readerPath || !isMarkdown(readerPath)) return refuse('Only a markdown file can be read as written.');
        // Keep your place. A formatted row covers a range of source lines, so
        // the two shapes only line up through that range; falling back to the
        // nearest row index turned line 248 into a paragraph from line 125.
        const line = readerLineOf(current?.id, mdLines);
        const to = readerIdAt(line, raw ? mdLines : null);
        const y = current?.id ? visible.findIndex(row => row.id === current.id) : -1;
        if (to) {
          if (y >= 0) anchor.current = {id: to, y, slot: 'reader'};
          setSel(s => ({...s, reader: to}));
        }

        return setRaw(!raw);
      }

      case 'foldAll': {
        const owner = [current?.id, ...(current?.pins ?? [])].find(id => id?.startsWith('f:'))?.slice(2);
        const groups = owner ? diffs.get(owner) : undefined;
        if (!owner || !groups) return refuse('Move into an open diff first.');
        const all = groups.flatMap(g => (g.file?.hunks ?? []).map((_, i) => `${owner}#${g.key}:${i}`));
        const every = all.every(key => folded.has(key));
        const next = new Set(folded);
        for (const key of all) if (every) next.delete(key); else next.add(key);
        return setFolded(next);
      }

      case 'mouse':
        stdout.write(mouse ? MOUSE_OFF : MOUSE_ON);
        setMouse(!mouse);
        return say(mouse ? 'Mouse off. Select and copy freely.' : 'Mouse on.');
      case 'quit':
        return exit();
    }
  };

  const perform = (act: Act | undefined) => {
    if (!act) return;
    switch (act.type) {
      case 'view':
        return run({do: 'view', view: act.view});
      case 'menu':
        return setMenu(menu?.open === act.menu ? null : {open: act.menu, item: firstItem(act.menu)});
      case 'item': {
        const item = list[act.menu]?.items[act.item];
        return item && isAction(item) ? run(item.command) : undefined;
      }

      case 'group':
        return run({do: 'group', group: act.group});
      case 'filter':
        return act.what === 'chat' ? run({do: 'chat', to: act.on ? chat : null}) : run({do: 'changedOnly', on: act.on});

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
        if (act.dir) return setExpanded(flipped(expanded, act.path));
        // A row is a toggle, by key or by click: the peek opens and closes
        // under it. `o` is what reads the whole file.
        if (peekPath === act.path) return setPeekPath(null);
        return setPeekPath(act.path);
      case 'read':
        return openReader(act.path, act.line);
      case 'more': {
        // The label promised more of this file, so that is what it gives: the
        // peek grows in place and the tree stays. `o` is still the only way
        // into the whole-file reader. With a changed place below the window,
        // the row is the `]` key instead, because that is what it says.
        const total = peekFile.view?.kind === 'text' ? peekFile.view.lines.length : 0;
        const end = peekEnd(total, peekFrom, peekRows);
        if (changedPlaces(peekFile.marks, total).some(n => n > end)) return nextChange(1);
        return setPeekRows(rows => rows + MORE_ROWS);
      }

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

  const firstItem = (index: number): number => Math.max(0, (list[index]?.items ?? []).findIndex(isAction));

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

      return refuse('No more changes in this file.');
    }

    if (slot === 'files' && peekPath && peekFile.view?.kind === 'text') {
      const places = changedPlaces(peekFile.marks, peekFile.view.lines.length);
      if (places.length === 0) return;
      // Forward means the first change below the lines the peek is showing,
      // back means the last change above the line it is anchored on.
      const end = peekEnd(peekFile.view.lines.length, peekFrom, peekRows);
      const to =
        dir > 0
          ? (places.find(n => n > end) ?? places[0]!)
          : ([...places].reverse().find(n => n < peekFrom + 4) ?? places[places.length - 1]!);
      return setPeekFrom(Math.max(0, to - 4));
    }
  };

  // ---- mouse ------------------------------------------------------------------

  const dragging = useRef(false);
  const lastClick = useRef({x: -1, y: -1, at: 0});
  const menuLines = menu ? menuBox(list[menu.open]!, menu.open, menu.item) : [];
  const menuLeft = menu ? Math.min(bar.starts[menu.open] ?? 0, Math.max(0, cols - MENU_WIDTH)) : 0;

  const onMouse = (event: MouseEvent) => {
    if (mouseDebug) say(`${event.kind} ${event.button} col ${event.x} row ${event.y}`);
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
    if (notice && !mouseDebug) setNotice(null);

    const zoneOf = (line: Line | undefined): Act | undefined => line?.zones?.find(z => event.x >= z.from && event.x < z.to)?.act;

    if (menu) {
      const row = menuLines[event.y - 1];
      const inside = row && event.x >= menuLeft && event.x < menuLeft + MENU_WIDTH;
      if (inside) return perform(row.act);
      if (event.y === 0 && zoneOf(bar.line)?.type === 'menu') return perform(zoneOf(bar.line));
      return setMenu(null);
    }

    if (event.y < top.length) return perform(zoneOf(top[event.y]));
    if (!inStream) return;

    if (event.x >= cols - 1 && lines.length > height) {
      dragging.current = true;
      return setScroll(s => ({...s, [slot]: scrollFromThumb(lines.length, height, event.y - top.length)}));
    }

    const row = event.y - top.length;
    const line = visible[row];
    if (!line) return;
    const act = zoneOf(line) ?? line.act;
    if (act && TOGGLING.has(act.type)) {
      // Rows that carry a toggle but no cursor stop, a wrapped prompt or a
      // meta line, belong to the row above: anchor and move there.
      let y = row;
      while (y > 0 && !visible[y]!.id) y--;
      const owner = visible[y];
      if (owner?.id) {
        anchor.current = {id: owner.id, y, slot};
        moveTo(owner.id);
      } else if (line.pick) moveTo(line.id);
    } else if (line.pick) moveTo(line.id);

    if (twice && line.at) return openReader(line.at.path, line.at.line);
    perform(act);
  };

  // ---- keys ---------------------------------------------------------------------

  useInput(
    (input, key) => {
      const event = parseMouse(input);
      if (event) return mouse ? onMouse(event) : undefined;
      if (notice) setNotice(null);

      if (menu) {
        const items = list[menu.open]!.items;
        const move = (dir: 1 | -1) => {
          let next = menu.item;
          // A rule and a heading are read, not chosen: the cursor steps past.
          do next = (next + dir + items.length) % items.length;
          while (!isAction(items[next]!));
          setMenu({...menu, item: next});
        };

        if (key.escape || input === 'm' || input === '?') return setMenu(null);
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
      // `?` is where people look for help, and the menus are the help.
      if (input === 'm' || input === '?') return setMenu({open: 1, item: firstItem(1)});
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
      if (key.return || key.rightArrow) {
        // Same as a click: the row being opened or closed stays where it is.
        const act = current?.act;
        const y = current?.id ? visible.findIndex(line => line.id === current.id) : -1;
        if (act && TOGGLING.has(act.type) && y >= 0 && current?.id) anchor.current = {id: current.id, y, slot};
        return perform(act);
      }

      if (key.escape || key.leftArrow) {
        if (slot === 'reader') return setReaderPath(null);
        // Inside something that is open: go back up to the row that owns it.
        const owner = current?.pins?.[current.pins.length - 1];
        if (owner) return moveTo(owner);
        if (slot === 'files') {
          if (peekPath) return setPeekPath(null);
          const node = nodes.find(n => nodeId(n.path) === current?.id);
          if (node?.isDir && node.open) return setExpanded(flipped(expanded, node.path));
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
        if (input === 'o') {
          if (!current?.at) return refuse('Move onto a line of a diff first.');
          reveal(current.at.path);
          return openReader(current.at.path, current.at.line);
        }
      }

      // The tree's own keys. Neither means anything inside the reader, where
      // `c` would filter a tree you cannot see.
      if (slot === 'files') {
        if (input === 'c') return run({do: 'changedOnly'});
        if (input === 'o') {
          if (peekPath) return openReader(peekPath);
          const node = nodes.find(n => nodeId(n.path) === current?.id);
          return node && !node.isDir ? openReader(node.path) : refuse('Move onto a file first.');
        }
      }

      if (slot === 'reader' && input === 'r') return run({do: 'raw'});
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

  // What this row does first, then the way back out, then the menu that holds
  // everything else. A narrow pane keeps the ones at the front.
  const hints: Hint[] =
    slot === 'changes'
      ? inDiff
        ? [['enter', 'fold'], ['esc', 'back'], ['m', 'menu'], ['↑↓', 'line'], [']', 'hunk'], ['o', 'open'], ['z', 'fold all']]
        : [['enter', 'open'], ['m', 'menu'], ['↑↓', 'move'], [']', 'next'], ['v', 'group'], ['q', 'quit']]
      : slot === 'files'
        ? peekPath
          ? [['o', 'read all'], ['esc', 'close'], ['m', 'menu'], [']', 'next change']]
          : [['enter', 'peek'], ['m', 'menu'], ['↑↓', 'move'], ['o', 'read'], ['c', 'changed'], ['q', 'quit']]
        : slot === 'reader'
          ? [['↑↓', 'line'], ['esc', 'back'], ['m', 'menu'], [']', 'change'], ['space', 'page'], ...(markdown ? [['r', raw ? 'formatted' : 'raw'] as Hint] : [])]
          : slot === 'agents'
            ? [['enter', 'open'], ['m', 'menu'], ['↑↓', 'move'], ['q', 'quit']]
            : [['↑↓', 'scroll'], ['m', 'menu'], ['q', 'quit']];

  // The last column is a minimap. The thumb is a background, so a change mark
  // can sit on top of it, and the marks are spread over the whole track by
  // where their row falls in the whole list.
  const track = thumb(lines.length, height, at);
  const marks = new Map<number, string>();
  lines.forEach((line, i) => {
    if (!line.rail) return;
    const y = lines.length <= height ? i : Math.round((i / (lines.length - 1)) * (height - 1));
    marks.set(y, line.rail);
  });

  const stream: Line[] = Array.from({length: height}, (_, i) => {
    const onThumb = Boolean(track && i >= track.from && i < track.to);
    const rail = marks.get(i);
    const mark = rail ? seg(glyph.rail, rail, onThumb ? {bg: theme.thumb} : {}) : sp(1, onThumb ? theme.thumb : undefined);
    return {segs: [...(visible[i]?.segs ?? [sp(cols - 1)]), mark]};
  });

  let screen: Line[] = [
    ...top,
    ...stream,
    ...(roomy ? [blank] : []),
    footer(cols, hints, notice, {project, branch: git?.branch ?? null}, !mouse),
  ];
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

