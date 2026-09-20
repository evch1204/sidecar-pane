import {execFile, execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// What a turn changed cannot be read out of the transcript: Claude edits
// through shell commands as often as through its file tools, and a command
// can change a file without naming it. The only honest answer is to look at
// the project before and after.
//
// So sidecar keeps its own bare git repo, outside the project, and writes a
// tree of the working folder every time the session moves. The project's own
// .git is never touched, and folders that are not git repos work too.

export type Shot = {at: number; tree: string};

export type Store = {
  dir: string;
  gitDir: string;
  shots: Shot[];
};

const KEEP = 400;

function storeDir(root: string): string {
  const slug = path.resolve(root).replace(/[\\/:.]/g, '-');
  return path.join(process.env.SIDECAR_HOME || path.join(os.homedir(), '.sidecar'), slug);
}

export function openStore(root: string): Store | null {
  const dir = storeDir(root);
  const gitDir = path.join(dir, 'shadow.git');
  try {
    if (!fs.existsSync(gitDir)) {
      fs.mkdirSync(dir, {recursive: true});
      execFileSync('git', ['--git-dir', gitDir, 'init', '--bare', '-q'], {windowsHide: true});
      // The project's own history is not ours to copy, and nothing good comes
      // of snapshotting a dependency folder.
      fs.writeFileSync(path.join(gitDir, 'info', 'exclude'), '/.git/\nnode_modules/\n');
    }
  } catch {
    return null;
  }

  let shots: Shot[] = [];
  try {
    shots = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8')) as Shot[];
  } catch {
    shots = [];
  }

  return {dir, gitDir, shots};
}

function git(store: Store, root: string, args: string[]): Promise<string | null> {
  return new Promise(resolve => {
    execFile(
      'git',
      ['--git-dir', store.gitDir, '--work-tree', root, ...args],
      {maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: 20_000},
      (error, stdout) => resolve(error ? null : stdout),
    );
  });
}

// Write down what the project looks like right now. Returns the tree, or null
// if nothing changed since the last one, so the timeline stays short.
export async function take(store: Store, root: string, at: number): Promise<string | null> {
  if ((await git(store, root, ['add', '-A'])) === null) return null;
  const tree = (await git(store, root, ['write-tree']))?.trim();
  if (!tree) return null;

  const last = store.shots[store.shots.length - 1];
  if (last?.tree === tree) return null;

  store.shots.push({at, tree});
  if (store.shots.length > KEEP) store.shots.splice(0, store.shots.length - KEEP);
  try {
    fs.writeFileSync(path.join(store.dir, 'timeline.json'), JSON.stringify(store.shots));
  } catch {
    // A timeline we cannot save still works for this run.
  }

  return tree;
}

// The last snapshot taken at or before `at`, and the first one at or after it.
export function before(store: Store, at: number): Shot | null {
  let found: Shot | null = null;
  for (const shot of store.shots) {
    if (shot.at <= at) found = shot;
    else break;
  }

  return found;
}

export function after(store: Store, at: number): Shot | null {
  for (const shot of store.shots) if (shot.at >= at) return shot;
  return null;
}

// The patch between two snapshots, in the same form `git diff` gives.
export async function patchBetween(store: Store, root: string, from: string, to: string): Promise<string | null> {
  return git(store, root, ['diff', '--no-color', '--no-ext-diff', '--find-renames', '-U3', from, to]);
}

export type FileStat = {
  rel: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  added: number;
  removed: number;
};

const LETTER = {A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'added', T: 'modified'} as const;

// Which files differ between two snapshots, and by how much. Counting is a
// separate, much cheaper call than the patch itself, so the list of turns can
// show numbers without reading a single line of any diff.
export async function statBetween(
  store: Store,
  root: string,
  from: string,
  to: string,
): Promise<FileStat[]> {
  const names = (await git(store, root, ['diff', '--name-status', '-z', '--find-renames', from, to])) ?? '';
  const status = new Map<string, FileStat['status']>();
  const parts = names.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i];
    if (!code || !/^[A-Z]/.test(code)) continue;
    const kind = LETTER[code[0] as keyof typeof LETTER] ?? 'modified';
    // A rename is followed by the old path and then the new one.
    if (code[0] === 'R' || code[0] === 'C') {
      status.set(parts[i + 2] ?? '', kind);
      i += 2;
    } else {
      status.set(parts[i + 1] ?? '', kind);
      i += 1;
    }
  }

  const counts = (await git(store, root, ['diff', '--numstat', '-z', '--find-renames', from, to])) ?? '';
  const out: FileStat[] = [];
  const tokens = counts.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(tokens[i] ?? '');
    if (!match) continue;
    let rel = match[3]!;
    if (rel === '') {
      rel = tokens[i + 2] ?? '';
      i += 2;
    }

    out.push({
      rel,
      status: status.get(rel) ?? 'modified',
      added: match[1] === '-' ? 0 : Number(match[1]),
      removed: match[2] === '-' ? 0 : Number(match[2]),
    });
  }

  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

// The patch for one file between two snapshots.
export async function patchFile(
  store: Store,
  root: string,
  from: string,
  to: string,
  rel: string,
): Promise<string | null> {
  return git(store, root, ['diff', '--no-color', '--no-ext-diff', '--find-renames', '-U3', from, to, '--', rel]);
}
