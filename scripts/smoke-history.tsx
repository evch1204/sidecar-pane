// Builds a whole fake session — a chat transcript, a subagent, a usage feed and
// the snapshots sidecar would have taken while it ran — and prints every view.
// This is the only way to see measured, per-turn diffs without living through
// a real session. Run with: npx tsx scripts/smoke-history.tsx
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {render} from 'ink';
import {openStore, take} from '../src/core/snapshot';
import {App} from '../src/ui/App';

// realpath: on a Mac the temp folder is a symlink, and git reports the real one.
const stage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-history-')));
const project = path.join(stage, 'demo');
process.env.SIDECAR_CLAUDE_HOME = path.join(stage, 'claude');
process.env.SIDECAR_HOME = path.join(stage, 'sidecar');

fs.mkdirSync(path.join(project, 'src'), {recursive: true});
const write = (rel: string, text: string) => fs.writeFileSync(path.join(project, rel), text);
const run = (...args: string[]) => execFileSync('git', ['-C', project, ...args], {stdio: 'ignore'});

write('src/greet.ts', 'export function greet(name: string) {\n  return `hello ${name}`;\n}\n');
write('README.md', '# demo\n\nA project.\n');
run('init', '-q');
run('add', '-A');
run('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'first');

// The transcript, exactly as Claude Code writes one.
const chat = '11111111-2222-3333-4444-555555555555';
const dir = path.join(process.env.SIDECAR_CLAUDE_HOME, 'projects', path.resolve(project).replace(/[\\/:.]/g, '-'));
fs.mkdirSync(dir, {recursive: true});
const lines: string[] = [{type: 'ai-title', aiTitle: 'Make greet friendlier', sessionId: chat}].map(o => JSON.stringify(o));
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const turn = (uuid: string, prompt: string, when: string) =>
  JSON.stringify({
    type: 'user', turnOrigin: 'human', isSidechain: false, uuid, sessionId: chat,
    timestamp: when, cwd: project, gitBranch: 'main', message: {role: 'user', content: prompt},
  });
let messageId = 0;
const usage = {input_tokens: 40, output_tokens: 900, cache_creation_input_tokens: 5200, cache_read_input_tokens: 61000};
const acts = (when: string, calls: {name: string; id?: string; input: Record<string, unknown>}[]) =>
  JSON.stringify({
    type: 'assistant', sessionId: chat, timestamp: when, isSidechain: false,
    message: {role: 'assistant', id: `msg-${messageId++}`, model: 'claude-fable-5-1', usage, content: calls.map((c, i) => ({type: 'tool_use', id: `t${i}`, ...c}))},
  });
const says = (when: string, text: string) =>
  JSON.stringify({
    type: 'assistant', sessionId: chat, timestamp: when, isSidechain: false,
    message: {role: 'assistant', id: `msg-${messageId++}`, model: 'claude-fable-5-1', usage, stop_reason: 'end_turn', content: [{type: 'text', text}]},
  });

const store = openStore(project)!;

// --- turn one -------------------------------------------------------------
lines.push(turn('turn-1', 'make greet friendlier and say hi instead of hello', at(20)));
fs.writeFileSync(path.join(dir, `${chat}.jsonl`), lines.join('\n') + '\n');
await take(store, project, Date.parse(at(21)));

write('src/greet.ts', 'export function greet(name: string, punctuation = "!") {\n  return `hi there ${name}${punctuation}`;\n}\n');
lines.push(acts(at(19), [
  {name: 'Edit', input: {file_path: path.join(project, 'src/greet.ts'), description: 'Say hi instead of hello'}},
  {name: 'Bash', input: {command: 'npx tsc --noEmit', description: 'Typecheck the change'}},
]));
lines.push(says(at(18.5), 'greet now says hi and takes the punctuation as a second argument. The typecheck passes.'));
fs.writeFileSync(path.join(dir, `${chat}.jsonl`), lines.join('\n') + '\n');
await take(store, project, Date.parse(at(18)));

// --- turn two -------------------------------------------------------------
lines.push(turn('turn-2', 'now write the readme for it', at(10)));
fs.writeFileSync(path.join(dir, `${chat}.jsonl`), lines.join('\n') + '\n');
await take(store, project, Date.parse(at(11)));

write('README.md', '# demo\n\nA project.\n\n## greet\n\nSays hi to someone.\n\n```ts\ngreet("world");\n```\n');
write('src/greet.ts', 'export function greet(name: string, punctuation = "!") {\n  // Greets someone by name.\n  return `hi there ${name}${punctuation}`;\n}\n');
lines.push(acts(at(9), [
  {name: 'Write', input: {file_path: path.join(project, 'README.md'), description: 'Document greet'}},
  {name: 'Edit', input: {file_path: path.join(project, 'src/greet.ts'), description: 'Add a comment'}},
  {name: 'Agent', id: 'call-agent-1', input: {description: 'Check the README wording', subagent_type: 'Explore', prompt: 'Read README.md and check it.'}},
]));
lines.push(says(at(8.5), 'The README now documents greet, with an example. I had a subagent check the wording.'));

// The subagent that turn started, where Claude Code would have written it.
const agentDir = path.join(dir, chat, 'subagents');
fs.mkdirSync(agentDir, {recursive: true});
fs.writeFileSync(path.join(agentDir, 'agent-abc123.meta.json'), JSON.stringify({agentType: 'Explore', description: 'Check the README wording', toolUseId: 'call-agent-1', spawnDepth: 1}));
const agentLine = (when: string, message: Record<string, unknown>) => JSON.stringify({type: 'assistant', isSidechain: true, agentId: 'abc123', timestamp: when, message});
fs.writeFileSync(path.join(agentDir, 'agent-abc123.jsonl'), [
  JSON.stringify({type: 'user', isSidechain: true, agentId: 'abc123', timestamp: at(9), message: {role: 'user', content: 'Read README.md and check it.'}}),
  agentLine(at(8.9), {id: 'a-1', model: 'claude-haiku-4-5-20251001', usage, content: [{type: 'tool_use', id: 'a-t1', name: 'Read', input: {file_path: path.join(project, 'README.md')}}]}),
  agentLine(at(8.7), {id: 'a-2', model: 'claude-haiku-4-5-20251001', usage, stop_reason: 'end_turn', content: [{type: 'text', text: 'The README reads well. One nit: the example could show the punctuation argument.'}]}),
].join('\n') + '\n');
fs.writeFileSync(path.join(dir, `${chat}.jsonl`), lines.join('\n') + '\n');
await take(store, project, Date.parse(at(8)));

// Sidecar was watching the whole time, so both turns count as measured.
fs.writeFileSync(path.join(store.dir, 'watched.json'), JSON.stringify([[Date.parse(at(25)), Date.now()]]));

// What the status line script would have saved.
fs.writeFileSync(path.join(process.env.SIDECAR_HOME, 'usage.json'), JSON.stringify({
  at: Date.now(),
  rate_limits: {
    five_hour: {used_percentage: 58, resets_at: Math.round(Date.now() / 1000) + 112 * 60},
    seven_day: {used_percentage: 23, resets_at: Math.round(Date.now() / 1000) + 3 * 86_400},
  },
  context_window: {context_window_size: 1_000_000, used_percentage: 7},
}));

// --- draw it --------------------------------------------------------------
const stdin = Object.assign(new PassThrough(), {isTTY: true, setRawMode: () => stdin, ref: () => stdin, unref: () => stdin});
const frames: string[] = [];
const stdout = Object.assign(new PassThrough(), {columns: Number(process.env.SMOKE_COLS) || 64, rows: 34, isTTY: true});
stdout.on('data', c => frames.push(String(c)));

const app = render(<App root={project} interactive />, {
  stdin: stdin as unknown as NodeJS.ReadStream,
  stdout: stdout as unknown as NodeJS.WriteStream,
  debug: true,
  exitOnCtrlC: false,
});

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const press = async (...keys: string[]) => {
  for (const k of keys) {
    stdin.write(k);
    await wait(60);
  }
};
const show = async (label: string) => {
  await wait(500);
  console.log(`\n===== ${label}\n${frames.at(-1)}`);
};

await wait(1500);
await show('changes: both turns measured, the newest open');

await press('\u001B[B', '\u001B[B', '\r');
await wait(500);
await show('changes: README.md opened in place, as that turn left it');

await press('v');
await wait(300);
await press('\u001B[B', '\u001B[B', '\r');
await show('by file: greet.ts, and both turns that touched it');

await press('3', '\u001B[B', '\r');
await show('agents: the subagent, opened');

await press('4');
await wait(1200);
await show('usage: limits from the feed, tokens from the transcripts');

await press('2', '\u001B[B', '\r', 'o');
await wait(1500);
await show('files: README.md in the reader, formatted');

await press('\u001B', 'c');
await wait(600);
await show('files: changed files only, so the folders are headings');

stdin.write('q');
await app.waitUntilExit();
fs.rmSync(stage, {recursive: true, force: true});
