#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {render} from 'ink';
import {App} from './ui/App';
import {MOUSE_OFF, MOUSE_ON} from './ui/mouse';

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
  process.stdout.write(enterScreen + MOUSE_ON);
  // Mouse reporting outlives the process if it is not turned off, which would
  // leave the user's shell printing escape codes at every click. Every way out
  // goes through here.
  const restore = () => process.stdout.write(MOUSE_OFF + leaveScreen);
  process.on('exit', restore);
  process.on('uncaughtException', error => {
    restore();
    console.error(error);
    process.exit(1);
  });
}

// The opening plays while the first read runs. A flag turns it off for one
// run, and the environment turns it off for good, for anyone who has seen it.
// This is the one place the variable is read: App trusts what it is handed.
// `0`, `false` or an empty value leave it on, as anyone setting one would mean.
const noOpening = (process.env.SIDECAR_NO_OPENING ?? '').trim().toLowerCase();
const opening = !args.includes('--no-opening') && noOpening !== '1' && noOpening !== 'true';

const app = render(
  <App root={root} interactive={interactive} mouseDebug={args.includes('--mouse-debug')} opening={opening} />,
);
await app.waitUntilExit();
