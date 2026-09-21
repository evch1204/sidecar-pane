import path from 'node:path';
import {buildDiff, type FileDiff, type FileStatus} from './diff';
import {commitsSince, EMPTY_TREE, patchBetweenCommits, statBetweenCommits, type Commit} from './git';
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
};

const stats = new Map<string, ChangedFile[]>();

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
//
// Only a turn the pane did not watch is filled in this way. A turn measured
// from snapshots already knows its own lines, and commits would add nothing
// but doubt about which of them it was.
async function fromCommits(root: string, changes: TurnChange[]): Promise<void> {
  const missing = changes.filter(change => !change.measured);
  if (missing.length === 0) return;

  // The log only has to reach as far back as the oldest turn still missing.
  const since = Math.min(...missing.map(change => change.turn.at));
  const log = await commitsSince(root, since);
  if (!log || log.length === 0) return;

  // Both lists are in time order, so one walk matches them.
  const order = [...changes].sort((a, b) => a.turn.at - b.turn.at);
  const mine = new Map<TurnChange, Commit[]>();
  let i = 0;
  let owner: TurnChange | null = null;
  for (const commit of log) {
    while (i < order.length && order[i]!.turn.at <= commit.at) owner = order[i++]!;
    if (!owner || owner.measured) continue;
    mine.set(owner, [...(mine.get(owner) ?? []), commit]);
  }

  for (const [change, window] of mine) {
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

// Every turn of every chat, newest last, with what it changed.
export async function loadTurns(
  root: string,
  store: Store | null,
  sessions: Session[],
  now: number,
): Promise<TurnChange[]> {
  const out: TurnChange[] = [];

  for (const session of sessions) {
    for (const [i, turn] of session.turns.entries()) {
      const next = session.turns[i + 1];
      const running = !next && now - turn.endedAt < 120_000;
      const base: TurnChange = {
        turn,
        chat: session.title || 'Untitled chat',
        chatId: session.id,
        files: [],
        added: 0,
        removed: 0,
        measured: false,
        via: null,
        commits: 0,
        running,
        from: null,
        to: null,
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
  await fromCommits(root, out);

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
