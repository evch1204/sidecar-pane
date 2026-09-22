import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Claude Code writes one JSONL file per chat, in a folder named after the
// project path with every separator turned into a dash, and it flushes each
// message as it happens. That file is the only place that knows *why* a file
// changed: which chat, which prompt, and what Claude did about it.
//
// Nothing here is a hook. Sidecar reads what Claude Code already writes.

export type Action = {
  // The tool call's own id. A subagent's meta file points back at this.
  id: string;
  tool: string;
  // The one-line description Claude gives its own tool calls.
  why: string;
  // The file it named, when it named one.
  file: string | null;
  at: number;
  // True when the call looks like it wrote something rather than read it.
  wrote: boolean;
  // The shell command, or the kind of subagent, when the call has one.
  detail: string;
  // Its result has come back. A call still waiting is either slow, or is the
  // one Claude Code is asking you to allow.
  done: boolean;
};

export type Turn = {
  id: string;
  sessionId: string;
  at: number;
  endedAt: number;
  prompt: string;
  // The last thing Claude said in plain words: usually its own recap.
  says: string;
  // When Claude first answered. The gap from `at` is how long it thought.
  firstReplyAt: number;
  // New tokens this turn spent on the main thread: input, output and cache
  // writes. Cache reads are left out, they are nearly free.
  tokens: number;
  // How full the context window was at the last reply, in tokens.
  context: number;
  model: string;
  // The turn is over, exactly as the transcript says so: Claude's last record
  // stopped at `end_turn`, or its reply was cut off and you interrupted it.
  // A record that carries no `stop_reason` at all says nothing either way,
  // and a turn only ever ends here — never on a timer.
  ended: boolean;
  // The last thing Claude said stopped with no reason given, which is what a
  // reply cut off mid-stream looks like. On its own that means nothing; it is
  // the interrupt line right after it that ends the turn.
  cut: boolean;
  // Calls that are waiting on you — a question, a plan to approve — with no
  // result in the transcript yet.
  asks: string[];
  // Whether any of them still are. The one thing callers want to know.
  asking: boolean;
  actions: Action[];
  // Files this turn looks like it wrote, read out of the transcript. A hint,
  // not a measurement: only a snapshot either side of the turn knows what
  // really changed. The Changes view says which one it is showing.
  claimed: string[];
};

export type Session = {
  id: string;
  title: string;
  file: string;
  startedAt: number;
  endedAt: number;
  turns: Turn[];
};

export type ReadState = {
  // file path -> how far it has been read and what came out
  seen: Map<string, {size: number; tail: string; session: Session; messages: Set<string>}>;
};

export function newReadState(): ReadState {
  return {seen: new Map()};
}

export function claudeHome(): string {
  return process.env.SIDECAR_CLAUDE_HOME || path.join(os.homedir(), '.claude');
}

export function projectDir(root: string): string {
  const full = path.resolve(root);
  const slug = full.replace(/[\\/:.]/g, '-');
  return path.join(claudeHome(), 'projects', slug);
}

// How many chats this project has, without opening any of them. The first
// frame has to say something while the real read is still going, and one
// `readdir` is the most it can afford.
export function countChats(root: string): number {
  try {
    return fs.readdirSync(projectDir(root)).filter(name => name.endsWith('.jsonl')).length;
  } catch {
    return 0;
  }
}

// A shell command that writes, as opposed to one that looks.
const WRITER = /\b(sed\s+-i|tee|mv|cp|rm|rmdir|mkdir|touch|patch|chmod|npm\s+(?:i|install|ci)|git\s+(?:apply|checkout|restore|mv|rm|stash))\b/;
const REDIRECT = /(?<![0-9&])>{1,2}(?!\s*(?:&|\/dev\/null))/;

function wroteSomething(tool: string, input: Record<string, unknown>): boolean {
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') return true;
  if (tool !== 'Bash') return false;
  const command = String(input.command ?? '');
  return WRITER.test(command) || REDIRECT.test(command);
}

// Paths a shell command names that are really files in this project.
//
// Reading `foo.bar` out of a command is mostly wrong: `Object.assign` and
// `frames.push` look exactly like file names. Requiring the path to resolve to
// a file that exists inside the project throws all of that away. What is left
// is still only a hint — a command can change a file without naming it — so
// nothing downstream treats it as the truth about what changed.
function namedFiles(command: string, root: string): string[] {
  const out = new Set<string>();
  for (const match of command.matchAll(/[\w./-]*[\w-]+\.[A-Za-z]\w{0,9}\b/g)) {
    const raw = match[0]!;
    if (raw.startsWith('-') || raw.includes('node_modules')) continue;
    const full = path.resolve(root, raw);
    if (!full.startsWith(root + path.sep)) continue;
    if (full.includes(`${path.sep}.git${path.sep}`)) continue;
    try {
      if (!fs.statSync(full).isFile()) continue;
    } catch {
      continue;
    }

    out.add(full);
  }

  return [...out];
}

type Record_ = {
  type?: string;
  aiTitle?: string;
  uuid?: string;
  sessionId?: string;
  timestamp?: string;
  turnOrigin?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  message?: {role?: string; content?: unknown; id?: string; model?: string; usage?: Usage; stop_reason?: string | null};
};

// The two calls that hand the turn back to you without ending it: a question,
// and a plan waiting to be approved.
const ASKS = new Set(['AskUserQuestion', 'ExitPlanMode']);

// What Claude Code writes into the chat when you stop it mid-reply. There are
// two spellings, one of them `… for tool use`, so only the front is matched.
const INTERRUPT = '[Request interrupted by user';

export type Usage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

// Tokens that count as new work. One reply is written as several records that
// all repeat the same usage, so callers count each message id once.
export function newTokens(usage: Usage | undefined): number {
  if (!usage) return 0;
  return (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
}

function parseInto(session: Session, lines: string[], root: string, messages: Set<string>): void {
  for (const raw of lines) {
    let record: Record_;
    try {
      record = JSON.parse(raw) as Record_;
    } catch {
      continue;
    }

    if (record.type === 'ai-title' && record.aiTitle) session.title = record.aiTitle;
    const at = record.timestamp ? Date.parse(record.timestamp) : 0;
    if (at) {
      session.startedAt ||= at;
      session.endedAt = Math.max(session.endedAt, at);
    }

    // A turn starts when you press enter. Sidechains are subagents; their work
    // belongs to the turn that spawned them, not to a turn of their own.
    if (
      record.type === 'user' &&
      record.turnOrigin === 'human' &&
      !record.isMeta &&
      !record.isSidechain &&
      typeof record.message?.content === 'string'
    ) {
      session.turns.push({
        id: record.uuid ?? String(session.turns.length),
        sessionId: session.id,
        at,
        endedAt: at,
        prompt: record.message.content.replace(/\s+/g, ' ').trim(),
        says: '',
        firstReplyAt: 0,
        tokens: 0,
        context: 0,
        model: '',
        ended: false,
        cut: false,
        asks: [],
        asking: false,
        actions: [],
        claimed: [],
      });
      continue;
    }

    const turn = session.turns[session.turns.length - 1];
    if (!turn || record.isSidechain) continue;
    const content = record.message?.content;
    if (!Array.isArray(content)) continue;

    if (record.type === 'assistant') {
      // Whatever Claude said last is where the turn stands, so both of these
      // are set again on every reply rather than only the first.
      const stop = record.message?.stop_reason;
      turn.ended = stop === 'end_turn';
      turn.cut = stop === null;
      if (!turn.firstReplyAt) turn.firstReplyAt = at;
      turn.endedAt = Math.max(turn.endedAt, at);
      if (record.message?.model) turn.model = record.message.model;
      const usage = record.message?.usage;
      if (usage) {
        turn.context = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
      }

      const id = record.message?.id;
      if (id && !messages.has(id)) {
        messages.add(id);
        turn.tokens += newTokens(record.message?.usage);
      }
    }

    for (const block of content as {type?: string; id?: string; name?: string; text?: string; tool_use_id?: string; input?: Record<string, unknown>}[]) {
      if (block.type === 'text' && record.type === 'assistant' && block.text?.trim()) turn.says = block.text.trim();
      // You stopped it. That only ends the turn when the reply it stopped was
      // still in flight; after a finished reply the line is just a line.
      if (block.type === 'text' && record.type === 'user' && block.text?.startsWith(INTERRUPT) && turn.cut) turn.ended = true;
      if (block.type === 'tool_result' && block.tool_use_id) {
        turn.asks = turn.asks.filter(id => id !== block.tool_use_id);
        turn.asking = turn.asks.length > 0;
        for (const action of turn.actions) if (action.id === block.tool_use_id) action.done = true;
      }

      if (block.type !== 'tool_use' || !block.name) continue;
      if (ASKS.has(block.name) && block.id) {
        turn.asks.push(block.id);
        turn.asking = true;
      }

      const input = block.input ?? {};
      const tool = block.name;
      const wrote = wroteSomething(tool, input);
      const named = typeof input.file_path === 'string' ? path.resolve(input.file_path) : null;

      turn.endedAt = Math.max(turn.endedAt, at);
      turn.actions.push({
        id: block.id ?? '',
        tool,
        why: typeof input.description === 'string' ? input.description : '',
        file: named,
        at,
        wrote,
        done: false,
        detail:
          typeof input.command === 'string'
            ? input.command
            : typeof input.subagent_type === 'string'
              ? input.subagent_type
              : '',
      });

      if (!wrote) continue;
      const files = named ? [named] : tool === 'Bash' ? namedFiles(String(input.command ?? ''), root) : [];
      for (const file of files) if (!turn.claimed.includes(file)) turn.claimed.push(file);
    }
  }
}

// Every chat that has touched this project, newest last. Re-reading is cheap:
// only the bytes appended since the previous call are parsed.
export function readSessions(root: string, state: ReadState): Session[] {
  const dir = projectDir(root);
  const full = path.resolve(root);
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter(name => name.endsWith('.jsonl'));
  } catch {
    return [];
  }

  const out: Session[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      continue;
    }

    let seen = state.seen.get(file);
    if (seen && seen.size === size) {
      out.push(seen.session);
      continue;
    }

    // The file was replaced or truncated: start it again.
    if (!seen || size < seen.size) {
      seen = {
        size: 0,
        tail: '',
        session: {id: name.replace(/\.jsonl$/, ''), title: '', file, startedAt: 0, endedAt: 0, turns: []},
        messages: new Set(),
      };
      state.seen.set(file, seen);
    }

    let chunk: string;
    try {
      const handle = fs.openSync(file, 'r');
      const buffer = Buffer.alloc(size - seen.size);
      fs.readSync(handle, buffer, 0, buffer.length, seen.size);
      fs.closeSync(handle);
      chunk = seen.tail + buffer.toString('utf8');
    } catch {
      continue;
    }

    // The last line may still be being written.
    const lines = chunk.split('\n');
    seen.tail = lines.pop() ?? '';
    seen.size = size;
    parseInto(seen.session, lines, full, seen.messages);
    out.push(seen.session);
  }

  return out.filter(s => s.turns.length > 0).sort((a, b) => a.startedAt - b.startedAt);
}
