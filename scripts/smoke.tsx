// Drives the app with fake key presses and prints a few frames.
// Run with: npx tsx scripts/smoke.tsx
import {PassThrough} from 'node:stream';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {render} from 'ink';
import {App} from '../src/ui/App';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOWN = '\u001B[B';
const RIGHT = '\u001B[C';
const ESC = '\u001B';

// Ink only needs a stream that says it is a terminal and accepts raw mode.
const stdin = Object.assign(new PassThrough(), {
  isTTY: true,
  setRawMode: () => stdin,
  ref: () => stdin,
  unref: () => stdin,
});

const frames: string[] = [];
const stdout = Object.assign(new PassThrough(), {columns: 64, rows: 26, isTTY: true});
stdout.on('data', chunk => frames.push(String(chunk)));

const app = render(<App root={repo} interactive />, {
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
  await wait(250);
  console.log(`\n=== ${label}\n${frames.at(-1)}`);
};

await wait(900); // first git read

await press(DOWN, RIGHT, DOWN, RIGHT, DOWN, DOWN);
await show('browsing: src/core opened, cursor on a file');

await press(RIGHT, DOWN, DOWN, DOWN);
await show('reading: preview focused, list shrunk, scrolled 3 lines');

await press(ESC, 'c');
await show('changed files only');

stdin.write('q');
await app.waitUntilExit();
