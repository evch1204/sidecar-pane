// Drives the app with fake key presses and prints the last frame.
// Run with: npx tsx scripts/smoke.tsx
import {PassThrough} from 'node:stream';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {render} from 'ink';
import {App} from '../src/ui/App';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOWN = '\u001B[B';
const RIGHT = '\u001B[C';

// Ink only needs a stream that says it is a terminal and accepts raw mode.
const stdin = Object.assign(new PassThrough(), {
  isTTY: true,
  setRawMode: () => stdin,
  ref: () => stdin,
  unref: () => stdin,
});

const frames: string[] = [];
const stdout = Object.assign(new PassThrough(), {columns: 72, rows: 24, isTTY: true});
stdout.on('data', chunk => frames.push(String(chunk)));

const app = render(<App root={repo} interactive />, {
  stdin: stdin as unknown as NodeJS.ReadStream,
  stdout: stdout as unknown as NodeJS.WriteStream,
  debug: true,
  exitOnCtrlC: false,
});

// open "src", step down to cli.tsx, then move into the preview and scroll twice
const keys = [DOWN, RIGHT, DOWN, DOWN, DOWN, RIGHT, DOWN, DOWN];
for (const key of keys) {
  stdin.write(key);
  await new Promise(resolve => setTimeout(resolve, 40));
}

console.log(frames.at(-1));
stdin.write('q');
await app.waitUntilExit();
