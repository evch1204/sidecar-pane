import {execFile} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {pathKey} from './git';
import {highlightLines, type Segment} from './highlight';
import {wordDiff, type Span} from './words';

export type LineKind = 'add' | 'del' | 'context';

export type DiffLine = {
  kind: LineKind;
  oldNo: number | null;
  newNo: number | null;
  text: string;
  // Character ranges that differ from the line this one replaced.
  words?: Span[];
  // Syntax colours, when the file type is one the highlighter knows.
  segments?: Segment[];
  // The change is only spaces or tabs.
  spaceOnly?: boolean;
  noNewline?: boolean;
};

export type Hunk = {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  // The text git puts after the second @@: usually the enclosing function.
  context: string;
  lines: DiffLine[];
};

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export type FileDiff = {
  path: string;
  rel: string;
  // Where it moved from, when it was renamed.
  fromRel: string | null;
  status: FileStatus;
  added: number;
  removed: number;
  binary: boolean;
  // Every changed line differs only in whitespace.
  spaceOnly: boolean;
  hunks: Hunk[];
  // The file was too big to show in full.
  truncated: boolean;
};

const MAX_LINES_PER_FILE = 6000;
const MAX_UNTRACKED_BYTES = 300_000;

function git(cwd: string, args: string[]): Promise<string | null> {
  return new Promise(resolve => {
    execFile(
      'git',
      ['-C', cwd, '-c', 'core.quotepath=false', ...args],
      {maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: 15_000},
      (error, stdout) => resolve(error ? null : stdout),
    );
  });
}

function countBlank(text: string): boolean {
  return text.trim() === '';
}

// Pair each removed line with the added line that replaced it, then mark the
// words that differ. Pairs only line up when the two runs are the same length,
// or when a single line replaced a single line; anything else is a rewrite and
// word marks would be noise.
const PAIR_THRESHOLD = 0.3;

function markWords(lines: DiffLine[]): void {
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind !== 'del') {
      i++;
      continue;
    }

    let d = i;
    while (d < lines.length && lines[d]!.kind === 'del') d++;
    let a = d;
    while (a < lines.length && lines[a]!.kind === 'add') a++;

    const dels = lines.slice(i, d);
    const adds = lines.slice(d, a);
    if (dels.length > 0 && dels.length === adds.length) {
      for (let n = 0; n < dels.length; n++) {
        const before = dels[n]!;
        const after = adds[n]!;
        const diff = wordDiff(before.text, after.text);
        if (diff.similarity >= PAIR_THRESHOLD) {
          before.words = diff.removed;
          after.words = diff.added;
        }

        if (before.text.trim() === after.text.trim() && before.text !== after.text) {
          before.spaceOnly = true;
          after.spaceOnly = true;
        }
      }
    }

    i = Math.max(a, i + 1);
  }
}

function parsePatch(root: string, top: string, patch: string): FileDiff[] {
  const out: FileDiff[] = [];
  const lines = patch.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  let file: FileDiff | null = null;
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  const close = () => {
    if (!file) return;
    if (hunk) file.hunks.push(hunk);
    hunk = null;
    markWords(file.hunks.flatMap(h => h.lines));
    const changed = file.hunks.flatMap(h => h.lines).filter(l => l.kind !== 'context');
    file.added = changed.filter(l => l.kind === 'add').length;
    file.removed = changed.filter(l => l.kind === 'del').length;
    file.spaceOnly = changed.length > 0 && changed.every(l => l.spaceOnly || countBlank(l.text));
    out.push(file);
    file = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.startsWith('diff --git ')) {
      close();
      // "diff --git a/x b/x" — the real paths come from the ---/+++ lines
      // below, which survive names containing " b/".
      // "diff --git a/x b/x": both halves name the same file unless it was
      // renamed, and a rename spells it out on its own lines below.
      const half = line.slice('diff --git '.length);
      const guess = half.slice(2, 2 + (half.length - 5) / 2);
      file = {
        path: path.resolve(top, guess),
        rel: guess,
        fromRel: null,
        status: 'modified',
        added: 0,
        removed: 0,
        binary: false,
        spaceOnly: false,
        hunks: [],
        truncated: false,
      };
      continue;
    }

    if (!file) continue;

    if (line.startsWith('new file mode')) file.status = 'added';
    else if (line.startsWith('deleted file mode')) file.status = 'deleted';
    else if (line.startsWith('rename from ')) {
      file.status = 'renamed';
      file.fromRel = line.slice('rename from '.length);
    } else if (line.startsWith('rename to ')) {
      file.rel = line.slice('rename to '.length);
      file.path = path.resolve(top, file.rel);
    } else if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) {
      file.binary = true;
    } else if (line.startsWith('--- ') && !hunk) {
      const old = line.slice(4);
      if (old !== '/dev/null') {
        const rel = old.replace(/^a\//, '');
        if (!file.fromRel) file.fromRel = rel;
        // A deleted file has no new path, so the old one is the only name it has.
        if (file.status === 'deleted') {
          file.rel = rel;
          file.path = path.resolve(top, rel);
        }
      }
    } else if (line.startsWith('+++ ') && !hunk) {
      const now = line.slice(4);
      if (now !== '/dev/null') {
        file.rel = now.replace(/^b\//, '');
        file.path = path.resolve(top, file.rel);
      }
    } else if (line.startsWith('@@')) {
      if (hunk) file.hunks.push(hunk);
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(line);
      if (!match) continue;
      oldNo = Number(match[1]);
      newNo = Number(match[3]);
      hunk = {
        oldStart: oldNo,
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: newNo,
        newCount: match[4] === undefined ? 1 : Number(match[4]),
        context: match[5] ?? '',
        lines: [],
      };
    } else if (hunk) {
      const sign = line[0];
      const text = line.slice(1).replace(/\t/g, '  ');
      if (sign === '\\') {
        const last = hunk.lines[hunk.lines.length - 1];
        if (last) last.noNewline = true;
      } else if (sign === '+') {
        hunk.lines.push({kind: 'add', oldNo: null, newNo: newNo++, text});
      } else if (sign === '-') {
        hunk.lines.push({kind: 'del', oldNo: oldNo++, newNo: null, text});
      } else if (sign === ' ' || line === '') {
        hunk.lines.push({kind: 'context', oldNo: oldNo++, newNo: newNo++, text});
      }

      if (hunk.lines.length > MAX_LINES_PER_FILE) {
        file.truncated = true;
        file.hunks.push(hunk);
        hunk = null;
        // Skip to the next file.
        while (i + 1 < lines.length && !lines[i + 1]!.startsWith('diff --git ')) i++;
      }
    }
  }

  close();
  return out;
}

// A file git has never seen: every line of it is new.
function untrackedDiff(top: string, rel: string): FileDiff {
  const abs = path.resolve(top, rel);
  const file: FileDiff = {
    path: abs,
    rel,
    fromRel: null,
    status: 'added',
    added: 0,
    removed: 0,
    binary: false,
    spaceOnly: false,
    hunks: [],
    truncated: false,
  };

  let text: string;
  try {
    if (fs.statSync(abs).size > MAX_UNTRACKED_BYTES) {
      file.truncated = true;
      return file;
    }

    const buffer = fs.readFileSync(abs);
    if (buffer.subarray(0, 8000).includes(0)) {
      file.binary = true;
      return file;
    }

    text = buffer.toString('utf8');
  } catch {
    return file;
  }

  const rows = text.replace(/\r\n/g, '\n').replace(/\t/g, '  ').split('\n');
  if (rows.length > 1 && rows[rows.length - 1] === '') rows.pop();
  const kept = rows.slice(0, MAX_LINES_PER_FILE);
  file.truncated = kept.length < rows.length;
  file.added = kept.length;
  file.hunks = [
    {
      oldStart: 0,
      oldCount: 0,
      newStart: 1,
      newCount: kept.length,
      context: '',
      lines: kept.map((line, i) => ({kind: 'add' as const, oldNo: null, newNo: i + 1, text: line})),
    },
  ];

  return file;
}

const GAP_MERGE = 4;

// A gap of a line or two takes up as much room as the lines it hides, so those
// are filled in from the file and the two hunks become one.
function fillSmallGaps(file: FileDiff): void {
  if (file.binary || file.hunks.length < 1) return;

  let rows: string[] | null = null;
  const read = (): string[] => {
    if (rows) return rows;
    try {
      rows = fs.readFileSync(file.path, 'utf8').replace(/\r\n/g, '\n').replace(/\t/g, '  ').split('\n');
    } catch {
      rows = [];
    }

    return rows;
  };

  const context = (hunk: Hunk, from: number, to: number): DiffLine[] => {
    const shift = hunk.oldStart - hunk.newStart;
    const out: DiffLine[] = [];
    for (let n = from; n <= to; n++) {
      const line = read()[n - 1];
      if (line === undefined) break;
      out.push({kind: 'context', oldNo: n + shift, newNo: n, text: line});
    }

    return out;
  };

  const out: Hunk[] = [];
  for (const hunk of file.hunks) {
    const previous = out[out.length - 1];
    const from = previous ? previous.newStart + previous.newCount : 1;
    const gap = hunk.newStart - from;

    if (gap > 0 && gap <= GAP_MERGE) {
      const filler = context(hunk, from, hunk.newStart - 1);
      if (filler.length === gap) {
        if (previous) {
          previous.lines.push(...filler, ...hunk.lines);
          previous.newCount = hunk.newStart + hunk.newCount - previous.newStart;
          previous.oldCount = hunk.oldStart + hunk.oldCount - previous.oldStart;
          continue;
        }

        hunk.lines.unshift(...filler);
        hunk.oldCount += gap;
        hunk.newCount += gap;
        hunk.oldStart -= gap;
        hunk.newStart -= gap;
      }
    }

    out.push(hunk);
  }

  file.hunks = out;
}

// Colour the diff the way the file itself would be coloured. Each side is
// highlighted as one block so that a string or comment spanning several lines
// still comes out right; context lines take their colours from the new side.
function colour(file: FileDiff): void {
  const lines = file.hunks.flatMap(h => h.lines);
  if (lines.length === 0) return;

  for (const side of ['add', 'del'] as const) {
    const mine = lines.filter(l => l.kind === 'context' || l.kind === side);
    const marked = highlightLines(file.path, mine.map(l => l.text));
    if (!marked) return;
    mine.forEach((line, i) => {
      if (side === 'del' && line.kind === 'context') return;
      line.segments = marked[i];
    });
  }
}

// Turn a unified patch into files ready to draw, whoever produced it.
export function buildDiff(root: string, top: string, patch: string): FileDiff[] {
  const files = parsePatch(root, top, patch);
  const rootKey = pathKey(root);
  const mine = files.filter(f => pathKey(f.path).startsWith(rootKey));
  for (const file of mine) {
    fillSmallGaps(file);
    colour(file);
  }

  mine.sort((a, b) => a.rel.localeCompare(b.rel));
  return mine;
}

export function indexOf(files: FileDiff[]): ReadonlyMap<string, number> {
  const index = new Map<string, number>();
  files.forEach((f, i) => index.set(pathKey(f.path), i));
  return index;
}

export type DiffState = {
  files: FileDiff[];
  // Absolute path key -> index in `files`.
  index: ReadonlyMap<string, number>;
};

// Everything that differs from the last commit, including untracked files.
// Returns null outside a git repo.
export async function loadDiff(root: string): Promise<DiffState | null> {
  const top = (await git(root, ['rev-parse', '--show-toplevel']))?.trim();
  if (!top) return null;

  const patch =
    (await git(root, [
      'diff',
      'HEAD',
      '--no-color',
      '--no-ext-diff',
      '--find-renames',
      '-U3',
    ])) ?? '';

  const files = parsePatch(root, top, patch);

  const status = (await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])) ?? '';
  for (const entry of status.split('\0')) {
    if (entry.slice(0, 2) !== '??') continue;
    files.push(untrackedDiff(top, entry.slice(3)));
  }

  // Inside a sub-folder, only show what is under it.
  const rootKey = pathKey(root);
  const mine = files.filter(f => pathKey(f.path).startsWith(rootKey));
  for (const file of mine) {
    fillSmallGaps(file);
    colour(file);
  }
  mine.sort((a, b) => a.rel.localeCompare(b.rel));

  const index = new Map<string, number>();
  mine.forEach((f, i) => index.set(pathKey(f.path), i));
  return {files: mine, index};
}

// The unchanged lines sitting above a hunk, read from the file as it is now.
// Opening a gap costs one file read and no call to git.
export function expandGap(file: FileDiff, hunkIndex: number): DiffLine[] {
  const hunk = file.hunks[hunkIndex];
  if (!hunk) return [];
  const previous = file.hunks[hunkIndex - 1];
  const from = previous ? previous.newStart + previous.newCount : 1;
  const to = hunk.newStart - 1;
  if (to < from) return [];

  let text: string;
  try {
    text = fs.readFileSync(file.path, 'utf8');
  } catch {
    return [];
  }

  const rows = text.replace(/\r\n/g, '\n').replace(/\t/g, '  ').split('\n');
  // Inside a gap nothing was added or removed, so the two numberings move together.
  const shift = hunk.oldStart - hunk.newStart;
  const out: DiffLine[] = [];
  for (let n = from; n <= to; n++) {
    const line = rows[n - 1];
    if (line === undefined) break;
    out.push({kind: 'context', oldNo: n + shift, newNo: n, text: line});
  }

  const marked = highlightLines(file.path, out.map(l => l.text));
  if (marked) out.forEach((line, i) => (line.segments = marked[i]));
  return out;
}

// How many unchanged lines sit above a hunk.
export function gapSize(file: FileDiff, hunkIndex: number): number {
  const hunk = file.hunks[hunkIndex];
  if (!hunk) return 0;
  const previous = file.hunks[hunkIndex - 1];
  const from = previous ? previous.newStart + previous.newCount : 1;
  return Math.max(0, hunk.newStart - from);
}

const MODIFIER = /^(export|default|async|public|private|protected|static|final|pub|declare)\s+/;
const STATEMENT = /^(import|from|return|if|else|for|while|switch|case|try|catch|throw|await|yield|const|let|var|\}|\)|<|\/\/)/;

// git puts the enclosing function after the second @@. Turn it into something
// worth reading: "export async function loadGit(root: string)" -> "loadGit()".
export function hunkLabel(context: string): string {
  let text = context.trim();
  while (MODIFIER.test(text)) text = text.replace(MODIFIER, '');
  text = text.replace(/^(function|def|fn|func|sub|method)\s+/, '').replace(/^(const|let|var)\s+/, '');

  const call = /^([A-Za-z_$][\w$.]*)\s*(?:=\s*)?(?:async\s+)?(?:function\s*\*?\s*)?\(/.exec(text);
  if (call) return `${call[1]}()`;

  const clean = text.replace(/[\s={(:]+$/, '').replace(/\s+/g, ' ').trim();
  // Whatever git found is only useful if it names something. A statement it
  // happened to land on is worse than saying nothing.
  if (clean.includes(';') || STATEMENT.test(clean)) return '';
  return clean;
}
