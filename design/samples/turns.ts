import path from 'node:path';
import {buildDiff, type FileDiff, type FileStatus} from './diff';
import type {Session, Turn} from './sessions';
import {after, before, patchFile, statBetween, type Store} from './snapshot';

// Joins the two halves of the story: the transcript knows which chat and which
// prompt, the snapshots know which lines. A turn is the unit that has both.

export type ChangedFile = {
  rel: string;
  path: string;
  status: FileStatus;
  added: number;
  removed: number;
};

export type TurnChange = {
  turn: Turn;
  chat: string;
  chatId: string;
  files: ChangedFile[];
  added: number;
  removed: number;
  // True when the files were read off snapshots taken either side of the turn.
  // False when sidecar was not running then and all we have is what the
  // transcript claimed.
  measured: boolean;
  running: boolean;
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
  }));
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
        running,
        from: null,
        to: null,
      };

      const start = store ? before(store, turn.at) : null;
      // A turn still running has no snapshot after it yet, so "now" stands in.
      const end = store
        ? (after(store, turn.endedAt) ?? (running ? store.shots[store.shots.length - 1] ?? null : null))
        : null;

      if (!store || !start || !end || start.tree === end.tree) {
        base.files = claimed(root, turn);
        out.push(base);
        continue;
      }

      base.from = start.tree;
      base.to = end.tree;
      base.measured = true;

      const key = `${start.tree}..${end.tree}`;
      let files = stats.get(key);
      if (!files) {
        files = (await statBetween(store, root, start.tree, end.tree)).map(stat => ({
          rel: stat.rel,
          path: path.resolve(root, stat.rel),
          status: stat.status,
          added: stat.added,
          removed: stat.removed,
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

  return out;
}

// The diff of one file as one turn left it.
export async function fileInTurn(
  root: string,
  store: Store,
  change: TurnChange,
  rel: string,
): Promise<FileDiff | null> {
  if (!change.from || !change.to) return null;
  const patch = await patchFile(store, root, change.from, change.to, rel);
  if (!patch) return null;
  return buildDiff(root, root, patch)[0] ?? null;
}

export type FileHistory = {
  rel: string;
  path: string;
  status: FileStatus;
  added: number;
  removed: number;
  // At least one of the turns below was measured from snapshots.
  measured: boolean;
  touches: {change: TurnChange; added: number; removed: number}[];
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
      entry.measured ||= change.measured;
      // The newest status wins: a file created then edited is still new.
      if (file.status === 'added' || file.status === 'deleted') entry.status = file.status;
      entry.touches.push({change, added: file.added, removed: file.removed});
    }
  }

  return [...map.values()].sort((a, b) => a.rel.localeCompare(b.rel));
}
