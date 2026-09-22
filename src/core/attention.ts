import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {Session} from './sessions';
import {isRunning} from './turns';

// Claude Code asking to run something is the one thing the transcript never
// records: the prompt lives in the CLI and leaves nothing behind either way
// you answer. `hooks/attention.mjs` writes it down when it happens; this reads
// that note back and decides whether it is still true.
//
// The note is never deleted, by the hook or by anything else. A file on disk
// only means "a prompt was raised here once", so every question the pane asks
// about it is answered from the transcript instead.

export type Attention = {
  at: number;
  // The tool Claude Code wants to run: `Bash`, `Write`.
  tool: string;
  toolUseId: string;
  sessionId: string;
  transcriptPath: string;
  // How big the transcript was when the prompt went up. Answering it, either
  // way, appends a line — so a different size means it has been dealt with.
  transcriptSize: number;
};

// The same slug the snapshot store and the worktree memory use.
function noteFile(root: string): string {
  const slug = path.resolve(root).replace(/[\\/:.]/g, '-');
  return path.join(process.env.SIDECAR_HOME || path.join(os.homedir(), '.sidecar'), slug, 'attention.json');
}

function readNote(root: string): Attention | null {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(noteFile(root), 'utf8'));
  } catch {
    return null;
  }

  if (!raw || typeof raw !== 'object') return null;
  const note = raw as Partial<Attention>;
  return {
    at: Number(note.at) || 0,
    tool: typeof note.tool === 'string' ? note.tool : '',
    toolUseId: typeof note.toolUseId === 'string' ? note.toolUseId : '',
    sessionId: typeof note.sessionId === 'string' ? note.sessionId : '',
    transcriptPath: typeof note.transcriptPath === 'string' ? note.transcriptPath : '',
    transcriptSize: Number(note.transcriptSize) || 0,
  };
}

function sizeOf(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return -1;
  }
}

// The prompt the pane should be showing, or null when there is nothing to
// say. Three things have to hold, and all three are read off the disk:
//
// Nothing has been written since the prompt went up. Answering it, either way,
// appends a line, so the transcript still being the size the hook wrote down
// is what says you have not answered yet. This is the test, not the call:
// allowing `npm test` leaves its call open for the three minutes the command
// runs, and the pane must stop asking the moment you answer.
//
// And the call is still outstanding, where the transcript knows about it. Its
// `tool_use` record is normally already on disk when the prompt goes up, so a
// result on it means the prompt is long over however the size reads.
//
// And the chat is still in that turn. A note left behind by a session that has
// since finished, or been closed, is not a question anyone is waiting on.
export function attention(root: string, sessions: Session[], now: number = Date.now()): Attention | null {
  const note = readNote(root);
  if (!note) return null;

  const session = sessions.find(one => one.id === note.sessionId);
  const newest = session?.turns[session.turns.length - 1];
  if (!newest || !isRunning(newest, undefined, now)) return null;

  const call = note.toolUseId ? newest.actions.find(action => action.id === note.toolUseId) : undefined;
  const outstanding = sizeOf(note.transcriptPath) === note.transcriptSize && !call?.done;
  return outstanding ? note : null;
}
