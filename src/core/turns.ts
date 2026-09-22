import path from 'node:path';
import {buildDiff, type FileDiff, type FileStatus} from './diff';
import {
  branchOf, commitsSince, defaultBranch, EMPTY_TREE, isAncestor, patchBetweenCommits, pathKey, statBetweenCommits,
  upstreamOf, type Commit, type GitState,
} from './git';
import type {Session, Turn} from './sessions';
import {after, before, covered, patchFile, statBetween, type Store} from './snapshot';

// Joins the two halves of the story: the transcript knows which chat and which
// prompt, the snapshots know which lines. A turn is the unit that has both.
// When sidecar was not running for a turn there is still a third source: the
// project's own commits, matched to the turn by time.

export type ChangedFile = {
  rel: string;
  path: string;
  status: FileStatus;
  added: number;
  removed: number;
  // True when the counts are real, because a snapshot or a commit holds them.
  // False for a file the transcript merely named: it stays in the list, with
  // no numbers.
  known: boolean;
};

export type TurnChange = {
  turn: Turn;
  chat: string;
  chatId: string;
  // The folder this turn was typed in. The pane's own folder for everything it
  // reads itself; another worktree of the same repository when the stream is
  // covering all of them.
  folder: string;
  files: ChangedFile[];
  added: number;
  removed: number;
  // True when the counts are real, whichever source recorded them.
  measured: boolean;
  // Which source: snapshots taken either side of the turn, or the commits that
  // landed inside its window. Null when neither recorded it and all we have is
  // what the transcript claimed.
  via: 'snapshots' | 'commits' | null;
  // How many commits were matched to it, so the row can say where it got this.
  commits: number;
  running: boolean;
  // Two snapshot trees, or two commits, depending on `via`.
  from: string | null;
  to: string | null;
  // The commits that landed inside this turn's window, oldest first. Every
  // turn gets these, watched or not: they are the receipt for the work, and a
  // turn the pane measured itself still wants to say where that work stands.
  landed: Landed[];
  // Where the work stands: nothing to say, still only in the working tree,
  // committed, or arrived on the branch the project keeps its work on.
  git: TurnGit;
};

export type Landed = {sha: string; subject: string; at: number; merge: boolean};

export type TurnGit = 'none' | 'uncommitted' | 'committed' | 'merged';

const stats = new Map<string, ChangedFile[]>();

// A turn ends when the transcript says it ended, not when it goes quiet. This
// is only the bound on the other case: Claude Code was closed mid-reply, so
// nothing will ever write the line that ends the turn, and a turn with no end
// would otherwise read as running for ever.
const QUIET = 120_000;

function claimed(root: string, turn: Turn): ChangedFile[] {
  return turn.claimed.map(file => ({
    rel: path.relative(root, file).split(path.sep).join('/'),
    path: file,
    status: 'modified' as FileStatus,
    added: 0,
    removed: 0,
    known: false,
  }));
}

// A commit belongs to the turn with the latest start at or before its
// committer time, across every chat of this project: a turn's window runs from
// its own start to the start of the next turn wherever that was typed, or to
// now for the newest. That catches both the commits Claude makes while working
// and the one the owner makes by hand after reading the result.
async function matchCommits(root: string, changes: TurnChange[]): Promise<Map<TurnChange, Commit[]>> {
  const mine = new Map<TurnChange, Commit[]>();
  if (changes.length === 0) return mine;

  // The log only has to reach as far back as the oldest turn there is.
  const since = Math.min(...changes.map(change => change.turn.at));
  const log = await commitsSince(root, since);
  if (!log || log.length === 0) return mine;

  // Both lists are in time order, so one walk matches them.
  const order = [...changes].sort((a, b) => a.turn.at - b.turn.at);
  let i = 0;
  let owner: TurnChange | null = null;
  for (const commit of log) {
    while (i < order.length && order[i]!.turn.at <= commit.at) owner = order[i++]!;
    if (!owner) continue;
    mine.set(owner, [...(mine.get(owner) ?? []), commit]);
  }

  return mine;
}

// Only a turn the pane did not watch is filled in from its commits. A turn
// measured from snapshots already knows its own lines, and commits would add
// nothing but doubt about which of them it was.
async function fromCommits(root: string, matched: Map<TurnChange, Commit[]>): Promise<void> {
  for (const [change, window] of matched) {
    if (change.measured) continue;
    const first = window[0]!;
    // The very first commit of a repository has no parent to compare with.
    const base = first.parent || EMPTY_TREE;
    const tip = window[window.length - 1]!.sha;

    const key = `${base}..${tip}`;
    let files = stats.get(key);
    if (!files) {
      files = (await statBetweenCommits(root, base, tip)).map(stat => ({
        rel: stat.rel,
        path: path.resolve(root, stat.rel),
        status: stat.status,
        added: stat.added,
        removed: stat.removed,
        known: true,
      }));
      // A commit never changes, so its counts are worked out once.
      stats.set(key, files);
    }

    // A file the transcript named that no commit holds stays in the list the
    // way it reads today: there, and honest about having no numbers.
    const held = new Set(files.map(file => file.rel));
    change.files = [...files, ...change.files.filter(file => !held.has(file.rel))].sort((a, b) => a.rel.localeCompare(b.rel));
    change.added = files.reduce((n, f) => n + f.added, 0);
    change.removed = files.reduce((n, f) => n + f.removed, 0);
    change.measured = true;
    change.via = 'commits';
    change.commits = window.length;
    change.from = base;
    change.to = tip;
  }
}

// The branch a turn's work has to reach before it counts as merged: the
// project's trunk, or, when the pane is sitting on the trunk itself, whatever
// that trunk tracks — there "merged" can only mean pushed. Null when there is
// nothing to compare with, and then `committed` is the most a turn can say.
//
// Which branch we are on is read from git rather than taken from `state`,
// which is null until the pane's second poll: without that, a repo sitting on
// its own trunk called its every commit merged for one frame.
async function trunkOf(root: string, state: GitState | null): Promise<string | null> {
  const branch = await defaultBranch(root);
  if (!branch) return null;
  const here = state?.branch ?? (await branchOf(root)) ?? '';
  if (here && (here === branch || `origin/${here}` === branch)) return upstreamOf(root);
  return branch;
}

// Where every turn's work stands, watched or not. The commits are the receipt;
// the branch says whether they have arrived; and a turn with nothing committed
// is still worth marking when one of the files it changed is dirty right now.
async function markGit(
  root: string,
  changes: TurnChange[],
  matched: Map<TurnChange, Commit[]>,
  state: GitState | null,
): Promise<void> {
  const trunk = matched.size ? await trunkOf(root, state) : null;
  for (const change of changes) {
    const window = matched.get(change) ?? [];
    change.landed = window.map(commit => ({sha: commit.sha, subject: commit.subject, at: commit.at, merge: commit.merge}));

    if (window.length) {
      const newest = window[window.length - 1]!.sha;
      change.git = trunk && (await isAncestor(root, newest, trunk)) ? 'merged' : 'committed';
      continue;
    }

    // Only a file something actually counted can be called dirty: a file the
    // transcript merely named is a claim, not a change.
    const known = change.files.filter(file => file.known);
    const dirty = state ? known.some(file => state.changes.has(pathKey(file.path))) : false;
    change.git = dirty ? 'uncommitted' : 'none';
  }
}

// Every turn of every chat, newest last, with what it changed. `state` is the
// working tree as git sees it now, and only the `uncommitted` mark needs it,
// so a caller that has not read git yet can leave it out.
export async function loadTurns(
  root: string,
  store: Store | null,
  sessions: Session[],
  now: number,
  state: GitState | null = null,
): Promise<TurnChange[]> {
  const out: TurnChange[] = [];

  for (const session of sessions) {
    for (const [i, turn] of session.turns.entries()) {
      const next = session.turns[i + 1];
      const running = !next && !turn.ended && now - turn.endedAt < QUIET;
      const base: TurnChange = {
        turn,
        chat: session.title || 'Untitled chat',
        chatId: session.id,
        folder: root,
        files: [],
        added: 0,
        removed: 0,
        measured: false,
        via: null,
        commits: 0,
        running,
        from: null,
        to: null,
        landed: [],
        git: 'none',
      };

      const start = store ? before(store, turn.at) : null;
      // A turn still running has no snapshot after it yet, so "now" stands in.
      const end = store
        ? (after(store, turn.endedAt) ?? (running ? store.shots[store.shots.length - 1] ?? null : null))
        : null;

      // Snapshots only belong to a turn if sidecar was looking the whole time.
      // Otherwise the nearest ones may be hours away and full of other turns.
      const watching = store ? covered(store, turn.at, running ? now : turn.endedAt) : false;
      if (!store || !start || !end || !watching) {
        base.files = claimed(root, turn);
        out.push(base);
        continue;
      }

      if (start.tree === end.tree) {
        base.measured = true;
        base.via = 'snapshots';
        out.push(base);
        continue;
      }

      base.from = start.tree;
      base.to = end.tree;
      base.measured = true;
      base.via = 'snapshots';

      const key = `${start.tree}..${end.tree}`;
      let files = stats.get(key);
      if (!files) {
        files = (await statBetween(store, root, start.tree, end.tree)).map(stat => ({
          rel: stat.rel,
          path: path.resolve(root, stat.rel),
          status: stat.status,
          added: stat.added,
          removed: stat.removed,
          known: true,
        }));
        // Trees never change, so a count only has to be worked out once.
        if (!running) stats.set(key, files);
      }

      base.files = files;
      base.added = files.reduce((n, f) => n + f.added, 0);
      base.removed = files.reduce((n, f) => n + f.removed, 0);
      out.push(base);
    }
  }

  // Whatever the pane was not there for, git may still have the receipt.
  // Outside a git repo this does nothing and every turn reads as it did.
  const matched = await matchCommits(root, out);
  await fromCommits(root, matched);
  await markGit(root, out, matched, state);

  return out;
}

// The diff of one file as one turn left it: between the two snapshots, or
// between the two commits, depending on which recorded it.
export async function fileInTurn(
  root: string,
  store: Store | null,
  change: TurnChange,
  rel: string,
): Promise<FileDiff | null> {
  if (!change.from || !change.to) return null;
  const patch =
    change.via === 'commits'
      ? await patchBetweenCommits(root, change.from, change.to, rel)
      : store
        ? await patchFile(store, root, change.from, change.to, rel)
        : null;
  if (!patch) return null;
  return buildDiff(root, root, patch)[0] ?? null;
}

export type FileHistory = {
  rel: string;
  path: string;
  status: FileStatus;
  added: number;
  removed: number;
  // At least one of the turns below has real counts for this file.
  measured: boolean;
  touches: {change: TurnChange; added: number; removed: number; known: boolean}[];
};

// The same changes seen the other way round: one row per file, and the turns
// that touched it underneath.
export function byFile(changes: TurnChange[]): FileHistory[] {
  const map = new Map<string, FileHistory>();
  for (const change of changes) {
    for (const file of change.files) {
      let entry = map.get(file.rel);
      if (!entry) {
        entry = {
          rel: file.rel,
          path: file.path,
          status: file.status,
          added: 0,
          removed: 0,
          measured: false,
          touches: [],
        };
        map.set(file.rel, entry);
      }

      entry.added += file.added;
      entry.removed += file.removed;
      // Per file, not per turn: a turn filled in from commits can hold both a
      // file git counted and a file only the transcript named.
      entry.measured ||= file.known;
      // The newest status wins: a file created then edited is still new.
      if (file.status === 'added' || file.status === 'deleted') entry.status = file.status;
      entry.touches.push({change, added: file.added, removed: file.removed, known: file.known});
    }
  }

  return [...map.values()].sort((a, b) => a.rel.localeCompare(b.rel));
}

// Where a turn landed, as a place rather than a list of paths. The key is the
// first two segments of a file's own folder, so `src/ui/views/changes.ts` and
// `src/ui/App.tsx` are both `src/ui`; a file at the top of the project is
// `root`, because "" reads as nothing.
export function folderOf(rel: string): string {
  const parts = rel.split('/').slice(0, -1);
  return parts.length ? parts.slice(0, 2).join('/') : 'root';
}

export type FolderShare = {key: string; share: number; lines: number; files: number};

// Past this many folders the rest are one part called `other`: a bar of
// eight slivers says less than a bar of four and a remainder.
const FOLDERS_SHOWN = 4;
const OTHER = 'other';

// One part per folder, biggest first, each with its share of the turn.
// Changed lines are the measure; a turn nothing counted falls back to how many
// files it touched, which is the only size it has.
export function folderShares(files: ChangedFile[], measured: boolean): FolderShare[] {
  const by = new Map<string, {lines: number; files: number}>();
  for (const file of files) {
    const key = folderOf(file.rel);
    const entry = by.get(key) ?? {lines: 0, files: 0};
    entry.lines += file.added + file.removed;
    entry.files += 1;
    by.set(key, entry);
  }

  const lines = [...by.values()].reduce((n, e) => n + e.lines, 0);
  const byLines = measured && lines > 0;
  const weigh = (entry: {lines: number; files: number}): number => (byLines ? entry.lines : entry.files);
  const total = byLines ? lines : files.length;
  if (!total) return [];

  const sorted = [...by.entries()]
    .map(([key, entry]) => ({key, lines: entry.lines, files: entry.files}))
    .sort((a, b) => weigh(b) - weigh(a) || a.key.localeCompare(b.key));

  const kept = sorted.slice(0, FOLDERS_SHOWN);
  const rest = sorted.slice(FOLDERS_SHOWN);
  const parts = kept.map(part => ({...part, share: weigh(part) / total}));
  if (rest.length) {
    const lump = rest.reduce((sum, part) => ({lines: sum.lines + part.lines, files: sum.files + part.files}), {lines: 0, files: 0});
    parts.push({key: OTHER, ...lump, share: weigh(lump) / total});
  }

  return parts;
}

export type FolderGroup = {
  key: string;
  lines: number;
  // The same files, each with the path the row under this folder shows:
  // `views/changes.ts` under `src/ui`.
  files: {file: ChangedFile; label: string}[];
};

// The turn's files under the same keys the shares use, biggest folder first,
// so the bar above the list and the list itself say the same thing.
export function groupByFolder(files: ChangedFile[]): FolderGroup[] {
  const by = new Map<string, FolderGroup>();
  for (const file of files) {
    const key = folderOf(file.rel);
    let group = by.get(key);
    if (!group) by.set(key, (group = {key, lines: 0, files: []}));
    group.lines += file.added + file.removed;
    group.files.push({file, label: key === 'root' ? file.rel : file.rel.slice(key.length + 1) || file.rel});
  }

  return [...by.values()].sort((a, b) => b.lines - a.lines || b.files.length - a.files.length || a.key.localeCompare(b.key));
}

export type DayGroup = {
  // Local midnight of the day these turns were typed on, and whose chat.
  day: number;
  chatId: string;
  chat: string;
  // Oldest first, the order the skyline draws them in.
  turns: TurnChange[];
  added: number;
  removed: number;
  // The first prompt to the last reply: how long that day's work ran.
  span: number;
};

function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

// The day headers, newest first: one per day and chat, with that day's turns
// in time order and its totals. A day is where the stream breaks, so the same
// grouping has to build the header, the skyline and the totals beside them.
export function daySummary(changes: TurnChange[], now: number): DayGroup[] {
  const by = new Map<string, DayGroup>();
  for (const change of changes) {
    const day = startOfDay(change.turn.at);
    const key = `${day}\0${change.chatId}`;
    let group = by.get(key);
    if (!group) by.set(key, (group = {day, chatId: change.chatId, chat: change.chat, turns: [], added: 0, removed: 0, span: 0}));
    group.turns.push(change);
    group.added += change.added;
    group.removed += change.removed;
  }

  for (const group of by.values()) {
    group.turns.sort((a, b) => a.turn.at - b.turn.at);
    const first = group.turns[0]!;
    const last = group.turns[group.turns.length - 1]!;
    group.span = Math.max(0, (last.running ? now : last.turn.endedAt) - first.turn.at);
  }

  return [...by.values()].sort((a, b) => b.day - a.day || b.turns[0]!.turn.at - a.turns[0]!.turn.at);
}
