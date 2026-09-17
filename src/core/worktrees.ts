import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {statusOf, type AgentRun} from './agents';
import {defaultBranch, git, isAncestor, landedIn, parseStats, pathKey, type FileStat, type GitState} from './git';
import {sameDay} from './time';

// Claude Code gives a background agent a git worktree of its own: the same
// repository, checked out into another folder on its own branch, so three
// agents can edit the same files at once without meeting. The pane's folder is
// one of those folders too.
//
// So "what changed" has more than one place to happen, and this is the only
// module that knows the others exist. It answers two questions per folder: how
// far it has gone (dirty, ahead), and whether its work has arrived where the
// pane is (merged, and when).
//
// Merged agent worktrees are usually deleted the moment they land, so while
// the pane runs it writes down each one's head. A head we remember can still
// be measured after the folder is gone, because a linked worktree's commits
// live in the repository's own object store, not in the folder.

export type Worktree = {
  path: string;
  // Empty for a detached head.
  branch: string;
  head: string;
  // The repository's own checkout: the first entry git lists.
  main: boolean;
  locked: boolean;
  // Git can see the folder is gone.
  prunable: boolean;
};

// `git worktree list --porcelain` writes one block per worktree, a blank line
// between blocks, and one `key value` per line. The path is the rest of the
// line, so a folder with a space in it survives; a detached head has no
// `branch` line at all.
export async function listWorktrees(root: string): Promise<Worktree[]> {
  const out = await git(root, ['worktree', 'list', '--porcelain']);
  if (!out) return [];

  const list: Worktree[] = [];
  let current: Worktree | null = null;
  for (const raw of out.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('worktree ')) {
      current = {path: path.resolve(line.slice(9)), branch: '', head: '', main: list.length === 0, locked: false, prunable: false};
      list.push(current);
      continue;
    }

    if (!current) continue;
    if (line.startsWith('HEAD ')) current.head = line.slice(5).trim();
    else if (line.startsWith('branch ')) current.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
    // Both come either bare or with a reason after them.
    else if (line === 'locked' || line.startsWith('locked ')) current.locked = true;
    else if (line === 'prunable' || line.startsWith('prunable ')) current.prunable = true;
  }

  return list;
}

export type WorktreeRun = {
  path: string;
  // The folder's own name, which is what a row calls it.
  name: string;
  branch: string;
  head: string;
  main: boolean;
  // The folder the pane is watching.
  here: boolean;
  // The folder is not on disk any more.
  gone: boolean;
  // Gone, and its work never arrived: nothing to show and nothing to wait for.
  removed: boolean;
  // False for a worktree we know of only from an agent's meta file: the folder
  // and its branch are both gone, so where it got to cannot be told.
  known: boolean;
  // Files changed in it right now.
  dirty: number;
  // Commits it has that its parent does not.
  ahead: number;
  merged: boolean;
  // When the merge that brought it in was made.
  mergedAt: number | null;
  // Its head is in the pane's own folder: merged into the trunk while the
  // pane sits on a branch of its own is merged, but it has not landed here.
  arrived: boolean;
  // How many commits it brought, once merged; nought before.
  commits: number;
  // Agents of this project's chats that worked in it, oldest first.
  agents: AgentRun[];
  // One of them is running now.
  active: boolean;
  // What it changed since it left its parent, the work tree included.
  files: FileStat[];
  lines: {added: number; removed: number};
  // The ref it is all measured against: the pane's folder, or the trunk.
  parent: string;
};

// `born` is the first head the pane ever saw the folder at, `bornAhead` how
// many commits of its own it had then, and `bornBase` where it had left its
// parent. A folder that never had a commit of its own — still at the head it
// was first seen at, and nothing ahead then — is a checkout, not work, and a
// checkout of an old commit is reachable from the parent without having been
// merged. Anything else that the parent can reach, it brought.
//
// `mergedAt` is written once, the first time the pane sees it merged, so a
// merge with no merge commit of its own keeps the time it was first seen at
// rather than the time of whatever was committed after it.
type Remembered = {
  name: string; branch: string; head: string; at: number;
  mergedAt?: number; born?: string; bornAhead?: number; bornBase?: string;
};
type Memory = Record<string, Remembered>;

type Memo = {
  at: number;
  // The heads this was worked out from, which the worktree list already says,
  // and the status text, which costs a call.
  refs: string;
  status: string;
  dirty: number;
  ahead: number;
  merged: boolean;
  mergedAt: number | null;
  arrived: boolean;
  commits: number;
  files: FileStat[];
};

const memos = new Map<string, Memo>();

// A worktree nobody is working in is not where the news is, so it is looked at
// this often rather than every poll.
const IDLE_MS = 30_000;
const KEEP_REMEMBERED = 24;

// The same folder the snapshots live in, with the same override, so everything
// sidecar remembers about a project sits together. The pane's own preferences
// live there too, which is why it is shared.
export function storeDir(root: string): string {
  const slug = path.resolve(root).replace(/[\\/:.]/g, '-');
  return path.join(process.env.SIDECAR_HOME || path.join(os.homedir(), '.sidecar'), slug);
}

function readMemory(root: string): Memory {
  try {
    return JSON.parse(fs.readFileSync(path.join(storeDir(root), 'worktrees.json'), 'utf8')) as Memory;
  } catch {
    return {};
  }
}

// Written through a temporary file, so a pane that dies mid-write leaves the
// last good copy rather than half a one. Failing to write only costs the
// memory of a worktree that is deleted before the next run.
function writeMemory(root: string, memory: Memory): void {
  try {
    // Only the newest are worth keeping: a worktree merged a hundred folders
    // ago is not news.
    const entries = Object.entries(memory).sort((a, b) => b[1].at - a[1].at).slice(0, KEEP_REMEMBERED * 2);
    memory = Object.fromEntries(entries);
    const dir = storeDir(root);
    fs.mkdirSync(dir, {recursive: true});
    const file = path.join(dir, 'worktrees.json');
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(memory));
    fs.renameSync(temp, file);
  } catch {
    // Nothing here is worth an error in a viewer.
  }
}

function exists(folder: string): boolean {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

// How many files are changed in a folder right now. One call, and the text
// itself is the cache key: two polls that read the same status have nothing
// left to work out.
async function statusOfFolder(folder: string): Promise<{dirty: number; key: string}> {
  const out = await git(folder, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (out === null) return {dirty: 0, key: 'none'};
  const dirty = out.split('\0').filter(entry => entry.length >= 4 && !entry.startsWith('D ') && !entry.startsWith(' D')).length;
  return {dirty, key: out};
}

// The pane's own folder is already read once a poll by `loadGit`, so it never
// pays for a second `git status`.
function statusFromState(root: string, state: GitState | null): {dirty: number; key: string} {
  if (!state) return {dirty: 0, key: 'none'};
  const keys = [...state.changes.entries()].filter(([, change]) => change.status !== 'D').map(([file]) => file);
  return {dirty: keys.length, key: `${pathKey(root)}\0${keys.sort().join('\0')}`};
}

// What a worktree changed against the point it left its parent. From the
// folder itself the work tree counts too; once the folder is gone only its
// commits are left to compare. `from` is that point when the caller already
// knows it: once a branch has merged, the merge base with its parent is its
// own head, and a diff from there is empty.
async function changedIn(
  root: string,
  wt: {path: string; head: string; gone: boolean},
  parent: string,
  from?: string,
): Promise<FileStat[]> {
  const base = from ?? (await git(root, ['merge-base', wt.head, parent]))?.trim();
  if (!base) return [];
  const commitsOnly = wt.gone || from !== undefined;
  const where = commitsOnly ? root : wt.path;
  const range = commitsOnly ? [base, wt.head] : [base];
  const names = (await git(where, ['diff', '--name-status', '-z', '--find-renames', ...range])) ?? '';
  const counts = (await git(where, ['diff', '--numstat', '-z', '--find-renames', ...range])) ?? '';
  return parseStats(names, counts);
}

// Every folder of this repository the pane has anything to say about: the ones
// git lists now, plus the ones it remembers an agent working in. `state` is
// the pane folder's own status, already read this poll.
export async function readWorktrees(
  root: string,
  agents: AgentRun[],
  state: GitState | null,
  now: number,
): Promise<WorktreeRun[]> {
  const live = await listWorktrees(root);
  if (live.length === 0) return [];

  const rootKey = pathKey(root);
  const here = live.find(wt => pathKey(wt.path) === rootKey) ?? null;
  const trunk = (await defaultBranch(root)) ?? '';
  // Where the trunk is now, as a sha. The trunk moves without the pane's own
  // head moving whenever the pane sits on a branch of its own, and the answers
  // below are remembered by the shas they were asked about: asked by name,
  // a merge into the trunk would go unseen until the pane's own head moved.
  const trunkAt = trunk ? (await git(root, ['rev-parse', '--verify', '--quiet', trunk]))?.trim() || trunk : '';

  // Who worked where. An agent with a worktree of its own says so in its meta
  // file; every other agent ran in the folder its transcript names, which is
  // the pane's folder or another checkout of the same repo.
  const working = new Map<string, AgentRun[]>();
  const claimed = new Map<string, AgentRun>();
  for (const run of agents) {
    const folder = run.worktree?.path || run.cwd;
    if (!folder) continue;
    const key = pathKey(folder);
    working.set(key, [...(working.get(key) ?? []), run]);
    if (run.worktree?.path) claimed.set(key, run);
  }

  const memory = readMemory(root);
  let changed = false;
  for (const wt of live) {
    if (!wt.head || pathKey(wt.path) === rootKey) continue;
    const was = memory[wt.path];
    if (was?.head === wt.head && was.branch === wt.branch) continue;
    // An entry written before `born` was kept has no first head, and the head
    // it has now is not one: guessing would call it merged the day it moves.
    memory[wt.path] = {
      name: path.basename(wt.path), branch: wt.branch, head: wt.head, at: now,
      mergedAt: was?.mergedAt, born: was ? was.born : wt.head, bornAhead: was?.bornAhead, bornBase: was?.bornBase,
    };
    changed = true;
  }

  // Folders that are gone: the ones we wrote down, and the ones only an
  // agent's meta file ever named.
  const seen = new Set(live.map(wt => pathKey(wt.path)));
  type Ghost = {path: string; name: string; branch: string; head: string; at: number};
  const ghosts: Ghost[] = [];
  for (const [folder, was] of Object.entries(memory)) {
    if (seen.has(pathKey(folder))) continue;
    ghosts.push({path: folder, name: was.name, branch: was.branch, head: was.head, at: was.at});
    seen.add(pathKey(folder));
  }

  for (const run of agents) {
    const folder = run.worktree?.path;
    if (!folder || seen.has(pathKey(folder))) continue;
    // Nothing recorded its head, so all that is left is its name.
    ghosts.push({path: folder, name: path.basename(folder), branch: run.worktree?.branch ?? '', head: '', at: run.startedAt});
    seen.add(pathKey(folder));
  }

  const out: WorktreeRun[] = [];
  const all = [
    ...live.map(wt => ({...wt, gone: !exists(wt.path) || wt.prunable, name: path.basename(wt.path)})),
    ...ghosts
      .sort((a, b) => b.at - a.at)
      .slice(0, KEEP_REMEMBERED)
      .map(ghost => ({...ghost, main: false, locked: false, prunable: true, gone: true})),
  ];

  for (const wt of all) {
    const key = pathKey(wt.path);
    const mine = working.get(key) ?? [];
    const isHere = key === rootKey;
    const active = mine.some(run => statusOf(run, now) === 'running');
    // A worktree an agent of ours was given belongs to the pane's folder: its
    // work is going there, not to the trunk. Everything else answers to the
    // branch the project keeps its work on.
    const parent = !isHere && claimed.has(key) && here?.head ? here.head : trunk;

    // The heads are free: the worktree list has already said them. So a
    // folder nothing has moved in is only asked how dirty it is, and one
    // nobody is working in is not even asked that more than now and then.
    const against = parent === trunk ? trunkAt : parent;
    const refs = `${wt.head}\0${against}\0${here?.head ?? ''}`;
    const idle = !isHere && !active;
    const memo = memos.get(key);
    if (memo && memo.refs === refs && idle && now - memo.at < IDLE_MS) {
      out.push(row(wt, isHere, mine, active, parent, memo));
      continue;
    }

    const status = wt.gone
      ? {dirty: 0, key: 'gone'}
      : isHere
        ? statusFromState(root, state)
        : await statusOfFolder(wt.path);

    if (memo && memo.refs === refs && memo.status === status.key) {
      memo.at = now;
      out.push(row(wt, isHere, mine, active, parent, memo));
      continue;
    }

    let ahead = 0;
    let merged = false;
    let mergedAt: number | null = null;
    let arrived = false;
    let commits = 0;
    let files: FileStat[] = [];
    if (wt.head && parent) {
      ahead = Number((await git(root, ['rev-list', '--count', `${parent}..${wt.head}`]))?.trim() ?? 0) || 0;
      const kept = memory[wt.path];
      // The first time the folder is measured is the one time how far ahead
      // it was when it was born can be told: after that its commits may be
      // in the parent and the count is nought either way.
      if (kept && kept.born === wt.head && kept.bornAhead === undefined) {
        kept.bornAhead = ahead;
        kept.bornBase = (await git(root, ['merge-base', wt.head, parent]))?.trim() || undefined;
        changed = true;
      }

      // The trunk cannot be merged into itself, and the folder the pane is in
      // is where everything else is going, so neither is asked.
      const trunkItself = wt.main && (wt.branch === trunk || `origin/${wt.branch}` === trunk);
      let from: string | undefined;
      if (!isHere && !trunkItself && (await isAncestor(root, wt.head, against))) {
        // Reachable is not the same as merged. A folder checked out at its
        // parent's head, or at any older commit of it, and never committed
        // in, is reachable too, and calling it merged put a landing in the
        // stream for work that never happened. So a folder that never had a
        // commit of its own is left out; everything else the parent can
        // reach, a fast-forward included, it brought.
        const landing = await landedIn(root, wt.head, parent);
        const viaMerge = Boolean(landing?.merge && landing.parent !== wt.head);
        // An entry from before `born` was kept knows nothing of where it
        // started, so only a merge commit can say it brought anything.
        const fresh = kept?.born === undefined ? !viaMerge : wt.head === kept.born && (kept.bornAhead ?? 0) === 0;
        if (!fresh) {
          merged = true;
          // The merge commit's own time when there is one. A fast-forward has
          // none, and the commit after it on the parent is somebody else's
          // work, so its time is the one the pane first saw it merged — now,
          // if this pane saw it unmerged — or else its own last commit's.
          const sawItOpen = memo !== undefined && !memo.merged && memo.refs.split('\0')[0] === wt.head;
          const own = async () => Number((await git(root, ['log', '-1', '--format=%ct', wt.head]))?.trim() ?? 0) * 1000 || null;
          mergedAt = viaMerge ? landing!.at : (kept?.mergedAt ?? (sawItOpen ? now : await own()));
          if (kept && kept.mergedAt === undefined && mergedAt !== null) {
            kept.mergedAt = mergedAt;
            changed = true;
          }

          // What it brought is measured from the commit before it arrived:
          // where it left the line the merge was made on, or where it left
          // its parent when it was first seen.
          from = viaMerge
            ? (await git(root, ['merge-base', wt.head, landing!.parent]))?.trim() || undefined
            : (kept?.bornBase ?? (kept?.born && kept.born !== wt.head ? kept.born : undefined));
          if (from) commits = Number((await git(root, ['rev-list', '--count', `${from}..${wt.head}`]))?.trim() ?? 0) || 0;
          // Its work is in the pane's folder only if the pane's head can
          // reach it: a branch merged into the trunk while you sit on a
          // branch of your own has landed somewhere else.
          arrived = Boolean(here?.head) && (parent === here!.head || (await isAncestor(root, wt.head, here!.head)));
        }
      }

      // The pane's own folder shows its work as turns, so it is the one folder
      // whose files are not worth a diff here. A merged folder with no known
      // start has nothing to measure from.
      if (!isHere && (!merged || from)) files = await changedIn(root, wt, parent, from);
    }

    const measured: Memo = {at: now, refs, status: status.key, dirty: status.dirty, ahead, merged, mergedAt, arrived, commits, files};
    memos.set(key, measured);
    out.push(row(wt, isHere, mine, active, parent, measured));
  }

  if (changed) writeMemory(root, memory);

  // The pane's folder first, then the main checkout, then the newest work.
  return out.sort((a, b) => Number(b.here) - Number(a.here) || Number(b.main) - Number(a.main) || a.name.localeCompare(b.name));
}

function row(
  wt: {path: string; name: string; branch: string; head: string; main: boolean; gone: boolean},
  here: boolean,
  agents: AgentRun[],
  active: boolean,
  parent: string,
  memo: Memo,
): WorktreeRun {
  return {
    path: wt.path,
    name: wt.name,
    branch: wt.branch,
    head: wt.head,
    main: wt.main,
    here,
    gone: wt.gone && !here,
    removed: wt.gone && !here && Boolean(wt.head) && !memo.merged,
    known: Boolean(wt.head),
    dirty: memo.dirty,
    ahead: memo.ahead,
    merged: memo.merged,
    mergedAt: memo.mergedAt,
    arrived: memo.arrived,
    commits: memo.commits,
    agents,
    active,
    files: memo.files,
    lines: {
      added: memo.files.reduce((n, f) => n + f.added, 0),
      removed: memo.files.reduce((n, f) => n + f.removed, 0),
    },
    parent,
  };
}

// One word for where a folder has got to. The first true one is the whole
// truth, so every row that names a folder's state names the same word.
export type StateWord = 'working' | 'ahead' | 'dirty' | 'merged' | 'clean' | 'removed' | 'not recorded';

// `busy` is the pane's own turn: no agent file says Claude is working in the
// pane's folder, so the caller that knows has to say it.
export function stateWord(wt: WorktreeRun, now: number, busy = false): StateWord {
  if (busy || wt.agents.some(run => statusOf(run, now) === 'running')) return 'working';
  if (wt.merged) return 'merged';
  if (wt.removed) return 'removed';
  if (wt.gone && !wt.known) return 'not recorded';
  if (wt.ahead > 0) return 'ahead';
  if (wt.dirty > 0) return 'dirty';
  return 'clean';
}

// A time of day, 24 hour. The UI has its own; core may not borrow it.
function clock(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// The four stops of a worktree's journey, and how far it has got.
export type Journey = {
  stage: 0 | 1 | 2 | 3 | 4; // 1 started, 2 committed, 3 merged, 4 removed
  labels: [string, string, string, string];
};

// `now` is taken for the same reason `stateWord` takes it, so the two are
// called alike; every stop here is already a fact of the folder.
export function journeyOf(wt: WorktreeRun, now: number): Journey {
  const started = wt.agents.length ? Math.min(...wt.agents.map(run => run.startedAt)) : 0;
  // Once it has merged, its commits are in the parent and `ahead` is back to
  // nought, so "no commit yet" would be a lie about a folder that plainly
  // committed.
  const commits = wt.ahead > 0 ? plural(wt.ahead, 'commit') : wt.merged ? 'committed' : 'no commit yet';
  // No check mark: the mark is the UI's to draw, where it has the room.
  const merged = wt.merged ? (wt.mergedAt ? `merged ${clock(wt.mergedAt)}` : 'merged') : 'not merged';

  // A folder git lists has at least been started, whatever else is true.
  const stage: Journey['stage'] =
    wt.merged && wt.gone ? 4
      : wt.merged ? 3
        : wt.ahead > 0 ? 2
          : wt.agents.length || wt.dirty > 0 || !wt.gone ? 1
            : 0;

  return {
    stage,
    labels: [started ? `started ${clock(started)}` : 'started', commits, merged, wt.gone ? 'removed' : 'folder kept'],
  };
}

const plural = (n: number, one: string): string => `${n} ${n === 1 ? one : `${one}s`}`;


// The folders a list of them shows: every one on disk, and a gone one only on
// the day its work landed here, which is the day that is news. Everything
// else that is gone — removed, never recorded, merged last week — is history
// the stream already carries, and listed it pushed the folders somebody is
// working in off the bottom of the panel.
export function visibleWorktrees(worktrees: WorktreeRun[], now: number): WorktreeRun[] {
  return worktrees.filter(wt => !wt.gone || (wt.merged && wt.mergedAt !== null && sameDay(wt.mergedAt, now)));
}

// A branch that arrived in the pane's folder: one row of its own in the stream.
// `commits` is what it brought, counted from where it left its parent.
export type Landing = {wt: WorktreeRun; at: number; files: FileStat[]; added: number; removed: number; commits: number};

// Newest first, like the stream it is laid into. Only what the pane's own
// head can reach has landed here; a merge into the trunk while the pane sits
// on a branch is news for the trunk, not for this folder. A merge with no time
// cannot be placed among the turns, so it is left out rather than guessed at.
export function landingsOf(worktrees: WorktreeRun[]): Landing[] {
  return worktrees
    .filter(wt => wt.merged && wt.arrived && wt.mergedAt)
    .map(wt => ({wt, at: wt.mergedAt!, files: wt.files, added: wt.lines.added, removed: wt.lines.removed, commits: wt.commits}))
    .sort((a, b) => b.at - a.at);
}
