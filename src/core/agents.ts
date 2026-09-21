import fs from 'node:fs';
import path from 'node:path';
import {newTokens, projectDir, type Usage} from './sessions';

// Claude Code keeps every subagent it starts on disk, beside the chat that
// started it:
//
//   <project>/<session>/subagents/agent-<id>.jsonl      what the agent did
//   <project>/<session>/subagents/agent-<id>.meta.json  who started it, and why
//
// The meta file names the tool call that spawned the agent, which is how an
// agent is tied back to the prompt it was working for. Nothing here is a hook,
// and nothing is guessed: an agent sidecar cannot see on disk does not exist.
//
// The chat that started an agent also records how that agent ended, as a task
// notification, which is the only exact answer to "is it still running?".

export type AgentStep = {
  id: string;
  tool: string;
  why: string;
  file: string | null;
  at: number;
};

// How a task notification says an agent ended.
export type AgentEnd = 'completed' | 'killed' | 'failed';

export type AgentRun = {
  id: string;
  sessionId: string;
  // "Explore", "Plan", "general-purpose": the kind Claude asked for.
  type: string;
  // The few words Claude gave the job.
  task: string;
  // The tool call in the parent transcript that started this agent.
  toolUseId: string;
  // The agent whose own transcript carries that call, when there is one: an
  // agent the main chat started has no parent here.
  parentId?: string;
  // 1 for an agent the main chat started, 2 for one started by an agent.
  depth: number;
  model: string;
  // The folder Claude Code gave the agent of its own: a git worktree on its
  // own branch, so several agents can edit the same repo at once. Its meta
  // file says so; there is no other record once the folder is gone.
  worktree?: {path: string; branch: string};
  // Where the agent actually worked, from its own transcript. Usually the same
  // folder as `worktree`, or the pane's folder for an agent without one.
  cwd?: string;
  startedAt: number;
  endedAt: number;
  // The last reply ended the agent's turn, so it has handed back.
  done: boolean;
  // A tool call it made has not come back yet, so the quiet is the tool's.
  waiting: boolean;
  // What the task notification about this run said, when one has been written.
  // Exact: Claude Code writes it the moment the agent stops.
  ended?: AgentEnd;
  // When the quiet began and how long it may run before the pane gives up on
  // an agent no notification covers. Its own last line, unless it is waiting on
  // a child agent: then the child's, since it lives as long as the child does.
  quiet: {from: number; limit: number};
  tokens: number;
  // Every tool call the agent made. Counted on its own rather than read off
  // `steps`, so a view that trims that list cannot change the number.
  toolUses: number;
  steps: AgentStep[];
  // Absolute paths the agent's own Edit and Write calls named.
  wrote: string[];
  // The last thing it said in plain words: its report.
  says: string;
};

type Seen = {size: number; tail: string; run: AgentRun; messages: Set<string>; awaiting: Set<string>};
type Cursor = {size: number; tail: string};
type Notice = {status: AgentEnd; at: number};
export type AgentState = {
  seen: Map<string, Seen>;
  // A chat transcript -> how far it has been read for notifications.
  feeds: Map<string, Cursor>;
  // Agent id -> the last notification written about it.
  notices: Map<string, Notice>;
};

export function newAgentState(): AgentState {
  return {seen: new Map(), feeds: new Map(), notices: new Map()};
}

type Meta = {
  agentType?: string;
  description?: string;
  toolUseId?: string;
  spawnDepth?: number;
  model?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  spawnedWithWorktree?: boolean;
};

type Line = {
  type?: string;
  timestamp?: string;
  // Every line of a transcript carries the folder it was written in.
  cwd?: string;
  // Both only on the lines that carry a task notification: what put the line
  // there, and, on a queued one, the notification's own text.
  turnOrigin?: string;
  content?: unknown;
  message?: {id?: string; model?: string; stop_reason?: string | null; usage?: Usage; content?: unknown};
};

function readMeta(file: string): Meta {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Meta;
  } catch {
    return {};
  }
}

const ENDS: Record<string, AgentEnd> = {completed: 'completed', killed: 'killed', failed: 'failed'};

// Claude Code tells the chat that started an agent when that agent stops, and
// writes the notification itself in two places: as it queues it
// (`queue-operation`, the text in `content`) and as the chat receives it
// (`user`, `turnOrigin: 'task_notification'`). The same text turns up quoted
// inside replies and tool results, so only those two shapes count.
function noticeIn(line: Line): string | null {
  const text =
    line.type === 'queue-operation' && typeof line.content === 'string'
      ? line.content
      : line.type === 'user' && line.turnOrigin === 'task_notification' && typeof line.message?.content === 'string'
        ? line.message.content
        : null;
  return text?.startsWith('<task-notification>') ? text : null;
}

// `<task-id>` is the agent's own id, and `<status>` is how it ended.
function takeNotice(notices: Map<string, Notice>, text: string, at: number): void {
  const id = /<task-id>([^<]+)<\/task-id>/.exec(text)?.[1];
  const status = ENDS[/<status>([^<]+)<\/status>/.exec(text)?.[1] ?? ''];
  if (!id || !status || !at) return;
  // An agent can be sent another message after it stopped and notify again, so
  // the newest notification is the one that counts.
  const prev = notices.get(id);
  if (!prev || prev.at < at) notices.set(id, {status, at});
}

// The bytes a file has grown by since the last look, as whole lines. The last
// line may still be being written, so it is kept for next time.
function appended(file: string, cursor: Cursor): string[] {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return [];
  }

  // Replaced or truncated: read it from the top again.
  if (size < cursor.size) {
    cursor.size = 0;
    cursor.tail = '';
  }

  if (size === cursor.size) return [];
  try {
    const handle = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(size - cursor.size);
    fs.readSync(handle, buffer, 0, buffer.length, cursor.size);
    fs.closeSync(handle);
    const lines = (cursor.tail + buffer.toString('utf8')).split('\n');
    cursor.tail = lines.pop() ?? '';
    cursor.size = size;
    return lines;
  } catch {
    return [];
  }
}

// Every notification this project's chats have written, read the same way as
// everything else: only the bytes appended since the last call.
function readNotices(dir: string, state: AgentState): void {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter(name => name.endsWith('.jsonl'));
  } catch {
    return;
  }

  for (const name of names) {
    const file = path.join(dir, name);
    let cursor = state.feeds.get(file);
    if (!cursor) state.feeds.set(file, (cursor = {size: 0, tail: ''}));
    for (const raw of appended(file, cursor)) {
      if (!raw.includes('<task-notification>')) continue;
      let line: Line;
      try {
        line = JSON.parse(raw) as Line;
      } catch {
        continue;
      }

      const text = noticeIn(line);
      if (text) takeNotice(state.notices, text, line.timestamp ? Date.parse(line.timestamp) : 0);
    }
  }
}

function parseInto(seen: Seen, lines: string[], notices: Map<string, Notice>): void {
  const run = seen.run;
  for (const raw of lines) {
    let line: Line;
    try {
      line = JSON.parse(raw) as Line;
    } catch {
      continue;
    }

    const at = line.timestamp ? Date.parse(line.timestamp) : 0;
    if (at) {
      run.startedAt ||= at;
      run.endedAt = Math.max(run.endedAt, at);
    }

    // The first line that says where it is running is enough: an agent cannot
    // change folder half way through.
    if (!run.cwd && line.cwd) run.cwd = line.cwd;

    // An agent that started a child agent is told here when the child stops,
    // exactly as a chat is.
    const notice = noticeIn(line);
    if (notice) {
      takeNotice(notices, notice, at);
      continue;
    }

    // A tool result comes back on a `user` line and names the call it answers.
    // Until it does, the agent is inside that call and not idle.
    const answers = line.type === 'user' ? line.message?.content : null;
    if (Array.isArray(answers)) {
      for (const block of answers as {type?: string; tool_use_id?: string}[]) {
        if (block.type === 'tool_result' && block.tool_use_id) seen.awaiting.delete(block.tool_use_id);
      }
    }

    if (line.type !== 'assistant' || !line.message) continue;
    const message = line.message;
    if (message.model) run.model = message.model;
    if (message.id && !seen.messages.has(message.id)) {
      seen.messages.add(message.id);
      run.tokens += newTokens(message.usage);
    }

    // A reply that stops for any reason other than a tool call is the agent
    // handing back. A later tool call clears it again.
    run.done = message.stop_reason === 'end_turn';
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content as {type?: string; id?: string; name?: string; text?: string; input?: Record<string, unknown>}[]) {
      if (block.type === 'text' && block.text?.trim()) run.says = block.text.trim();
      if (block.type !== 'tool_use' || !block.name) continue;
      run.done = false;
      run.toolUses += 1;
      if (block.id) seen.awaiting.add(block.id);
      const input = block.input ?? {};
      const file = typeof input.file_path === 'string' ? path.resolve(input.file_path) : null;
      run.steps.push({
        id: block.id ?? '',
        tool: block.name,
        why:
          typeof input.description === 'string'
            ? input.description
            : typeof input.pattern === 'string'
              ? input.pattern
              : typeof input.command === 'string'
                ? input.command
                : typeof input.url === 'string'
                  ? input.url
                  : typeof input.query === 'string'
                    ? input.query
                    : '',
        file,
        at,
      });
      if (file && (block.name === 'Edit' || block.name === 'Write') && !run.wrote.includes(file)) run.wrote.push(file);
    }
  }

  run.waiting = !run.done && seen.awaiting.size > 0;
}

// A guess: quiet for this long with no tool call open means it is not coming
// back. Nothing on disk says an agent died, so this is only a fallback for a
// run no notification covers.
const STALLED_MS = 5 * 60_000;

// Also a guess, but a bounded one: quiet inside a tool call is the tool's
// quiet, and Claude Code's own Bash timeout stops at 10 minutes, so no single
// call can stay open much longer than this.
const WAITING_MS = 12 * 60_000;

// When the quiet began and how long it may run. An agent whose open call is
// the one that started a child agent is alive exactly as long as the child is,
// however long that takes, so it watches the child's clock instead of its own.
// `walked` stops a cycle.
function quietOf(run: AgentRun, childOf: Map<string, AgentRun>, awaiting: Map<string, Set<string>>, walked: Set<string>): AgentRun['quiet'] {
  const mine = {from: run.endedAt, limit: run.waiting ? WAITING_MS : STALLED_MS};
  if (!run.waiting || walked.has(run.id)) return mine;
  walked.add(run.id);
  for (const call of awaiting.get(run.id) ?? []) {
    const child = childOf.get(call);
    if (child && !child.ended) return quietOf(child, childOf, awaiting, walked);
  }

  return mine;
}

// Every subagent any chat in this project has started, oldest first.
export function readAgents(root: string, state: AgentState): AgentRun[] {
  const dir = projectDir(root);
  let sessions: string[];
  try {
    sessions = fs.readdirSync(dir, {withFileTypes: true}).filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }

  readNotices(dir, state);

  const out: AgentRun[] = [];
  // Run id -> the tool calls it is still inside, for the clock below.
  const awaiting = new Map<string, Set<string>>();
  for (const sessionId of sessions) {
    const folder = path.join(dir, sessionId, 'subagents');
    let names: string[];
    try {
      names = fs.readdirSync(folder).filter(name => /^agent-.+\.jsonl$/.test(name));
    } catch {
      continue;
    }

    for (const name of names) {
      const file = path.join(folder, name);
      let size: number;
      try {
        size = fs.statSync(file).size;
      } catch {
        continue;
      }

      let seen = state.seen.get(file);
      if (!seen || size < seen.size) {
        const id = name.replace(/^agent-|\.jsonl$/g, '');
        const meta = readMeta(path.join(folder, `agent-${id}.meta.json`));
        seen = {
          size: 0,
          tail: '',
          messages: new Set(),
          awaiting: new Set(),
          run: {
            id,
            sessionId,
            type: meta.agentType ?? 'agent',
            task: meta.description ?? '',
            toolUseId: meta.toolUseId ?? '',
            depth: meta.spawnDepth ?? 1,
            model: meta.model ?? '',
            // `spawnedWithWorktree` and the two paths travel together, but the
            // paths are what matter, so either of them is enough.
            worktree:
              meta.worktreePath || meta.worktreeBranch
                ? {path: meta.worktreePath ?? '', branch: meta.worktreeBranch ?? ''}
                : undefined,
            startedAt: 0,
            endedAt: 0,
            done: false,
            waiting: false,
            quiet: {from: 0, limit: STALLED_MS},
            tokens: 0,
            toolUses: 0,
            steps: [],
            wrote: [],
            says: '',
          },
        };
        state.seen.set(file, seen);
      }

      if (size > seen.size) {
        try {
          const handle = fs.openSync(file, 'r');
          const buffer = Buffer.alloc(size - seen.size);
          fs.readSync(handle, buffer, 0, buffer.length, seen.size);
          fs.closeSync(handle);
          const lines = (seen.tail + buffer.toString('utf8')).split('\n');
          seen.tail = lines.pop() ?? '';
          seen.size = size;
          parseInto(seen, lines, state.notices);
        } catch {
          continue;
        }
      }

      if (!seen.run.startedAt) continue;
      out.push(seen.run);
      awaiting.set(seen.run.id, seen.awaiting);
    }
  }

  // Who started whom: the child's meta names the tool call that spawned it,
  // and that call is one of the parent's own steps. An agent the main chat
  // started matches nothing here, and keeps no parent.
  const byCall = new Map<string, AgentRun>();
  for (const run of out) for (const step of run.steps) if (step.id) byCall.set(step.id, run);
  const childOf = new Map<string, AgentRun>();
  for (const run of out) {
    const parent = run.toolUseId ? byCall.get(run.toolUseId) : undefined;
    run.parentId = parent && parent !== run ? parent.id : undefined;
    if (run.toolUseId) childOf.set(run.toolUseId, run);
  }

  // A notification is exact, but it is not final: the parent can send the same
  // agent another message, and then the agent notifies again. Lines written
  // after the last notification mean it is live again.
  for (const run of out) {
    const notice = state.notices.get(run.id);
    run.ended = notice && run.endedAt <= notice.at ? notice.status : undefined;
  }

  for (const run of out) run.quiet = quietOf(run, childOf, awaiting, new Set());
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

export type AgentStatus = 'running' | 'done' | 'stopped';

// The most agents that were ever running at the same time. "3 agents · at
// most 3 at once" is the difference between work done in parallel and work
// done one after another, and a list of rows cannot show it.
export function maxOverlap(agents: AgentRun[], now: number): number {
  const edges: {at: number; delta: number}[] = [];
  for (const run of agents) {
    if (!run.startedAt) continue;
    // One still running covers the span up to now.
    const end = Math.max(run.startedAt, statusOf(run, now) === 'running' ? now : run.endedAt);
    edges.push({at: run.startedAt, delta: 1}, {at: end, delta: -1});
  }

  // An agent that ends exactly as another starts was never beside it, so the
  // ends are walked before the starts.
  edges.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let at = 0;
  let most = 0;
  for (const edge of edges) {
    at += edge.delta;
    most = Math.max(most, at);
  }

  return most;
}

export function statusOf(run: AgentRun, now: number): AgentStatus {
  // The notification wins: Claude Code wrote it when the agent stopped, and it
  // says how. An agent the user stopped mid tool call never hands back, so
  // without this it would look alive for as long as the clock below allows.
  if (run.ended) return run.ended === 'completed' ? 'done' : 'stopped';
  if (run.done) return 'done';
  return now - run.quiet.from < run.quiet.limit ? 'running' : 'stopped';
}
