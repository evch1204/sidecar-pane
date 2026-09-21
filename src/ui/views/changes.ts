import path from 'node:path';
import {statusOf, type AgentRun} from '../../core/agents';
import type {DiffLine, FileDiff, FileStatus} from '../../core/diff';
import {modelName} from '../../core/usage';
import type {ChangedFile, FileHistory, TurnChange} from '../../core/turns';
import type {WorktreeRun} from '../../core/worktrees';
import {
  blankRow, chevron, counts, INDENT, INDENT2, pageRow, RIGHT_PAD, seg, sp, span, spineRow, tokens, widthOf,
  type Group, type Line, type Seg,
} from '../cells';
import {diffLines, viewRows, type DiffGroup} from '../diffrows';
import {agentColours, glyph, theme} from '../theme';
import {wrap} from '../util';

// The Changes view is one stream. A turn is a header row and a left line under
// it; what it changed is a row on that line; a diff opens in a well under its
// own row. Nothing is shown "down there", and nothing is a fill.

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
};

const FILES_SHOWN = 8;
// More agents than this in one turn and the Changes view rolls them into one
// row. A file row carries this many agent labels before it counts the rest.
const AGENTS_SHOWN = 3;
const TAGS_SHOWN = 2;
const STEPS_SHOWN = 40;
const SAYS_SHOWN = 2;
const DAY = 86_400_000;

export const turnKey = (change: TurnChange): string => `${change.chatId}:${change.turn.id}`;
export const fileKey = (scope: string, rel: string): string => `${scope}|${rel}`;
export const spinner = (frame: number): string => glyph.spinner[frame % glyph.spinner.length]!;

// The one separator between facts on a row.
const sep = (): Seg => seg(`  ${glyph.sep}  `, theme.faint);

export function dayLabel(at: number, now: number): string {
  const startOf = (ms: number) => new Date(new Date(ms).toDateString()).getTime();
  const days = Math.round((startOf(now) - startOf(at)) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return new Date(at).toLocaleDateString(undefined, {weekday: 'long'}).toLowerCase();
  return new Date(at).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
}

export function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit', hour12: false});
}

const VERB: Record<FileStatus, string> = {added: 'Created', modified: 'Edited', deleted: 'Deleted', renamed: 'Renamed'};

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

export const agentLabel = (index: number): string => `A${index + 1}`;
export const agentColour = (index: number): string => agentColours[index % agentColours.length]!;

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

type Ctx = ChangesInput & {out: Line[]};

// Where a row sits on the left line. A nested row hangs off the line of the
// block above it; a top level row carries its own mark in the line's column.
type Where = {nested: boolean; live?: boolean};

// One openable file row, and under it the diff when it is open.
function fileRow(ctx: Ctx, key: string, rel: string, abs: string | null, left: Seg[], right: Seg[], pins: string[], where: Where): void {
  const {cols, sel, open} = ctx;
  const id = `f:${key}`;
  const here = id === sel;
  const isOpen = open.files.has(key);
  const mark = chevron(isOpen, here);
  const live = where.live;
  ctx.out.push(
    spineRow(cols, where.nested ? [mark, sp(1), ...left] : left, right, {
      bg: here ? theme.surface2 : undefined,
      id, pick: true, pins, live, act: {type: 'file', key},
      ...(where.nested ? {} : {mark}),
    }),
  );
  if (!isOpen) return;

  const groups = ctx.diffs.get(key);
  if (!groups) {
    ctx.out.push(spineRow(cols, [sp(INDENT), seg('Reading the diff…', theme.faint)], [], {pins: [...pins, id], live}));
    return;
  }

  const keyed = groups.map(g => ({...g, key: `${key}#${g.key}`}));
  const rows = viewRows(keyed, ctx.folded, ctx.opened, ctx.hideSpace);
  ctx.out.push(...diffLines(rows, keyed, {cols, fileKey: key, path: abs, sel, pins: [...pins, id], live}));
}

function changedFileRow(ctx: Ctx, change: TurnChange, file: ChangedFile, pins: string[], tags: Seg[]): void {
  // Per file, not per turn: a turn filled in from commits can hold both a file
  // git counted and a file only the transcript named.
  const right = file.known ? counts(file.added, file.removed) : [seg('not recorded', theme.faint, {italic: true})];
  fileRow(
    ctx,
    fileKey(turnKey(change), file.rel),
    file.rel,
    file.status === 'deleted' ? null : file.path,
    [seg((file.known ? VERB[file.status] : 'Touched').padEnd(9), theme.dim), ...pathSegs(file.rel, true), ...tags],
    right,
    pins,
    {nested: true, live: change.running},
  );
}

// `counted` is false when the turn has its own row for the agents: the count
// belongs there and saying it twice reads as two different facts.
function meta(change: TurnChange, agents: AgentRun[], now: number, counted = true): Seg[] {
  const out: Seg[] = [];
  const dot = () => (out.length ? [sep()] : []);
  if (change.running) out.push(seg('running', theme.accent));
  const n = change.files.length;
  if (n) {
    out.push(...dot(), seg(`${n} file${n === 1 ? '' : 's'}`, theme.dim));
    if (change.measured) {
      if (change.added) out.push(seg(`  +${change.added}`, theme.add));
      if (change.removed) out.push(seg(` ${glyph.minus}${change.removed}`, theme.del));
    } else {
      out.push(seg('  not recorded', theme.faint, {italic: true}));
    }
  } else if (!change.running) {
    out.push(...dot(), seg('no file changes', theme.faint));
  }

  // Where the counts came from, when it was not this pane watching. The lines
  // are git's own, only the turn they belong to is matched by time, so the row
  // says so quietly rather than as a warning.
  if (change.via === 'commits' && change.commits) {
    out.push(...dot(), seg(change.commits === 1 ? `from commit ${(change.to ?? '').slice(0, 7)}` : `from ${change.commits} commits`, theme.dim));
  }

  if (agents.length && counted) out.push(...dot(), seg(`${agents.length} agent${agents.length === 1 ? '' : 's'}`, theme.dim));
  const took = (change.running ? now : change.turn.endedAt) - change.turn.at;
  if (took >= 1000) out.push(...dot(), seg(span(took), theme.dim));
  return out;
}

// One header for a turn, open or closed: the same row, the same column, the
// clock on the right of its first row. Opening a turn adds nothing above it.
function turnHead(ctx: Ctx, change: TurnChange, isOpen: boolean): void {
  const {cols, sel} = ctx;
  const key = turnKey(change);
  const id = `t:${key}`;
  const here = id === sel;
  const bg = here ? theme.surface2 : undefined;
  const act = {type: 'turn', key} as const;
  const live = change.running;
  const mark = live ? seg(spinner(ctx.frame), theme.accent) : chevron(isOpen, here);
  const when = [seg(clock(change.turn.at), theme.dim)];

  // Your own words are the title: they are the reason the files moved.
  if (!isOpen) {
    ctx.out.push(spineRow(cols, [seg(change.turn.prompt, here ? theme.ink : theme.text)], when, {bg, mark, id, pick: true, act}));
    return;
  }

  // A running turn keeps the prompt to two rows: the terminal beside this pane
  // has the rest of it anyway.
  const lines = wrap(change.turn.prompt, cols - 13);
  const shown = lines.slice(0, live ? 2 : 3);
  shown.forEach((text, i) => {
    const last = i === shown.length - 1 && lines.length > shown.length;
    ctx.out.push(
      spineRow(cols, [seg(text + (last ? ` ${glyph.ellipsis}` : ''), theme.ink, {bold: true})], i === 0 ? when : [], {
        bg, act, live, ...(i === 0 ? {mark, id, pick: true} : {}),
      }),
    );
  });
}

function closedTurn(ctx: Ctx, change: TurnChange, agents: AgentRun[]): void {
  turnHead(ctx, change, false);
  const id = `t:${turnKey(change)}`;
  const bg = id === ctx.sel ? theme.surface2 : undefined;
  // No line under a closed turn: its meta row is simply indented to the
  // column the content starts at.
  ctx.out.push(spineRow(ctx.cols, meta(change, agents, ctx.now), [], {bg, mark: sp(1), act: {type: 'turn', key: turnKey(change)}}));
}

function openTurn(ctx: Ctx, change: TurnChange, agents: AgentRun[]): void {
  const {cols, sel, open, now} = ctx;
  const key = turnKey(change);
  const id = `t:${key}`;
  const turn = change.turn;
  const live = change.running;
  // Every row below the header hangs off the turn's own line.
  const rail = {pins: [id], live};
  const pins = rail.pins;

  turnHead(ctx, change, true);
  ctx.out.push(spineRow(cols, meta(change, agents, now, agents.length <= AGENTS_SHOWN), [], rail));

  // What Claude said about it. Only once the turn is over: while it runs, the
  // conversation is on screen right next to this pane.
  if (!live && (turn.says || turn.firstReplyAt)) {
    ctx.out.push(spineRow(cols, [], [], rail));
    const thought = turn.firstReplyAt - turn.at;
    // The mark column belongs to controls, so the thought glyph sits inside.
    if (thought >= 1000) ctx.out.push(spineRow(cols, [sp(INDENT), seg(glyph.thought, theme.faint), seg(` Thought for ${span(thought)}`, theme.dim)], [], rail));
    if (turn.says) {
      const saysId = `s:${key}`;
      const here = saysId === sel;
      const all = open.says.has(key);
      const text = wrap(turn.says.replace(/[*_`#>]/g, ''), cols - 9);
      const some = all ? text : text.slice(0, SAYS_SHOWN);
      const expands = text.length > SAYS_SHOWN;
      some.forEach((line, i) => {
        const cut = !all && i === some.length - 1 && text.length > some.length;
        // Leave room for the word rather than letting it be cut off.
        const shownText = cut ? [...line].slice(0, cols - 14).join('').trimEnd() + glyph.ellipsis : line;
        const tail = expands && i === some.length - 1 ? [sp(1), seg(all ? 'less' : 'more', here ? theme.accent : theme.dim)] : [];
        ctx.out.push(
          spineRow(cols, [i === 0 && expands ? chevron(all, here) : sp(1), sp(1), seg(shownText, theme.text), ...tail], [], {
            ...rail,
            bg: here ? theme.surface2 : undefined,
            act: {type: 'toggle', set: 'says', key},
            ...(i === 0 ? {id: saysId, pick: expands} : {}),
          }),
        );
      });
    }
  }

  if (change.files.length || agents.length || turn.actions.length) ctx.out.push(spineRow(cols, [], [], rail));

  // Which agents wrote which file, so an overlap is visible on the row itself.
  const writers = new Map<string, number[]>();
  agents.forEach((agent, i) => {
    for (const file of agent.wrote) writers.set(file, [...(writers.get(file) ?? []), i]);
  });

  const all = open.more.has(key);
  for (const file of all ? change.files : change.files.slice(0, FILES_SHOWN)) {
    const by = writers.get(file.path) ?? [];
    // Two labels is as much as a file row can carry; the rest is a count.
    const tags: Seg[] = by.slice(0, TAGS_SHOWN).flatMap(i => [sp(1), seg(agentLabel(i), agentColour(i), {bold: true})]);
    if (by.length > TAGS_SHOWN) tags.push(sp(1), seg(`+${by.length - TAGS_SHOWN}`, theme.faint));
    if (by.length > 1) tags.push(sp(1), seg(glyph.warn, theme.warn));
    changedFileRow(ctx, change, file, pins, tags.length ? [sp(1), ...tags] : []);
  }

  if (!all && change.files.length > FILES_SHOWN) {
    const moreId = `m:${key}`;
    ctx.out.push(
      spineRow(cols, [sp(INDENT), seg(`${change.files.length - FILES_SHOWN} more files`, moreId === sel ? theme.accent : theme.dim)], [], {
        ...rail, id: moreId, pick: true, bg: moreId === sel ? theme.surface2 : undefined, act: {type: 'toggle', set: 'more', key},
      }),
    );
  }

  // Subagents as a tree under the turn. A handful is worth listing here; a
  // crowd folds into one row, because the whole story is the Agents view's.
  if (agents.length) {
    const rollId = `ga:${key}`;
    const rollKey = `roll:${key}`;
    const crowd = agents.length > AGENTS_SHOWN;
    const rolled = crowd && !open.folded.has(rollKey);
    const hereRoll = rollId === sel;
    if (crowd) {
      ctx.out.push(
        spineRow(cols, [chevron(!rolled, hereRoll), sp(1), ...agentSummary(agents, now)], [], {
          ...rail, id: rollId, pick: true, bg: hereRoll ? theme.surface2 : undefined, act: {type: 'toggle', set: 'folded', key: rollKey},
        }),
      );
    }

    if (!rolled) agentRows(ctx, agentTree(agents), change, crowd ? [...pins, rollId] : pins, turn.actions.length > 0);
  }

  // Every tool call, folded into one row. The list is there when you want it.
  if (turn.actions.length) {
    const stepsId = `w:${key}`;
    const here = stepsId === sel;
    const isOpen = open.steps.has(key);
    const tally = new Map<string, number>();
    for (const action of turn.actions) tally.set(action.tool, (tally.get(action.tool) ?? 0) + 1);
    const summary = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([tool, n]) => `${tool} ${n}`).join('  ');
    const last = turn.actions[turn.actions.length - 1]!;
    const count = [seg(`${turn.actions.length} steps`, live ? theme.faint : theme.dim)];
    const more = {...rail, id: stepsId, pick: true, bg: here ? theme.surface2 : undefined, act: {type: 'toggle', set: 'steps', key} as const};
    ctx.out.push(
      live
        ? spineRow(cols, [seg(spinner(ctx.frame), theme.accent), sp(1), seg(last.tool.padEnd(9), theme.accent), seg(last.why || path.basename(last.file ?? ''), theme.text)], count, more)
        : spineRow(cols, [chevron(isOpen, here), sp(1), seg('Steps'.padEnd(9), theme.dim), seg(summary, theme.faint)], count, more),
    );
    if (isOpen) {
      const inner = {pins: [...pins, stepsId], live};
      const from = Math.max(0, turn.actions.length - STEPS_SHOWN);
      if (from > 0) ctx.out.push(spineRow(cols, [sp(INDENT2), seg(`${from} earlier steps`, theme.faint)], [], inner));
      for (const action of turn.actions.slice(from)) {
        const label = action.why || (action.file ? path.basename(action.file) : action.detail);
        ctx.out.push(
          spineRow(cols, [sp(INDENT2), seg(action.tool.padEnd(9), action.wrote ? theme.text : theme.faint), seg(label, action.wrote ? theme.text : theme.dim)], [seg(clock(action.at), theme.faint)], inner),
        );
      }
    }
  }
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
// place in the turn's whole list, so a folded list keeps its labels.
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

// `4 agents  ·  3 running  ·  1 done  ·  276k tokens`
export function agentSummary(agents: AgentRun[], now: number, unit = false): Seg[] {
  const count = (status: string) => agents.filter(a => statusOf(a, now) === status).length;
  const spent = agents.reduce((n, a) => n + a.tokens, 0);
  const out: Seg[] = [seg(`${agents.length} agent${agents.length === 1 ? '' : 's'}`, theme.dim)];
  const running = count('running');
  const done = count('done');
  const stopped = count('stopped');
  if (running) out.push(sep(), seg(`${running} running`, theme.accent));
  if (done) out.push(sep(), seg(`${done} done`, theme.dim));
  if (stopped) out.push(sep(), seg(`${stopped} stopped`, theme.warn));
  out.push(sep(), seg(`${tokens(spent)}${unit ? ' tokens' : ''}`, theme.dim));
  return out;
}

const guide = (on: boolean): Seg => (on ? seg(glyph.guide, theme.spine) : sp(1));

// Where a row sits in the tree. `stack[i]` is true when the line at level i
// carries on below this row; the row's own level is the last one. Level 0 sits
// in the left line's column and every level after it three columns further in.
// A branch row ends in `├─`; the rows hanging under it end in four spaces, so
// their text starts under the task and not under the status glyph.
export function agentBranch(stack: boolean[]): {mark: Seg; lead: Seg[]} {
  const depth = stack.length - 1;
  const branch = seg(stack[depth] ? glyph.branch : glyph.branchLast, theme.spine);
  if (depth === 0) return {mark: branch, lead: []};
  return {mark: guide(stack[0] ?? false), lead: [sp(1), ...stack.slice(1, depth).flatMap(on => [guide(on), sp(2)]), branch, sp(1)]};
}

function agentUnder(stack: boolean[], gap: number): {mark: Seg; lead: Seg[]} {
  const rails = stack.slice(1);
  return {mark: guide(stack[0] ?? false), lead: [sp(1), ...rails.flatMap((on, i) => [guide(on), sp(i === rails.length - 1 ? gap : INDENT)])]};
}

type AgentCtx = Pick<Ctx, 'cols' | 'sel' | 'now' | 'frame' | 'root' | 'out'> & {open: Pick<Open, 'agents'>};

// An agent as one row of the tree: status first, then the label, the kind it
// was asked for and the job, with elapsed time and tokens in fixed columns on
// the right. A running one gets one dim row with the step it is on; an open
// one gets its detail under that.
export function agentRow(ctx: AgentCtx, node: AgentNode, change: TurnChange | null, pins: string[], stack: boolean[], pad: number): void {
  const {cols, sel, now} = ctx;
  const {agent, index} = node;
  const id = `a:${agent.id}`;
  const here = id === sel;
  const isOpen = ctx.open.agents.has(agent.id);
  const status = statusOf(agent, now);
  const branch = agentBranch(stack);
  // The rows under an agent start under its task: the status glyph, a space
  // and the label wide.
  const under = agentUnder([...stack, node.kids.length > 0], pad + 2);
  const mine = [...pins, id];

  ctx.out.push(
    spineRow(
      cols,
      [
        ...branch.lead,
        ...agentStatus(agent, now, ctx.frame),
        sp(1),
        seg(agentLabel(index).padEnd(pad), agentColour(index), {bold: true}),
        // "general-purpose" says nothing. A kind that was chosen does.
        ...(agent.type === 'general-purpose' ? [] : [seg(`${agent.type}  `, theme.ink)]),
        seg(agent.task, status === 'running' ? theme.ink : theme.text),
      ],
      [seg(span((status === 'running' ? now : agent.endedAt) - agent.startedAt).padStart(7), theme.dim), sp(1), seg(tokens(agent.tokens).padStart(5), theme.faint)],
      {id, pick: true, pins, mark: branch.mark, bg: here ? theme.surface2 : undefined, act: {type: 'toggle', set: 'agents', key: agent.id}},
    ),
  );

  // While it runs, the one thing worth a second row is what it is doing.
  const last = agent.steps[agent.steps.length - 1];
  if (status === 'running' && last) {
    ctx.out.push(
      spineRow(cols, [...under.lead, seg(last.tool, theme.faint), sp(INDENT), seg(last.why || path.basename(last.file ?? ''), theme.dim)], [], {mark: under.mark, pins: mine}),
    );
  }

  if (!isOpen) return;
  const room = cols - 4 - RIGHT_PAD - widthOf(under.lead);
  const row = (left: Seg[], right: Seg[] = []) => ctx.out.push(spineRow(cols, [...under.lead, ...left], right, {mark: under.mark, pins: mine}));
  row([seg(`${agent.type}  ${glyph.sep}  ${modelName(agent.model)}  ${glyph.sep}  ${agent.steps.length} step${agent.steps.length === 1 ? '' : 's'}  ${glyph.sep}  ${tokens(agent.tokens)}`, theme.faint)]);
  // The notification says how it ended; without one the quiet is only a guess,
  // so the sentence stays vaguer.
  if (status === 'stopped') {
    const why =
      agent.ended === 'killed' ? 'Stopped before it handed back.' : agent.ended === 'failed' ? 'Failed before it handed back.' : 'Went quiet without handing back.';
    row([seg(why, theme.warn)]);
  }
  for (const file of agent.wrote) {
    const rel = path.relative(ctx.root, file).split(path.sep).join('/');
    const stat = change?.files.find(f => f.path === file);
    row([seg('Wrote'.padEnd(9), theme.dim), ...pathSegs(rel, false)], stat?.known ? counts(stat.added, stat.removed) : []);
  }

  for (const step of agent.steps.slice(-5)) row([seg(step.tool.padEnd(9), theme.faint), seg(step.why || path.basename(step.file ?? ''), theme.dim)], [seg(clock(step.at), theme.faint)]);
  if (agent.says && status !== 'running') {
    for (const text of wrap(agent.says.replace(/[*_`#>]/g, ''), Math.max(20, room - 8)).slice(0, 3)) row([seg(text, theme.text)]);
  }
}

// How deep a tree is worth drawing: past this the indents cost more than the
// nesting tells you.
const TREE_MAX = 4;

// `tail` is for a tree with more of its turn under it: the last branch is then
// still a `├─`, because the turn's own line carries on past it.
export function agentRows(ctx: AgentCtx, nodes: AgentNode[], change: TurnChange | null, pins: string[], tail = false): void {
  // One label column for the whole tree, so `A10` does not push its own task
  // out of line with the rest.
  const pad = Math.max(3, ...agentsFlat(nodes).map(node => agentLabel(node.index).length + 1));
  const draw = (level: AgentNode[], stack: boolean[], under: string[]) => {
    level.forEach((node, i) => {
      const mine = [...stack, i < level.length - 1 || (stack.length === 0 && tail)];
      agentRow(ctx, node, change, under, mine, pad);
      // A nested agent keeps its parent's row on screen with it.
      if (node.kids.length && mine.length < TREE_MAX) draw(node.kids, mine, [...under, `a:${node.agent.id}`]);
    });
  };

  draw(nodes, [], pins);
}

function byTurn(ctx: Ctx): void {
  const {cols, changes, now, open} = ctx;
  const byAgent = agentsByTurn(changes, ctx.agents);
  let section = '';
  let blanked = false;
  const newest = changes[changes.length - 1];

  for (const change of [...changes].reverse()) {
    const when = dayLabel(change.turn.at, now);
    const mark = `${change.chatId}|${when}`;
    if (mark !== section) {
      if (section && !blanked) ctx.out.push(blankRow(cols));
      section = mark;
      ctx.out.push(pageRow(cols, [seg(change.chat, theme.dim)], [seg(when, theme.faint)]));
    }

    const key = turnKey(change);
    const agents = byAgent.get(key) ?? [];
    // Flipped by hand, or the newest turn, but not both.
    const isOpen = open.turns.has(key) !== (change === newest);
    if (isOpen) openTurn(ctx, change, agents);
    else closedTurn(ctx, change, agents);
    // One blank row after an open turn, below it only.
    if (isOpen) ctx.out.push(blankRow(cols));
    blanked = isOpen;
  }
}

const LETTER: Record<FileStatus, string> = {added: 'A', modified: 'M', deleted: 'D', renamed: 'R'};
const LETTER_COLOUR: Record<FileStatus, string> = {added: theme.add, modified: theme.warn, deleted: theme.del, renamed: theme.link};

function byFile(ctx: Ctx): void {
  const {cols, sel, open} = ctx;
  for (const history of ctx.histories) {
    const id = `h:${history.rel}`;
    const here = id === sel;
    const isOpen = open.hists.has(history.rel);
    const n = history.touches.length;
    ctx.out.push(
      spineRow(
        cols,
        [seg(LETTER[history.status], LETTER_COLOUR[history.status]), sp(2), ...pathSegs(history.rel, true)],
        [seg(`${n} turn${n === 1 ? '' : 's'}`, theme.faint), sp(2), ...(history.measured ? counts(history.added, history.removed) : [seg('not recorded', theme.faint, {italic: true})])],
        {mark: chevron(isOpen, here), id, pick: true, bg: here ? theme.surface2 : undefined, act: {type: 'toggle', set: 'hists', key: history.rel}},
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
        touch.known ? counts(touch.added, touch.removed) : [seg('not recorded', theme.faint, {italic: true})],
        [id],
        {nested: true},
      );
    }

    ctx.out.push(blankRow(cols));
  }
}

function flat(ctx: Ctx): void {
  const {cols} = ctx;
  if (!ctx.flat || ctx.flat.length === 0) return;
  for (const file of ctx.flat) {
    fileRow(
      ctx,
      fileKey('git', file.rel),
      file.rel,
      file.status === 'deleted' ? null : file.path,
      [seg(LETTER[file.status], LETTER_COLOUR[file.status]), sp(2), ...pathSegs(file.rel, true), ...(file.status === 'renamed' && file.fromRel ? [seg(`  from ${file.fromRel}`, theme.faint)] : [])],
      file.binary ? [seg('binary', theme.faint)] : counts(file.added, file.removed),
      [],
      {nested: false},
    );
  }
}

export function changesLines(input: ChangesInput): Line[] {
  const ctx: Ctx = {...input, out: []};
  if (input.group === 'turn') byTurn(ctx);
  else if (input.group === 'file') byFile(ctx);
  else flat(ctx);

  // An empty view has to say what to do next, in one sentence.
  if (ctx.out.length === 0) {
    const message =
      input.group === 'flat'
        ? input.flat === null
          ? 'This folder is not a git repo, so there is no last commit to compare with. "By turn" still works.'
          : 'Nothing has changed since the last commit. Every turn is still there under "By turn".'
        : input.changes.length === 0
          ? 'No Claude chats have touched this project yet. Start Claude Code in this folder.'
          : 'Nothing changed in these turns. Press v for everything since the last commit.';
    for (const text of wrap(message, input.cols - 4)) ctx.out.push(pageRow(input.cols, [seg(text, theme.dim)]));
  }

  return ctx.out;
}
