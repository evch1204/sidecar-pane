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

export type FileStat = {
  rel: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  added: number;
  removed: number;
};

const LETTER = {A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'added', T: 'modified'} as const;

// `git diff --name-status -z` and `git diff --numstat -z` read together. One
// parser for both the shadow snapshots and the project's own commits, because
// the output is the same shape either way. With `-z` nothing is quoted, so a
// path with a space in it survives; a rename is three tokens (the code, the old
// path, the new path); and a binary file's counts are dashes, which count as
// nothing rather than as unknown.
export function parseStats(names: string, counts: string): FileStat[] {
  const status = new Map<string, FileStat['status']>();
  const parts = names.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i];
    if (!code || !/^[A-Z]/.test(code)) continue;
    const kind = LETTER[code[0] as keyof typeof LETTER] ?? 'modified';
    if (code[0] === 'R' || code[0] === 'C') {
      status.set(parts[i + 2] ?? '', kind);
      i += 2;
    } else {
      status.set(parts[i + 1] ?? '', kind);
      i += 1;
    }
  }

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

// Git's own name for "nothing was here yet": the only honest base for a
// repository's first commit.
export const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export type Commit = {sha: string; at: number; parent: string};

const commits = new Map<string, Commit[]>();
const KEEP_LOGS = 8;

// Commits on HEAD's first-parent history, oldest first, none older than
// `since`. A merge counts as one commit, which is what the branch it landed
// looks like from here.
//
// `loadTurns` asks for this on every poll, so the answer is cached by the HEAD
// sha: a poll that finds the same HEAD costs one `rev-parse` and nothing else.
// Each commit carries its own first parent, so working out the base of a window
// costs no extra call. Null outside a git repo, or in one with no commits yet.
export async function commitsSince(root: string, since: number): Promise<Commit[] | null> {
  const head = (await git(root, ['rev-parse', 'HEAD']))?.trim();
  if (!head) return null;

  const key = `${pathKey(root)}\0${head}\0${since}`;
  const hit = commits.get(key);
  if (hit) return hit;

  const out = await git(root, ['log', '--first-parent', '--format=%H %ct %P', `--since=${new Date(since).toISOString()}`, head]);
  if (out === null) return null;

  const list: Commit[] = [];
  for (const line of out.split('\n')) {
    const match = /^([0-9a-f]{7,64}) (\d+)(?: (.*))?$/.exec(line.trim());
    if (!match) continue;
    list.push({sha: match[1]!, at: Number(match[2]) * 1000, parent: (match[3] ?? '').split(' ')[0] ?? ''});
  }

  list.reverse();
  if (commits.size >= KEEP_LOGS) commits.clear();
  commits.set(key, list);
  return list;
}

// Which files two commits differ in, and by how much. `--relative` keeps the
// paths relative to `root` the way the snapshots' are, and drops anything
// above it.
export async function statBetweenCommits(root: string, base: string, tip: string): Promise<FileStat[]> {
  const names = (await git(root, ['diff', '--name-status', '-z', '--relative', '--find-renames', base, tip])) ?? '';
  const counts = (await git(root, ['diff', '--numstat', '-z', '--relative', '--find-renames', base, tip])) ?? '';
  return parseStats(names, counts);
}

// The patch for one file between two commits, in the form the snapshot store
// gives, so the same parser draws it.
export async function patchBetweenCommits(root: string, base: string, tip: string, rel: string): Promise<string | null> {
  return git(root, [
    '-c', 'core.quotepath=false',
    'diff', '--no-color', '--no-ext-diff', '--relative', '--find-renames', '-U3', base, tip, '--', rel,
  ]);
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
