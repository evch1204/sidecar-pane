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

export type AgentStep = {
  id: string;
  tool: string;
  why: string;
  file: string | null;
  at: number;
};

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
  startedAt: number;
  endedAt: number;
  // The last reply ended the agent's turn, so it has handed back.
  done: boolean;
  // A tool call it made has not come back yet, so the quiet is the tool's.
  waiting: boolean;
  tokens: number;
  steps: AgentStep[];
  // Absolute paths the agent's own Edit and Write calls named.
  wrote: string[];
  // The last thing it said in plain words: its report.
  says: string;
};

type Seen = {size: number; tail: string; run: AgentRun; messages: Set<string>; awaiting: Set<string>};
export type AgentState = {seen: Map<string, Seen>};

export function newAgentState(): AgentState {
  return {seen: new Map()};
}

type Meta = {agentType?: string; description?: string; toolUseId?: string; spawnDepth?: number; model?: string};

type Line = {
  type?: string;
  timestamp?: string;
  message?: {id?: string; model?: string; stop_reason?: string | null; usage?: Usage; content?: unknown};
};

function readMeta(file: string): Meta {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Meta;
  } catch {
    return {};
  }
}

function parseInto(seen: Seen, lines: string[]): void {
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

// Every subagent any chat in this project has started, oldest first.
export function readAgents(root: string, state: AgentState): AgentRun[] {
  const dir = projectDir(root);
  let sessions: string[];
  try {
    sessions = fs.readdirSync(dir, {withFileTypes: true}).filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }

  const out: AgentRun[] = [];
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
            startedAt: 0,
            endedAt: 0,
            done: false,
            waiting: false,
            tokens: 0,
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
          parseInto(seen, lines);
        } catch {
          continue;
        }
      }

      if (seen.run.startedAt) out.push(seen.run);
    }
  }

  // Who started whom: the child's meta names the tool call that spawned it,
  // and that call is one of the parent's own steps. An agent the main chat
  // started matches nothing here, and keeps no parent.
  const byCall = new Map<string, AgentRun>();
  for (const run of out) for (const step of run.steps) if (step.id) byCall.set(step.id, run);
  for (const run of out) {
    const parent = run.toolUseId ? byCall.get(run.toolUseId) : undefined;
    run.parentId = parent && parent !== run ? parent.id : undefined;
  }

  return out.sort((a, b) => a.startedAt - b.startedAt);
}

// Quiet for this long without handing back means it is not coming back.
const STALLED_MS = 5 * 60_000;

// Quiet inside a tool call is the tool's quiet, not the agent's: a long build,
// or a child agent that is still working, writes nothing to this transcript
// while the agent is plainly alive. Only give up on it after an hour.
const WAITING_MS = 60 * 60_000;

export type AgentStatus = 'running' | 'done' | 'stopped';

export function statusOf(run: AgentRun, now: number): AgentStatus {
  if (run.done) return 'done';
  return now - run.endedAt < (run.waiting ? WAITING_MS : STALLED_MS) ? 'running' : 'stopped';
}
