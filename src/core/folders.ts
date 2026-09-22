import {newAgentState, readAgents, statusOf, type AgentRun, type AgentState} from './agents';
import {loadGit, pathKey, type GitState} from './git';
import {newReadState, readSessions, type ReadState} from './sessions';
import {loadTurns, type TurnChange} from './turns';

// The same three sources the pane reads for its own folder — the transcripts,
// the subagents beside them and git — read for another worktree of the same
// repository. Claude Code keys a chat by the folder it was typed in, so a chat
// that ran in another worktree has its own `~/.claude/projects/<slug>` and is
// invisible from here until somebody looks there.
//
// Two things are deliberately missing. There are no snapshots: sidecar only
// ever watched the folder it is running in, so another folder's turns are
// filled in from that folder's own commits, and say so. And nothing is written:
// this only ever reads.

type Reader = {
  sessions: ReadState;
  agents: AgentState;
  // What the last read found, and when. A folder nobody is working in is not
  // where the news is, so it is read again on the slow cadence.
  at: number;
  turns: FolderTurns | null;
};

export type FolderTurns = {folder: string; changes: TurnChange[]; agents: AgentRun[]; git: GitState | null};

const readers = new Map<string, Reader>();

const IDLE_MS = 30_000;
// More folders than this and the cost stops being worth the news in them.
const FOLDERS_MAX = 8;

const busy = (turns: FolderTurns, now: number): boolean =>
  turns.changes.some(change => change.running) || turns.agents.some(agent => statusOf(agent, now) === 'running');

// Every turn of every chat that was typed in one of these folders, each turn
// carrying the folder it happened in. Oldest last, the order the stream reads.
export async function loadFolders(folders: string[], now: number): Promise<FolderTurns[]> {
  const out: FolderTurns[] = [];
  for (const folder of folders.slice(0, FOLDERS_MAX)) {
    const key = pathKey(folder);
    let reader = readers.get(key);
    if (!reader) readers.set(key, (reader = {sessions: newReadState(), agents: newAgentState(), at: 0, turns: null}));

    // Nothing is running there and it was looked at a moment ago: the last
    // reading still stands.
    if (reader.turns && !busy(reader.turns, now) && now - reader.at < IDLE_MS) {
      out.push(reader.turns);
      continue;
    }

    const git = await loadGit(folder);
    const sessions = readSessions(folder, reader.sessions);
    const agents = readAgents(folder, reader.agents);
    const changes = await loadTurns(folder, null, sessions, now, git);
    reader.turns = {folder, changes, agents, git};
    reader.at = now;
    out.push(reader.turns);
  }

  return out;
}
