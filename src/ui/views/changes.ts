import path from 'node:path';
import {statusOf, type AgentRun} from '../../core/agents';
import type {DiffLine, FileDiff, FileStatus} from '../../core/diff';
import {pathKey} from '../../core/git';
import {
  daySummary, folderShares, groupByFolder,
  type ChangedFile, type DayGroup, type FileHistory, type TurnChange,
} from '../../core/turns';
import {modelName} from '../../core/usage';
import {journeyOf, stateWord, type Landing, type StateWord, type WorktreeRun} from '../../core/worktrees';
import {
  blankRow, brief, chevron, chip, counts, cut, INDENT, INDENT2, num, padTo, pageRow, plural, sep, seg, sizeCells, sizeLit, SIZE_CELLS,
  skylineCol, sp, span, spinner, splitBar, streamRoom, streamRow, tokens, turnMark, width, widthOf,
  type Group, type Line, type Seg, type Zone,
} from '../cells';
import {diffLines, viewRows, type DiffGroup} from '../diffrows';
import {glyph, hues, theme} from '../theme';
import {wrap} from '../util';

// The Changes view is one stream, whichever folders are in scope. A day heads
// it with its own skyline; a turn is a block whose chevron sits in column 1 and
// whose rows all hang on the block's own line; a diff opens in a well under the
// row of the file it belongs to. Nothing is a box, nothing is shown "down
// there", and every row in the view starts its text in the same column.

export type Open = {
  // Turns whose open state was flipped by hand. The newest turn starts open,
  // every other turn starts closed.
  turns: ReadonlySet<string>;
  files: ReadonlySet<string>;
  more: ReadonlySet<string>;
  steps: ReadonlySet<string>;
  says: ReadonlySet<string>;
  // Agent rows whose detail is open, keyed by agent id.
  agents: ReadonlySet<string>;
  // Rows that fold a crowd of agents away, keyed by turn.
  folded: ReadonlySet<string>;
  hists: ReadonlySet<string>;
  // Branches that landed here whose files are open, keyed by folder path. A
  // pane that has never drawn a landing has nothing here, so it may be left out.
  landings?: ReadonlySet<string>;
};

export type ChangesInput = {
  cols: number;
  now: number;
  frame: number;
  root: string;
  group: Group;
  changes: TurnChange[];
  histories: FileHistory[];
  flat: FileDiff[] | null;
  agents: AgentRun[];
  open: Open;
  diffs: ReadonlyMap<string, DiffGroup[]>;
  folded: ReadonlySet<string>;
  opened: ReadonlyMap<string, DiffLine[]>;
  hideSpace: boolean;
  sel: string | null;
  // Every folder of this repository the pane can say something about, and how
  // much of it this view is covering. Both optional: without them the view
  // shows the pane's own folder, which is all it used to know about.
  worktrees?: WorktreeRun[];
  scope?: 'mine' | 'all';
  // The chat's own model, so an agent is only marked with one when it differs.
  chatModel?: string;
  // The branch the pane's folder is on: the one a merge in this history landed
  // on, and the name the commit rows use.
  branch?: string;
  // A turn of this folder's own chat is running, which is what makes the
  // folder active in the map even when no agent is.
  working?: boolean;
  // The chat Claude Code has a permission prompt up for, so the step that
  // chat's running turn is on is waiting on you, not on the machine. Only that
  // one: with two chats, or in `all`, the others are working as usual.
  waiting?: string;
  // The one folder the stream is about, when a workspace was picked: `null`,
  // or left out, is the pane's own. The turns come in already filtered to it.
  focus?: string | null;
  // Whether the side panel is on screen. When it is, it carries the list of
  // workspaces and the name of the picked one, so the stream does not repeat
  // them. Left out, there is no panel.
  panel?: 'open' | 'folded' | 'off';
  // Branches that merged into the pane's folder, newest first.
  landings?: Landing[];
};

const FILES_SHOWN = 8;
// A landing's files are a receipt, not the work itself, so fewer of them show
// before the rest are counted.
const LANDING_FILES = 6;
// The columns between two stops of a journey, and so the width of each label.
const JOURNEY_GAP = 13;
// More agents than this in one turn and the Changes view rolls them into one
// row. A file row carries this many squares before it counts the rest.
const AGENTS_SHOWN = 3;
const TAGS_SHOWN = 2;
const STEPS_SHOWN = 40;
const SAYS_SHOWN = 2;
// More commits than this on one turn and the older ones fold away.
const COMMITS_SHOWN = 3;
// The newest turns of a day the skyline has room for.
const SKYLINE_SHOWN = 20;
// The column the skyline starts in, clear of the day label above it.
const SKYLINE_LEFT = 8;
const DAY = 86_400_000;

// Under this width a row cannot carry everything it does at 64 columns, so the
// parts that give way (the skyline totals, the chips after the first, the
// legend's percentages, the size cells) are dropped.
const NARROW = 56;

// A spinner says something is happening; it never says for how long. Past this
// much silence the row says the number instead, because that is the point at
// which a long command and a stuck one start to look the same.
const QUIET_SHOWN = 5 * 60_000;

export const turnKey = (change: TurnChange): string => `${change.chatId}:${change.turn.id}`;
export const fileKey = (scope: string, rel: string): string => `${scope}|${rel}`;

export function dayLabel(at: number, now: number): string {
  const startOf = (ms: number) => new Date(new Date(ms).toDateString()).getTime();
  const days = Math.round((startOf(now) - startOf(at)) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return new Date(at).toLocaleDateString(undefined, {weekday: 'long'}).toLowerCase();
  return new Date(at).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

// How long a running row has been silent, once that is worth saying.
export function quietNote(since: number, now: number): Seg[] {
  return now - since > QUIET_SHOWN ? [seg(`${span(now - since)} quiet`, theme.warn)] : [];
}

export function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit', hour12: false});
}

// The room a stream row's own content has, under the three column prefix.
const roomOf = (cols: number): number => streamRoom(cols);

// What a tool call was aimed at: the words Claude gave it, or the file it
// named, as a path in the project rather than a bare name.
function target(root: string, step: {why: string; file: string | null}): string {
  if (step.why) return step.why;
  if (!step.file) return '';
  const rel = path.relative(root, step.file).split(path.sep).join('/');
  return rel.startsWith('..') ? path.basename(step.file) : rel;
}

const LETTER: Record<FileStatus, string> = {added: 'A', modified: 'M', deleted: 'D', renamed: 'R'};
const LETTER_COLOUR: Record<FileStatus, string> = {added: theme.add, modified: theme.link, deleted: theme.del, renamed: theme.keyword};

// The agents each turn started, keyed by turn. An agent started by another
// agent belongs to the same turn as its parent.
export function agentsByTurn(changes: TurnChange[], agents: AgentRun[]): Map<string, AgentRun[]> {
  const turnOfCall = new Map<string, string>();
  for (const change of changes) for (const action of change.turn.actions) if (action.id) turnOfCall.set(action.id, turnKey(change));
  const out = new Map<string, AgentRun[]>();
  const placed = new Map<string, string>();
  for (const agent of [...agents].sort((a, b) => a.depth - b.depth || a.startedAt - b.startedAt)) {
    // Either the main chat started it, or an agent did: then it belongs to
    // whichever turn its parent belongs to.
    let key = turnOfCall.get(agent.toolUseId);
    if (!key && agent.parentId) key = placed.get(agent.parentId);
    if (!key) continue;
    placed.set(agent.id, key);
    out.set(key, [...(out.get(key) ?? []), agent]);
  }

  return out;
}

// `changesLines` runs on every spinner tick, and these two walk the whole
// history. Both only depend on what the last poll handed over, so they are
// worked out again when that moves and not four times a second.
let agentMemo: {changes: TurnChange[]; agents: AgentRun[]; by: Map<string, AgentRun[]>} | null = null;

function turnAgents(changes: TurnChange[], agents: AgentRun[]): Map<string, AgentRun[]> {
  if (agentMemo && agentMemo.changes === changes && agentMemo.agents === agents) return agentMemo.by;
  const by = agentsByTurn(changes, agents);
  agentMemo = {changes, agents, by};
  return by;
}

let dayMemo: {changes: TurnChange[]; now: number; days: DayGroup[]} | null = null;

function daysOf(changes: TurnChange[], now: number): DayGroup[] {
  if (dayMemo && dayMemo.changes === changes && dayMemo.now === now) return dayMemo.days;
  const days = daySummary(changes, now);
  dayMemo = {changes, now, days};
  return days;
}

// `daySummary` groups by day and chat, because a run of turns from one chat is
// what the stream breaks on. The head above them is about the day: two chats
// this morning are still one morning, and its count, its span, its skyline and
// its totals say so. The divider under the head names the next chat.
function wholeDay(runs: DayGroup[], day: number, now: number): {turns: TurnChange[]; added: number; removed: number; span: number} {
  const mine = runs.filter(run => run.day === day);
  const turns = mine.flatMap(run => run.turns).sort((a, b) => a.turn.at - b.turn.at);
  const first = turns[0];
  const last = turns[turns.length - 1];
  return {
    turns,
    added: mine.reduce((n, run) => n + run.added, 0),
    removed: mine.reduce((n, run) => n + run.removed, 0),
    span: first && last ? Math.max(0, (last.running ? now : last.turn.endedAt) - first.turn.at) : 0,
  };
}

// One agent's own hue, by the order it was started in its turn.
const hueOf = (index: number): string => hues[index % hues.length]!;

function pathSegs(rel: string, bright: boolean): Seg[] {
  // A file outside the project arrives as a chain of `../`, which says nothing
  // and eats the row. The last two segments and a tag say the same thing.
  if (rel.startsWith('../')) {
    const parts = rel.split('/').filter(part => part !== '..');
    const tail = parts.slice(-2);
    return [
      seg(`${glyph.ellipsis}/`, theme.faint),
      ...(tail.length > 1 ? [seg(`${tail[0]}/`, theme.dim)] : []),
      seg(tail[tail.length - 1] ?? rel, bright ? theme.ink : theme.text),
      seg(' outside', theme.faint),
    ];
  }

  const dir = path.posix.dirname(rel);
  return [...(dir === '.' ? [] : [seg(`${dir}/`, theme.dim)]), seg(path.posix.basename(rel), bright ? theme.ink : theme.text)];
}

// `lead` is how many rows sit above the stream itself: the workspaces and a
// picked folder's head, which are not turns and so do not make it non-empty.
type Ctx = ChangesInput & {out: Line[]; lead?: number};

// Everything a block's rows hang on: the id that keeps them on screen while
// they scroll, and whether the line is a live one.
type Rail = {pins: string[]; live?: boolean};

function gapRow(ctx: Ctx, rail: Rail): void {
  ctx.out.push(streamRow(ctx.cols, [], [], rail));
}

// ---------- the day header, and the day as a skyline ----------

function dayHead(ctx: Ctx, label: string, title: string, right: Seg[]): void {
  ctx.out.push(pageRow(ctx.cols, [seg(label.toUpperCase(), theme.faint, {bold: true}), seg(`   ${title}`, theme.dim)], right));
}

// One column pair per turn of the day, in time order: where the big ones were.
// Each pair is a click zone that moves the cursor onto its turn.
function skylineRow(ctx: Ctx, turns: TurnChange[], lit: (change: TurnChange) => boolean, added: number, removed: number): void {
  const {cols} = ctx;
  const shown = turns.slice(-SKYLINE_SHOWN);
  const left: Seg[] = [sp(SKYLINE_LEFT)];
  const zones: Zone[] = [];
  let x = 1 + SKYLINE_LEFT;
  for (const change of shown) {
    const on = lit(change) || `t:${turnKey(change)}` === ctx.sel;
    left.push(...skylineCol(sizeLit(change.added + change.removed), on ? theme.accent : theme.faint), sp(1));
    zones.push({from: x, to: x + 3, act: {type: 'goTurn', key: turnKey(change)}});
    x += 3;
  }

  const totals = added || removed ? [seg(`+${num(added)}`, theme.add), sp(1), seg(`${glyph.minus}${num(removed)}`, theme.del)] : [];
  // The totals are the first thing to go when the day is wider than the pane.
  const fits = widthOf(left) + widthOf(totals) + 2 <= cols - 3;
  ctx.out.push(pageRow(cols, left, fits ? totals : [], {zones}));
}

// Where the stream breaks between days, or between two chats of one day. The
// rule is the same grey as a block's own line, so it reads as structure.
function dividerRow(cols: number, label: string): Line {
  const text = `  ${label}  `;
  const left = Math.min(20, Math.max(2, cols - 6 - width(text)));
  const rest = Math.max(0, cols - 1 - 4 - left - width(text));
  return {segs: [sp(4), seg(glyph.rule.repeat(left), theme.spine), seg(text, theme.faint), seg(glyph.rule.repeat(rest), theme.spine)]};
}

// ---------- a turn ----------

type Block = {
  // The turn's chevron, and the chip in front of its title: which folder it
  // was typed in, when that was not this one.
  colour?: string;
  tag?: Seg[];
};

// Your own words are the title: they are the reason the files moved. One line
// of them, and the row itself opens the whole prompt when there is more.
function titleRow(ctx: Ctx, change: TurnChange, o: Block): void {
  const {cols, sel} = ctx;
  const key = turnKey(change);
  const id = `t:${key}`;
  const here = id === sel;
  const bg = here ? theme.surface2 : undefined;
  const live = change.running;
  const tag = o.tag ?? [];
  const when = [seg(clock(change.turn.at), theme.dim)];
  // Your own words are the reason the turn happened, so an open turn carries
  // all of them, on as many rows as they take. The clock's columns are kept
  // clear on every one of them, and the chip in front took what it took.
  const act = {type: 'turn', key} as const;
  const lines = wrap(change.turn.prompt, roomOf(cols) - 6 - widthOf(tag));
  if (lines.length === 0) lines.push('');
  lines.forEach((text, i) => {
    ctx.out.push(
      streamRow(cols, i === 0 ? [...tag, seg(text, theme.ink, {bold: true})] : [seg(text, theme.ink, {bold: true})], i === 0 ? when : [], {
        // Enter on any row of the title closes the turn, because every one of
        // them is the turn's own row.
        bg, live, act, hint: 'close',
        ...(i === 0 ? {mark: turnMark(change.running, true, here, ctx.frame, o.colour), id, pick: true} : {pins: [id]}),
      }),
    );
  });
}

// Where a turn's work stands in git, as a chip on its own row.
function stateChip(change: TurnChange): Seg[] {
  if (change.git === 'merged') return chip(`${glyph.check} merged`, theme.tintAdd, theme.add);
  if (change.git === 'committed') return chip(`${glyph.diamond} committed`, theme.surface2, theme.link);
  if (change.git === 'uncommitted') return chip(`${glyph.dot} uncommitted`, theme.surface2, theme.dim);
  return [];
}

// How big the turn was, as figures on ground: the file count, then what it
// added and removed. The parts after the first give way on a narrow pane.
function chipsRow(ctx: Ctx, change: TurnChange, agents: AgentRun[], rail: Rail, o: Block & {right?: Seg[]}): void {
  const {cols, now} = ctx;
  const head: Seg[] = [];
  const parts: Seg[][] = [];
  const took = (change.running ? now : change.turn.endedAt) - change.turn.at;
  if (change.running) head.push(seg(`running ${span(took)}`, theme.accent), sp(3));

  const n = change.files.length;
  if (n) {
    head.push(...chip(plural(n, 'file'), theme.surface2, theme.text));
    if (change.measured) {
      if (change.added) parts.push([sp(1), ...chip(`+${change.added}`, theme.tintAdd, theme.add)]);
      if (change.removed) parts.push([sp(1), ...chip(`${glyph.minus}${change.removed}`, theme.tintDel, theme.del)]);
    } else {
      head.push(seg('  not recorded', theme.faint, {italic: true}));
    }
  } else if (!change.running) {
    head.push(seg('no file changes', theme.faint));
  }

  if (!change.running && took >= 1000) parts.push([seg(`  ${span(took)}`, theme.dim)]);
  // The agents are not counted here: the chart's own head row below says how
  // many there are, how they are getting on and what they have spent.

  const right = o.right ?? stateChip(change);
  // Whatever will not fit goes from the end: the agent count, then how long it
  // took, then the figures, so the file count is the last thing standing.
  let kept = parts;
  while (kept.length && widthOf(head) + kept.reduce((w, part) => w + widthOf(part), 0) + widthOf(right) + 1 > roomOf(cols)) {
    kept = kept.slice(0, -1);
  }

  ctx.out.push(streamRow(cols, [...head, ...kept.flat()], right, rail));
}

// Where the turn landed, by folder: one bar split by share, and a legend that
// names the parts. Only worth drawing when there is more than one place.
function landedRows(ctx: Ctx, change: TurnChange, rail: Rail): void {
  const {cols} = ctx;
  const parts = folderShares(change.files, change.measured);
  if (parts.length < 2) return;
  const bar = roomOf(cols);
  let used = 0;
  // Every part is capped by what is left, and the last one takes the
  // remainder: five parts that each round up must not push the bar past the
  // row it has to fit in.
  const cells = parts.map((part, i) => {
    const room = bar - used;
    const n = i === parts.length - 1 ? room : Math.max(0, Math.min(room, Math.round(part.share * bar)));
    used += n;
    return n;
  });

  ctx.out.push(streamRow(cols, splitBar(parts.map((_, i) => [cells[i]!, hueOf(i)])), [], rail));
  const tight = cols < NARROW;
  ctx.out.push(
    streamRow(
      cols,
      parts.flatMap((part, i) => [
        ...(i ? [sp(3)] : []),
        seg(glyph.square, hueOf(i)),
        seg(` ${part.key}`, theme.text),
        ...(tight ? [] : [seg(` ${Math.round(part.share * 100)}%`, theme.dim)]),
      ]),
      [],
      rail,
    ),
  );
}

// One openable file row, and under it the diff when it is open. The diff hangs
// on the same line, one column further in than a row of the stream.
function fileRow(ctx: Ctx, key: string, rel: string, abs: string | null, left: Seg[], right: Seg[], pins: string[], o: {mark?: Seg; live?: boolean}): void {
  const {cols, sel, open} = ctx;
  const id = `f:${key}`;
  const here = id === sel;
  const isOpen = open.files.has(key);
  const groups = isOpen ? ctx.diffs.get(key) : undefined;
  const hunks = groups?.reduce((n, group) => n + (group.file?.hunks.length ?? 0), 0) ?? 0;
  // Only the cursor's own row is lit: two lit rows read as two cursors, and
  // the hunk count beside the name already says which file is open.
  const bg = here ? theme.surface2 : undefined;
  const live = o.live;
  ctx.out.push(
    streamRow(cols, [...left, ...(hunks ? [seg(`   ${plural(hunks, 'hunk')}`, theme.dim)] : [])], right, {
      bg, id, pick: true, pins, live, hint: isOpen ? 'close diff' : 'diff', act: {type: 'file', key}, ...(o.mark ? {mark: o.mark} : {}),
    }),
  );
  if (!isOpen) return;

  if (!groups) {
    ctx.out.push(streamRow(cols, [seg('Reading the diff…', theme.faint)], [], {pins: [...pins, id], live}));
    return;
  }

  const keyed = groups.map(group => ({...group, key: `${key}#${group.key}`}));
  const rows = viewRows(keyed, ctx.folded, ctx.opened, ctx.hideSpace);
  // `wide` hangs the well off the three column prefix the rest of the block
  // uses, so a diff lines up under the name of the file it belongs to.
  ctx.out.push(...diffLines(rows, keyed, {cols, fileKey: key, path: abs, sel, pins: [...pins, id], live, wide: true}));
}

// A file of a turn: the chevron that opens its diff, the status letter, its
// path under the folder it is grouped by, the squares of whoever wrote it,
// then how big the change was.
function turnFileRow(ctx: Ctx, change: TurnChange, file: ChangedFile, label: string, tags: Seg[], pins: string[]): void {
  const tight = ctx.cols < NARROW;
  const known = file.known;
  const letter = known ? LETTER[file.status] : '?';
  const key = fileKey(turnKey(change), file.rel);
  const left = [
    sp(1),
    chevron(ctx.open.files.has(key), `f:${key}` === ctx.sel),
    sp(1),
    seg(letter, known ? LETTER_COLOUR[file.status] : theme.faint, {bold: known}),
    sp(2),
    seg(label, known ? theme.ink : theme.dim),
    ...tags,
    // On a narrow pane the `?` is the whole of that news.
    ...(known || tight ? [] : [seg('   not recorded', theme.faint, {italic: true})]),
  ];
  const right = [
    // A file nothing counted has no size to show, so it shows none.
    ...(tight ? [] : [...(known ? sizeCells(file.added, file.removed) : [sp(SIZE_CELLS)]), sp(2)]),
    ...(known ? counts(file.added, file.removed) : [sp(SIZE_CELLS * 2 + 1)]),
  ];
  fileRow(ctx, key, file.rel, file.status === 'deleted' ? null : file.path, left, right, pins, {live: change.running});
}

function folderRow(ctx: Ctx, name: string, rail: Rail): void {
  ctx.out.push(streamRow(ctx.cols, [seg(name, theme.dim)], [], rail));
}

// The turn's files, grouped under the folder each one lives in, biggest folder
// first. A long list is cut and counted rather than scrolled past.
function fileRows(ctx: Ctx, change: TurnChange, agents: AgentRun[], rail: Rail): void {
  const {cols, sel, open} = ctx;
  const key = turnKey(change);
  const all = open.more.has(`files:${key}`);

  // Which agents wrote which file, so an overlap is visible on the row itself.
  const writers = new Map<string, number[]>();
  agents.forEach((agent, i) => {
    for (const file of agent.wrote) writers.set(file, [...(writers.get(file) ?? []), i]);
  });

  const groups = groupByFolder(change.files);
  let shown = 0;
  for (const group of groups) {
    const room = all ? group.files.length : Math.max(0, FILES_SHOWN - shown);
    if (room === 0) break;
    folderRow(ctx, group.key, rail);
    for (const {file, label} of group.files.slice(0, room)) {
      const by = writers.get(file.path) ?? [];
      const tags: Seg[] = by.length ? [sp(3), ...by.slice(0, TAGS_SHOWN).map(i => seg(glyph.square, hueOf(i)))] : [];
      if (by.length > TAGS_SHOWN) tags.push(seg(`+${by.length - TAGS_SHOWN}`, theme.faint));
      if (by.length > 1) tags.push(sp(1), seg(`${glyph.warn} ${by.length === 2 ? 'two' : by.length} agents`, theme.warn));
      turnFileRow(ctx, change, file, label, tags, rail.pins);
      shown++;
    }
  }

  const rest = change.files.length - shown;
  if (rest <= 0) return;
  const moreId = `m:${key}`;
  ctx.out.push(
    streamRow(cols, [seg(glyph.closed, theme.dim), sp(1), seg(plural(rest, 'more file'), moreId === sel ? theme.accent : theme.dim)], [], {
      ...rail, id: moreId, pick: true, bg: moreId === sel ? theme.surface2 : undefined, hint: 'all files', act: {type: 'toggle', set: 'more', key: `files:${key}`},
    }),
  );
}

// Every tool call, folded into one row: the step in progress while the turn
// runs, and afterwards a count with the tools it leaned on.
function stepsRow(ctx: Ctx, change: TurnChange, agents: AgentRun[], rail: Rail): void {
  const {cols, sel, open} = ctx;
  const turn = change.turn;
  const key = turnKey(change);
  const id = `w:${key}`;
  const here = id === sel;
  const isOpen = open.steps.has(key);
  const live = change.running;
  const tally = new Map<string, number>();
  for (const action of turn.actions) tally.set(action.tool, (tally.get(action.tool) ?? 0) + 1);
  const summary = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([tool, n]) => `${tool} ${n}`).join('  ');
  const last = turn.actions[turn.actions.length - 1]!;
  const more = {...rail, id, pick: true, bg: here ? theme.surface2 : undefined, hint: isOpen ? 'close' : 'steps', act: {type: 'toggle', set: 'steps', key} as const};
  // What the step is waiting on takes the right of the row when there is
  // anything to say: a count of steps is the quietest thing on it.
  const held = ctx.waiting && ctx.waiting === change.chatId ? [seg('waiting for you', theme.warn)] : quietNote(turn.endedAt, ctx.now);

  ctx.out.push(
    live
      ? streamRow(cols, [seg(spinner(ctx.frame), theme.accent), sp(1), seg(last.tool, theme.dim), sp(2), seg(target(ctx.root, last), theme.text)], held.length ? held : [seg(plural(turn.actions.length, 'step'), theme.dim)], more)
      : streamRow(cols, [chevron(isOpen, here), sp(1), seg(plural(turn.actions.length, 'step'), theme.text), seg(`   ${summary}`, theme.dim)], agents.length ? [seg(plural(agents.length, 'agent'), theme.dim)] : [], more),
  );

  if (!isOpen) return;
  const inner = {pins: [...rail.pins, id], live};
  const from = Math.max(0, turn.actions.length - STEPS_SHOWN);
  if (from > 0) ctx.out.push(streamRow(cols, [sp(INDENT2), seg(`${from} earlier steps`, theme.faint)], [], inner));
  for (const action of turn.actions.slice(from)) {
    const label = action.why || (action.file ? path.basename(action.file) : action.detail);
    ctx.out.push(
      streamRow(cols, [sp(INDENT2), seg(action.tool.padEnd(9), action.wrote ? theme.text : theme.faint), seg(label, action.wrote ? theme.text : theme.dim)], [seg(clock(action.at), theme.faint)], inner),
    );
  }
}

// What Claude said about the turn, in its own words. Only once the turn is
// over: while it runs, the conversation is on screen right next to this pane.
function saysRows(ctx: Ctx, change: TurnChange, rail: Rail): void {
  const {cols, sel, open} = ctx;
  const key = turnKey(change);
  const saysId = `s:${key}`;
  const here = saysId === sel;
  const all = open.says.has(key);
  const room = roomOf(cols) - 2;
  const text = wrap(change.turn.says.replace(/[*_`#>]/g, ''), room);
  const some = all ? text : text.slice(0, SAYS_SHOWN);
  const expands = text.length > SAYS_SHOWN;
  some.forEach((line, i) => {
    const last = i === some.length - 1;
    const cutHere = !all && last && text.length > some.length;
    // Leave room for the word rather than letting it be cut off.
    const shown = cutHere ? cut(line, room - 5) : line;
    const tail = expands && last ? [sp(1), seg(all ? 'less' : 'more', here ? theme.accent : theme.link, {underline: true})] : [];
    ctx.out.push(
      streamRow(cols, [i === 0 ? seg(glyph.thought, theme.accent) : sp(1), sp(1), seg(shown, theme.text), ...tail], [], {
        ...rail,
        bg: here ? theme.surface2 : undefined,
        act: {type: 'toggle', set: 'says', key},
        ...(i === 0 ? {id: saysId, pick: expands, hint: all ? 'close' : 'open'} : {}),
      }),
    );
  });
}

// The receipt: every commit that landed inside the turn's window, and where
// each one got to. A long run of them keeps the newest two.
function commitRows(ctx: Ctx, change: TurnChange, branch: string, rail: Rail): void {
  const {cols, sel, open} = ctx;
  const key = `commits:${turnKey(change)}`;
  const all = open.more.has(key);
  const many = change.landed.length > COMMITS_SHOWN;
  const shown = all || !many ? change.landed : change.landed.slice(-2);
  if (many) {
    const id = `mc:${turnKey(change)}`;
    const here = id === sel;
    const rest = change.landed.length - shown.length;
    ctx.out.push(
      streamRow(cols, [seg(all ? glyph.open : glyph.closed, theme.dim), sp(1), seg(all ? 'fewer commits' : plural(rest, 'more commit'), here ? theme.accent : theme.dim)], [], {
        ...rail, id, pick: true, bg: here ? theme.surface2 : undefined, hint: all ? 'close' : 'all commits', act: {type: 'toggle', set: 'more', key},
      }),
    );
  }

  for (const landed of shown) {
    const left = landed.merge
      ? [seg(glyph.check, theme.add), sp(1), seg(landed.sha.slice(0, 7), theme.link), sp(2), seg('merged into ', theme.dim), seg(branch || 'the branch', theme.text, {bold: true})]
      : [seg(glyph.diamond, theme.link), sp(1), seg(landed.sha.slice(0, 7), theme.link), sp(2), seg(landed.subject, theme.dim)];
    ctx.out.push(streamRow(cols, left, [seg(clock(landed.at), theme.faint)], rail));
  }
}

function openTurn(ctx: Ctx, change: TurnChange, agents: AgentRun[], o: Block): void {
  const key = turnKey(change);
  const id = `t:${key}`;
  const turn = change.turn;
  const live = change.running;
  // Every row below the header hangs off the turn's own line.
  const rail: Rail = {pins: [id], live};

  titleRow(ctx, change, o);
  chipsRow(ctx, change, agents, rail, o);
  landedRows(ctx, change, rail);

  const says = !live && Boolean(turn.says);
  if (change.files.length || agents.length || turn.actions.length || says || change.landed.length) gapRow(ctx, rail);
  if (agents.length) {
    chartRows(ctx, change, agents, rail);
    gapRow(ctx, rail);
  }

  if (change.files.length) {
    fileRows(ctx, change, agents, rail);
    // Only when there is something under the files to be told apart from them.
    if (turn.actions.length || says || change.landed.length) gapRow(ctx, rail);
  }

  if (turn.actions.length) stepsRow(ctx, change, agents, rail);
  if (says) saysRows(ctx, change, rail);
  if (change.landed.length) {
    gapRow(ctx, rail);
    // A merge in this history landed ON the branch the pane is sitting on —
    // that is whose first-parent log the commits came from — not on the branch
    // that was merged in, which nothing here knows the name of.
    commitRows(ctx, change, ctx.branch || ctx.worktrees?.find(wt => wt.here)?.branch || '', rail);
  }
}

// The widest right side a past turn can have: the file count, the size cells,
// the git mark and the clock. `2 files ▄▄▄▄▄ ◆3  12:41`
const promptRoom = (cols: number, tag: Seg[]): number => roomOf(cols) - (cols < NARROW ? 19 : 25) - 1 - widthOf(tag);

// A past turn is one row: what you asked, how big the answer was, where it
// stands in git, and when. Everything else is one press away.
function pastTurn(ctx: Ctx, change: TurnChange, agents: AgentRun[], o: Block): void {
  const {cols, sel, now} = ctx;
  const key = turnKey(change);
  const id = `t:${key}`;
  const here = id === sel;
  const tight = cols < NARROW;
  const when = seg(clock(change.turn.at), theme.faint);

  let right: Seg[];
  if (change.files.length && change.measured) {
    const n = change.files.length;
    const mark =
      change.git === 'merged'
        ? [seg(glyph.check, theme.add), sp(2)]
        : change.landed.length
          ? [seg(glyph.diamond, theme.link), seg(String(change.landed.length).padEnd(2), theme.dim)]
          : [sp(3)];
    right = [
      seg(`${String(n).padStart(2)} ${n === 1 ? 'file ' : 'files'}`, theme.dim),
      ...(tight ? [] : [sp(1), ...sizeCells(change.added, change.removed)]),
      sp(1), ...mark, sp(2), when,
    ];
  } else {
    // Nothing to measure, so the row says which kind of nothing it was.
    const note = change.files.length
      ? seg('not recorded', theme.faint, {italic: true})
      : agents.length
        ? seg(plural(agents.length, 'agent'), theme.faint, {italic: true})
        : seg('no file changes', theme.faint);
    right = [note, sp(3), when];
  }

  // Every past turn cuts its prompt in the same column, whatever it has to say
  // on the right, so the stream reads as one list rather than as a ragged edge.
  // A chip in front of it is the one thing that moves that column.
  const tag = o.tag ?? [];
  ctx.out.push(
    streamRow(cols, [...tag, seg(cut(change.turn.prompt, promptRoom(cols, tag)), here ? theme.ink : theme.text)], right, {
      bg: here ? theme.surface2 : undefined,
      mark: turnMark(change.running, false, here, ctx.frame, o.colour),
      id, pick: true, hint: 'open', act: {type: 'turn', key},
    }),
  );
}

// ---------- the agents of a turn, as the chart Claude Code prints ----------

// How far in an agent sits under the turn's line: one step a level, with the
// guide of everything above it running down the left, the way the Files tree
// draws what is inside a folder. An agent the chat started needs no step at
// all: its chevron is the first thing on the row.
const agentIndent = (depth: number): Seg[] =>
  Array.from({length: Math.max(0, depth - 1)}, () => seg(`${glyph.guide}${' '.repeat(INDENT - 1)}`, theme.spine));

// "general-purpose" says nothing and the chat's own model says nothing either.
// A kind that was chosen, or a model that differs, is worth two columns.
function agentChip(agent: AgentRun, chatModel: string | undefined): Seg[] {
  if (agent.type && agent.type !== 'general-purpose' && agent.type !== 'agent') return chip(agent.type, theme.surface2, theme.dim);
  const mine = agent.model ? modelName(agent.model) : '';
  if (!mine || !chatModel || modelName(chatModel) === mine) return [];
  return chip(mine, theme.surface2, theme.dim);
}

export function agentStatus(agent: AgentRun, now: number, frame: number): Seg[] {
  const status = statusOf(agent, now);
  if (status === 'done') return [seg(glyph.check, theme.add)];
  if (status === 'running') return [seg(spinner(frame), theme.accent)];
  return [seg(glyph.dot, theme.faint)];
}

export type AgentNode = {agent: AgentRun; index: number; kids: AgentNode[]};

// Who started whom. `parentId` is exact: the parent's own transcript carries
// the call that started the child. Without it, a deeper agent hangs off
// whichever shallower agent was running when it started. `index` stays the
// place in the turn's whole list, so a folded list keeps its hues.
export function agentTree(agents: AgentRun[], shown?: (agent: AgentRun) => boolean): AgentNode[] {
  const nodes: AgentNode[] = agents.map((agent, index) => ({agent, index, kids: []})).filter(node => !shown || shown(node.agent));
  const byId = new Map(nodes.map(node => [node.agent.id, node]));
  const roots: AgentNode[] = [];
  for (const node of nodes) {
    const {agent} = node;
    let parent = agent.parentId ? byId.get(agent.parentId) : undefined;
    if (!agent.parentId && agent.depth > 1) {
      const before = nodes.filter(other => other.agent.depth < agent.depth && other.agent.startedAt <= agent.startedAt);
      parent = before.sort((a, b) => a.agent.startedAt - b.agent.startedAt).pop();
    }

    // A parent can only have started before its child, which also rules a
    // loop out.
    if (parent && parent !== node && parent.agent.startedAt <= agent.startedAt) parent.kids.push(node);
    else roots.push(node);
  }

  return roots;
}

export const agentsFlat = (nodes: AgentNode[]): AgentNode[] => nodes.flatMap(node => [node, ...agentsFlat(node.kids)]);

// How deep a tree is worth drawing: past this the indents cost more than the
// nesting tells you.
const TREE_MAX = 4;

// A folder's name in a row. Its branch says more than the folder it happens to
// be checked out into, except for the two folders you already know by name.
const folderLabel = (wt: WorktreeRun): string => cut(wt.here || wt.main ? wt.name : wt.branch || wt.name, 12);

// The folder an agent worked in, when it was not this one: its meta file names
// the worktree it was given, or its transcript's `cwd` is another folder of
// the same repository.
function agentFolder(ctx: Ctx, agent: AgentRun): WorktreeRun | undefined {
  const folder = agent.worktree?.path || agent.cwd;
  if (!folder || pathKey(folder) === pathKey(ctx.root)) return undefined;
  return ctx.worktrees?.find(wt => pathKey(wt.path) === pathKey(folder));
}

// Whether any of that folder's work has arrived where you are. The first of
// these that applies is the whole truth about it, so the row says one thing.
function factState(ctx: Ctx, wt: WorktreeRun): Seg[] {
  const agent = [...wt.agents].reverse().find(run => statusOf(run, ctx.now) === 'running');
  if (agent) return [seg(spinner(ctx.frame), theme.accent), seg(` ${modelName(agent.model)} ${glyph.sep} ${brief(ctx.now - agent.startedAt)}`, theme.text)];
  if (wt.merged) return [seg(`${glyph.check} merged${wt.mergedAt ? ` ${clock(wt.mergedAt)}` : ''}`, theme.add)];
  if (wt.removed) return [seg('removed', theme.faint)];
  // Nothing wrote its head down before the folder went, so where it got to
  // cannot be told either way.
  if (wt.gone && !wt.known) return [seg('not recorded', theme.faint, {italic: true})];
  if (wt.ahead > 0 || wt.dirty > 0) {
    // A narrow row cannot hold both how far ahead it is and where it is not,
    // and which of the two folders it is not in is the part you already know.
    if (ctx.cols < NARROW) return [seg('not merged', theme.faint, {italic: true})];
    return [
      ...(wt.ahead ? [seg(`${glyph.ahead}${wt.ahead}`, theme.dim), seg(` ${glyph.sep} `, theme.faint)] : []),
      seg(`not in ${path.basename(ctx.root)} yet`, theme.faint, {italic: true}),
    ];
  }

  return [seg('clean', theme.faint)];
}

// The chart's own head row: the count first, then how they are getting on,
// with the tokens they have spent on the right. A crowd rolls into this row.
function chartRows(ctx: Ctx, change: TurnChange, agents: AgentRun[], rail: Rail): void {
  const {cols, sel, now} = ctx;
  const key = turnKey(change);
  const rollId = `ga:${key}`;
  const rollKey = `roll:${key}`;
  const crowd = agents.length > AGENTS_SHOWN;
  const rolled = crowd && !ctx.open.folded.has(rollKey);
  const here = rollId === sel;
  const count = (status: string) => agents.filter(a => statusOf(a, now) === status).length;
  const running = count('running');
  const done = count('done');
  const stopped = count('stopped');
  const spent = agents.reduce((n, a) => n + a.tokens, 0);

  const left: Seg[] = [
    ...(crowd ? [chevron(!rolled, here), sp(1)] : running ? [seg(spinner(ctx.frame), theme.accent), sp(1)] : []),
    seg(plural(agents.length, 'agent'), theme.ink, {bold: true}),
    ...(running ? [sep(), seg(`${running} running`, theme.accent)] : []),
    ...(done ? [sep(), seg(`${done} done`, theme.dim)] : []),
    ...(stopped ? [sep(), seg(`${stopped} stopped`, theme.warn)] : []),
  ];
  // How they are getting on is the news; the word `tokens` is a label on a
  // figure that reads the same without it. So it goes before any state is cut.
  const spentSeg = (word: boolean) => seg(`${tokens(spent)}${word ? ' tokens' : ''}`, theme.dim);
  const wordy = cols >= NARROW && widthOf(left) + 2 + widthOf([spentSeg(true)]) <= roomOf(cols);
  ctx.out.push(
    streamRow(cols, left, [spentSeg(wordy)], {
      ...rail,
      ...(crowd ? {id: rollId, pick: true, bg: here ? theme.surface2 : undefined, hint: rolled ? 'unfold' : 'fold', act: {type: 'toggle', set: 'folded', key: rollKey}} : {}),
    }),
  );

  if (rolled) return;
  const pins = crowd ? [...rail.pins, rollId] : rail.pins;
  const draw = (level: AgentNode[], depth: number, under: string[]) => {
    for (const node of level) {
      chartRow(ctx, node, change, under, depth, rail.live);
      // A nested agent keeps its parent's row on screen with it.
      if (node.kids.length && depth < TREE_MAX) draw(node.kids, depth + 1, [...under, `a:${node.agent.id}`]);
    }
  };

  draw(agentTree(agents), 1, pins);
}

// One agent: the square in its own hue, the task as its name, the chip when
// there is something to say about it, and the state, time and tokens in fixed
// columns on the right.
function chartRow(ctx: Ctx, node: AgentNode, change: TurnChange, pins: string[], depth: number, live?: boolean): void {
  const {cols, sel, now} = ctx;
  const {agent, index} = node;
  const id = `a:${agent.id}`;
  const here = id === sel;
  const isOpen = ctx.open.agents.has(agent.id);
  const status = statusOf(agent, now);
  const indent = agentIndent(depth);
  // The chevron, the square and the air between them: four columns, and
  // everything that hangs under the agent starts where its task does.
  const under = [...indent, sp(INDENT2)];
  const mine = [...pins, id];
  const tight = cols < NARROW;

  ctx.out.push(
    streamRow(
      cols,
      [
        ...indent,
        chevron(isOpen, here),
        sp(1),
        seg(glyph.square, hueOf(index)),
        sp(1),
        seg(agent.task, status === 'running' ? theme.ink : theme.text, {bold: status === 'running'}),
        ...(tight ? [] : [sp(2), ...agentChip(agent, ctx.chatModel)]),
      ],
      [
        ...agentStatus(agent, now, ctx.frame),
        sp(1),
        seg(span((status === 'running' ? now : agent.endedAt) - agent.startedAt).padStart(7), theme.dim),
        ...(tight ? [] : [sp(1), seg(tokens(agent.tokens).padStart(5), theme.faint)]),
      ],
      {id, pick: true, pins, live, bg: here ? theme.surface2 : undefined, hint: isOpen ? 'close' : 'agent', act: {type: 'toggle', set: 'agents', key: agent.id}},
    ),
  );

  const row = (left: Seg[], right: Seg[] = []) => ctx.out.push(streamRow(cols, [...under, ...left], right, {pins: mine, live}));
  // While it runs, the one thing worth a row is the step it is on.
  const last = agent.steps[agent.steps.length - 1];
  if (status === 'running' && last) {
    row(
      [sp(1), seg(glyph.elbow, theme.faint), sp(2), seg(last.tool.padEnd(6), theme.dim), seg(target(ctx.root, last), theme.text)],
      // The quiet the pane judges it by, not its own last record: an agent
      // waiting on a child of its own writes nothing while the child works,
      // and branding a healthy parent `20m quiet` in warn is a false alarm.
      quietNote(agent.quiet.from, now),
    );
  }

  // A worktree is where an agent worked, never a block of the stream, so this
  // one row is the whole of it: the folder, how much is in it, and whether any
  // of that has arrived where you are.
  const wt = agentFolder(ctx, agent);
  if (wt) {
    const n = wt.files.length;
    const left = [seg('in ', theme.faint), seg(folderLabel(wt), theme.text)];
    // Once the work has been merged or the folder taken away there is nothing
    // left to count against: the point it left the parent has moved past it,
    // so the count would read `0 files` over work that is plainly there. The
    // folder's name is the whole of the left side then.
    const countable = !wt.merged && !wt.removed && !wt.gone;
    // At 40 columns the words on the right are the news, so the count gives way.
    if (!tight && countable) {
      if (status === 'running') left.push(seg(`   ${plural(n, 'file')} so far`, theme.dim));
      else left.push(seg(`   ${plural(n, 'file')} `, theme.dim), ...sizeCells(wt.lines.added, wt.lines.removed));
    }

    row(left, factState(ctx, wt));
  }

  if (!isOpen) return;
  // Opened, the folder also says how far along its way it is. It lines up
  // under the agent's square rather than its task: the labels need the two
  // columns, and a closed agent keeps the one row it always had.
  if (wt) {
    const prefix = [...indent, sp(2)];
    for (const segs of journeyRows(ctx, wt, prefix, roomOf(cols))) ctx.out.push(streamRow(cols, segs, [], {pins: mine, live}));
  }
  // What it was, what it ran on, and how much it did. At 40 columns the kind
  // is the part that says least — `general-purpose`, nearly always — so it is
  // the part that gives way.
  const facts = [...(tight ? [] : [agent.type]), modelName(agent.model), plural(agent.toolUses, 'tool use'), tokens(agent.tokens)];
  row([seg(facts.join(`  ${glyph.sep}  `), theme.faint)]);
  // The notification says how it ended; without one the quiet is only a guess,
  // so the sentence stays vaguer.
  if (status === 'stopped') {
    const why =
      agent.ended === 'killed' ? 'Stopped before it handed back.' : agent.ended === 'failed' ? 'Failed before it handed back.' : 'Went quiet without handing back.';
    row([seg(why, theme.warn)]);
  }

  if (wt) {
    // The files of that folder's own git, as text: the diff for them lives
    // over there, and nothing here could open it.
    const files: ChangedFile[] = wt.files.map(stat => ({
      rel: stat.rel, path: path.resolve(wt.path, stat.rel), status: stat.status, added: stat.added, removed: stat.removed, known: true,
    }));
    let shown = 0;
    for (const group of groupByFolder(files)) {
      if (shown >= FILES_SHOWN) break;
      row([seg(group.key, theme.dim)]);
      for (const {file, label} of group.files.slice(0, FILES_SHOWN - shown)) {
        row(
          [sp(1), seg(LETTER[file.status], LETTER_COLOUR[file.status], {bold: true}), sp(2), seg(label, theme.ink)],
          [...(tight ? [] : [...sizeCells(file.added, file.removed), sp(2)]), ...counts(file.added, file.removed)],
        );
        shown++;
      }
    }

    const rest = files.length - shown;
    if (rest > 0) row([seg(plural(rest, 'more file'), theme.faint)]);
  } else {
    for (const file of agent.wrote) {
      const rel = path.relative(ctx.root, file).split(path.sep).join('/');
      const stat = change.files.find(f => f.path === file);
      row([sp(1), ...pathSegs(rel, false)], stat?.known ? counts(stat.added, stat.removed) : []);
    }
  }

  for (const step of agent.steps.slice(-5)) {
    row([seg(step.tool.padEnd(9), theme.faint), seg(target(ctx.root, step), theme.dim)], [seg(clock(step.at), theme.faint)]);
  }

  if (agent.says && status !== 'running') {
    const room = Math.max(20, roomOf(cols) - widthOf(under));
    for (const text of wrap(agent.says.replace(/[*_`#>]/g, ''), room).slice(0, 3)) row([seg(text, theme.text)]);
  }
}

// ---------- the workspaces of the repository ----------

type Folder = {wt: WorktreeRun; colour: string; label: string};

// Every folder of the repository, each with its hue. The hues are handed out
// over the whole list, not over whatever part of it a row is drawing, so a
// folder is the same colour in the list, on a chip, on a landing and on its
// journey.
function allFolders(ctx: Ctx): Folder[] {
  let hue = 0;
  return (ctx.worktrees ?? []).map(wt => ({
    wt,
    // The pane's folder is the accent, the main checkout is quiet, and every
    // other folder gets a hue of its own.
    colour: wt.here ? theme.accent : wt.main ? theme.dim : hueOf(hue++),
    label: folderLabel(wt),
  }));
}

// The folders this view is covering: the pane's own plus wherever an agent of
// its chats is working, or every worktree of the repository.
function foldersInScope(ctx: Ctx): Folder[] {
  const all = allFolders(ctx);
  return ctx.scope === 'all' ? all : all.filter(folder => folder.wt.here || folder.wt.agents.length > 0);
}

const folderChip = (folder: Folder): Seg[] => chip(folder.label, theme.surface2, folder.colour);

const folderColour = (ctx: Ctx, wt: WorktreeRun): string =>
  allFolders(ctx).find(folder => pathKey(folder.wt.path) === pathKey(wt.path))?.colour ?? theme.text;

// What a workspace is called in a list of them. The pane's folder and the main
// checkout are known by their branch; an agent's folder is named after a hash,
// so the job the newest agent in it was given says more.
function workspaceName(wt: WorktreeRun): string {
  if (wt.here || wt.main) return wt.branch || wt.name;
  return wt.agents[wt.agents.length - 1]?.task || wt.branch || wt.name;
}

// No agent file says Claude is working in the pane's own folder: that is the
// chat's own turn, which only the caller knows about.
const wordOf = (ctx: Ctx, wt: WorktreeRun): StateWord => stateWord(wt, ctx.now, wt.here && Boolean(ctx.working));

// How long whoever is in a folder has been at it: the pane's own running turn,
// or the newest agent still running there.
function workingFor(ctx: Ctx, wt: WorktreeRun): number | null {
  if (wt.here) {
    const turn = [...ctx.changes].reverse().find(change => change.running && pathKey(change.folder) === pathKey(ctx.root));
    if (turn) return ctx.now - turn.turn.at;
  }

  const agent = [...wt.agents].reverse().find(run => statusOf(run, ctx.now) === 'running');
  return agent ? ctx.now - agent.startedAt : null;
}

// Where a folder has got to, as one sentence on the right of its row. It opens
// with who is working in it, when anybody is, because that is the first thing
// a glance down the list is for.
function workspaceState(ctx: Ctx, wt: WorktreeRun, word: StateWord): Seg[] {
  let says: Seg[];
  if (word === 'working') {
    const took = workingFor(ctx, wt);
    // The pane's folder is where everything else is going, so `not merged`
    // means nothing there: what is in it that git has not got yet does.
    if (wt.here) says = wt.dirty ? [seg(`${wt.dirty} uncommitted`, theme.dim)] : took === null ? [] : [seg(brief(took), theme.dim)];
    else says = [seg(`${took === null ? '' : `${brief(took)} ${glyph.sep} `}not merged`, theme.dim)];
  } else if (word === 'dirty') {
    says = [seg(`${wt.dirty} uncommitted`, theme.dim)];
  } else if (word === 'ahead') {
    says = [seg(`${glyph.ahead}${wt.ahead} ${glyph.sep} not merged`, theme.dim)];
  } else if (word === 'merged') {
    says = [seg(`${glyph.check} merged${wt.mergedAt ? ` ${clock(wt.mergedAt)}` : ''}`, theme.add)];
  } else if (word === 'not recorded') {
    // Nothing wrote its head down before the folder went, so where it got to
    // cannot be told either way.
    says = [seg('not recorded', theme.faint, {italic: true})];
  } else {
    says = [seg(word, theme.faint)];
  }

  if (word !== 'working') return says;
  const who = wt.here && ctx.working ? 'you' : 'agent';
  return [seg(who, theme.text), ...(says.length ? [seg(` ${glyph.sep} `, theme.faint), ...says] : [])];
}

// Every folder of the repository, one row each, and a press on one scopes the
// stream to it. The pane's folder heads the list and the main checkout ends
// it; between them the order is git's own, so a row never moves because
// somebody started working in it. The picked one carries the accent bar in
// column 1, which is a different thing from the cursor's own row.
function workspaceRows(ctx: Ctx): void {
  const {cols, sel, now, frame} = ctx;
  const all = allFolders(ctx);
  const rows = [...all.filter(f => f.wt.here), ...all.filter(f => !f.wt.here && !f.wt.main), ...all.filter(f => f.wt.main && !f.wt.here)];
  const words = rows.map(folder => wordOf(ctx, folder.wt));
  const active = words.filter(word => word === 'working').length;
  ctx.out.push(
    pageRow(cols, [seg('WORKSPACES', theme.faint, {bold: true})], [seg(`${active} active`, active ? theme.accent : theme.dim), seg(` of ${rows.length}`, theme.dim)]),
  );

  rows.forEach((folder, i) => {
    const {wt} = folder;
    const word = words[i]!;
    const id = `ws:${wt.path}`;
    const here = id === sel;
    const picked = ctx.focus ? pathKey(ctx.focus) === pathKey(wt.path) : wt.here;
    const quiet = word === 'merged' || word === 'clean' || word === 'removed' || word === 'not recorded';
    const mark = word === 'working' ? seg(spinner(frame), theme.accent) : quiet ? seg(glyph.ring, theme.faint) : seg(glyph.dot, folder.colour);
    ctx.out.push(
      pageRow(
        cols,
        [
          picked ? seg(glyph.bar, theme.accent) : sp(1),
          sp(1),
          mark,
          sp(1),
          seg(cut(workspaceName(wt), Math.max(8, cols - 40)), picked ? theme.ink : folder.colour, {bold: picked}),
        ],
        workspaceState(ctx, wt, word),
        {id, pick: true, bg: here ? theme.surface2 : undefined, hint: 'open', act: {type: 'focus', path: wt.here ? null : wt.path}},
      ),
    );
  });

  ctx.out.push(blankRow(cols));
}

// ---------- a folder's journey ----------

// The four stops of a folder's way from started to removed, as a line of
// nodes and, under it, what each stop was. A stop it has reached is lit in the
// folder's hue, and so is the line between two lit stops. The labels are as
// wide as the gaps, so each one sits under its own node. Under 56 columns, or
// wherever the labels would not fit, the nodes say it alone.
function journeyRows(ctx: Ctx, wt: WorktreeRun, prefix: Seg[], room: number): Seg[][] {
  const {stage, labels} = journeyOf(wt, ctx.now);
  const hue = folderColour(ctx, wt);
  const lit = (i: number) => i < stage;
  const nodes: Seg[] = [...prefix];
  for (let i = 0; i < 4; i++) {
    if (i) nodes.push(lit(i - 1) && lit(i) ? seg(glyph.heavy.repeat(JOURNEY_GAP), hue) : seg(glyph.rule.repeat(JOURNEY_GAP), theme.spine));
    nodes.push(lit(i) ? seg(glyph.dot, hue) : seg(glyph.ring, theme.faint));
  }

  // The lit node already says it merged, and `✓ merged 13:20` is one column
  // too wide to leave a space before the label after it.
  const check = `${glyph.check} `;
  const names: Seg[] = [...prefix];
  labels.forEach((label, i) => {
    const text = cut(label.startsWith(check) ? label.slice(check.length) : label, JOURNEY_GAP);
    const current = i === stage - 1;
    names.push(seg(i < labels.length - 1 ? padTo(text, JOURNEY_GAP + 1) : text, current ? theme.ink : i < stage ? theme.dim : theme.faint, {bold: current}));
  });

  // A line cut short would read as a folder that stopped half way, so where
  // even the nodes do not fit there is no journey at all.
  if (widthOf(nodes) > room) return [];
  return ctx.cols >= NARROW && widthOf(names) <= room ? [nodes, names] : [nodes];
}

// What a folder's own git says about the one it is going to, in a sentence.
function whereItIs(ctx: Ctx, wt: WorktreeRun): string {
  const mine = ctx.worktrees?.find(other => other.here);
  // An agent's folder is measured against the pane's head, which is a sha;
  // the branch that head is on is the name anybody would use for it.
  const into = mine && wt.parent === mine.head ? ctx.branch || mine.branch || mine.name : wt.parent || ctx.branch || 'the branch';
  if (wt.merged) return `everything it did is in ${into} now`;
  if (wt.ahead > 0) return `${glyph.ahead}${wt.ahead} ahead of ${into} ${glyph.sep} not there until merged`;
  if (wt.dirty > 0) return `${plural(wt.dirty, 'file')} edited, nothing committed ${glyph.sep} nothing there yet`;
  return '';
}

// The head of a stream scoped to one folder: its name, its journey and where
// its work stands. With the panel on screen the name is already there, lit, so
// the stream leaves it out.
function focusHead(ctx: Ctx, at: string): void {
  const {cols} = ctx;
  const folder = allFolders(ctx).find(f => pathKey(f.wt.path) === pathKey(at));
  if ((ctx.panel ?? 'off') === 'off') {
    ctx.out.push(pageRow(cols, [sp(1), seg('in ', theme.faint), seg(folder?.wt.name ?? path.basename(at), theme.ink, {bold: true})]));
  }

  if (folder) {
    for (const segs of journeyRows(ctx, folder.wt, [sp(1)], cols - 3)) ctx.out.push(pageRow(cols, segs));
    const where = whereItIs(ctx, folder.wt);
    if (where) ctx.out.push(pageRow(cols, [sp(1), seg(where, theme.dim)]));
  }

  ctx.out.push(blankRow(cols));
}

// ---------- a branch that landed here ----------

// A merge is the moment another folder's work arrives in this one, and until
// now it arrived with no row of its own: forty files turned up under whichever
// turn happened to be next. So it is a row, among the day's turns at the time
// it was made, that opens to show what it brought.
function landingRow(ctx: Ctx, landing: Landing): void {
  const {cols, sel} = ctx;
  const {wt} = landing;
  const id = `l:${wt.path}`;
  const here = id === sel;
  const isOpen = ctx.open.landings?.has(wt.path) ?? false;
  const tight = cols < NARROW;
  const n = landing.files.length;
  const mark = here ? chevron(isOpen, true) : {...chevron(isOpen, false), color: theme.add};
  // The same columns as a past turn's right side, so the clocks line up.
  const size = n
    ? [seg(`${String(n).padStart(2)} ${n === 1 ? 'file ' : 'files'}`, theme.dim), ...(tight ? [] : [sp(1), ...sizeCells(landing.added, landing.removed)])]
    : [seg('not recorded', theme.faint, {italic: true})];
  ctx.out.push(
    streamRow(
      cols,
      [seg(`${glyph.check} `, theme.add), seg('merged', theme.dim), sp(2), seg(workspaceName(wt), folderColour(ctx, wt), {bold: true})],
      // Six columns: a past turn's git mark and the air after it.
      [...size, sp(6), seg(clock(landing.at), theme.dim)],
      {mark, id, pick: true, bg: here ? theme.surface2 : undefined, hint: isOpen ? 'close' : 'open', act: {type: 'toggle', set: 'landings', key: wt.path}},
    ),
  );
  if (!isOpen) return;

  // Its rows hang on a line in the colour of what arrived, not the grey of a
  // turn: this is the one block in the stream that is somebody else's work.
  const line = seg(glyph.spine, theme.add);
  const row = (left: Seg[], right: Seg[] = [], more: Parameters<typeof streamRow>[3] = {}) =>
    ctx.out.push(streamRow(cols, left, right, {mark: line, pins: [id], ...more}));

  const facts = [
    ...(wt.ahead > 0 ? [plural(wt.ahead, 'commit')] : []),
    ...(wt.agents.length ? [brief(agentsSpan(wt.agents, ctx.now))] : []),
    wt.gone ? 'folder removed' : 'folder kept',
  ];
  row([seg('from ', theme.faint), seg(wt.name, theme.text), ...facts.flatMap(fact => [sep(), seg(fact, theme.dim)])]);

  // The files are text: their diff lives in that folder's git, and nothing
  // here could open it.
  if (n) {
    row([]);
    const moreKey = `l:${wt.path}`;
    const all = ctx.open.more.has(moreKey);
    const limit = all || n <= LANDING_FILES ? n : LANDING_FILES;
    const files: ChangedFile[] = landing.files.map(stat => ({
      rel: stat.rel, path: path.resolve(wt.path, stat.rel), status: stat.status, added: stat.added, removed: stat.removed, known: true,
    }));
    let shown = 0;
    for (const group of groupByFolder(files)) {
      if (shown >= limit) break;
      row([seg(group.key, theme.dim)]);
      for (const {file, label} of group.files.slice(0, limit - shown)) {
        row(
          [sp(1), seg(LETTER[file.status], LETTER_COLOUR[file.status], {bold: true}), sp(2), seg(label, theme.ink)],
          [...(tight ? [] : [...sizeCells(file.added, file.removed), sp(2)]), ...counts(file.added, file.removed)],
        );
        shown++;
      }
    }

    if (n > LANDING_FILES) {
      const moreId = `lm:${wt.path}`;
      const on = moreId === sel;
      row([seg(all ? glyph.open : glyph.closed, theme.dim), sp(1), seg(all ? 'fewer files' : plural(n - shown, 'more file'), on ? theme.accent : theme.dim)], [], {
        id: moreId, pick: true, bg: on ? theme.surface2 : undefined, hint: all ? 'close' : 'all files', act: {type: 'toggle', set: 'more', key: moreKey},
      });
    }
  }

  // The merge commit itself would close the block, but a landing does not
  // carry it yet: `mergedAt` is all the worktree kept of it.
  ctx.out.push(blankRow(cols));
}

// From the first of a folder's agents starting to the last one stopping.
function agentsSpan(agents: AgentRun[], now: number): number {
  const from = Math.min(...agents.map(agent => agent.startedAt));
  const to = Math.max(...agents.map(agent => (statusOf(agent, now) === 'running' ? now : agent.endedAt)));
  return Math.max(0, to - from);
}

const startOfDay = (at: number): number => new Date(at).setHours(0, 0, 0, 0);

// Which run of turns each landing is drawn in: the newest run of its day that
// had started by the time it landed, or that day's oldest when it landed
// before any of them. A landing on a day the stream does not show is left out.
function placeLandings(days: DayGroup[], landings: Landing[]): Map<DayGroup, Landing[]> {
  const out = new Map<DayGroup, Landing[]>();
  for (const landing of landings) {
    const runs = days.filter(run => run.day === startOfDay(landing.at));
    if (!runs.length) continue;
    const run = runs.find(r => r.turns[0]!.turn.at <= landing.at) ?? runs[runs.length - 1]!;
    out.set(run, [...(out.get(run) ?? []), landing]);
  }

  return out;
}

// ---------- the stream ----------

function byTurn(ctx: Ctx): void {
  // A worktree is where an agent worked, never a block of the stream. The
  // list of them heads it whenever there is no panel to carry it, and the
  // stream under it is the same stream in either scope.
  const folders = ctx.scope === 'all' ? foldersInScope(ctx) : [];
  if ((ctx.panel ?? 'off') === 'off' && (ctx.worktrees?.length ?? 0) > 1) workspaceRows(ctx);
  // Picked, one folder is the whole stream: every turn is from it, so none of
  // them needs its chip.
  if (ctx.focus) focusHead(ctx, ctx.focus);
  ctx.lead = ctx.out.length;

  stream(ctx, ctx.focus ? [] : folders);
}

// A day heads the stream with its own skyline, and every turn of that day
// follows, newest first. A turn typed in another folder — which only the wider
// scope has any of — carries that folder's chip and its hue. A branch that
// landed here that day sits among the turns at the time it landed.
function stream(ctx: Ctx, folders: Folder[]): void {
  const {cols, changes, now, open} = ctx;
  const byAgent = turnAgents(changes, ctx.agents);
  // The turn that starts open is the one you are in, which is the newest of
  // this folder's own. Widening the scope must not close what you are watching
  // to open a stranger's, and follow mode is aimed at the same turn.
  const newest = [...changes].reverse().find(change => pathKey(change.folder) === pathKey(ctx.root)) ?? changes[changes.length - 1];
  // Flipped by hand, or the newest turn, but not both.
  const isOpen = (change: TurnChange) => open.turns.has(turnKey(change)) !== (change === newest);
  const days = daysOf(changes, now);
  const folderOf = (change: TurnChange): Folder | undefined =>
    folders.find(folder => !folder.wt.here && pathKey(folder.wt.path) === pathKey(change.folder));
  // Landings are the pane's own folder's news, so a stream scoped to another
  // folder has none.
  const landed = placeLandings(days, ctx.focus ? [] : ctx.landings ?? []);

  days.forEach((day, i) => {
    if (i === 0) {
      const whole = wholeDay(days, day.day, now);
      dayHead(ctx, dayLabel(day.day, now), day.chat, [
        seg(plural(whole.turns.length, 'turn'), theme.dim),
        ...(whole.span >= 1000 ? [sep(), seg(span(whole.span), theme.dim)] : []),
      ]);
      skylineRow(ctx, whole.turns, isOpen, whole.added, whole.removed);
      ctx.out.push(blankRow(cols));
    } else {
      // A new day, or the same day in another chat: either way the stream
      // breaks and the rule says which.
      const was = days[i - 1]!;
      ctx.out.push(dividerRow(cols, was.day === day.day ? day.chat : dayLabel(day.day, now)));
    }

    const pending = [...(landed.get(day) ?? [])];
    for (const change of [...day.turns].reverse()) {
      while (pending.length && pending[0]!.at >= change.turn.at) landingRow(ctx, pending.shift()!);
      const agents = byAgent.get(turnKey(change)) ?? [];
      const folder = folderOf(change);
      const block: Block = folder ? {colour: folder.colour, tag: [...folderChip(folder), sp(1)]} : {};
      if (!isOpen(change)) {
        pastTurn(ctx, change, agents, block);
        continue;
      }

      openTurn(ctx, change, agents, block);
      // One blank row after an open turn, below it only.
      ctx.out.push(blankRow(cols));
    }

    for (const landing of pending) landingRow(ctx, landing);
  });
}

// ---------- the other two groupings, on the same columns ----------

function byFile(ctx: Ctx): void {
  const {cols, sel, open} = ctx;
  const tight = cols < NARROW;
  for (const history of ctx.histories) {
    const id = `h:${history.rel}`;
    const here = id === sel;
    const isOpen = open.hists.has(history.rel);
    const n = history.touches.length;
    ctx.out.push(
      streamRow(
        cols,
        [sp(1), seg(LETTER[history.status], LETTER_COLOUR[history.status], {bold: true}), sp(2), ...pathSegs(history.rel, true)],
        [
          seg(plural(n, 'turn'), theme.faint),
          sp(2),
          ...(tight ? [] : [...(history.measured ? sizeCells(history.added, history.removed) : [sp(SIZE_CELLS)]), sp(2)]),
          ...(history.measured ? counts(history.added, history.removed) : [seg('not recorded', theme.faint, {italic: true})]),
        ],
        {mark: chevron(isOpen, here), id, pick: true, bg: here ? theme.surface2 : undefined, hint: isOpen ? 'close' : 'open', act: {type: 'toggle', set: 'hists', key: history.rel}},
      ),
    );
    if (!isOpen) continue;
    // Every turn that touched it, on the file's own line.
    for (const touch of [...history.touches].reverse()) {
      fileRow(
        ctx,
        fileKey(turnKey(touch.change), history.rel),
        history.rel,
        history.status === 'deleted' ? null : history.path,
        [seg(clock(touch.change.turn.at), theme.dim), sp(2), seg(touch.change.turn.prompt, theme.text)],
        touch.known
          ? [...(tight ? [] : [...sizeCells(touch.added, touch.removed), sp(2)]), ...counts(touch.added, touch.removed)]
          : [seg('not recorded', theme.faint, {italic: true})],
        [id],
        {},
      );
    }

    ctx.out.push(blankRow(cols));
  }
}

function flat(ctx: Ctx): void {
  const {cols, sel, open} = ctx;
  const tight = cols < NARROW;
  if (!ctx.flat || ctx.flat.length === 0) return;
  for (const file of ctx.flat) {
    const key = fileKey('git', file.rel);
    const here = `f:${key}` === sel;
    ctx.out.push(
      streamRow(
        cols,
        [
          sp(1),
          seg(LETTER[file.status], LETTER_COLOUR[file.status], {bold: true}),
          sp(2),
          ...pathSegs(file.rel, true),
          ...(file.status === 'renamed' && file.fromRel ? [seg(`  from ${file.fromRel}`, theme.faint)] : []),
          ...(open.files.has(key) && ctx.diffs.get(key) ? [seg(`   ${plural(ctx.diffs.get(key)!.reduce((n, g) => n + (g.file?.hunks.length ?? 0), 0), 'hunk')}`, theme.dim)] : []),
        ],
        file.binary
          ? [seg('binary', theme.faint)]
          : [...(tight ? [] : [...sizeCells(file.added, file.removed), sp(2)]), ...counts(file.added, file.removed)],
        {
          mark: chevron(open.files.has(key), here),
          bg: here ? theme.surface2 : undefined,
          id: `f:${key}`, pick: true, hint: open.files.has(key) ? 'close diff' : 'diff', act: {type: 'file', key},
        },
      ),
    );
    if (!open.files.has(key)) continue;
    const groups = ctx.diffs.get(key);
    if (!groups) {
      ctx.out.push(streamRow(cols, [seg('Reading the diff…', theme.faint)], [], {pins: [`f:${key}`]}));
      continue;
    }

    const keyed = groups.map(group => ({...group, key: `${key}#${group.key}`}));
    const rows = viewRows(keyed, ctx.folded, ctx.opened, ctx.hideSpace);
    ctx.out.push(
      ...diffLines(rows, keyed, {
        cols, fileKey: key, path: file.status === 'deleted' ? null : file.path, sel, pins: [`f:${key}`], wide: true,
      }),
    );
  }
}

export function changesLines(input: ChangesInput): Line[] {
  const ctx: Ctx = {...input, out: []};
  if (input.group === 'turn') byTurn(ctx);
  else if (input.group === 'file') byFile(ctx);
  else flat(ctx);

  // An empty view has to say what to do next, in one sentence.
  if (ctx.out.length === (ctx.lead ?? 0)) {
    const message =
      // Another folder's agents are not turns of its own: a chat typed there is.
      input.focus && input.group === 'turn'
        ? 'No chat was typed in this folder, so it has no turns of its own. What its agents did is under the turn that started them.'
        : input.group === 'flat'
        ? input.flat === null
          ? 'This folder is not a git repo, so there is no last commit to compare with. "By turn" still works.'
          : 'Nothing has changed since the last commit. Every turn is still there under "By turn".'
        : 'Nothing changed in these turns. Press v for everything since the last commit.';
    for (const text of wrap(message, input.cols - 4)) ctx.out.push(pageRow(input.cols, [seg(text, theme.dim)]));
  }

  return ctx.out;
}
