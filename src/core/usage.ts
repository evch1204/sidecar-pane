import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {claudeHome, newTokens, type Usage} from './sessions';

// Two sources, and the view says which is which.
//
// 1. Tokens. Every reply in every transcript carries its own token count and
//    the model that wrote it, so pace and share by model are worked out here,
//    across every project, with nothing installed.
// 2. Limits. How much of the 5 hour and weekly allowance is used is only ever
//    handed to a status line script. `hooks/statusline.mjs` writes what it is
//    given to ~/.sidecar/usage.json; when that file is missing or stale the
//    view says so instead of inventing a number.

export type Spend = {at: number; model: string; tokens: number; context: number};

type Seen = {size: number; tail: string};
export type UsageState = {seen: Map<string, Seen>; messages: Set<string>; spends: Spend[]};

export function newUsageState(): UsageState {
  return {seen: new Map(), messages: new Set(), spends: []};
}

const WEEK = 7 * 86_400_000;

function transcripts(since: number): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, {withFileTypes: true});
    } catch {
      return;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      // projects/<project>/<chat>.jsonl and .../<chat>/subagents/agent-*.jsonl
      if (entry.isDirectory()) {
        if (depth < 3) walk(full, depth + 1);
        continue;
      }

      if (!entry.name.endsWith('.jsonl')) continue;
      try {
        if (fs.statSync(full).mtimeMs >= since) out.push(full);
      } catch {
        // Gone between the listing and the stat.
      }
    }
  };

  walk(path.join(claudeHome(), 'projects'), 0);
  return out;
}

type Line = {type?: string; timestamp?: string; message?: {id?: string; model?: string; usage?: Usage}};

// Every reply of the last week, from every project, oldest first.
export function readSpends(state: UsageState, now: number): Spend[] {
  const since = now - WEEK;
  for (const file of transcripts(since)) {
    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      continue;
    }

    let seen = state.seen.get(file);
    if (!seen || size < seen.size) {
      seen = {size: 0, tail: ''};
      state.seen.set(file, seen);
    }

    if (size === seen.size) continue;
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

    const lines = chunk.split('\n');
    seen.tail = lines.pop() ?? '';
    seen.size = size;
    for (const raw of lines) {
      // Most lines are tool output. Skip them before paying for a parse.
      if (!raw.includes('"usage"')) continue;
      let line: Line;
      try {
        line = JSON.parse(raw) as Line;
      } catch {
        continue;
      }

      const message = line.message;
      if (line.type !== 'assistant' || !message?.id || !message.usage || state.messages.has(message.id)) continue;
      state.messages.add(message.id);
      const at = line.timestamp ? Date.parse(line.timestamp) : 0;
      if (!at || at < since) continue;
      const usage = message.usage;
      state.spends.push({
        at,
        model: message.model ?? 'unknown',
        tokens: newTokens(usage),
        context: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
      });
    }
  }

  state.spends = state.spends.filter(s => s.at >= since).sort((a, b) => a.at - b.at);
  return state.spends;
}

export type Pace = {buckets: number[]; bucketMs: number; from: number};

// Tokens per half hour over the last five hours.
export function paceOf(spends: Spend[], now: number): Pace {
  const bucketMs = 30 * 60_000;
  const count = 10;
  const from = now - bucketMs * count;
  const buckets = new Array<number>(count).fill(0);
  for (const spend of spends) {
    if (spend.at < from) continue;
    const at = Math.min(count - 1, Math.floor((spend.at - from) / bucketMs));
    buckets[at]! += spend.tokens;
  }

  return {buckets, bucketMs, from};
}

export type Share = {model: string; tokens: number; part: number};

export function shareByModel(spends: Spend[]): Share[] {
  const totals = new Map<string, number>();
  for (const spend of spends) totals.set(spend.model, (totals.get(spend.model) ?? 0) + spend.tokens);
  const all = [...totals.values()].reduce((a, n) => a + n, 0);
  return [...totals.entries()]
    .map(([model, tokens]) => ({model, tokens, part: all ? tokens / all : 0}))
    .sort((a, b) => b.tokens - a.tokens);
}

// "claude-opus-5" -> "Opus 5", "claude-haiku-4-5-20251001" -> "Haiku 4.5".
export function modelName(id: string): string {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{6,})?/.exec(id);
  if (!match) return id || 'unknown';
  const family = match[1]![0]!.toUpperCase() + match[1]!.slice(1);
  return `${family} ${match[2]}${match[3] ? `.${match[3]}` : ''}`;
}

export type Window = {usedPercentage: number; resetsAt: number};
export type Limits = {
  at: number;
  fiveHour: Window | null;
  sevenDay: Window | null;
  contextSize: number | null;
  contextUsed: number | null;
};

export function limitsFile(): string {
  return path.join(process.env.SIDECAR_HOME || path.join(os.homedir(), '.sidecar'), 'usage.json');
}

function windowOf(raw: unknown): Window | null {
  if (!raw || typeof raw !== 'object') return null;
  const used = Number((raw as Record<string, unknown>).used_percentage);
  const resets = (raw as Record<string, unknown>).resets_at;
  if (!Number.isFinite(used)) return null;
  // Seconds, milliseconds or an ISO string, depending on the version.
  const at = typeof resets === 'number' ? (resets < 1e12 ? resets * 1000 : resets) : Date.parse(String(resets ?? ''));
  return {usedPercentage: used, resetsAt: Number.isFinite(at) ? at : 0};
}

// What the status line script last saw, or null when it has never run.
export function readLimits(): Limits | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(limitsFile(), 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }

  const limits = (raw.rate_limits ?? {}) as Record<string, unknown>;
  const context = (raw.context_window ?? {}) as Record<string, unknown>;
  const size = Number(context.context_window_size);
  const used = Number(context.used_percentage);
  return {
    at: Number(raw.at) || 0,
    fiveHour: windowOf(limits.five_hour),
    sevenDay: windowOf(limits.seven_day),
    contextSize: Number.isFinite(size) && size > 0 ? size : null,
    contextUsed: Number.isFinite(used) ? used : null,
  };
}
