// Draws the real pane against a made-up project and saves what it printed,
// colours and all. `build.mjs` turns those frames into the Version 3 artboards,
// so that page of the canvas is the implementation, not a drawing of it.
//
// Run with: FORCE_COLOR=3 npx tsx design/capture.tsx
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {render} from 'ink';
import {openStore, take} from '../src/core/snapshot';
import {App} from '../src/ui/App';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'frames');
fs.mkdirSync(out, {recursive: true});

const stage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-capture-')));
const project = path.join(stage, 'sidecar-pane');
process.env.SIDECAR_CLAUDE_HOME = path.join(stage, 'claude');
process.env.SIDECAR_HOME = path.join(stage, 'sidecar');

const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(project, rel)), {recursive: true});
  fs.writeFileSync(path.join(project, rel), text);
};
const git = (...args: string[]) => execFileSync('git', ['-C', project, ...args], {stdio: 'ignore'});

const INDEX_1 = `import {windowsTerminal} from './wt';

// One small file per terminal. detect() picks the first that fits.
export const launchers = [windowsTerminal];

export function detect(env: NodeJS.ProcessEnv) {
  return launchers.find(launcher => launcher.fits(env)) ?? null;
}
`;
const INDEX_2 = INDEX_1.replace("import {windowsTerminal} from './wt';", "import {tmux} from './tmux';\nimport {windowsTerminal} from './wt';").replace('[windowsTerminal]', '[windowsTerminal, tmux]');
const INDEX_3 = INDEX_2.replace("import {windowsTerminal} from './wt';", "import {wezterm} from './wezterm';\nimport {windowsTerminal} from './wt';").replace('[windowsTerminal, tmux]', '[windowsTerminal, tmux, wezterm]');
const launcher = (name: string, command: string) => `import type {Launcher} from './types';

// Opens the pane as a split to the right of the Claude session.
export const ${name}: Launcher = {
  name: '${name}',
  fits: env => Boolean(env.${name.toUpperCase()}),
  open: root => ['${command}', root],
};
`;

write('src/launch/wt.ts', launcher('windowsTerminal', 'wt -w 0 split-pane -V'));
write('src/launch/types.ts', 'export type Launcher = {name: string; fits: (env: NodeJS.ProcessEnv) => boolean; open: (root: string) => string[]};\n');
write('src/launch/index.ts', INDEX_1);
write('src/cli.tsx', "import {detect} from './launch';\n\nconsole.log(detect(process.env));\n");
write('PLAN.md', '# Sidecar: project plan\n\n## Day 3\n\nLaunchers, one small file per terminal.\n\n| Terminal | Split command | Status |\n|---|---|---|\n| Windows Terminal | `wt -w 0 split-pane -V` | Working |\n| tmux | `tmux split-window -h` | Day 3 |\n\n- [x] Windows Terminal\n- [ ] tmux\n- [ ] WezTerm, iTerm2, kitty\n');
write('package.json', '{"name": "sidecar-pane"}\n');
git('init', '-q', '-b', 'main');
git('add', '-A');
git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'first');

const chat = '11111111-2222-3333-4444-555555555555';
const dir = path.join(process.env.SIDECAR_CLAUDE_HOME, 'projects', path.resolve(project).replace(/[\\/:.]/g, '-'));
fs.mkdirSync(path.join(dir, chat, 'subagents'), {recursive: true});
const transcript = path.join(dir, `${chat}.jsonl`);
const lines: string[] = [JSON.stringify({type: 'ai-title', aiTitle: 'Day 3 launchers', sessionId: chat})];
const flush = () => fs.writeFileSync(transcript, lines.join('\n') + '\n');
const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

let n = 0;
const usage = (output: number) => ({input_tokens: 60, output_tokens: output, cache_creation_input_tokens: output * 6, cache_read_input_tokens: 182_000});
const prompt = (uuid: string, text: string, when: string) =>
  JSON.stringify({type: 'user', turnOrigin: 'human', isSidechain: false, uuid, sessionId: chat, timestamp: when, message: {role: 'user', content: text}});
const reply = (when: string, content: unknown[], more: Record<string, unknown> = {}) =>
  JSON.stringify({type: 'assistant', sessionId: chat, isSidechain: false, timestamp: when, message: {role: 'assistant', id: `m${n++}`, model: 'claude-fable-5-1', usage: usage(1800), content, ...more}});
const call = (name: string, input: Record<string, unknown>, id = `t${n}`) => ({type: 'tool_use', id, name, input});
const file = (rel: string) => path.join(project, rel);

const store = openStore(project)!;

// --- turn one: finished, and measured ----------------------------------------
lines.push(prompt('turn-1', 'add a tmux launcher and wire it into the launcher list', at(34)));
flush();
await take(store, project, Date.parse(at(34.2)));
write('src/launch/tmux.ts', launcher('tmux', 'tmux split-window -h'));
write('src/launch/index.ts', INDEX_2);
write('PLAN.md', fs.readFileSync(file('PLAN.md'), 'utf8').replace('| tmux | `tmux split-window -h` | Day 3 |', '| tmux | `tmux split-window -h` | Working |').replace('- [ ] tmux', '- [x] tmux'));
lines.push(
  reply(at(33.7), [call('Read', {file_path: file('src/launch/index.ts')}), call('Read', {file_path: file('src/launch/wt.ts')})]),
  reply(at(33), [call('Write', {file_path: file('src/launch/tmux.ts'), description: 'Write the tmux launcher'})]),
  reply(at(32), [call('Edit', {file_path: file('src/launch/index.ts'), description: 'Add tmux to the launcher list'})]),
  reply(at(31.5), [call('Edit', {file_path: file('PLAN.md'), description: 'Mark tmux as working'})]),
  reply(at(31), [call('Bash', {command: 'npm run typecheck', description: 'Typecheck the launchers'})]),
  reply(at(30.5), [{type: 'text', text: 'tmux has its own launcher now, and detect() finds it when TMUX is set. The typecheck passes. I marked it as working in PLAN.md.'}], {stop_reason: 'end_turn'}),
);
flush();
await take(store, project, Date.parse(at(30.4)));
fs.writeFileSync(path.join(store.dir, 'watched.json'), JSON.stringify([[Date.parse(at(40)), Date.now()]]));
fs.writeFileSync(path.join(process.env.SIDECAR_HOME, 'usage.json'), JSON.stringify({
  at: Date.now() + 3_600_000,
  rate_limits: {
    five_hour: {used_percentage: 58, resets_at: Math.round(Date.now() / 1000) + 112 * 60},
    seven_day: {used_percentage: 23, resets_at: Math.round(Date.now() / 1000) + 3 * 86_400 + 5000},
  },
  context_window: {context_window_size: 1_000_000, used_percentage: 19},
}));

// --- the pane ---------------------------------------------------------------------
const stdin = Object.assign(new PassThrough(), {isTTY: true, setRawMode: () => stdin, ref: () => stdin, unref: () => stdin});
const frames: string[] = [];
const stdout = Object.assign(new PassThrough(), {columns: 64, rows: 52, isTTY: true});
stdout.on('data', c => frames.push(String(c)));
const app = render(<App root={project} interactive />, {
  stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, debug: true, exitOnCtrlC: false,
});

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const press = async (...keys: string[]) => {
  for (const k of keys) {
    stdin.write(k);
    await wait(70);
  }
};
const save = async (name: string) => {
  await wait(600);
  fs.writeFileSync(path.join(out, `${name}.ans`), frames.at(-1) ?? '');
  console.log('saved', name);
};
const DOWN = '\u001B[B', ENTER = '\r', ESC = '\u001B';

await wait(1800);
await press(DOWN, DOWN, DOWN, ENTER);
await wait(700);
await save('changes');

await press('m');
await save('menu');

// src, then launch, then a peek at index.ts
await press(ESC, '2', ENTER, DOWN, ENTER, DOWN, ENTER);
await wait(900);
await save('files');

// down to PLAN.md: peek it, then read it
await press(ESC, DOWN, DOWN, DOWN, DOWN, DOWN, DOWN, ENTER, ENTER);
await wait(900);
await save('reader');

// --- turn two: running, with three subagents -------------------------------------
lines.push(prompt('turn-2', 'build the rest of the day 3 launchers in parallel. one agent per terminal: wezterm, iterm2, kitty', at(3.2)));
const agents = [
  {id: 'aa11', task: 'Write the WezTerm launcher', call: 'call-a1', done: true, tool: ['Write', {file_path: file('src/launch/wezterm.ts')}], also: file('src/launch/index.ts')},
  {id: 'bb22', task: 'Write the iTerm2 launcher', call: 'call-a2', done: false, tool: ['Bash', {command: 'osascript -e ...', description: 'Try the AppleScript split'}], also: file('src/launch/index.ts')},
  {id: 'cc33', task: 'Write the kitty launcher', call: 'call-a3', done: false, tool: ['Write', {file_path: file('src/launch/kitty.ts')}], also: null},
] as const;
lines.push(reply(at(3), agents.map(a => call('Agent', {description: a.task, subagent_type: 'general-purpose', prompt: a.task}, a.call))));
write('src/launch/wezterm.ts', launcher('wezterm', 'wezterm cli split-pane --right'));
write('src/launch/kitty.ts', launcher('kitty', 'kitty @ launch --location=vsplit'));
write('src/launch/index.ts', INDEX_3);
agents.forEach((a, i) => {
  const base = path.join(dir, chat, 'subagents', `agent-${a.id}`);
  fs.writeFileSync(`${base}.meta.json`, JSON.stringify({agentType: 'general-purpose', description: a.task, toolUseId: a.call, spawnDepth: 1}));
  const row = (when: string, message: Record<string, unknown>) => JSON.stringify({type: 'assistant', isSidechain: true, agentId: a.id, timestamp: when, message: {model: 'claude-sonnet-5', usage: usage(2600 + i * 900), ...message}});
  const rows = [
    JSON.stringify({type: 'user', isSidechain: true, agentId: a.id, timestamp: at(2.95), message: {role: 'user', content: a.task}}),
    row(at(2.8), {id: `${a.id}-1`, content: [call('Read', {file_path: file('src/launch/wt.ts')}, `${a.id}-t1`)]}),
    row(at(2.2), {id: `${a.id}-2`, content: [call(a.tool[0], a.tool[1] as Record<string, unknown>, `${a.id}-t2`)]}),
    ...(a.also ? [row(at(1.6), {id: `${a.id}-3`, content: [call('Edit', {file_path: a.also, description: 'Add it to the launcher list'}, `${a.id}-t3`)]})] : []),
    ...(a.done ? [row(at(1.2), {id: `${a.id}-4`, stop_reason: 'end_turn', content: [{type: 'text', text: 'wezterm.ts is written and added to the launcher list. It splits to the right with wezterm cli split-pane.'}]})] : [row(at(0.05), {id: `${a.id}-5`, content: [call(a.tool[0], a.tool[1] as Record<string, unknown>, `${a.id}-t5`)]})]),
  ];
  fs.writeFileSync(`${base}.jsonl`, rows.join('\n') + '\n');
});
lines.push(reply(at(0.04), [call('Bash', {command: 'sleep 1', description: 'Wait for the agents'})]));
flush();

await press(ESC, '1');
await wait(4200); // one refresh, so the pane has read the new turn
await save('working');

await press('3', DOWN, DOWN, ENTER);
await save('agents');

await press('4');
await wait(1500);
await save('usage');

stdin.write('q');
await app.waitUntilExit();
fs.rmSync(stage, {recursive: true, force: true});
