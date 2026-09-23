import path from 'node:path';
import {useEffect, useMemo, useRef, useState} from 'react';
import {useApp, useInput, useStdout} from 'ink';
import {newAgentState, readAgents, type AgentRun} from '../core/agents';
import {attention, type Attention} from '../core/attention';
import {expandGap, loadDiff, type DiffLine, type DiffState} from '../core/diff';
import {readFileView, type FileView} from '../core/file';
import {loadFolders} from '../core/folders';
import {changedLines, loadGit, pathKey, type GitState} from '../core/git';
import {highlightLines} from '../core/highlight';
import {formatMarkdown, isMarkdown} from '../core/markdown';
import {countChats, newReadState, readSessions} from '../core/sessions';
import {openStore, take, type Store} from '../core/snapshot';
import {visibleNodes} from '../core/tree';
import {byFile, fileInTurn, loadTurns, type TurnChange} from '../core/turns';
import {newUsageState, readLimits, readSpends, type Limits, type Spend} from '../core/usage';
import {readWorktrees, type WorktreeRun} from '../core/worktrees';
import {brief, cut, dimmed, overlay, seg, sp, spinner, widthOf, type Act, type Group, type Line, type Seg, type View} from './cells';
import type {DiffGroup} from './diffrows';
import {follow as keepInView, scrollFromThumb, thumb} from './layout';
import {footer, isAction, MENU_WIDTH, menuBar, menuBox, menus, pillRow, tabRow, type Command, type Hint, type Pill} from './menu';
import {DOUBLE_CLICK_MS, MOUSE_OFF, MOUSE_ON, parseMouse, type MouseEvent} from './mouse';
import {splashLines, type Counts} from './splash';
import {Screen} from './Screen';
import {glyph, theme} from './theme';
import {agentsBadge, agentsLines, agentsTabVisible, runningAgents} from './views/agents';
import {changesLines, fileKey, turnKey, type Open} from './views/changes';
import {
  changedPlaces, filesLines, firstReadId, MORE_ROWS, nodeId, paperMeasure, peekEnd, readerHead, readerIdAt,
  readerLineOf, readerLines, type Marks,
} from './views/files';
import {METERS_MIN, usageExtras, usageLines} from './views/usage';

type Props = {
  root: string;
  interactive: boolean;
  // --mouse-debug: show the last mouse report in the footer. Terminals differ
  // in how they count rows, and this says at a glance whether they agree.
  mouseDebug?: boolean;
  // --no-opening or SIDECAR_NO_OPENING=1: go straight to the first frame
  // without the three seconds of the name being typed in. On by default.
  opening?: boolean;
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
const GROUP_PILL: Record<Group, string> = {turn: 'By turn', file: 'By file', flat: 'Uncommitted'};

// The columns the bar gives a tool's name. Long enough for `WebFetch`, and the
// elapsed time beside it is the half of `⠧ Bash 4m` that never gives way.
const TOOL_COLS = 8;

const NONE: ReadonlySet<string> = new Set();
const CLOSED: Open = {turns: NONE, files: NONE, more: NONE, steps: NONE, says: NONE, agents: NONE, folded: NONE, hists: NONE};

type Notice = {text: string; warn?: boolean};

// Follow mode: while a turn is running the pane opens each file it touches, as
// it touches it. Anything you do with the keyboard or the mouse pauses it —
// the page is yours the moment you reach for it — and `f` hands it back.
type Follow = 'on' | 'paused' | 'off';

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
//
// The working tree comes in from `useGit`, which has already read it this
// poll: a turn with nothing committed can only be called uncommitted if
// something it touched is dirty right now. It arrives through a ref, because
// the poll must not restart every time git hands back a new object.
function useHistory(root: string, live: boolean, git: GitState | null) {
  const reader = useRef(newReadState());
  const agentReader = useRef(newAgentState());
  const store = useRef<Store | null>(null);
  const latest = useRef(git);
  latest.current = git;
  const [state, setState] = useState<{
    changes: TurnChange[]; agents: AgentRun[]; now: number; version: number; loaded: boolean; counts: Counts | null;
    note: Attention | null;
  }>({changes: [], agents: [], now: Date.now(), version: 0, loaded: false, counts: null, note: null});
  // How many chats there are, before anything has been opened. The first frame
  // draws long before the read comes back and it has to say what it is doing.
  const [chats] = useState(() => countChats(root));

  usePolling(async () => {
    store.current ??= openStore(root);
    const now = Date.now();
    const sessions = readSessions(root, reader.current);
    const agents = readAgents(root, agentReader.current);
    // The transcripts are read; the commits are not. Say so now rather than at
    // the end: on a big history the two are minutes apart.
    const turns = sessions.reduce((n, session) => n + session.turns.length, 0);
    // The same three numbers every poll once the history is read: handing back
    // the state unchanged is React's way of saying there is nothing to draw.
    setState(s =>
      s.counts && s.counts.chats === sessions.length && s.counts.turns === turns && s.counts.agents === agents.length
        ? s
        : {...s, counts: {chats: sessions.length, turns, agents: agents.length}},
    );
    // Claude Code asking to run something is the one thing the transcript
    // never records, so the note the hook left is read against the transcript
    // that has just been read, every poll.
    const note = attention(root, sessions, now);
    if (store.current) await take(store.current, root, now);
    const changes = await loadTurns(root, store.current, sessions, now, latest.current);
    setState(s => ({...s, changes, agents, now, note, version: s.version + 1, loaded: true}));
  }, [root], true, live);

  return {...state, chats, store: store.current};
}

// Every folder of this repository the pane has something to say about. A
// worktree somebody is working in moves as often as the rest of the pane; the
// others cost a git call or two, so they are looked at on the slow cadence.
function useWorktrees(root: string, agents: AgentRun[], git: GitState | null, live: boolean, busy: boolean) {
  const latest = useRef({agents, git});
  latest.current = {agents, git};
  const [trees, setTrees] = useState<WorktreeRun[]>([]);
  usePolling(async () => {
    setTrees(await readWorktrees(root, latest.current.agents, latest.current.git, Date.now()));
  }, [root], true, live, busy ? REFRESH_MS : SLOW_MS);
  return trees;
}

// The chats of the repository's other folders. A chat is keyed by the folder it
// was typed in, so an agent working in its own worktree has a whole history of
// its own that is invisible from here. Only read while the stream is covering
// every folder, and `loadFolders` itself leaves an idle folder alone between
// slow polls.
function useFolders(paths: string[], on: boolean, live: boolean) {
  const key = paths.join('\0');
  const latest = useRef(paths);
  latest.current = paths;
  const [state, setState] = useState<{changes: TurnChange[]; agents: AgentRun[]}>({changes: [], agents: []});
  usePolling(async () => {
    const read = await loadFolders(latest.current, Date.now());
    setState({changes: read.flatMap(one => one.changes), agents: read.flatMap(one => one.agents)});
  }, [key], on && paths.length > 0, live);
  // Nothing of theirs is on screen while the scope is this folder, and a stale
  // list would come back the moment it widened again.
  return on ? state : {changes: [], agents: []};
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

export function App({root, interactive, mouseDebug = false, opening = true}: Props) {
  const {exit} = useApp();
  const {stdout} = useStdout();
  const {cols, rows} = useTerminalSize();

  const [view, setView] = useState<View>('changes');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [mouse, setMouse] = useState(true);
  const [follow, setFollow] = useState<Follow>('on');
  const [menu, setMenu] = useState<{open: number; item: number} | null>(null);
  const [frame, setFrame] = useState(0);
  const [sel, setSel] = useState<Record<Slot, string | null>>({home: null, changes: null, files: null, agents: null, usage: null, reader: null});
  const [scroll, setScroll] = useState<Record<Slot, number>>({home: 0, changes: 0, files: 0, agents: 0, usage: 0, reader: 0});

  // Changes.
  const [group, setGroup] = useState<Group>('turn');
  const [chat, setChat] = useState<string | null>(null);
  // How much of the repository the stream covers: this folder and wherever its
  // agents are working, or every worktree of it.
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
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
  const history = useHistory(root, interactive, git);
  const {spends, limits} = useUsage(view === 'usage', interactive);
  const say = (text: string) => setNotice({text});
  const refuse = (text: string) => setNotice({text, warn: true});
  const now = history.now;

  const mine = useMemo(() => (chat ? history.changes.filter(c => c.chatId === chat) : history.changes), [history.changes, chat]);
  const histories = useMemo(() => byFile(mine), [mine]);
  // The turn the bar's words, `working` and follow mode are all about: the
  // newest by the clock. The changes arrive a chat at a time, so the last of
  // them is the last turn of whichever chat was started last — start a quick
  // second chat at two o'clock and all three would follow the one from nine
  // that is still working.
  const newest = useMemo(
    () => history.changes.reduce<TurnChange | undefined>((best, change) => (best && best.turn.at > change.turn.at ? best : change), undefined),
    [history.changes],
  );
  const working = Boolean(newest?.running);
  const agentsRunning = runningAgents(history.agents, now);
  const worktrees = useWorktrees(root, history.agents, git, interactive, working || agentsRunning > 0);
  // Every other folder of this repository that is still on disk. Its own chats
  // are only read while the stream is covering all of them.
  const elsewhere = useMemo(
    () => worktrees.filter(wt => !wt.here && !wt.gone).map(wt => wt.path).sort(),
    [worktrees],
  );
  const others = useFolders(elsewhere, scope === 'all', interactive);
  // One stream, in the order it all happened. The pane's own turns keep every
  // other job they had: the diffs, the file histories and the Agents view are
  // about the folder you are in.
  const timeline = useMemo(
    () => (others.changes.length ? [...mine, ...others.changes].sort((a, b) => a.turn.at - b.turn.at) : mine),
    [mine, others.changes],
  );
  const streamAgents = useMemo(
    () => (others.agents.length ? [...history.agents, ...others.agents] : history.agents),
    [history.agents, others.agents],
  );
  // The chat's own model. An agent is only worth a model chip when its model
  // is not this one, and a turn still waiting for its first reply has none.
  const chatModel = useMemo(
    () => [...history.changes].reverse().find(change => change.turn.model)?.turn.model ?? '',
    [history.changes],
  );

  // The spinner only ticks while there is something spinning. The first read is
  // one of those things: it is the one the pane is waiting on itself.
  useEffect(() => {
    if (!interactive || (history.loaded && !working && agentsRunning === 0)) return;
    const timer = setInterval(() => setFrame(f => f + 1), SPIN_MS);
    return () => clearInterval(timer);
  }, [interactive, history.loaded, working, agentsRunning]);

  // ---- diffs for the file rows that are open ---------------------------------

  const settled = useRef(new Set<string>());
  useEffect(() => {
    let alive = true;
    const load = async (key: string): Promise<DiffGroup[]> => {
      const at = key.indexOf('|');
      const owner = key.slice(0, at);
      const rel = key.slice(at + 1);
      // `dead` is what to say when there is nothing left to show at all.
      const fromGit = (note?: string, dead?: string): DiffGroup[] => {
        const found = diff?.files[diff.index.get(pathKey(path.resolve(root, rel))) ?? -1] ?? null;
        return found
          ? [{key: 'git', band: null, file: found, note}]
          : [{key: 'none', band: null, file: null, note: dead ?? 'Nothing to show: this file matches the last commit.'}];
      };

      if (owner === 'git') return fromGit();
      const change = timeline.find(c => turnKey(c) === owner);
      // A turn typed in another worktree: its lines are in that folder's own
      // history, and this folder's git knows nothing about them.
      if (change && change.folder !== root) {
        settled.current.add(key);
        return [{key: 'none', band: null, file: null, note: `That turn happened in ${path.basename(change.folder)}. Its diff lives in that folder.`}];
      }

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
  // map the row under the cursor onto its source line and back. The page costs
  // a pass over the file, so it is only laid out again when the file's lines or
  // the paper's measure change, never on a spinner tick.
  const mdLines = useMemo(
    () => (readerPath && isMarkdown(readerPath) && readFile.view?.kind === 'text' ? formatMarkdown(readFile.view.lines, paperMeasure(cols), glyph) : null),
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
    // Phase 2: Home's own page. Nothing opens on it yet.
    if (slot === 'home') return {head: [], lines: []};

    if (slot === 'changes') {
      return {
        head: [],
        lines: changesLines({
          cols, now, frame, root, group, changes: timeline, histories, flat: diff ? diff.files : null, agents: streamAgents,
          open, diffs, folded, opened, hideSpace, sel: at, worktrees, scope, chatModel,
          branch: git?.branch ?? '', working, waiting: history.note?.sessionId,
        }),
      };
    }

    if (slot === 'agents') {
      return {
        head: [],
        lines: agentsLines({
          cols, now, frame, root, changes: history.changes, agents: history.agents, open, sel: at, worktrees, scope, chatModel,
        }),
      };
    }
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
  const lastIndex = useRef<Record<Slot, number>>({home: 0, changes: 0, files: 0, agents: 0, usage: 0, reader: 0});
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
    slot, sel, cols, now, frame, group, scope, timeline, streamAgents, histories, diff, history.agents, worktrees, chatModel, working,
    open, diffs, folded, opened, hideSpace,
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
  const list = menus({
    view, group, hideSpace, changedOnly, chat: chatName, folders: worktrees.length, scope, inDiff, markdown, raw, follow: follow === 'on', mouse,
    // Phase 2: the side panel and the workspaces. Until then there is no panel
    // and nothing is picked, which is what the pane draws today.
    panel: 'off', focus: null, workspaces: [],
  });
  // The card, and not the stream, on the two occasions there is no stream: the
  // first frames, and a folder Claude Code has never been run in. Files is left
  // alone — the tree is worth looking at whether or not anything was ever typed
  // here — and so is every grouping but By turn, the only one the chats are the
  // content of.
  const reading = !history.loaded && slot !== 'files' && slot !== 'reader';
  const nothingYet = history.loaded && history.counts?.chats === 0 && slot === 'changes' && group === 'turn';
  const card = reading || nothingYet;
  // Reading comes first while it lasts: nothing else is known yet. Then agents
  // — while a fan-out is running, how many of them there are is the news, and
  // the turn they belong to is working by definition.
  //
  // Then the one word that is about you rather than about Claude. It is keyed
  // on a turn that has not ended and a question nobody has answered, never on
  // the turn running: a turn parked on a permission prompt appends nothing at
  // all, and waiting is exactly what it is doing.
  const lastAction = newest?.turn.actions[newest.turn.actions.length - 1];
  const asking = Boolean(newest && !newest.turn.ended && (newest.turn.asking || history.note));
  const sameDay = (ms: number) => new Date(ms).toDateString() === new Date(now).toDateString();
  const status: Seg[] = !history.loaded
    ? [seg(spinner(frame), theme.accent), seg(' reading', theme.dim)]
    : agentsRunning
      ? [seg(spinner(frame), theme.accent), seg(` ${agentsRunning} agent${agentsRunning === 1 ? '' : 's'}`, theme.ink)]
      : asking
        ? [seg(glyph.dot, theme.warn), seg(' asking you', theme.warn)]
        : working && newest
          ? [seg(spinner(frame), theme.accent), seg(` ${lastAction ? `${cut(lastAction.tool, TOOL_COLS)} ` : ''}${brief(now - newest.turn.at)}`, theme.ink)]
          : newest?.turn.ended && sameDay(newest.turn.endedAt)
            ? [seg(glyph.dot, theme.ink), seg(' your turn', theme.text)]
            : [seg(glyph.dot, theme.faint), seg(' idle', theme.dim)];
  // What is left of the bar once the menus and the status have had their
  // columns. The meters shrink in steps and then go, so the menus always fit.
  const barLeft = 2 + list.reduce((n, m) => n + m.title.length + 2, 0);
  const metersRoom = cols - barLeft - 2 - widthOf(status) - 3;
  const extras = metersRoom >= METERS_MIN ? usageExtras(limits, now, {spends, room: metersRoom}) : [];
  const bar = menuBar(cols, list, menu?.open ?? null, {meters: extras, status});

  const uncommitted = git ? [...git.changes.values()].filter(c => c.status !== 'D').length : 0;
  const showAgents = agentsTabVisible(history.changes, history.agents, now) || view === 'agents';
  // A question waiting on you is the one thing worth pulling you out of
  // another view, so the tab it happened on carries a dot until you look.
  const tabs = tabRow(
    cols,
    view,
    {agents: agentsBadge(history.agents, now, frame), changes: asking && view !== 'changes' ? [seg(glyph.dot, theme.warn)] : []},
    {agents: !showAgents},
  );

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
  // The right end of the pills row. A repository with more than one folder has
  // something to say there that a count of dirty files cannot: which folders
  // this stream is covering, and one click to widen it.
  const folders = worktrees.length;
  const scopePill: Seg[] =
    view === 'changes' && folders > 1
      ? [
          seg('in ', theme.faint),
          seg(scope === 'all' ? `all ${folders} worktrees` : project, scope === 'all' ? theme.accent : theme.text, {bold: true}),
          seg(` ${glyph.open}`, theme.dim),
        ]
      : [];
  const note: Seg[] = scopePill.length
    ? scopePill
    : view === 'changes' && uncommitted
      ? [seg(`${uncommitted} uncommitted`, theme.dim)]
      : [];
  const scopeAct: Act | undefined = scopePill.length ? {type: 'scope', scope: scope === 'all' ? 'mine' : 'all'} : undefined;
  // Nothing has been read, so there is nothing for a pill to be showing or
  // hiding yet: the first frame is the bar, the tabs and the card.
  const pillsLine = pills.length && !reading ? pillRow(cols, pills, note, scopeAct) : null;
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
      const next = keepInView(s[slot], cursor, height, lines.length);
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

  // ---- follow mode ---------------------------------------------------------------

  // The files the running turn was known to have touched at the last poll, and
  // the one diff this opened. The set is remembered whether or not follow is
  // on, so resuming shows what happens next rather than everything that
  // happened while you were reading something else.
  const touched = useRef<{turn: string; files: ReadonlySet<string>} | null>(null);
  const showing = useRef<string | null>(null);
  useEffect(() => {
    if (!newest?.running) return;
    const turn = turnKey(newest);
    // The snapshot's list, not the transcript's: a file a shell command
    // changed without naming it counts exactly as much as an edit.
    const files = new Set(newest.files.filter(file => file.known).map(file => file.rel));
    const was = touched.current;
    touched.current = {turn, files};
    if (follow !== 'on' || slot !== 'changes' || group !== 'turn') return;
    // Nothing is new about a turn this is seeing for the first time.
    if (!was || was.turn !== turn) return;
    const fresh = [...files].find(rel => !was.files.has(rel));
    if (!fresh) return;

    // One followed diff at a time: the one before it closes as this opens, so
    // the block does not grow a tail of everything the turn has ever touched.
    const want = fileKey(turn, fresh);
    // Read the ref here, not inside the updater: React runs the updater during
    // the next render, by which time the ref already names the new file.
    const last = showing.current;
    setOpen(o => {
      const next = new Set(o.files);
      if (last) next.delete(last);
      next.add(want);
      return {...o, files: next};
    });
    showing.current = want;
    anchor.current = {id: `f:${want}`, y: 3, slot: 'changes'};
    setSel(s => ({...s, changes: `f:${want}`}));
  }, [history.version]);

  // Anything you do with the keyboard or the mouse, `f` aside, hands the page
  // back to you until you ask for it again.
  const pause = () => setFollow(f => (f === 'on' ? 'paused' : f));

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

  // A place in the code, onto the clipboard, through the terminal itself. OSC
  // 52 is the one way a pane running inside somebody else's terminal can reach
  // it, and it is the whole of what the pane may do with a line: no file is
  // written, no command is run, and what lands there is a place, not the code.
  const copyPlace = (place: {path: string; line: number}) => {
    const where = `${path.relative(root, place.path).split(path.sep).join('/')}:${place.line}`;
    stdout.write(`\u001B]52;c;${Buffer.from(where).toString('base64')}\u0007`);
    say(`copied ${where}`);
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

      case 'scope': {
        // No notice: the pill at the right of the pills row says which.
        if (worktrees.length < 2) return refuse('This repository has one folder, so there is nothing else to show.');
        setView('changes');
        setGroup('turn');
        return setScope(command.to ?? (scope === 'all' ? 'mine' : 'all'));
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

      // No notice: the footer says `following` or `follow` either way, and a
      // message there would cover the hints it is one of.
      case 'follow':
        return setFollow(follow === 'on' ? 'off' : 'on');
      case 'mouse':
        stdout.write(mouse ? MOUSE_OFF : MOUSE_ON);
        setMouse(!mouse);
        return say(mouse ? 'Mouse off. Select and copy freely.' : 'Mouse on.');
      case 'quit':
        return exit();
      // Phase 2: Home, the side panel, the workspaces and the opening.
      case 'home':
      case 'panel':
      case 'focus':
      case 'skip':
        return;
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
      case 'scope':
        return run({do: 'scope', to: act.scope});
      // Phase 2: picking a workspace, the side panel and the opening.
      case 'focus':
      case 'panel':
      case 'skip':
        return;

      case 'turn':
        return setOpen(o => ({...o, turns: flipped(o.turns, act.key)}));
      case 'file':
        return setOpen(o => ({...o, files: flipped(o.files, act.key)}));
      case 'toggle': {
        // Phase 2: landing rows open once the stream draws them.
        const set = act.set;
        if (set === 'landings') return;
        return setOpen(o => ({...o, [set]: flipped(o[set], act.key)}));
      }

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
        const id = `t:${act.key}`;
        // A click on the day's skyline is a click on a turn: its row opens and
        // has to stay where it is, exactly as if the row itself was clicked.
        // The row may be anywhere in the stream, or off screen entirely, so the
        // anchor uses the screen row it is on now and otherwise the top.
        if (slot === 'changes') {
          const y = visible.findIndex(line => line.id === id);
          anchor.current = {id, y: Math.max(0, y), slot: 'changes'};
        }

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

      // The pills are two states, not a toggle: pressing the lit one does nothing.
      case 'page':
        return act.raw === raw ? undefined : run({do: 'raw'});
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
    pause();
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
      if (input !== 'f') pause();

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
      if (input === 'f') return follow === 'paused' ? setFollow('on') : run({do: 'follow'});
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

        // On a row that is open: close it. A turn's own title row closes the
        // turn whatever Enter does there — on a prompt too long for one line
        // Enter shows the rest of it, and Esc still has to be the way out.
        const id = current?.id ?? '';
        const act = current?.act;
        if (id.startsWith('t:') && lines[cursor + 1]?.pins?.includes(id)) return perform({type: 'turn', key: id.slice(2)});
        const isOpen =
          (act?.type === 'file' && open.files.has(act.key)) ||
          (act?.type === 'toggle' && act.set !== 'landings' && open[act.set].has(act.key));
        return isOpen ? perform(act) : undefined;
      }

      if (input === 'y') {
        if (!current?.at) return refuse('Move onto a line of a diff or a file first.');
        return copyPlace(current.at);
      }

      if (input === ']' || input === '[') {
        const dir = input === ']' ? 1 : -1;
        if (slot === 'changes') return jump(dir, line => Boolean(line.id?.startsWith('f:') || line.id?.startsWith('t:') || line.id?.startsWith('h:')));
        return nextChange(dir);
      }

      if (slot === 'changes') {
        if (input === 'v') return run({do: 'group', group: GROUPS[(GROUPS.indexOf(group) + 1) % GROUPS.length]!});
        if (input === 's') return run({do: 'chat'});
        // `w` is worth more on the folders than on whitespace: one of them is
        // work you cannot see at all, the other is noise in a diff.
        if (input === 'w') return run({do: 'scope'});
        if (input === 'W') return run({do: 'whitespace'});
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
  //
  // The first hint is the row's own: only the view that built it knows what
  // Enter will do there, and `open` is the answer when it did not say. The way
  // back out is second, and only where there is something to go back to — a
  // row inside something that is open is the one that has pins.
  const verb: Hint = ['enter', current?.hint ?? 'open'];
  const back: Hint[] = current?.pins?.length ? [['esc', 'back']] : [];
  // Follow mode says which it is where it is turned on and off: lit while the
  // pane is opening the running turn's files, quiet while the page is yours.
  // It sits at the front because it is the only sign the pane is following,
  // and the footer drops from the back.
  const trail: Hint = follow === 'on' ? ['f', 'following', theme.accent] : ['f', 'follow'];
  const hints: Hint[] =
    slot === 'changes'
      ? inDiff
        ? [verb, ...back, ['m', 'menu'], ['↑↓', 'line'], [']', 'hunk'], ['o', 'open'], ['z', 'fold all']]
        : agentsRunning
          ? [verb, ...back, trail, ['3', 'agents'], ['m', 'menu'], ['↑↓', 'move']]
          : [verb, ...back, trail, ['m', 'menu'], ['↑↓', 'move'], [']', 'next'], ['v', 'group']]
      : slot === 'files'
        ? peekPath
          ? [verb, ...back, ['o', 'read all'], ['m', 'menu'], [']', 'next change']]
          : [verb, ...back, ['m', 'menu'], ['↑↓', 'move'], ['o', 'read'], ['c', 'changed'], ['q', 'quit']]
        : slot === 'reader'
          ? [['↑↓', 'line'], ['esc', 'back'], ['m', 'menu'], [']', 'change'], ['space', 'scroll'], ...(markdown ? [['r', raw ? 'page' : 'source'] as Hint] : [])]
          : slot === 'agents'
            ? [verb, ...back, ['m', 'menu'], ['↑↓', 'move']]
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

  // The card takes the stream's place whole, a third of the way down it, so
  // the chrome above it and the footer under it never move when the real rows
  // arrive.
  const body: Line[] = !card
    ? stream
    : ((): Line[] => {
        const rows = splashLines(cols, {
          folder: project,
          branch: git?.branch ?? '',
          counts: history.counts,
          chats: history.chats,
          reading: !history.loaded,
          frame,
        }).map(line => ({segs: [...line.segs, sp(1)]}));
        const lead = Math.min(Math.floor(height / 3), Math.max(0, height - rows.length));
        return Array.from({length: height}, (_, i) => rows[i - lead] ?? blank);
      })();

  let screen: Line[] = [
    ...top,
    ...body,
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

  return <Screen lines={screen} cols={cols} rows={rows} />;
}

