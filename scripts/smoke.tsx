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
const RIGHT = '\u001B[C';
const ESC = '\u001B';

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
const stdout = Object.assign(new PassThrough(), {columns: 72, rows: 30, isTTY: true});
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
    await wait(40);
  }
};

const show = async (label: string) => {
  await wait(300);
  console.log(`\n=== ${label}\n${frames.at(-1)}`);
};

await wait(900); // first git read

await press(DOWN, RIGHT, DOWN, RIGHT, DOWN, DOWN);
await show('files: src/core opened, cursor on a file');

await press(RIGHT, DOWN, DOWN, DOWN);
await show('files: preview focused, tree shrunk, scrolled 3 lines');

await press(ESC, '2');
await wait(700); // first diff read
await show('changes: file list and the first diff');

await press('n');
await show('changes: cursor jumped to the next hunk, diff focused');

await press('\r');
await show('changes: that hunk folded');

// Row 2 is the top of the file list, so this clicks the third changed file.
await press(click(4, 4));
await show('changes: third file opened by clicking its row');

await press(DOWN, DOWN, DOWN, '\r');
await show('changes: a gap expanded in place');

await press(wheelDown(20, 14), wheelDown(20, 14));
await show('changes: wheel over the diff scrolled it, cursor left alone');

await press('w');
await show('changes: whitespace-only changes hidden');

await press(click(11, 0));
await show('files: switched back by clicking the Files tab');

stdin.write('q');
await app.waitUntilExit();
