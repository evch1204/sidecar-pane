import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type Change = {
  status: 'A' | 'M' | 'D';
  added: number | null;
  removed: number | null;
};

export type GitState = {
  branch: string;
  // keyed by pathKey(absolute path)
  changes: ReadonlyMap<string, Change>;
};

// Windows paths differ in slash direction and drive-letter case depending on
// who produced them, so every lookup goes through one normal form.
export function pathKey(p: string): string {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function git(cwd: string, args: string[]): Promise<string | null> {
  return new Promise(resolve => {
    execFile(
      'git',
      ['-C', cwd, ...args],
      {maxBuffer: 32 * 1024 * 1024, windowsHide: true, timeout: 10_000},
      (error, stdout) => resolve(error ? null : stdout),
    );
  });
}

const MAX_COUNTED_UNTRACKED = 200;

function countLines(filePath: string): number | null {
  try {
    if (fs.statSync(filePath).size > 300_000) return null;
    const text = fs.readFileSync(filePath, 'utf8');
    if (text === '') return 0;
    return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  } catch {
    return null;
  }
}

// Uncommitted changes compared with the last commit. Returns null outside a git repo.
export async function loadGit(root: string): Promise<GitState | null> {
  const top = (await git(root, ['rev-parse', '--show-toplevel']))?.trim();
  if (!top) return null;

  const branch =
    (await git(root, ['symbolic-ref', '--short', 'HEAD']))?.trim() ||
    (await git(root, ['rev-parse', '--short', 'HEAD']))?.trim() ||
    '';

  const changes = new Map<string, Change>();

  // Porcelain paths are relative to the top of the repo, not to `root`.
  const status = (await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])) ?? '';
  const entries = status.split('\0');
  const untracked: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const file = path.resolve(top, entry.slice(3));
    // A rename or copy is followed by its original path; skip that.
    if (xy[0] === 'R' || xy[0] === 'C') i++;
    const state = xy === '??' || xy.includes('A') ? 'A' : xy.includes('D') ? 'D' : 'M';
    changes.set(pathKey(file), {status: state, added: null, removed: null});
    if (xy === '??') untracked.push(file);
  }

  // Line counts. With -z a rename is written as "a\tr\t", old path, new path.
  const numstat = (await git(root, ['diff', 'HEAD', '--numstat', '-z'])) ?? '';
  const tokens = numstat.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(tokens[i]!);
    if (!match) continue;
    let file = match[3]!;
    if (file === '') {
      file = tokens[i + 2] ?? '';
      i += 2;
    }

    const change = changes.get(pathKey(path.resolve(top, file)));
    if (!change) continue;
    change.added = match[1] === '-' ? null : Number(match[1]);
    change.removed = match[2] === '-' ? null : Number(match[2]);
  }

  // Untracked files are not in the diff, so every line counts as added.
  for (const file of untracked.slice(0, MAX_COUNTED_UNTRACKED)) {
    const change = changes.get(pathKey(file))!;
    change.added = countLines(file);
    change.removed = change.added === null ? null : 0;
  }

  return {branch, changes};
}

// Line numbers (in the file as it is now) that differ from the last commit.
export async function changedLines(root: string, filePath: string, change: Change): Promise<ReadonlySet<number> | 'all'> {
  const out = (await git(root, ['diff', 'HEAD', '-U0', '--', filePath])) ?? '';
  const lines = new Set<number>();
  for (const match of out.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(match[1]);
    const length = match[2] === undefined ? 1 : Number(match[2]);
    for (let n = start; n < start + length; n++) lines.add(n);
  }

  // An untracked file has no diff at all: the whole file is new.
  if (lines.size === 0 && change.status === 'A') return 'all';
  return lines;
}
