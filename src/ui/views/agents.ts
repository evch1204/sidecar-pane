import path from 'node:path';
import {maxOverlap, statusOf, type AgentRun} from '../../core/agents';
import {pathKey} from '../../core/git';
import type {TurnChange} from '../../core/turns';
import {modelName} from '../../core/usage';
import type {WorktreeRun} from '../../core/worktrees';
import {
  blankRow, chip, fit, INDENT, pageRow, RIGHT_PAD, seg, sizeCells, sp, span, tokens, width, widthOf,
  type Line, type Seg,
} from '../cells';
import {glyph, hues, theme} from '../theme';
import {wrap} from '../util';
import {agentsByTurn, agentsFlat, agentStatus, agentTree, clock, dayLabel, spinner, turnKey, type Open} from './changes';

// When Claude hands work to subagents, its own screen mostly goes quiet. This
// view is the part you cannot see from the terminal: who was started, for which
// prompt, where each one worked and what it handed back.
//
// The shape is a chart, not a list. A turn's agents share one clock, so every
// agent is a bar on the same 26 cell axis: four short bars at the left and one
// long one after them is "it thought, then it worked", and three bars in a
// column is work that really did happen at once. The bars are grouped by the
// folder each agent worked in, because a worktree is the other thing a list of
// rows cannot show: whose changes are in your folder and whose are not.

export type AgentsInput = {
  cols: number;
  now: number;
  frame: number;
  root: string;
  changes: TurnChange[];
  agents: AgentRun[];
  // `turns` is the same set the Changes view uses, so a turn opened in one view
  // is open in the other; `says` holds the agents whose report is not cut.
  open: Pick<Open, 'turns' | 'agents' | 'says' | 'folded'>;
  sel: string | null;
  // The folders the agents worked in, and the chat's own model, so a lane can
  // be grouped by worktree and an agent only shows a model chip when its model
  // is not the chat's. Both optional: without them the view reads as it did.
  worktrees?: WorktreeRun[];
  scope?: 'mine' | 'all';
  chatModel?: string;
};

// Past this many finished read-only agents in one turn, they fold into one
// row: a crowd is what a fan-out of audits looks like, and their rows are the
// ones with the least on them. The ones still running, the ones that wrote
// something and the ones that gave up are always listed.
const FOLD_OVER = 8;

// The name column, the lane, and the elapsed time on the right.
const NAME = 21;
const LANE = 26;
const TIME = 7;
// The whole lane form is fixed width. Under this there is no room for it, so
// the rows take the branch form of the Changes view instead.
const LANES_MIN = 56;
// How deep an indent is worth the columns it costs.
const NEST_MAX = 3;
// Fewer columns than this and a task's name says nothing, so something else on
// the row gives way first.
const NAME_MIN = 14;
const SAYS_SHOWN = 2;
const DAY_RULE_LEFT = 0.43;
// The columns a past turn's row keeps for what it says on the right, so the
// prompts of the past all cut at the same place.
const PAST_RIGHT = 26;

// The three column prefix: the margin, the block's own mark, then two spaces,
// so a row's content starts at column 4. `streamRow` in cells.ts draws this
// shape one column too wide (it returns `cols`, not `cols - 1`), so the view
// keeps its own until that is fixed.
const PREFIX = 4;
const gapFor = (mark: number): number => Math.max(1, PREFIX - 1 - mark);
const room = (cols: number, mark = 1): number => cols - 2 - mark - gapFor(mark) - RIGHT_PAD;
// The same for a row with no mark at all: the summary and the day's rule.
const pageWide = (cols: number): number => cols - 2 - RIGHT_PAD;

type RowMore = Omit<Line, 'segs'> & {mark?: Seg; bg?: string; live?: boolean};

function blockRow(cols: number, left: Seg[] = [], right: Seg[] = [], more: RowMore = {}): Line {
  const {bg, mark, live, ...rest} = more;
  const first = mark ?? seg(glyph.spine, live ? theme.accent : theme.spine);
  // A two column mark (a tree branch) takes its column back from the air after
  // it, so every row in a block starts its text in the same place.
  const w = width(first.text);
  return {
    ...rest,
    segs: [sp(1), {...first, bg: first.bg ?? bg}, sp(gapFor(w), bg), ...fit(left, right, room(cols, w), bg), sp(RIGHT_PAD, bg)],
  };
}

const sep = (): Seg => seg(`  ${glyph.sep}  `, theme.faint);
const cut = (text: string, max: number): string =>
  width(text) <= max ? text : `${[...text].slice(0, Math.max(0, max - 1)).join('').trimEnd()}${glyph.ellipsis}`;
const padTo = (text: string, n: number): string => text + ' '.repeat(Math.max(0, n - width(text)));

// A coarse duration: what a headline says. `span` keeps the seconds, which a
// row about one agent wants and a row about a whole turn does not.
function brief(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

const LANE_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const countWord = (n: number): string => LANE_WORDS[n] ?? String(n);

// ---- the rows the whole view is built from ---------------------------------

// What the chat this pane is following has going on: the one row above the
// stream, and the only row that reads at a glance.
function summaryRow(cols: number, agents: AgentRun[], now: number, frame: number): Line {
  const count = (status: string) => agents.filter(a => statusOf(a, now) === status).length;
  const running = count('running');
  const done = count('done');
  const stopped = count('stopped');
  const spent = agents.reduce((n, a) => n + a.tokens, 0);
  const left: Seg[] = [
    running ? seg(spinner(frame), theme.accent) : seg(glyph.dot, theme.faint),
    sp(1),
    ...(running ? [seg(`${running} running`, theme.accent, {bold: true})] : []),
  ];
  if (done) left.push(...(running ? [sep()] : []), seg(`${done} done`, theme.text));
  if (stopped) left.push(...(left.length > 2 ? [sep()] : []), seg(`${stopped} stopped`, theme.dim));
  return pageRow(cols, left, [seg(`${tokens(spent)} tokens`, theme.dim)]);
}

// The day changes: a rule with the day's name in it, the way the Changes view
// divides its stream.
function dayRule(cols: number, when: string): Line {
  const label = `  ${when}  `;
  const rest = Math.max(0, pageWide(cols) - INDENT - width(label));
  const head = Math.max(2, Math.round(rest * DAY_RULE_LEFT));
  return pageRow(cols, [
    sp(INDENT),
    seg(glyph.rule.repeat(head), theme.spine),
    seg(label, theme.faint),
    seg(glyph.rule.repeat(rest - head), theme.spine),
  ]);
}

// The clock over the lanes: when the first agent started, the middle of the
// span and where it ends. The labels sit on the ticks they name.
function axisRow(cols: number, lane: number, from: number, to: number, pins: string[]): Line {
  const cells = [0, Math.max(0, Math.floor(lane / 2) - 1), Math.max(0, lane - 3)];
  const times = [clock(from), clock(from + (to - from) / 2), clock(to)];
  // A span of seconds reads the same clock three times, and saying it once is
  // the whole truth about it.
  const ticks = cells.map((cell, i) => ({cell, text: times[i]!})).filter((tick, i) => i === 0 || tick.text !== times[i - 1]);
  const left: Seg[] = [sp(NAME + 1)];
  let col = 0;
  ticks.forEach((tick, i) => {
    // Its own tick, unless the label before it is still in the way.
    const put = Math.max(tick.cell, col + (i ? 1 : 0));
    left.push(sp(put - col), seg(tick.text, theme.faint));
    col = put + width(tick.text);
  });

  return blockRow(cols, left, [], {pins});
}

// ---- who worked where -----------------------------------------------------

// A worktree Claude Code made for one agent is named after that agent, so its
// folder name is an id: `agent-a868194308eda1135`. Enough of it to tell two
// apart is all a row can spend columns on.
function folderLabel(folder: string): string {
  const name = path.basename(folder);
  const id = /^agent-([0-9a-f]{4,})$/i.exec(name);
  return id ? `agent-${id[1]!.slice(0, 4)}` : cut(name, 18);
}

// A file the way the step rows name it: its path inside the project, or just
// its name when it is somewhere else entirely.
function relOf(root: string, file: string): string {
  if (!file) return '';
  const rel = path.relative(root, file).split(path.sep).join('/');
  return !rel || rel.startsWith('..') ? path.basename(file) : rel;
}

type Slot = {agent: AgentRun; index: number; depth: number};
// A run of agents that worked in the same place: the pane's folder, one
// worktree, or several worktrees with one agent each.
type Group = {key: string; here: boolean; label: string; trees: WorktreeRun[]; slots: Slot[]};

const folderOf = (agent: AgentRun): string => agent.worktree?.path ?? '';

function groupsOf(input: AgentsInput, slots: Slot[]): Group[] {
  const treeOf = (folder: string): WorktreeRun | undefined =>
    input.worktrees?.find(wt => pathKey(wt.path) === pathKey(folder));

  const runs: Group[] = [];
  for (const slot of slots) {
    const folder = folderOf(slot.agent);
    const key = folder ? pathKey(folder) : 'here';
    const last = runs[runs.length - 1];
    if (last?.key === key) {
      last.slots.push(slot);
      continue;
    }

    const tree = folder ? treeOf(folder) : undefined;
    runs.push({
      key,
      here: !folder,
      label: folder ? folderLabel(folder) : path.basename(input.root) || 'this folder',
      trees: tree ? [tree] : [],
      slots: [slot],
    });
  }

  // Claude Code gives each background agent a worktree of its own, so three
  // agents in parallel are three folders with one row each. Side by side they
  // are one fact — "one agent in each" — not three headings.
  const out: Group[] = [];
  for (const group of runs) {
    const last = out[out.length - 1];
    const alone = !group.here && group.slots.length === 1 && group.trees.length === 1;
    // One agent per folder on both sides: the same fact, said once.
    if (alone && last && !last.here && last.slots.length === last.trees.length) {
      last.slots.push(...group.slots);
      last.trees.push(...group.trees);
      last.key = 'worktrees';
      last.label = `${countWord(last.slots.length)} worktrees`;
      continue;
    }

    out.push({...group, slots: [...group.slots], trees: [...group.trees]});
  }

  return out;
}

// Where a group's work stands: the state on the right of its heading row.
function groupState(group: Group, agents: AgentRun[]): Seg[] {
  if (group.here) {
    // Every agent in the pane's own folder only read: nothing of theirs is
    // waiting anywhere.
    return agents.every(a => a.wrote.length === 0) ? [seg('read only', theme.faint)] : [];
  }

  if (group.trees.length > 1) {
    const merged = group.trees.filter(wt => wt.merged).length;
    if (merged === group.trees.length) return [seg(`${glyph.check} ${merged} merged`, theme.add)];
    if (merged) return [seg(`${glyph.check} ${merged} of ${group.trees.length} merged`, theme.add)];
    return [];
  }

  const wt = group.trees[0];
  // Nothing recorded its head, so where it got to cannot be told.
  if (!wt || !wt.known) return [];
  if (wt.merged) return [seg(wt.mergedAt ? `${glyph.check} merged ${clock(wt.mergedAt)}` : `${glyph.check} merged`, theme.add)];
  if (wt.removed) return [seg('removed', theme.faint)];
  if (!wt.gone && wt.ahead === 0 && wt.dirty === 0) return [seg('clean', theme.faint)];
  return wt.ahead ? [seg(`${wt.ahead} ahead`, theme.dim)] : [];
}

// ---- an agent ---------------------------------------------------------------

type Ctx = AgentsInput & {out: Line[]};

const elapsed = (agent: AgentRun, now: number, status: string): number =>
  Math.max(0, (status === 'running' ? now : Math.max(agent.endedAt, agent.startedAt)) - agent.startedAt);

// The bar: the agent's own start and end mapped onto the turn's span, and never
// nothing — an agent that ran for ten seconds of an hour still happened.
function laneCells(agent: AgentRun, status: string, from: number, to: number, lane: number, now: number, colour: string): Seg[] {
  const total = Math.max(1, to - from);
  const end = status === 'running' ? now : Math.max(agent.endedAt, agent.startedAt);
  const cell = (at: number) => Math.round(((at - from) / total) * lane);
  const start = Math.max(0, Math.min(lane - 1, cell(agent.startedAt)));
  const stop = Math.max(start + 1, Math.min(lane, cell(end)));
  return [sp(start), seg(glyph.lower.repeat(stop - start), colour), sp(lane - stop)];
}

// What an agent's bar is coloured by: it wrote files, or it only read.
function laneColour(agent: AgentRun, status: string, index: number): string {
  if (status === 'running') return theme.accent;
  if (status === 'stopped') return theme.faint;
  return agent.wrote.length ? hues[index % hues.length]! : theme.dim;
}

function nameSegs(agent: AgentRun, status: string, wide: number): Seg[] {
  const fg = status === 'running' ? theme.ink : status === 'stopped' ? theme.dim : theme.text;
  return [seg(padTo(cut(agent.task || agent.type, wide), wide), fg, {bold: status === 'running'})];
}

const rightOf = (agent: AgentRun, status: string, now: number, frame: number): Seg[] => [
  ...agentStatus(agent, now, frame),
  sp(1),
  seg((status === 'stopped' ? 'stopped' : span(elapsed(agent, now, status))).padStart(TIME), status === 'running' ? theme.accent : theme.dim),
];

// The rows under an agent: what it is, where its work went, and what it said.
// A running one says the step it is on instead, whether it is open or not.
function agentUnder(ctx: Ctx, slot: Slot, group: Group, pins: string[], isOpen: boolean): void {
  const {cols, now} = ctx;
  const {agent} = slot;
  const status = statusOf(agent, now);
  const inset = INDENT + slot.depth * INDENT;
  const row = (left: Seg[], right: Seg[] = []) => ctx.out.push(blockRow(cols, [sp(inset), ...left], right, {pins}));

  if (isOpen) {
    const model = modelName(agent.model);
    const facts: Seg[] = [seg(agent.type, theme.dim)];
    if (model && model !== 'unknown') facts.push(sep(), seg(model, theme.dim));
    facts.push(sep(), seg(`${agent.toolUses} tool use${agent.toolUses === 1 ? '' : 's'}`, theme.dim));
    facts.push(sep(), seg(tokens(agent.tokens), theme.dim));
    row(facts);

    // The notification says how it ended; without one the quiet is only a
    // guess, so the sentence stays vaguer.
    if (status === 'stopped') {
      const why =
        agent.ended === 'killed'
          ? 'Stopped before it handed back.'
          : agent.ended === 'failed'
            ? 'Failed before it handed back.'
            : 'Went quiet without handing back.';
      row([seg(why, theme.warn)]);
    }

    const wt = group.trees.find(tree => pathKey(tree.path) === pathKey(folderOf(agent)));
    if (wt) {
      // A folder that is gone and whose head nobody wrote down has no diff
      // left to count, so the row says where it was and nothing more.
      const files = wt.files.length;
      row(
        [
          seg('in ', theme.faint),
          seg(folderLabel(wt.path), hues[slot.index % hues.length]!, {bold: true}),
          ...(files ? [seg(`   ${files} file${files === 1 ? '' : 's'} `, theme.dim), ...sizeCells(wt.lines.added, wt.lines.removed)] : []),
        ],
        groupState({...group, trees: [wt], here: false}, [agent]),
      );
    }
  }

  // While it runs, the one thing worth a row is what it is doing now.
  const last = agent.steps[agent.steps.length - 1];
  if (status === 'running') {
    row(
      [
        seg(glyph.elbow, theme.faint),
        sp(INDENT),
        seg(padTo(last?.tool ?? 'working', 6), theme.dim),
        seg(cut(last?.why || relOf(ctx.root, last?.file ?? ''), Math.max(8, room(cols) - inset - 24)), theme.text),
      ],
      [seg(`${agent.toolUses} tool use${agent.toolUses === 1 ? '' : 's'}`, theme.faint)],
    );
    return;
  }

  if (!isOpen || !agent.says) return;
  // What it handed back, in its own words, quoted: two lines and `more`.
  const all = wrap(agent.says.replace(/[*_`#>]/g, ''), Math.max(20, room(cols) - inset - 6));
  const whole = ctx.open.says.has(agent.id);
  const shown = whole ? all : all.slice(0, SAYS_SHOWN);
  const act = {type: 'toggle', set: 'says', key: agent.id} as const;
  shown.forEach((text, i) => {
    const head = i === 0 ? '“' : '';
    const tail = i === shown.length - 1 ? '”' : '';
    const more = !whole && all.length > shown.length && i === shown.length - 1;
    ctx.out.push(
      blockRow(cols, [sp(inset), seg(`${head}${text}${tail}${more ? ' ' : ''}`, theme.text), ...(more ? [seg('more', theme.link, {underline: true})] : [])], [], {pins, act}),
    );
  });
}

// An agent as a lane: its name, its bar on the turn's clock, then how it ended
// and how long it took.
function laneRow(ctx: Ctx, slot: Slot, group: Group, lane: number, from: number, to: number, pins: string[]): void {
  const {cols, now} = ctx;
  const {agent} = slot;
  const id = `a:${agent.id}`;
  const here = id === ctx.sel;
  const isOpen = ctx.open.agents.has(agent.id);
  const status = statusOf(agent, now);
  const nested = Math.min(slot.depth, NEST_MAX) * INDENT;
  ctx.out.push(
    blockRow(
      cols,
      [
        sp(nested),
        ...nameSegs(agent, status, NAME - nested),
        sp(1),
        ...laneCells(agent, status, from, to, lane, now, laneColour(agent, status, slot.index)),
      ],
      rightOf(agent, status, now, ctx.frame),
      {id, pick: true, pins, bg: here ? theme.surface2 : undefined, act: {type: 'toggle', set: 'agents', key: agent.id}},
    ),
  );

  agentUnder(ctx, slot, group, [...pins, id], isOpen);
}

// The same agent where there is no room for a chart: the branch form of the
// Changes view, still grouped by the folder it worked in.
function branchRow(ctx: Ctx, slot: Slot, group: Group, pins: string[]): void {
  const {cols, now} = ctx;
  const {agent} = slot;
  const id = `a:${agent.id}`;
  const here = id === ctx.sel;
  const isOpen = ctx.open.agents.has(agent.id);
  const status = statusOf(agent, now);
  const model = modelName(agent.model);
  const chatModel = ctx.chatModel ? modelName(ctx.chatModel) : '';
  // A chip only for what is not the default: a kind Claude chose, or a model
  // that is not the chat's own.
  let tag = agent.type !== 'general-purpose' ? agent.type : model && chatModel && model !== chatModel ? model : '';
  const state = rightOf(agent, status, now, ctx.frame);
  const nested = Math.min(slot.depth, NEST_MAX) * INDENT;
  // The name is the row. What it cost goes first when the pane is narrow, then
  // the chip; how it ended and how long it took never go.
  const nameRoom = (right: Seg[], chipped: string) =>
    room(cols, 2) - nested - 2 - (chipped ? width(chipped) + 4 : 0) - 1 - widthOf(right);
  let right = [...state, sp(1), seg(tokens(agent.tokens).padStart(5), theme.faint)];
  if (nameRoom(right, tag) < NAME_MIN) right = state;
  if (nameRoom(right, tag) < NAME_MIN) tag = '';
  const nameWide = Math.max(6, nameRoom(right, tag));
  ctx.out.push(
    blockRow(
      cols,
      [
        sp(nested),
        seg(glyph.square, laneColour(agent, status, slot.index)),
        sp(1),
        seg(cut(agent.task || agent.type, nameWide), status === 'running' ? theme.ink : status === 'stopped' ? theme.dim : theme.text, {bold: status === 'running'}),
        ...(tag ? [sp(2), ...chip(tag, theme.surface2, theme.dim)] : []),
      ],
      right,
      {
        id,
        pick: true,
        pins,
        // Always `├─`: the turn's own line carries on past every agent.
        mark: seg(glyph.branch, theme.spine),
        bg: here ? theme.surface2 : undefined,
        act: {type: 'toggle', set: 'agents', key: agent.id},
      },
    ),
  );

  agentUnder(ctx, slot, group, [...pins, id], isOpen);
}

// ---- a turn ----------------------------------------------------------------

// A past turn is one row: the prompt, how many agents it started and how long
// they took, and when it was. Enter opens the block in its place.
function closedBlock(input: AgentsInput, change: TurnChange, agents: AgentRun[]): Line {
  const {cols, now} = input;
  const key = turnKey(change);
  const id = `t:${key}`;
  const here = id === input.sel;
  const {from, to} = spanOf(agents, now);
  const note = `${agents.length} agent${agents.length === 1 ? '' : 's'} ${glyph.sep} ${brief(to - from)}`;
  const right = [seg(note, theme.faint, {italic: true}), sp(3), seg(clock(change.turn.at), theme.faint)];
  // The prompts of the past line up under each other, so the row cuts at its
  // own column rather than wherever the note happens to end.
  const wide = Math.max(12, Math.min(room(cols) - width(note) - 5, room(cols) - PAST_RIGHT));
  return blockRow(cols, [seg(cut(change.turn.prompt, wide), theme.text)], right, {
    id,
    pick: true,
    mark: seg(glyph.ring, theme.faint),
    bg: here ? theme.surface2 : undefined,
    act: {type: 'turn', key},
  });
}

// The span the turn's agents cover. One still running stretches it to now, so
// its bar keeps growing against a clock that keeps up with it.
function spanOf(agents: AgentRun[], now: number): {from: number; to: number} {
  const starts = agents.map(a => a.startedAt).filter(Boolean);
  const from = starts.length ? Math.min(...starts) : now;
  const to = agents.reduce((at, a) => Math.max(at, statusOf(a, now) === 'running' ? now : a.endedAt), from + 1);
  return {from, to};
}

function openBlock(input: AgentsInput, out: Line[], change: TurnChange, agents: AgentRun[]): void {
  const {cols, now, open} = input;
  const ctx: Ctx = {...input, out};
  const key = turnKey(change);
  const id = `t:${key}`;
  const here = id === input.sel;
  const live = agents.some(a => statusOf(a, now) === 'running');
  const {from, to} = spanOf(agents, now);

  out.push(
    blockRow(cols, [seg(cut(change.turn.prompt, room(cols) - 7), theme.ink, {bold: true})], [seg(clock(change.turn.at), theme.dim)], {
      id,
      pick: true,
      mark: seg(glyph.dot, live ? theme.accent : theme.text),
      bg: here ? theme.surface2 : undefined,
      act: {type: 'turn', key},
    }),
  );

  // How many, how much of it at once, and how long it all took. "At most N at
  // once" is the first thing to go when the pane is narrow: how long the turn
  // spent is the fact a cut row should keep.
  const most = maxOverlap(agents, now);
  const count = seg(`${agents.length} agent${agents.length === 1 ? '' : 's'}`, theme.text);
  const took = seg(brief(to - from), theme.dim);
  const stats: Seg[] = [count, sep(), seg(`at most ${most} at once`, theme.dim), sep(), took];
  out.push(blockRow(cols, most > 1 && widthOf(stats) <= room(cols) ? stats : [count, sep(), took], [], {pins: [id]}));
  out.push(blockRow(cols, [], [], {pins: [id]}));

  // A crowd folds its finished read-only agents away: they are the ones whose
  // rows say the least. The row that says so toggles like an agent's.
  const foldKey = `fold:${key}`;
  const quiet = (agent: AgentRun) => statusOf(agent, now) === 'done' && agent.wrote.length === 0;
  const crowd = agents.filter(quiet).length > FOLD_OVER;
  const folded = crowd && !open.folded.has(foldKey);
  const hidden = (agent: AgentRun) => crowd && quiet(agent);
  const away = crowd ? agents.filter(quiet) : [];
  if (away.length) {
    const foldId = `gf:${key}`;
    const spent = away.reduce((n, a) => n + a.tokens, 0);
    out.push(
      blockRow(
        cols,
        [seg(glyph.check, theme.add), sp(1), seg(`${away.length} finished`, theme.dim), sep(), seg(tokens(spent), theme.dim)],
        [],
        {
          id: foldId,
          pick: true,
          pins: [id],
          bg: foldId === input.sel ? theme.surface2 : undefined,
          act: {type: 'toggle', set: 'folded', key: foldKey},
        },
      ),
    );
  }

  // Start order inside the turn is what hands out the hues, so an agent keeps
  // its colour wherever it is drawn.
  const order = [...agents].sort((a, b) => a.startedAt - b.startedAt);
  const nodes = agentsFlat(agentTree(order, agent => !folded || !hidden(agent)));
  const depths = new Map<string, number>();
  for (const node of nodes) {
    const up = node.agent.parentId;
    depths.set(node.agent.id, up !== undefined && depths.has(up) ? depths.get(up)! + 1 : 0);
  }

  const slots: Slot[] = nodes.map(node => ({agent: node.agent, index: node.index, depth: depths.get(node.agent.id) ?? 0}));
  const groups = groupsOf(input, slots);
  // The lane takes what the fixed columns leave, and one column of air stays
  // between it and the status on the right.
  const lane = Math.min(LANE, room(cols) - NAME - 1 - (TIME + 2) - 1);
  const lanes = cols >= LANES_MIN && lane >= 8;
  if (lanes && slots.length) out.push(axisRow(cols, lane, from, to, [id]));

  const noted = new Set<string>();
  groups.forEach((group, i) => {
    if (i) out.push(blockRow(cols, [], [], {pins: [id]}));
    const note = group.here
      ? noted.has(group.key)
        ? ''
        : 'the folder you are in'
      : group.trees.length > 1
        ? 'one agent in each'
        : '';
    noted.add(group.key);
    const state = groupState(group, group.slots.map(slot => slot.agent));
    const name = [seg('in ', theme.faint), seg(group.label, theme.text, {bold: true})];
    // The note is the first thing to go: the folder and its state are the row.
    const keep = note && widthOf(name) + width(note) + 3 + widthOf(state) + 2 <= room(cols);
    out.push(blockRow(cols, keep ? [...name, seg(`   ${note}`, theme.dim)] : name, state, {pins: [id]}));
    for (const slot of group.slots) {
      if (lanes) laneRow(ctx, slot, group, lane, from, to, [id]);
      else branchRow(ctx, slot, group, [id]);
    }
  });

  out.push(blankRow(cols));
}

export function agentsLines(input: AgentsInput): Line[] {
  const {cols, now, changes, open} = input;
  const out: Line[] = [];
  const byTurn = agentsByTurn(changes, input.agents);
  const blocks = [...changes].reverse().filter(change => (byTurn.get(turnKey(change))?.length ?? 0) > 0);

  // The chat this pane is following: what is running right now and what it has
  // spent. Older chats are history, and have their own blocks below.
  const newest = changes[changes.length - 1];
  const chat = newest ? input.agents.filter(agent => agent.sessionId === newest.chatId) : [];
  if (chat.length) {
    out.push(summaryRow(cols, chat, now, input.frame));
    out.push(blankRow(cols));
  }

  let day = '';
  for (const change of blocks) {
    const when = dayLabel(change.turn.at, now);
    if (when !== day) {
      // Nothing divides the top of the stream from what is above it, unless
      // the newest agents are not from today.
      if (day || when !== 'today') out.push(dayRule(cols, when));
      day = when;
    }

    const agents = byTurn.get(turnKey(change))!;
    // Flipped by hand, or the newest block, but not both.
    if (open.turns.has(turnKey(change)) !== (change === blocks[0])) openBlock(input, out, change, agents);
    else out.push(closedBlock(input, change, agents));
  }

  if (blocks.length === 0) {
    const text = 'No subagents yet — ask Claude to hand part of a job to an agent, and it shows up here while it works.';
    for (const line of wrap(text, cols - 4)) out.push(pageRow(cols, [seg(line, theme.dim)]));
  }

  return out;
}

export function runningAgents(agents: AgentRun[], now: number): number {
  return agents.filter(a => statusOf(a, now) === 'running').length;
}

// The tab is worth a column only when there is something on it: an agent still
// working, or one that belongs to the chat this pane is following.
export function agentsTabVisible(changes: TurnChange[], agents: AgentRun[], now: number): boolean {
  if (agents.some(a => statusOf(a, now) === 'running')) return true;
  const newest = changes[changes.length - 1];
  return newest ? agents.some(a => a.sessionId === newest.chatId) : false;
}

// The badge beside the tab's name: nothing at all unless something is running.
export function agentsBadge(agents: AgentRun[], now: number, frame: number): Seg[] {
  const n = runningAgents(agents, now);
  return n ? [seg(spinner(frame), theme.accent), seg(` ${n}`, theme.ink)] : [];
}
