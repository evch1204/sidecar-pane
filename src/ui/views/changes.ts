import path from 'node:path';
import {statusOf, type AgentRun} from '../../core/agents';
import type {DiffLine, FileDiff, FileStatus} from '../../core/diff';
import {modelName} from '../../core/usage';
import type {ChangedFile, FileHistory, TurnChange} from '../../core/turns';
import {
  blankRow, counts, INDENT, INDENT2, pageRow, seg, sp, span, spineRow, tokens,
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
  agents: ReadonlySet<string>;
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
};

const FILES_SHOWN = 8;
const STEPS_SHOWN = 40;
const SAYS_SHOWN = 2;
const DAY = 86_400_000;

export const turnKey = (change: TurnChange): string => `${change.chatId}:${change.turn.id}`;
export const fileKey = (scope: string, rel: string): string => `${scope}|${rel}`;
export const spinner = (frame: number): string => glyph.spinner[frame % glyph.spinner.length]!;

// A chevron means one thing everywhere: accent when the cursor is on the row,
// dim otherwise. Whether it is open is the glyph's job, not the colour's.
const chevron = (isOpen: boolean, here: boolean): Seg => seg(isOpen ? glyph.open : glyph.closed, here ? theme.accent : theme.dim);

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
    let key = turnOfCall.get(agent.toolUseId);
    if (!key) {
      const parent = agents.find(other => other.steps.some(step => step.id === agent.toolUseId));
      key = parent ? placed.get(parent.id) : undefined;
    }

    if (!key) continue;
    placed.set(agent.id, key);
    out.set(key, [...(out.get(key) ?? []), agent]);
  }

  return out;
}

export const agentLabel = (index: number): string => `A${index + 1}`;
export const agentColour = (index: number): string => agentColours[index % agentColours.length]!;

function pathSegs(rel: string, bright: boolean): Seg[] {
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
  const right = change.measured ? counts(file.added, file.removed) : [seg('not recorded', theme.faint, {italic: true})];
  fileRow(
    ctx,
    fileKey(turnKey(change), file.rel),
    file.rel,
    file.status === 'deleted' ? null : file.path,
    [seg((change.measured ? VERB[file.status] : 'Touched').padEnd(9), theme.dim), ...pathSegs(file.rel, true), ...tags],
    right,
    pins,
    {nested: true, live: change.running},
  );
}

function meta(change: TurnChange, agents: AgentRun[], now: number): Seg[] {
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

  if (agents.length) out.push(...dot(), seg(`${agents.length} agent${agents.length === 1 ? '' : 's'}`, theme.dim));
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
  ctx.out.push(spineRow(cols, meta(change, agents, now), [], rail));

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
    const tags: Seg[] = by.flatMap(i => [sp(1), seg(agentLabel(i), agentColour(i), {bold: true})]);
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

  // Subagents, grouped by agent. One row each; open one for what it did.
  agents.forEach((agent, i) => agentRow(ctx, agent, i, change, pins));

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

// An agent as one row: label, kind, the job it was given, how it ended.
export function agentRow(ctx: Pick<Ctx, 'cols' | 'sel' | 'now' | 'frame' | 'root' | 'out'> & {open: Pick<Open, 'agents'>}, agent: AgentRun, index: number, change: TurnChange | null, pins: string[]): void {
  const {cols, sel, now} = ctx;
  const id = `a:${agent.id}`;
  const here = id === sel;
  const isOpen = ctx.open.agents.has(agent.id);
  const status = statusOf(agent, now);
  const last = agent.steps[agent.steps.length - 1];
  const doing = status === 'running' && last ? `${last.tool} ${last.why || path.basename(last.file ?? '')}` : agent.task;
  const live = change?.running;

  ctx.out.push(
    spineRow(
      cols,
      [
        chevron(isOpen, here),
        sp(1),
        seg(agentLabel(index).padEnd(3), agentColour(index), {bold: true}),
        sp(agent.depth > 1 ? 2 : 0),
        // "general-purpose" says nothing. A kind that was chosen does.
        ...(agent.type === 'general-purpose' ? [] : [seg(`${agent.type}  `, theme.ink)]),
        seg(doing, status === 'running' ? theme.ink : theme.text),
      ],
      [...agentStatus(agent, now, ctx.frame), sp(1), seg(span((status === 'running' ? now : agent.endedAt) - agent.startedAt).padStart(7), theme.dim), sp(1), seg(tokens(agent.tokens).padStart(5), theme.faint)],
      {id, pick: true, pins, live, bg: here ? theme.surface2 : undefined, act: {type: 'toggle', set: 'agents', key: agent.id}},
    ),
  );
  if (!isOpen) return;

  const inner = {pins: [...pins, id], live};
  const row = (left: Seg[], right: Seg[] = []) => ctx.out.push(spineRow(cols, [sp(INDENT2), ...left], right, inner));
  row([seg(`${agent.type}  ${glyph.sep}  ${modelName(agent.model)}  ${glyph.sep}  ${agent.steps.length} step${agent.steps.length === 1 ? '' : 's'}  ${glyph.sep}  ${tokens(agent.tokens)} tokens`, theme.faint)]);
  if (status === 'stopped') row([seg('Went quiet without handing back.', theme.warn)]);
  for (const file of agent.wrote) {
    const rel = path.relative(ctx.root, file).split(path.sep).join('/');
    const stat = change?.files.find(f => f.path === file);
    row([seg('Wrote'.padEnd(9), theme.dim), ...pathSegs(rel, false)], stat && change?.measured ? counts(stat.added, stat.removed) : []);
  }

  for (const step of agent.steps.slice(-5)) row([seg(step.tool.padEnd(9), theme.faint), seg(step.why || path.basename(step.file ?? ''), theme.dim)], [seg(clock(step.at), theme.faint)]);
  if (agent.says && status !== 'running') {
    for (const text of wrap(agent.says.replace(/[*_`#>]/g, ''), cols - 12).slice(0, 3)) row([seg(text, theme.text)]);
  }
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
        touch.change.measured ? counts(touch.added, touch.removed) : [seg('not recorded', theme.faint, {italic: true})],
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

  if (ctx.out.length === 0) {
    const message =
      input.group === 'flat'
        ? input.flat === null
          ? 'This folder is not a git repo, so there is no last commit to compare with.'
          : 'Nothing has changed since the last commit.'
        : input.changes.length === 0
          ? 'No Claude chats have touched this project yet.'
          : 'Nothing changed in these turns.';
    for (const text of wrap(message, input.cols - 4)) ctx.out.push(pageRow(input.cols, [seg(text, theme.dim)]));
  }

  return ctx.out;
}

// The little summary on the right of the tab row.
export function changesSummary(changes: TurnChange[]): Seg[] {
  const newest = changes[changes.length - 1];
  if (!newest || newest.files.length === 0) return [];
  const n = newest.files.length;
  return [seg(`${n} file${n === 1 ? '' : 's'}`, theme.dim), ...(newest.measured ? [seg(`  +${newest.added}`, theme.add), seg(` ${glyph.minus}${newest.removed}`, theme.del)] : [])];
}
