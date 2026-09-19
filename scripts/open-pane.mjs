// Opens sidecar in a split to the right of the current Windows Terminal pane.
// Usage: npm run pane -- "C:\path\to\project"   (defaults to the current folder)
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.resolve(process.argv[2] ?? process.cwd());

if (!process.env.WT_SESSION) {
  console.log('This is not Windows Terminal, so there is no split to open.');
  console.log(`Open a second terminal and run:\n  cd "${repo}"\n  npm start -- "${target}"`);
  process.exit(1);
}

// -w 0 means "this window". Arguments go as a list, so paths with spaces stay intact.
const wtArgs = ['-w', '0', 'split-pane', '-V', '--size', '0.45', '-d', repo];
// /c closes the split when Sidecar quits. If it fails to start, `pause` keeps
// the error on screen instead of closing the split at once.
const paneCommand = ['cmd', '/c', 'npx', 'tsx', 'src/cli.tsx', target, '||', 'pause'];

spawn('wt.exe', [...wtArgs, ...paneCommand], {detached: true, stdio: 'ignore'}).unref();
