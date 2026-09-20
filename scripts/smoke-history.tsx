// Builds a whole fake session — a chat transcript plus the snapshots sidecar
// would have taken while it ran — and prints the Changes view reading it.
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

const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-history-'));
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
const acts = (when: string, calls: {name: string; input: Record<string, unknown>}[]) =>
  JSON.stringify({
    type: 'assistant', sessionId: chat, timestamp: when, isSidechain: false,
    message: {role: 'assistant', content: calls.map((c, i) => ({type: 'tool_use', id: `t${i}`, ...c}))},
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
]));
fs.writeFileSync(path.join(dir, `${chat}.jsonl`), lines.join('\n') + '\n');
await take(store, project, Date.parse(at(8)));

// --- draw it --------------------------------------------------------------
const stdin = Object.assign(new PassThrough(), {isTTY: true, setRawMode: () => stdin, ref: () => stdin, unref: () => stdin});
const frames: string[] = [];
const stdout = Object.assign(new PassThrough(), {columns: 76, rows: 26, isTTY: true});
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

await wait(900);
await press('2');
await wait(1200);
await show('every turn, measured');

await press('\r');
await show('the newest turn, opened');

await press('\u001B[B', '\u001B[C');
await show('one file, as that one turn left it');

await press('\u001B', '\u001B[A', '\u001B[A', 'v', '\u001B[B', '\r');
await show('by file: greet.ts, and both turns that touched it');

await press('\u001B[C');
await show('greet.ts, banded by the turn that wrote each hunk');

stdin.write('q');
await app.waitUntilExit();
fs.rmSync(stage, {recursive: true, force: true});
