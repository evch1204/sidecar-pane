// Drives the app with fake key presses and fake mouse reports, then prints a
// few frames. Run with: npx tsx scripts/smoke.tsx
// Colours are stripped, so what you see is the layout, not the palette.
import {PassThrough} from 'node:stream';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {render} from 'ink';
import {App} from '../src/ui/App';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ? path.resolve(process.argv[2]) : repo;
const DOWN = '\u001B[B';
const ESC = '\u001B';
const ENTER = '\r';

// A left click at a column and row, as the terminal would report it.
const click = (col: number, row: number) => `\u001B[<0;${col + 1};${row + 1}M`;
const wheelDown = (col: number, row: number) => `\u001B[<65;${col + 1};${row + 1}M`;

// Ink only needs a stream that says it is a terminal and accepts raw mode.
const stdin = Object.assign(new PassThrough(), {
  isTTY: true,
  setRawMode: () => stdin,
  ref: () => stdin,
  unref: () => stdin,
});

const frames: string[] = [];
const stdout = Object.assign(new PassThrough(), {columns: 72, rows: 40, isTTY: true});
stdout.on('data', chunk => frames.push(String(chunk)));

const app = render(<App root={target} interactive />, {
  stdin: stdin as unknown as NodeJS.ReadStream,
  stdout: stdout as unknown as NodeJS.WriteStream,
  debug: true,
  exitOnCtrlC: false,
});

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const press = async (...keys: string[]) => {
  for (const key of keys) {
    stdin.write(key);
    await wait(60);
  }
};

const show = async (label: string) => {
  await wait(400);
  console.log(`\n=== ${label}\n${frames.at(-1)}`);
};

await wait(1800); // first git, transcript and snapshot read
await show('changes: the stream, newest turn open');

await press(DOWN, DOWN, ENTER);
await show('changes: a row of the open turn, entered');

await press('m');
await show('the View menu, open over a dimmed pane');

await press(ESC, 'v');
await show('changes: grouped by file');

await press('v');
await wait(600);
await press(ENTER);
await wait(600);
await show('changes: everything since the last commit, first file opened in place');

await press('n', ENTER);
await show('changes: jumped to a hunk and folded it');

await press(wheelDown(20, 14), wheelDown(20, 14));
await show('changes: wheel scrolled the stream, cursor left alone');

await press(click(16, 2));
await wait(300);
await press(DOWN, DOWN, ENTER, DOWN, DOWN, ENTER, DOWN, DOWN, ENTER);
await wait(500);
await show('files: a folder opened, then a file peeked in place');

await press(ENTER);
await wait(400);
await show('files: the reader, full height');

await press(ESC, '3');
await show('agents: every subagent, under the prompt that started it');

await press(DOWN, ENTER);
await show('agents: one agent opened');

await press('4');
await wait(1200);
await show('usage');

stdin.write('q');
await app.waitUntilExit();
