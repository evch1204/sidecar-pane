// Builds a whole fake day — a chat transcript, five turns, five subagents, a
// second git worktree with an agent working in it, the commits that carried the
// work away and the snapshots sidecar would have taken while it ran — then
// drives the pane over it and checks every part of the drawing. This is the
// only way to see measured per-turn diffs, `✓ merged` and a worktree map
// without living through a real session.
//   npx tsx scripts/smoke-history.tsx [--cols 40] [--rows 34]
// Colour is on so a check can find the cursor's own row, and stripped again
// before anything is printed or matched. Ink and the app are imported after
// that switch, because chalk decides once, when it is loaded.
process.env.FORCE_COLOR = '3';
// These checks are about the stream, so every pane skips the opening, has no
// side panel and starts in Changes rather than on Home.
process.env.SIDECAR_NO_OPENING = '1';
process.env.SIDECAR_PANEL = 'off';

import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';

const {render} = await import('ink');
const {openStore, take} = await import('../src/core/snapshot');
const {App} = await import('../src/ui/App');
const {theme} = await import('../src/ui/theme');

const argv = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const at = argv.findIndex(arg => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (at < 0) return fallback;
  return Number(argv[at]!.includes('=') ? argv[at]!.split('=')[1] : argv[at + 1]) || fallback;
};

// `SMOKE_COLS` still works: it is what this script was driven by before it had
// flags of its own.
const COLS = flag('cols', Number(process.env.SMOKE_COLS) || 64);
const ROWS = flag('rows', 34);

// realpath: on a Mac the temp folder is a symlink, and git reports the real one.
const stage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-history-')));
const project = path.join(stage, 'demo');
// A worktree named the way Claude Code names one it gives an agent.
const treePath = path.join(stage, 'agent-a7b1');
process.env.SIDECAR_CLAUDE_HOME = path.join(stage, 'claude');
const home = path.join(stage, 'sidecar');
process.env.SIDECAR_HOME = home;

let failed = 0;
const check = (ok: boolean, what: string) => {
  if (ok) return;
  failed++;
  console.error(`  FAILED: ${what}`);
};

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const CURSOR_BG = `\u001B[48;2;${rgb(theme.surface2).join(';')}m`;
const plain = (text: string) => text.replace(/\u001B\[[0-9;]*m/g, '');

// Does this row say `what`? A narrow pane cuts a prompt, a name and a whole
// sentence with an ellipsis, and `add a farewel…` still names the turn it is
// the start of, so a cut piece counts when enough of it is there. An open turn
// wraps its prompt instead of cutting it, so the first row of one carries the
// start of the words and the rest are on the rows below.
const KEPT = 8;
function onRow(row: string, what: string): boolean {
  if (row.includes(what)) return true;
  for (const piece of row.split('…')) {
    for (let n = piece.length; n >= KEPT; n--) {
      if (what.startsWith(piece.slice(piece.length - n))) return true;
    }
  }

  for (let n = what.length; n >= KEPT; n--) {
    if (row.includes(what.slice(0, n))) return true;
  }

  return false;
}

// The same, over a whole frame.
const saysIt = (frame: string, what: string): boolean => frame.split('\n').some(row => onRow(row, what));

// The row under the first one that says `what`. What a row opens — an agent's
// kind, model and tool count under the agent, the folder a worktree's work is
// in under its own row — is drawn there, and reading it by name beats counting
// rows, which a narrow pane rewraps anyway.
function rowUnder(frame: string, what: string): string {
  const rows = frame.split('\n');
  const at = rows.findIndex(row => onRow(row, what));
  return at < 0 ? '' : rows[at + 1] ?? '';
}

// `2 tool uses`, and what a row too narrow to hold the words leaves of it.
const TOOLS = /\d+ tool use|\d+ too…/;

// The spinner is a different glyph every 250 ms, so a check about a row that
// carries one matches whichever frame the pane happens to be on.
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
const spinning = (row: string, what: string): boolean => new RegExp(`[${SPIN}] ${what}`).test(row);

// The word the footer puts after `enter`: what the row under the cursor does.
const verbOf = (row: string): string => /^\s*enter (.+?)(?: {2,}|$)/.exec(row)?.[1] ?? '';

// How many columns of a row are painted with the cursor's own background.
function litWidth(row: string): number {
  let on = false;
  let n = 0;
  for (const part of row.split(/(\u001B\[[0-9;]*m)/)) {
    if (part.startsWith('\u001B')) {
      // Any other background, and any reset, ends the run.
      if (part === CURSOR_BG) on = true;
      else if (part.includes('48;2;') || part === '\u001B[49m' || part === '\u001B[0m') on = false;
      continue;
    }

    if (on) n += [...part].length;
  }

  return n;
}

// ---- the project, and the history of it ------------------------------------

fs.mkdirSync(path.join(project, 'src'), {recursive: true});
const write = (rel: string, text: string) => fs.writeFileSync(path.join(project, rel), text);
const run = (...args: string[]) => execFileSync('git', ['-C', project, ...args], {stdio: 'ignore'});

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
// A commit with a date of our choosing, so a turn can have one inside its
// window without living through the wait.
const commitIn = (where: string, when: string, message: string, args: string[]) =>
  execFileSync('git', ['-C', where, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', message, ...args], {
    stdio: 'ignore',
    env: {...process.env, GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when},
  });
const commit = (when: string, message: string, ...paths: string[]) => {
  run('add', ...(paths.length ? paths : ['-A']));
  commitIn(project, when, message, []);
};

write('src/greet.ts', 'export function greet(name: string) {\n  return `hello ${name}`;\n}\n');
write('README.md', '# demo\n\nA project.\n');
// `-b main` so the default branch is the same on every machine: the rule for
// "merged" turns on which branch this repo calls its trunk.
run('init', '-q', '-b', 'main');
commit(at(60), 'first');
// The work happens on a branch, the way it does in this repo, so `merged` can
// mean "it reached main" rather than "it was pushed".
run('checkout', '-q', '-b', 'improve-greet');

// The transcript, exactly as Claude Code writes one.
const chat = '11111111-2222-3333-4444-555555555555';
const slug = (folder: string) => path.resolve(folder).replace(/[\\/:.]/g, '-');
const dir = path.join(process.env.SIDECAR_CLAUDE_HOME, 'projects', slug(project));
fs.mkdirSync(dir, {recursive: true});
const lines: string[] = [{type: 'ai-title', aiTitle: 'Make greet friendlier', sessionId: chat}].map(o => JSON.stringify(o));
const flush = () => fs.writeFileSync(path.join(dir, `${chat}.jsonl`), lines.join('\n') + '\n');

const turn = (uuid: string, prompt: string, when: string) =>
  JSON.stringify({
    type: 'user', turnOrigin: 'human', isSidechain: false, uuid, sessionId: chat,
    timestamp: when, cwd: project, gitBranch: 'improve-greet', message: {role: 'user', content: prompt},
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
// How Claude Code says an agent ended: the notification it writes into the chat.
const notify = (id: string, status: string, when: string, summary: string) =>
  JSON.stringify({
    type: 'user', promptSource: 'system', turnOrigin: 'task_notification', isSidechain: false, sessionId: chat, timestamp: when,
    message: {role: 'user', content: `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n<summary>${summary}</summary>\n</task-notification>`},
  });

const store = openStore(project)!;

// --- turn one: nobody watched it, and its commit reached main --------------
lines.push(turn('turn-1', 'mention the licence in the readme', at(46)));
write('LICENSE', 'MIT\n');
write('README.md', '# demo\n\nA project. MIT licensed.\n');
lines.push(acts(at(45.5), [
  {name: 'Write', input: {file_path: path.join(project, 'LICENSE'), description: 'Add the licence'}},
  {name: 'Edit', input: {file_path: path.join(project, 'README.md'), description: 'Mention the licence'}},
]));
lines.push(says(at(45.2), 'The readme now says the project is MIT licensed, and LICENSE holds the text.'));
commit(at(45), 'Mention the licence');
// Merged into main by hand, the way a finished branch is. The merge is on
// main, so the branch this pane sits on still reads `↑N` against it.
run('checkout', '-q', 'main');
run('merge', '-q', '--no-ff', 'improve-greet', '-m', 'Merge the licence note');
commitIn(project, at(44), 'Merge the licence note', ['--amend', '--no-edit']);
run('checkout', '-q', 'improve-greet');

// --- turn two: watched, measured, and still uncommitted -------------------
lines.push(turn('turn-2', 'make greet friendlier and say hi instead of hello', at(40)));
flush();
await take(store, project, Date.parse(at(41)));

write('src/greet.ts', [
  'export function greet(name: string, punctuation = "!") {',
  '  // Greets someone by name, with a punctuation mark of your choosing.',
  '  const who = name.trim() || "friend";',
  '  return `hi there ${who}${punctuation}`;',
  '}',
  '',
].join('\n'));
lines.push(acts(at(39), [
  {name: 'Edit', input: {file_path: path.join(project, 'src/greet.ts'), description: 'Say hi instead of hello'}},
  {name: 'Bash', input: {command: 'npx tsc --noEmit', description: 'Typecheck the change'}},
]));
lines.push(says(at(38.5), 'greet now says hi, trims the name and takes the punctuation as a second argument. The typecheck passes.'));
flush();
await take(store, project, Date.parse(at(38)));

// --- turn three: watched, and three agents, two of them on one file -------
lines.push(turn('turn-3', 'document greet and get a few agents to check it over', at(30)));
flush();
await take(store, project, Date.parse(at(31)));

write('README.md', '# demo\n\nA project. MIT licensed.\n\n## greet\n\nSays hi to someone.\n\n```ts\ngreet("world", "?");\n```\n');
write('src/example.ts', 'import {greet} from "./greet";\n\nconsole.log(greet("world"));\n');
lines.push(acts(at(29), [
  {name: 'Write', input: {file_path: path.join(project, 'src/example.ts'), description: 'Add an example'}},
  {name: 'Agent', id: 'call-agent-1', input: {description: 'Check the README wording', subagent_type: 'Explore', prompt: 'Read README.md and check it.'}},
  {name: 'Agent', id: 'call-agent-2', input: {description: 'Rewrite the example', subagent_type: 'general-purpose', prompt: 'Rewrite the README example.'}},
  {name: 'Agent', id: 'call-agent-3', input: {description: 'Polish the greeting', subagent_type: 'general-purpose', prompt: 'Polish the greeting itself.'}},
]));
// The user stopped the second agent while it was inside a tool call, so its
// transcript has an unanswered call and no report. The notification Claude Code
// writes into this chat is the only thing that says so.
lines.push(notify('def456', 'killed', at(28.6), 'Agent "Rewrite the example" was stopped by user'));
lines.push(says(at(28.5), 'The README documents greet with an example. One agent checked the wording, one was stopped, and one is still polishing.'));

const agentDir = path.join(dir, chat, 'subagents');
fs.mkdirSync(agentDir, {recursive: true});
const agentMeta = (id: string, meta: Record<string, unknown>) =>
  fs.writeFileSync(path.join(agentDir, `agent-${id}.meta.json`), JSON.stringify(meta));
const agentLine = (id: string, when: string, message: Record<string, unknown>, cwd = project) =>
  JSON.stringify({type: 'assistant', isSidechain: true, agentId: id, timestamp: when, cwd, message});
const agentAsk = (id: string, when: string, text: string, cwd = project) =>
  JSON.stringify({type: 'user', isSidechain: true, agentId: id, timestamp: when, cwd, message: {role: 'user', content: text}});
const agentFile = (id: string, rows: string[]) => fs.writeFileSync(path.join(agentDir, `agent-${id}.jsonl`), rows.join('\n') + '\n');

// Done, and it wrote the README.
agentMeta('abc123', {agentType: 'Explore', description: 'Check the README wording', toolUseId: 'call-agent-1', spawnDepth: 1});
agentFile('abc123', [
  agentAsk('abc123', at(29), 'Read README.md and check it.'),
  agentLine('abc123', at(28.9), {id: 'a-1', model: 'claude-fable-5-1', usage, content: [{type: 'tool_use', id: 'a-t1', name: 'Read', input: {file_path: path.join(project, 'README.md')}}]}),
  agentLine('abc123', at(28.8), {id: 'a-2', model: 'claude-fable-5-1', usage, content: [{type: 'tool_use', id: 'a-t2', name: 'Edit', input: {file_path: path.join(project, 'README.md'), description: 'Fix the wording'}}]}),
  agentLine('abc123', at(28.7), {id: 'a-3', model: 'claude-fable-5-1', usage, stop_reason: 'end_turn', content: [{type: 'text', text: 'The README reads well now. The example shows the punctuation argument.'}]}),
]);

// Stopped by the user, and it had written the same file.
agentMeta('def456', {agentType: 'general-purpose', description: 'Rewrite the example', toolUseId: 'call-agent-2', spawnDepth: 1, stoppedByUser: true});
agentFile('def456', [
  agentAsk('def456', at(29), 'Rewrite the README example.'),
  agentLine('def456', at(28.9), {id: 'b-1', model: 'claude-fable-5-1', usage, content: [{type: 'tool_use', id: 'b-t1', name: 'Write', input: {file_path: path.join(project, 'README.md'), description: 'Rewrite the example'}}]}),
  agentLine('def456', at(28.8), {id: 'b-2', model: 'claude-fable-5-1', usage, stop_reason: 'tool_use', content: [{type: 'tool_use', id: 'b-t2', name: 'Bash', input: {command: 'npm test', description: 'Run the tests'}}]}),
]);

// Still running, on another model, so its row carries a model chip and the
// step it is on. Its typecheck was started six minutes ago and has not come
// back, which is the window in which a spinner stops being enough and the row
// says the number instead.
agentMeta('run789', {agentType: 'general-purpose', description: 'Polish the greeting', toolUseId: 'call-agent-3', spawnDepth: 1, model: 'claude-opus-4-5-20251101'});
agentFile('run789', [
  agentAsk('run789', at(28), 'Polish the greeting itself.'),
  agentLine('run789', at(27), {id: 'c-1', model: 'claude-opus-4-5-20251101', usage, content: [{type: 'tool_use', id: 'c-t1', name: 'Read', input: {file_path: path.join(project, 'src/greet.ts')}}]}),
  agentLine('run789', at(6.2), {id: 'c-2', model: 'claude-opus-4-5-20251101', usage, stop_reason: 'tool_use', content: [{type: 'tool_use', id: 'c-t2', name: 'Bash', input: {command: 'npx tsc --noEmit', description: 'Typecheck the greeting'}}]}),
]);
flush();
await take(store, project, Date.parse(at(28)));

// --- turn four: nobody watched it, and git kept the receipt ---------------
lines.push(turn('turn-4', 'add a farewell as well, then commit it', at(20)));
write('src/bye.ts', 'export function bye(name: string) {\n  return `bye ${name}`;\n}\n');
write('src/scratch.ts', 'const tmp = 1;\n');
lines.push(acts(at(19.5), [
  {name: 'Write', input: {file_path: path.join(project, 'src/bye.ts'), description: 'Add a farewell'}},
  {name: 'Write', input: {file_path: path.join(project, 'src/scratch.ts'), description: 'Scratch a check'}},
  {name: 'Bash', input: {command: 'git commit -am "Add a farewell"', description: 'Commit the farewell'}},
]));
lines.push(says(at(19), 'bye is in src/bye.ts, committed in two goes. I removed the scratch file afterwards.'));
// The scratch file never reaches a commit, so its row has no counts to show.
fs.rmSync(path.join(project, 'src/scratch.ts'));
commit(at(19.2), 'Add a farewell', 'src/bye.ts');
write('src/bye.ts', 'export function bye(name: string, wave = true) {\n  return `bye ${name}${wave ? " 👋" : ""}`;\n}\n');
commit(at(18.8), 'Tidy the farewell', 'src/bye.ts');

// --- turn five: an agent in a worktree of its own -------------------------
run('worktree', 'add', '-q', '-b', 'agent-docs', treePath);
const inTree = (...args: string[]) => execFileSync('git', ['-C', treePath, ...args], {stdio: 'ignore'});
fs.mkdirSync(path.join(treePath, 'docs'), {recursive: true});
fs.writeFileSync(path.join(treePath, 'docs/guide.md'), '# Guide\n\nHow to greet, and how to say goodbye.\n\n## greet\n\nTakes a name.\n');
inTree('add', '-A');
commitIn(treePath, at(9), 'Write the guide', []);
// Work it has not committed yet, so the folder is dirty as well as ahead.
fs.writeFileSync(path.join(treePath, 'docs/guide.md'), '# Guide\n\nHow to greet, and how to say goodbye.\n\n## greet\n\nTakes a name and a punctuation mark.\n');

lines.push(turn('turn-5', 'hand the guide to an agent in its own worktree', at(10)));
lines.push(acts(at(9.8), [
  {name: 'Agent', id: 'call-agent-4', input: {description: 'Write the guide', subagent_type: 'general-purpose', prompt: 'Write docs/guide.md.'}},
]));
lines.push(notify('a7b1', 'completed', at(3), 'Agent "Write the guide" finished'));
// The turn is still the one you are in: its last line is seconds old, so the
// pane reads it as running and the map says `you + Claude`.
lines.push(acts(at(0.3), [{name: 'Read', input: {file_path: path.join(treePath, 'docs/guide.md'), description: 'Read what it wrote'}}]));
agentMeta('a7b1', {
  agentType: 'general-purpose', description: 'Write the guide', toolUseId: 'call-agent-4', spawnDepth: 1,
  worktreePath: treePath, worktreeBranch: 'agent-docs', spawnedWithWorktree: true,
});
agentFile('a7b1', [
  agentAsk('a7b1', at(9.8), 'Write docs/guide.md.', treePath),
  agentLine('a7b1', at(9.5), {id: 'd-1', model: 'claude-fable-5-1', usage, content: [{type: 'tool_use', id: 'd-t1', name: 'Write', input: {file_path: path.join(treePath, 'docs/guide.md'), description: 'Write the guide'}}]}, treePath),
  agentLine('a7b1', at(3.2), {id: 'd-2', model: 'claude-fable-5-1', usage, stop_reason: 'end_turn', content: [{type: 'text', text: 'docs/guide.md covers greet and bye. It is on agent-docs, not in your folder yet.'}]}, treePath),
]);
flush();

// That worktree has a chat of its own, keyed by its own folder: the turn the
// agent was working for, which is invisible from here until the scope widens.
const treeChat = '99999999-8888-7777-6666-555555555555';
const treeDir = path.join(process.env.SIDECAR_CLAUDE_HOME, 'projects', slug(treePath));
fs.mkdirSync(treeDir, {recursive: true});
fs.writeFileSync(path.join(treeDir, `${treeChat}.jsonl`), [
  JSON.stringify({type: 'ai-title', aiTitle: 'Write the guide', sessionId: treeChat}),
  JSON.stringify({
    type: 'user', turnOrigin: 'human', isSidechain: false, uuid: 'tree-1', sessionId: treeChat,
    timestamp: at(9.7), cwd: treePath, gitBranch: 'agent-docs', message: {role: 'user', content: 'write the guide and commit it'},
  }),
  JSON.stringify({
    type: 'assistant', sessionId: treeChat, timestamp: at(9.4), isSidechain: false,
    message: {role: 'assistant', id: 'tm-1', model: 'claude-fable-5-1', usage, content: [{type: 'tool_use', id: 'tt-1', name: 'Write', input: {file_path: path.join(treePath, 'docs/guide.md'), description: 'Write the guide'}}]},
  }),
  JSON.stringify({
    type: 'assistant', sessionId: treeChat, timestamp: at(9.1), isSidechain: false,
    message: {role: 'assistant', id: 'tm-2', model: 'claude-fable-5-1', usage, stop_reason: 'end_turn', content: [{type: 'text', text: 'The guide is written and committed on agent-docs.'}]},
  }),
].join('\n') + '\n');

// Sidecar was running for turns two and three only. The rest happened while it
// was closed, so their lines come from the commits instead.
fs.writeFileSync(path.join(store.dir, 'watched.json'), JSON.stringify([[Date.parse(at(42)), Date.parse(at(27))]]));

// What the status line script would have saved.
const feed = (secondsOld: number) =>
  fs.writeFileSync(path.join(home, 'usage.json'), JSON.stringify({
    at: Date.now() - secondsOld * 1000,
    rate_limits: {
      five_hour: {used_percentage: 58, resets_at: Math.round(Date.now() / 1000) + 112 * 60},
      seven_day: {used_percentage: 23, resets_at: Math.round(Date.now() / 1000) + 3 * 86_400},
    },
    context_window: {context_window_size: 1_000_000, used_percentage: 7},
  }));
feed(0);

// ---- one rendered pane, driven by keys -------------------------------------

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const frames: string[] = [];
// Every frame any pane drew, for the checks that are about all of them.
const seen: string[] = [];

function pane(root: string, cols = COLS, rows = ROWS) {
  const stdin = Object.assign(new PassThrough(), {isTTY: true, setRawMode: () => stdin, ref: () => stdin, unref: () => stdin});
  const out: string[] = [];
  const stdout = Object.assign(new PassThrough(), {columns: cols, rows, isTTY: true});
  stdout.on('data', c => out.push(String(c)));

  const app = render(<App root={root} interactive />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    exitOnCtrlC: false,
  });
  stdin.write('1');

  const frame = () => out.filter(chunk => chunk.includes('\n')).at(-1) ?? '';
  const text = () => plain(frame());
  const rowsOf = () => frame().split('\n');
  // The two rows of chrome the checks about state read: the bar says who the
  // pane is waiting on, the footer says what the row under the cursor does.
  const bar = () => plain(rowsOf()[0] ?? '');
  const foot = () => [...rowsOf()].map(plain).reverse().find(row => row.trim()) ?? '';
  // A block is often taller than the window, and on a short pane never more
  // than half of it is on screen at once. `mark` remembers where the run is
  // now and `since` reads back every row drawn after that: step through a
  // block and the whole of it has passed through the window, one window at a
  // time, so a check about a block reads `since` and not one frame of it.
  let marked = 0;
  const mark = () => {
    marked = out.length;
  };

  const since = () => out.slice(marked).map(plain).join('\n');
  // A lit tab, a lit pill and every chip carry the cursor's own background
  // too, so a row is the cursor's when most of it is painted with it.
  const cursorRow = () => plain(rowsOf().find(row => litWidth(row) > cols / 2) ?? '');
  const press = async (...keys: string[]) => {
    for (const key of keys) {
      stdin.write(key);
      await wait(60);
    }
  };

  const show = async (label: string) => {
    await wait(500);
    const shot = text();
    seen.push(shot);
    frames.push(`\n===== ${label}\n${shot}`);
    console.log(`\n===== ${label}\n${shot}`);
    return shot;
  };

  // Step down until the cursor is on the row that says `what`. Down only, so a
  // second pass starts again from the top of the stream: rows open and close
  // as this walks, and the row wanted may be above where the cursor is now.
  const onto = async (what: string) => {
    for (let pass = 0; pass < 2; pass++) {
      for (let n = 0; n < 60; n++) {
        if (onRow(cursorRow(), what)) return true;
        await press(DOWN);
      }

      await press('g');
    }

    check(false, `the cursor should have reached the row for "${what}", and it is on "${cursorRow().trim()}"`);
    return false;
  };

  const quit = async () => {
    stdin.write('q');
    await app.waitUntilExit();
  };

  return {press, show, frame, text, rowsOf, bar, foot, cursorRow, mark, since, onto, quit};
}

const DOWN = '\u001B[B';
const UP = '\u001B[A';
const ESC = '\u001B';
const ENTER = '\r';
const click = (col: number, row: number) => `\u001B[<0;${col + 1};${row + 1}M`;

const p = pane(project);
await wait(1800);

// The cursor opens on the turn you are in, and a short window has to scroll
// past the head of the stream to reach it. `g` walks back up to the top, so
// the day and the turn under it are drawn whatever the pane's height.
await p.press('g');
const opening = await p.show('changes: the day, and the turn you are in');
check(opening.includes('TODAY'), 'the day should head the stream');
check(!opening.includes('WORKTREES'), 'this folder alone is no map: a worktree is where an agent worked, not a head of the stream');
check(/[▁▂▃▄▅▆▇█]{2} [▁▂▃▄▅▆▇█]{2} /.test(opening), 'and the day should keep its skyline whatever else is in scope');

// A turn is a row that opens, so it is marked like one, and the one that is
// running says that instead.
const turnRows = (shot: string) => shot.split('\n').filter(row => /\d\d:\d\d\s*$/.test(row) && !row.startsWith(' │'));
const opens = (rows: string[]) => rows.length > 0 && rows.every(row => new RegExp(`^ [▸▾${SPIN}]`).test(row));
check(opens(turnRows(opening)), 'every turn on screen should start with a chevron, or with the spinner while it runs');

// An open turn cuts nothing: whatever is not on its first row is on the row
// under it, because your own words are the reason the files moved.
check(saysIt(opening, 'hand the guide to an agent'), 'the open turn should start with your own words');
check(saysIt(opening, 'in its own worktree'), 'and carry the end of them too, wrapped rather than cut');

// While a fan-out is running, how many of them there are is the news.
check(spinning(p.bar(), '1 agent'), `the bar should count the agent that is running, and it reads "${p.bar().trim()}"`);
check(!saysIt(opening, 'w worktree'), 'and the footer should not spend a hint on the scope key');

// The footer is the only sign follow is on, so it has to survive the widest
// label the pane draws: this folder is `demo • improve-greet`, with an agent
// running, which is the row the owner's own pane has.
// The `g` above was a key press like any other, so follow is paused here.
check(COLS < 62 || /f follow(?!ing)/.test(p.foot()), `paused, the footer should offer follow back, and it reads "${p.foot().trim()}"`);
await p.press('f');
await wait(300);
check(COLS < 62 || p.foot().includes('f following'), `and while it is on the footer should say so, and it reads "${p.foot().trim()}"`);
await p.press('g');
await wait(300);

// ---- the agent that worked in a worktree of its own ----------------------
// One row under the agent says the whole of it: where it worked, how much is
// there, and whether any of that has arrived in this folder yet.
const fact = rowUnder(opening, 'Write the guide');
check(fact.includes('in agent-docs'), `the row under the agent should name the folder it worked in, and it reads "${fact.trim()}"`);
check(
  COLS < 56 ? fact.includes('not merged') : /↑1 · not in demo yet/.test(fact),
  'and say that none of it is in this folder yet, with how far ahead it is when there is room',
);

if (await p.onto('Write the guide')) {
  p.mark();
  // What it opens is drawn under it, which on a short pane is under the window
  // too: one step further down brings it in.
  await p.press(ENTER, DOWN, DOWN);
  await p.show('changes: the agent opened, and the files of the folder it worked in');
  const inside = p.since();
  check(saysIt(inside, 'guide.md'), "an opened agent should list the files of its own folder, read from that folder's git");
  check(TOOLS.test(inside), 'and say what it was and how much it did');
  // Closed again, so the turns below are read against the stream as it opened.
  await p.press('g');
  if (await p.onto('Write the guide')) await p.press(ENTER);
}

// The stream is newest first and `onto` only ever steps down, so the turns are
// visited in the order they are drawn: the newest at the top, the one whose
// work reached main at the bottom.

// ---- the turn with commits that have not reached main --------------------
if (await p.onto('add a farewell as well')) {
  p.mark();
  await p.press(ENTER);
  await p.show('changes: two commits of its own, and a file no source recorded');
  // Its own rows carry on below the window, so stepping through them brings
  // the receipt at the end of the block into view — and, on a short pane, the
  // chips and the files above it back out of view. The block is the walk.
  await p.press(DOWN, DOWN, DOWN, DOWN, DOWN);
  const receipt = await p.show('changes: the commits that turn made, at the end of its block');
  const block = p.since();
  check(block.includes('◆ committed'), 'a turn with commits that have not landed should say committed');
  check(/\?\s+scratch\.ts/.test(block), 'a file no source recorded should be marked and named');
  check(/[▸▾] [AMDR?] {2}\S/.test(block), 'a file inside an open turn should be a row that opens too');
  // The walk took the turns above and below this one through the window.
  check(opens(turnRows(block)), 'and every turn the walk passed should start with a chevron or the spinner');
  check(COLS < 56 || block.includes('not recorded'), 'and it should say so in words: on a narrow row the mark is the whole of it');
  check(/◆ [0-9a-f]{7} {2}Tidy the farewell/.test(receipt), 'its own commits should be listed');
  check(!block.includes('✓ merged'), 'nothing in that turn has been merged, so nothing should say so');
  // Esc walks up to the row that owns these, and again closes it, so the next
  // turn is read against a stream that is not carrying this one open.
  await p.press(ESC, ESC);
}

// ---- the watched turns: three agents, and work still in the working tree --
if (await p.onto('document greet')) {
  // Stepping into the block brings the whole of it into the window.
  await p.press(ENTER, DOWN, DOWN, DOWN, DOWN);
  const chart = await p.show('changes: three agents, two of them on the same file');
  check(/3 agents/.test(chart), 'the chart should head with how many agents there were');
  check(chart.includes('■'), 'each agent should carry a square in its own hue');
  check(chart.includes('■■'), 'a file two agents wrote should carry both their squares');
  check(chart.includes('⎿'), 'the agent still running should show the step it is on');
  // A spinner says something is happening and never says for how long. Past
  // five minutes the row says the number, because that is where a long
  // command and a stuck one start to look the same.
  const step = chart.split('\n').find(row => row.includes('⎿')) ?? '';
  check(/\d+m( \d+s)? quiet/.test(step), `and how long that step has been silent, and it reads "${step.trim()}"`);
  check(COLS < 56 || /▐(Explore|Opus)/.test(chart), 'an agent whose kind or model is not the default should carry a chip');
  await p.press(ESC, ESC);
}

if (await p.onto('make greet friendlier')) {
  // The footer says what Enter will do here, and it says it three ways: on a
  // turn that is closed, on the same turn open, and on a file inside it.
  check(verbOf(p.foot()) === 'open', `a closed turn should offer to open, and the footer reads "${p.foot().trim()}"`);
  await p.press(ENTER, DOWN, DOWN);
  const dirty = await p.show('changes: a measured turn whose work is still only in the working tree');
  check(dirty.includes('● uncommitted'), 'a measured turn with nothing committed and a dirty file should say uncommitted');
  check(/\+\d+ +−\d+/.test(dirty), 'its file row should carry both counts');
  if (await p.onto('greet.ts')) check(verbOf(p.foot()) === 'diff', `a file row should offer its diff, and the footer reads "${p.foot().trim()}"`);
  await p.press('g');
  if (await p.onto('make greet friendlier')) {
    check(verbOf(p.foot()) === 'close', `the same turn open should offer to close, and the footer reads "${p.foot().trim()}"`);
    await p.press(ESC, ESC);
  }
}

// ---- the turn whose commit reached main ----------------------------------
if (await p.onto('mention the licence')) {
  // Its block is the last thing in the stream, so a few steps into it bring
  // the whole of it, receipt included, into the window.
  await p.press(ENTER, DOWN, DOWN);
  const merged = await p.show('changes: the turn whose commit reached the default branch');
  check(merged.includes('✓ merged'), 'a turn whose commit reached the default branch should say so');
  // Its block runs past the bottom of the window. Nothing below it can hold
  // the cursor, so the last steps scroll the page instead of moving it.
  await p.press(DOWN, DOWN, DOWN, DOWN, DOWN, DOWN, DOWN);
  const receipt2 = await p.show('changes: and the commit that holds its work');
  check(/◆ [0-9a-f]{7} {2}Mention/.test(receipt2), 'the open turn should list the commit that holds its work');
}

// ---- the worktrees, before the merge ------------------------------------
// The scope moves the cursor's row down the stream, which scrolls the head of
// it away, so `g` walks back up after the switch rather than before it.
await p.press('w');
await wait(1200);
await p.press('g');
p.mark();
const all = await p.show('changes: every worktree of the repository, scope all');
// At 40 columns the grouping pills win and the scope pill gives way; the
// menu still has it, and the map still heads the stream.
check(COLS < 56 || all.includes('in all 2 worktrees'), 'the scope pill should say how many folders are in view');
check(all.includes('WORKTREES'), 'the map should head the stream, and only in this scope');
check(/[▸▾] {2}WORKTREES/.test(all), 'and fold from a chevron of its own');
// Closed, and at 40 columns the chip, the count and the clock leave the words
// nothing: the turn is in the stream and opens on Enter, but there is no
// reading it where it stands.
check(COLS < 56 || saysIt(all, 'write the guide and commit it'), "that folder's own chat should be in the stream");
check(/[▁▂▃▄▅▆▇█]{2}/.test(all), 'the day should still head it with its own skyline');
const chipped = all.split('\n').filter(row => row.includes('▐agent-docs▌'));
check(chipped.length === 1, `only a turn typed in another folder should carry that folder's chip, and ${chipped.length} rows carry one`);
check(COLS < 56 || onRow(chipped[0]!, 'write the guide and commit it'), 'and it should be the turn that was typed there');

// The head is about the day, not about whichever chat happened to start it:
// two chats worked today and all six turns are the day's. The divider under
// it is what says which chat the run of turns below belongs to.
const dayRow = all.split('\n').find(row => row.trimStart().startsWith('TODAY')) ?? '';
check(/\b6 turns\b/.test(dayRow), `the day head should count every turn of the day, and it reads "${dayRow.trim()}"`);
check(/([▁▂▃▄▅▆▇█]{2} ){5}[▁▂▃▄▅▆▇█]{2}/.test(all), 'and the skyline should have a column pair for each of the six');
check(saysIt(all, 'Make greet friendlier'), 'and the divider should name the chat the next run of turns is from');

// Widening the scope must not close the turn you are watching to open a
// stranger's: open by default is the newest turn of this folder's own.
check(/^ [▸▾]/.test(chipped[0] ?? ''), `a turn typed in another folder should be drawn closed, and it reads "${chipped[0]?.trim()}"`);
const under = rowUnder(all, 'hand the guide');
check(under.trimStart().startsWith('│'), `and this folder's own running turn should still be the open one, with "${under.trim()}" under it`);

// ---- merge it, and take the folder away ---------------------------------
run('merge', '-q', '--no-ff', 'agent-docs', '-m', 'Merge the guide');
run('worktree', 'remove', '--force', treePath);
run('worktree', 'prune');
await wait(4000);
const after = await p.show('changes: the same folder, merged and then removed');
check(/✓ merged \d\d:\d\d/.test(after), 'a merged worktree should say when it landed, even once it is gone');

await p.press('w');
await wait(600);
p.mark();
await p.show('changes: back to this folder, and the merge on the newest turn');
// The merge is the last row of the newest turn's block, under the agent and
// the files it wrote, so a short window reaches it by stepping.
await p.onto('hand the guide');
await p.press(DOWN, DOWN, DOWN, DOWN);
const back = p.since();
check(/✓ [0-9a-f]{7} {2}merged into/.test(back), 'the newest turn should carry the merge that landed in this folder');
check(COLS < 56 || back.includes('merged into improve-greet'), 'and name the branch it landed on');
// The folder is gone by now, and its own row still says where its work got to.
const landed = rowUnder(back, 'Write the guide');
check(/✓ merged \d\d:\d\d/.test(landed), `the agent's own row should say when its folder landed, and it reads "${landed.trim()}"`);
// The point it left the parent has moved past it, so there is nothing left to
// count: saying `0 files` over a file that is plainly there is the worse half
// of the row, and the name alone is the truth.
check(!/\d+ files?/.test(landed), `and count nothing it can no longer measure, and it reads "${landed.trim()}"`);

// ---- the Agents view ----------------------------------------------------
await p.press('3');
await wait(600);
p.mark();
await p.show('agents: the newest block, and the folder its agent worked in');

// The turn with three agents is history by now, so its block is closed.
if (await p.onto('document greet')) {
  await p.press(ENTER, DOWN, DOWN, DOWN);
  const agentsView = await p.show('agents: lanes on one clock, grouped by the folder each worked in');
  check(COLS < 56 || /at most \d at once/.test(agentsView), 'a turn whose agents overlapped should say how many ran at once');
  check(/in demo/.test(agentsView), 'the agents that worked here should be grouped under this folder');
  check(COLS >= 56 ? /[▄]/.test(agentsView) : agentsView.includes('■'), 'each agent should have a lane, or a square where there is no room for one');
}

if (await p.onto('Check the README')) {
  await p.press(ENTER);
  const opened = await p.show('agents: one agent opened, with what it was and what it said');
  // Its own row, not any row: the agent still running says how much it did on
  // a row of its own, and that was answering for this one.
  check(TOOLS.test(rowUnder(opened, 'Check the README')), 'an opened agent should say how much it did');
  check(opened.includes('“'), 'and quote what it handed back');
}

// Every row of this view that opens says so the same way: an agent by the
// chevron in front of its square, a turn by the one in column 1.
const walked = p.since();
const squares = walked.split('\n').filter(row => row.includes('■'));
const unmarked = squares.find(row => !/^[\s│]*[▸▾] ■ /.test(row));
check(squares.length > 0 && !unmarked, `every agent row should start with a chevron and its square, and "${unmarked?.trim()}" does not`);
check(walked.split('\n').some(row => /^ [▸▾] {2}/.test(row)), 'and a closed turn should carry its own chevron in column 1');

if (await p.onto('Rewrite the example')) {
  p.mark();
  await p.press(ENTER);
  const stopped = await p.show('agents: the one the user stopped, read from the notification');
  check(/● +stopped/.test(stopped), 'an agent the user stopped should say stopped');
  // It opens under the row it is on, which on a short pane is the last row of
  // the window: one step further down brings what it says into it.
  await p.press(DOWN);
  check(p.since().includes('Stopped before it handed back.'), 'and say what that means');
}

// ---- the bar, once the agents are done and a prompt is up ---------------
// The agent that was still polishing hands back, so the newest turn itself is
// the news: the step it is on, and how long it has been going.
fs.appendFileSync(
  path.join(agentDir, 'agent-run789.jsonl'),
  agentLine('run789', at(0.1), {id: 'c-3', model: 'claude-opus-4-5-20251101', usage, stop_reason: 'end_turn', content: [{type: 'text', text: 'The greeting reads well now.'}]}) + '\n',
);
await p.press('1');
await wait(4000);
check(spinning(p.bar(), 'Read \\d'), `with nothing else running the bar should name the step the turn is on, and it reads "${p.bar().trim()}"`);

// Claude Code asking to run something leaves nothing in the transcript, so the
// hook writes the note and the pane reads it back against the size it wrote.
const transcript = path.join(dir, `${chat}.jsonl`);
fs.writeFileSync(path.join(home, slug(project), 'attention.json'), JSON.stringify({
  at: Date.now(), tool: 'Read', toolUseId: 't0', sessionId: chat,
  transcriptPath: transcript, transcriptSize: fs.statSync(transcript).size,
}));
await wait(4000);
await p.show('changes: Claude Code is asking you to allow something');
check(p.bar().includes('● asking you'), `a prompt waiting on you should reach the bar, and it reads "${p.bar().trim()}"`);
if (await p.onto('Read what it wrote')) {
  check(p.cursorRow().includes('waiting for you'), `and the step row should say who it is waiting on, and it reads "${p.cursorRow().trim()}"`);
}

// Answering it, either way, appends a line — and then Claude Code carries on.
lines.push(JSON.stringify({
  type: 'user', isSidechain: false, sessionId: chat, timestamp: at(0.05),
  message: {role: 'user', content: [{type: 'tool_result', tool_use_id: 't0', content: 'the guide'}]},
}));
lines.push(acts(at(0.02), [{name: 'Read', id: 'after-1', input: {file_path: path.join(treePath, 'docs/guide.md'), description: 'Read what it wrote'}}]));
flush();
await wait(4000);
check(!p.bar().includes('asking you'), `answering it should take the word off the bar, and it reads "${p.bar().trim()}"`);
if (await p.onto('Read what it wrote')) {
  check(!p.cursorRow().includes('waiting for you'), `and off the step row, and it reads "${p.cursorRow().trim()}"`);
}

// Allowing something is not the same as it being over. `npm test` runs for
// minutes with its call still open, so the line that clears the note is any
// line at all, not that call's own result.
fs.writeFileSync(path.join(home, slug(project), 'attention.json'), JSON.stringify({
  at: Date.now(), tool: 'Read', toolUseId: 'after-1', sessionId: chat,
  transcriptPath: transcript, transcriptSize: fs.statSync(transcript).size,
}));
await wait(4000);
check(p.bar().includes('● asking you'), `a prompt on a call with no result should reach the bar, and it reads "${p.bar().trim()}"`);
lines.push(acts(at(0.01), [{name: 'Bash', id: 'allowed-1', input: {command: 'npm test', description: 'Run the tests'}}]));
flush();
await wait(4000);
check(
  !p.bar().includes('asking you'),
  `and allowing it should clear the note while its call runs on, and the bar reads "${p.bar().trim()}"`,
);

// ---- Usage, Files, and the reader ---------------------------------------
await p.press('4');
await wait(1200);
await p.show('usage: limits from the feed, tokens from the transcripts');

await p.press('2');
await wait(600);
if (await p.onto('README.md')) {
  await p.press(ENTER);
  await wait(600);
  await p.press('o');
  await wait(1200);
  await p.show('files: README.md in the reader, formatted');
  await p.press(ESC);
}

await p.press('c');
await wait(600);
await p.show('files: changed files only, so the folders are headings');

// ---- the bar, in its three states ---------------------------------------
// The limits are re-read every poll, so the same pane shows all three.
await p.press('1');
await wait(600);
const barOf = () => plain(p.rowsOf()[0] ?? '');
const fresh = barOf();
// The pane draws what fit beside the status; the full forms are checked below.

feed(40 * 60);
await wait(4000);
const quiet = barOf();
check(COLS < 56 || quiet.includes('feed quiet'), `a feed nobody has fed for a while should say so, and it reads "${quiet.trim()}"`);

fs.rmSync(path.join(home, 'usage.json'));
await wait(4000);
const none = barOf();
check(COLS < 56 || none.includes('connect for %'), `with no feed the bar should offer the way to a percentage, and it reads "${none.trim()}"`);
check(none.includes('~'), 'and mark its own figure as an estimate');
console.log(`\n===== the bar, in three states\n${fresh}\n${quiet}\n${none}`);
seen.push(fresh, quiet, none);

// ---- a prompt nobody has answered for twenty minutes --------------------
// Lunch. A turn parked on a permission prompt appends nothing while it waits,
// so the bound that stops a call reading as live for ever would take exactly
// the state the hook was written to report.
lines.push(JSON.stringify({
  type: 'user', turnOrigin: 'human', isSidechain: false, uuid: 'parked', sessionId: chat,
  timestamp: at(21), cwd: project, gitBranch: 'improve-greet', message: {role: 'user', content: 'run the tests and fix what fails'},
}));
lines.push(acts(at(20), [{name: 'Bash', id: 'parked-call', input: {command: 'npm test', description: 'Run the tests'}}]));
flush();
fs.writeFileSync(path.join(home, slug(project), 'attention.json'), JSON.stringify({
  at: Date.now(), tool: 'Bash', toolUseId: 'parked-call', sessionId: chat,
  transcriptPath: transcript, transcriptSize: fs.statSync(transcript).size,
}));
await wait(4000);
check(p.bar().includes('● asking you'), `a prompt left for twenty minutes should still be reported, and the bar reads "${p.bar().trim()}"`);

await p.quit();

// The bar the pane drew is the bar that fit beside a spinner and an agent
// count. These are the same three states at their full width, so the parts a
// narrow bar had to drop are checked too.
const {usageExtras} = await import('../src/ui/views/usage');
const {readLimits} = await import('../src/core/usage');
const wordsOf = (room: number) => usageExtras(readLimits(), Date.now(), {room}).map(s => s.text).join('');
feed(0);
check(/^5h ▄+ 58% {2}.+ · wk 23%$/.test(wordsOf(60)), `a fresh feed, at full width, reads "${wordsOf(60)}"`);
check(wordsOf(60).endsWith('· wk 23%') && !wordsOf(28).includes('wk'), 'the week is the first thing the bar gives up');
feed(40 * 60);
check(/^5h 58% {2}feed quiet 40m · reconnect$/.test(wordsOf(60)), `a quiet feed, at full width, reads "${wordsOf(60)}"`);
fs.rmSync(path.join(home, 'usage.json'));
// With no feed at all the figure is the window counted from the transcripts,
// which needs the spends the Usage view reads; the bar the pane drew above is
// the one with a real count in it. Here only the last words are checked.
check(usageExtras(null, Date.now(), {spends: [{at: Date.now(), tokens: 4300, model: 'claude-fable-5-1', chat: 'x', sub: false, context: 0, cacheRead: 0}], room: 60})
  .map(s => s.text).join('').includes('connect for %'), 'with no feed the bar offers the way to a percentage');

// ---- one folder, a day of turns, and the other half of the merge rule ----
// A repo sitting on its own default branch with no upstream cannot know that
// anything was merged: pushed is the only thing merged could mean there, and
// there is nothing to compare with, so `committed` is the most it may say.
// One folder is also where the day's skyline is worth reading: one column pair
// a turn, in time order, and a click on a pair goes to that turn.
const solo = path.join(stage, 'solo');
fs.mkdirSync(solo, {recursive: true});
const inSolo = (...args: string[]) => execFileSync('git', ['-C', solo, ...args], {stdio: 'ignore'});
const body = (n: number, word: string) => Array.from({length: n}, (_, i) => `${word} ${i + 1}`).join('\n') + '\n';
fs.writeFileSync(path.join(solo, 'notes.md'), body(12, 'a note about line'));
inSolo('init', '-q', '-b', 'main');
inSolo('add', '-A');
commitIn(solo, at(60), 'first', []);

const soloChat = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const soloDir = path.join(process.env.SIDECAR_CLAUDE_HOME, 'projects', slug(solo));
fs.mkdirSync(soloDir, {recursive: true});
const soloLines: string[] = [JSON.stringify({type: 'ai-title', aiTitle: 'A day of notes', sessionId: soloChat})];

// Four turns of four sizes, so the day has a shape: a one line fix, a rewrite
// that took lines out as well as putting them in, a big new table, and a last
// change nothing has committed.
const day: {when: number; prompt: string; file: string; lines: number}[] = [
  {when: 50, prompt: 'fix the typo in the first line', file: 'notes.md', lines: 12},
  {when: 40, prompt: 'rewrite the notes so they read as prose', file: 'notes.md', lines: 48},
  {when: 30, prompt: 'add the whole reference table', file: 'table.md', lines: 240},
  {when: 20, prompt: 'add one more row to the table', file: 'table.md', lines: 243},
];

day.forEach((one, i) => {
  soloLines.push(JSON.stringify({
    type: 'user', turnOrigin: 'human', isSidechain: false, uuid: `s-${i}`, sessionId: soloChat,
    timestamp: at(one.when), cwd: solo, gitBranch: 'main', message: {role: 'user', content: one.prompt},
  }));
  soloLines.push(JSON.stringify({
    type: 'assistant', sessionId: soloChat, timestamp: at(one.when - 0.4), isSidechain: false,
    message: {
      role: 'assistant', id: `sm-${i}`, model: 'claude-fable-5-1', usage,
      content: [{type: 'tool_use', id: `st-${i}`, name: 'Write', input: {file_path: path.join(solo, one.file), description: one.prompt}}],
    },
  }));
  soloLines.push(JSON.stringify({
    type: 'assistant', sessionId: soloChat, timestamp: at(one.when - 0.8), isSidechain: false,
    message: {role: 'assistant', id: `sr-${i}`, model: 'claude-fable-5-1', usage, stop_reason: 'end_turn', content: [{type: 'text', text: `Done: ${one.prompt}.`}]},
  }));
  fs.writeFileSync(path.join(solo, one.file), body(one.lines, one.file === 'notes.md' ? 'a line of prose' : 'a row of the table'));
  // The last turn is never committed, so its work is still in the working
  // tree and nothing on it can be called merged either.
  if (i < day.length - 1) {
    inSolo('add', '-A');
    commitIn(solo, at(one.when - 1), `${one.prompt[0]!.toUpperCase()}${one.prompt.slice(1)}`, []);
  }
});

fs.writeFileSync(path.join(soloDir, `${soloChat}.jsonl`), soloLines.join('\n') + '\n');

const q = pane(solo);
await wait(1800);
check(q.bar().includes('● your turn'), `a chat that handed back today should say whose turn it is, and the bar reads "${q.bar().trim()}"`);
q.mark();
const oneFolder = await q.show('changes: a day of four turns, and the skyline that gives it a shape');
check(/[▁▂▃▄▅▆▇█]{2} [▁▂▃▄▅▆▇█]{2} /.test(oneFolder), 'the day should draw a skyline of its turns');
check(/[+]\d+ −\d+/.test(oneFolder), "the day's own totals should be on the skyline row");
check(!oneFolder.includes('✓ merged'), 'and never merged: there is nothing here it could have been merged into');
check(!oneFolder.includes('WORKTREES'), 'one folder is no map');

// One click zone a turn, three columns each: the third pair is the big turn.
const skyRow = q.rowsOf().findIndex(row => /[▁▂▃▄▅▆▇█]{2} [▁▂▃▄▅▆▇█]{2} /.test(plain(row)));
await q.press(click(9 + 6, skyRow));
await wait(600);
const clicked = await q.show('changes: the turn a click on the skyline column opened');
check(onRow(q.cursorRow(), 'add the whole reference table'), `a click on the third column should move the cursor to the third turn, and it is on "${q.cursorRow().trim()}"`);
check(clicked.includes('◆ committed'), 'and open it: its commit is made but not merged anywhere');
check(!clicked.includes('✓ merged'), 'on the default branch with no upstream, committed is the most it may say');
// The past turns sit under whichever one is open, and a short window cannot
// hold them with it: walking to the oldest takes every one of them through it.
await q.onto('fix the typo');
check(/◆\d/.test(q.since()), 'a past turn with commits should carry the mark and the count');

// A question Claude asked and nobody has answered yet. The turn has not ended
// and the call has no result: that, and nothing about a timer, is the rule.
soloLines.push(JSON.stringify({
  type: 'user', turnOrigin: 'human', isSidechain: false, uuid: 's-4', sessionId: soloChat,
  timestamp: at(0.2), cwd: solo, gitBranch: 'main', message: {role: 'user', content: 'should the table have a summary row'},
}));
soloLines.push(JSON.stringify({
  type: 'assistant', sessionId: soloChat, timestamp: at(0.1), isSidechain: false,
  message: {role: 'assistant', id: 'sm-ask', model: 'claude-fable-5-1', usage, content: [{type: 'tool_use', id: 'ask-1', name: 'AskUserQuestion', input: {questions: []}}]},
}));
fs.writeFileSync(path.join(soloDir, `${soloChat}.jsonl`), soloLines.join('\n') + '\n');
await wait(4000);
check(q.bar().includes('● asking you'), `an unanswered question should reach the bar too, and it reads "${q.bar().trim()}"`);
await q.quit();
// ---- follow mode: the file the running turn is working on right now ------
// Nothing touches a key before the first check: follow is on until you reach
// for the page, and what it does is open the diff you would have opened.
const live = path.join(stage, 'live');
fs.mkdirSync(live, {recursive: true});
fs.writeFileSync(path.join(live, 'one.ts'), 'export const one = 1;\n');
execFileSync('git', ['-C', live, 'init', '-q', '-b', 'main'], {stdio: 'ignore'});
execFileSync('git', ['-C', live, 'add', '-A'], {stdio: 'ignore'});
commitIn(live, at(30), 'first', []);

const liveChat = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff';
const liveDir = path.join(process.env.SIDECAR_CLAUDE_HOME, 'projects', slug(live));
fs.mkdirSync(liveDir, {recursive: true});
const liveLines = [
  JSON.stringify({type: 'ai-title', aiTitle: 'Write the other files', sessionId: liveChat}),
  JSON.stringify({
    type: 'user', turnOrigin: 'human', isSidechain: false, uuid: 'live-1', sessionId: liveChat,
    timestamp: at(1), cwd: live, gitBranch: 'main', message: {role: 'user', content: 'add a second file beside the first'},
  }),
];
const flushLive = () => fs.writeFileSync(path.join(liveDir, `${liveChat}.jsonl`), liveLines.join('\n') + '\n');
// What Claude Code writes the moment it makes a file. The timestamp is now,
// as a real one is: the snapshot the pane takes this poll is the first one
// after it, and that is the pair the turn's diff is measured between.
let wrote = 0;
const writeFile = (name: string, body: string) => {
  fs.writeFileSync(path.join(live, name), body);
  liveLines.push(JSON.stringify({
    type: 'assistant', sessionId: liveChat, timestamp: new Date().toISOString(), isSidechain: false,
    message: {
      role: 'assistant', id: `lm-${wrote++}`, model: 'claude-fable-5-1', usage,
      content: [{type: 'tool_use', id: `lt-${wrote}`, name: 'Write', input: {file_path: path.join(live, name), description: `Write ${name}`}}],
    },
  }));
  flushLive();
};

writeFile('one.ts', 'export const one = 1;\n');
// Snapshots only belong to a turn the pane was looking at the whole time, so
// the store starts with one taken before the turn began.
const liveStore = openStore(live)!;
await take(liveStore, live, Date.parse(at(2)));
fs.writeFileSync(path.join(liveStore.dir, 'watched.json'), JSON.stringify([[Date.parse(at(2)), Date.now()]]));

const f = pane(live);
await wait(4000);
f.mark();
const before = await f.show('changes: a turn running, with nothing written yet');
check(!before.includes('two.ts'), 'nothing has been written yet, so nothing on screen is about it');

writeFile('two.ts', 'export const two = 2;\nexport const alpha = 1;\n');
await wait(5000);
const opened = await f.show('changes: follow mode opened the file the turn had just written');
check(onRow(f.cursorRow(), 'two.ts'), `the cursor should land on the file the turn just wrote, and it is on "${f.cursorRow().trim()}"`);
check(opened.includes('export const two'), 'and its diff should be open under it');

// The page is yours the moment you reach for it.
await f.press(DOWN);
f.mark();
writeFile('three.ts', 'export const beta = 2;\n');
await wait(5000);
await f.show('changes: paused, so the next file is left where it was');
check(!onRow(f.cursorRow(), 'three.ts'), `a key press should pause it, and the cursor is on "${f.cursorRow().trim()}"`);

// Back at the head of the stream, where the footer has room to say which of
// the two it is. `g` is a key like any other, so it leaves follow paused.
await f.press('g');
await wait(300);
check(COLS < 56 || /f follow(?!ing)/.test(f.foot()), `paused, the footer should offer to follow again, and it reads "${f.foot().trim()}"`);
await f.press('f');
await wait(300);
check(COLS < 56 || f.foot().includes('f following'), `and f should light it, and it reads "${f.foot().trim()}"`);
writeFile('four.ts', 'export const gamma = 3;\n');
await wait(5000);
const again = await f.show('changes: f handed it back, and the next file opened again');
check(onRow(f.cursorRow(), 'four.ts'), `f should hand it back, and the cursor is on "${f.cursorRow().trim()}"`);
check(again.includes('export const gamma'), 'and the newest file should be the one with its diff open');
// One followed diff at a time: a ten file turn must not end with ten of them.
check(!again.includes('export const alpha'), 'the diff follow opened before it should have closed as this one opened');
await f.quit();

// ---- what must be true of every frame -----------------------------------
const labelled = seen.filter(shot => shot.split('\n').some(row => /\bA[1-9]\b(?=\s\w)/.test(row)));
check(labelled.length === 0, `no frame should label an agent A1, A2 …, and ${labelled.length} do`);
// A worktree shows in three places at most, and the pane's own folder is not
// one of them: no chip on your own turns, no word for who was at the keyboard,
// and no caption under a folder heading.
const anyOf = (what: string) => seen.filter(shot => shot.includes(what)).length;
check(anyOf('▐demo▌') === 0, `no frame should chip this folder's own turns, and ${anyOf('▐demo▌')} do`);
check(seen.every(shot => !/\byou {2}·/.test(shot)), 'and no row should say who was at the keyboard');
check(anyOf('the squares say') === 0, 'and the squares should carry no caption');
// The scope has a key, a menu item and a pill of its own; the footer's columns
// belong to the row under the cursor.
const lastRow = (shot: string) => [...shot.split('\n')].reverse().find(row => row.trim()) ?? '';
const scoped = seen.filter(shot => lastRow(shot).includes('w worktree')).length;
check(scoped === 0, `no footer should spend a hint on the scope key, and ${scoped} frames do`);
const overflowed = seen.filter(shot => shot.split('\n').some(row => [...row].length > COLS));
check(overflowed.length === 0, `no row should be wider than the pane, and ${overflowed.length} frames have one`);

// Several bare repositories were written under here and Windows can still be
// holding one open a moment after the pane that used it has gone.
try {
  fs.rmSync(stage, {recursive: true, force: true, maxRetries: 10, retryDelay: 300});
} catch {
  // A folder left in the temp directory is not a failed check.
}

if (failed) {
  console.error(`\n${failed} check${failed === 1 ? '' : 's'} failed at ${COLS}x${ROWS}.`);
  process.exit(1);
}

console.log(`\nAll checks passed at ${COLS}x${ROWS}.`);
