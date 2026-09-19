#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {render} from 'ink';
import {App} from './ui/App';

const args = process.argv.slice(2);
const snapshot = args.includes('--snapshot');
const root = path.resolve(args.find(arg => !arg.startsWith('--')) ?? '.');

if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  console.error(`sidecar: "${root}" is not a folder.`);
  process.exit(1);
}

const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !snapshot;

// The alternate screen gives the pane the whole window and restores
// whatever was there before when it closes.
const enterScreen = '\u001B[?1049h\u001B[H';
const leaveScreen = '\u001B[?1049l';

if (interactive) {
  process.stdout.write(enterScreen);
  process.on('exit', () => process.stdout.write(leaveScreen));
}

const app = render(<App root={root} interactive={interactive} />);
await app.waitUntilExit();
