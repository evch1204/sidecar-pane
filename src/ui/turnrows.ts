import type {ChangedFile, FileHistory, TurnChange} from '../core/turns';

// The Changes list, as a flat array of rows. Same idea as the diff body: one
// array that the renderer draws, the cursor indexes, and a click maps onto.

export type ListRow =
  | {kind: 'section'; label: string; when: string}
  | {kind: 'turn'; change: TurnChange; open: boolean}
  | {kind: 'file'; change: TurnChange | null; file: ChangedFile; indent: boolean}
  | {kind: 'more'; owner: string; text: string}
  | {kind: 'fileHead'; history: FileHistory; open: boolean}
  | {kind: 'touch'; history: FileHistory; change: TurnChange; added: number; removed: number}
  | {kind: 'empty'; text: string};

const FILES_SHOWN = 8;

const DAY = 86_400_000;

export function dayLabel(at: number, now: number): string {
  const startOf = (ms: number) => new Date(new Date(ms).toDateString()).getTime();
  const days = Math.round((startOf(now) - startOf(at)) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return new Date(at).toLocaleDateString(undefined, {weekday: 'long'}).toLowerCase();
  return new Date(at).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

export function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit', hour12: false});
}

export function turnKey(change: TurnChange): string {
  return `${change.chatId}:${change.turn.id}`;
}

// Newest first: what just happened is what you want to see.
export function turnRows(
  changes: TurnChange[],
  open: ReadonlySet<string>,
  showAll: ReadonlySet<string>,
  now: number,
): ListRow[] {
  if (changes.length === 0) return [];
  const out: ListRow[] = [];
  let section = '';

  for (const change of [...changes].reverse()) {
    const when = dayLabel(change.turn.at, now);
    const mark = `${change.chatId}|${when}`;
    if (mark !== section) {
      section = mark;
      out.push({kind: 'section', label: change.chat, when});
    }

    const key = turnKey(change);
    const isOpen = open.has(key);
    out.push({kind: 'turn', change, open: isOpen});
    if (!isOpen) continue;

    const all = showAll.has(key);
    const files = all ? change.files : change.files.slice(0, FILES_SHOWN);
    for (const file of files) out.push({kind: 'file', change, file, indent: true});
    if (!all && change.files.length > FILES_SHOWN) {
      out.push({kind: 'more', owner: key, text: `… ${change.files.length - FILES_SHOWN} more files`});
    }
  }

  return out;
}

export function fileRows(histories: FileHistory[], open: ReadonlySet<string>): ListRow[] {
  const out: ListRow[] = [];
  for (const history of histories) {
    const isOpen = open.has(history.rel);
    out.push({kind: 'fileHead', history, open: isOpen});
    if (!isOpen) continue;
    for (const touch of [...history.touches].reverse()) {
      out.push({kind: 'touch', history, change: touch.change, added: touch.added, removed: touch.removed});
    }
  }

  return out;
}

// What the body should show for the row under the cursor.
export type Target =
  | {kind: 'why'; change: TurnChange}
  | {kind: 'file'; change: TurnChange | null; rel: string; path: string}
  | {kind: 'history'; history: FileHistory}
  | {kind: 'none'};

export function targetOf(row: ListRow | undefined): Target {
  if (!row) return {kind: 'none'};
  if (row.kind === 'turn') return {kind: 'why', change: row.change};
  if (row.kind === 'file') return {kind: 'file', change: row.change, rel: row.file.rel, path: row.file.path};
  if (row.kind === 'fileHead') return {kind: 'history', history: row.history};
  if (row.kind === 'touch') {
    return {kind: 'file', change: row.change, rel: row.history.rel, path: row.history.path};
  }

  return {kind: 'none'};
}
