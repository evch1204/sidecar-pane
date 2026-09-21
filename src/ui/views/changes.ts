import path from 'node:path';
import {statusOf, type AgentRun} from '../../core/agents';
import type {DiffLine, FileDiff, FileStatus} from '../../core/diff';
import {modelName} from '../../core/usage';
import type {ChangedFile, FileHistory, TurnChange} from '../../core/turns';
import {
  blankRow, cardBottom, cardRow, cardTop, counts, pageRow, seg, sp, span, tokens,
  type Group, type Line, type Seg,
} from '../cells';
import {diffLines, viewRows, type DiffGroup} from '../diffrows';
import {agentColours, glyph, theme} from '../theme';
import {wrap} from '../util';

// The Changes view is one stream. A turn is a card; what it changed is a row
// in the card; a diff opens under its own row. Nothing is shown "down there".

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
const DAY = 86_400_000;

export const turnKey = (change: TurnChange): string => `${change.chatId}:${change.turn.id}`;
export const fileKey = (scope: string, rel: string): string => `${scope}|${rel}`;
export const spinner = (frame: number): string => glyph.spinner[frame % glyph.spinner.length]!;

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

// One openable file row, and under it the diff when it is open.
function fileRow(ctx: Ctx, key: string, rel: string, abs: string | null, left: Seg[], right: Seg[], pins: string[]): void {
  const {cols, sel, open} = ctx;
  const id = `f:${key}`;
  const here = id === sel;
  const isOpen = open.files.has(key);
  const bg = here ? theme.surface2 : undefined;
  ctx.out.push(
    cardRow(cols, [seg(isOpen ? glyph.open : glyph.closed, here || isOpen ? theme.accent : theme.faint), sp(1), ...left], right, {
      bg, id, pick: true, pins, act: {type: 'file', key},
    }),
  );
  if (!isOpen) return;

  const groups = ctx.diffs.get(key);
  if (!groups) {
    ctx.out.push(cardRow(cols, [sp(2), seg('Reading the diff…', theme.faint)], [], {pins: [...pins, id]}));
    return;
  }

  const keyed = groups.map(g => ({...g, key: `${key}#${g.key}`}));
  const rows = viewRows(keyed, ctx.folded, ctx.opened, ctx.hideSpace);
  ctx.out.push(...diffLines(rows, keyed, {cols, fileKey: key, path: abs, sel, pins: [...pins, id]}));
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
  );
}

function meta(change: TurnChange, agents: AgentRun[], now: number): Seg[] {
  const out: Seg[] = [];
  const dot = () => (out.length ? [seg('  ·  ', theme.faint)] : []);
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

function closedTurn(ctx: Ctx, change: TurnChange, agents: AgentRun[]): void {
  const {cols, sel} = ctx;
  const id = `t:${turnKey(change)}`;
  const here = id === sel;
  const bg = here ? theme.surface2 : undefined;
  const act = {type: 'turn', key: turnKey(change)} as const;
  ctx.out.push(
    pageRow(cols, [seg(glyph.closed, here ? theme.accent : theme.faint), sp(1), seg(change.turn.prompt, here ? theme.ink : theme.text)], [], {bg, id, pick: true, act}),
    pageRow(cols, [sp(2), seg(clock(change.turn.at), theme.dim), seg('  ·  ', theme.faint), ...meta(change, agents, ctx.now)], [], {bg, act}),
  );
}

function openTurn(ctx: Ctx, change: TurnChange, agents: AgentRun[]): void {
  const {cols, sel, open, now} = ctx;
  const key = turnKey(change);
  const id = `t:${key}`;
  const here = id === sel;
  const pins = [id];
  const turn = change.turn;
  const act = {type: 'turn', key} as const;

  ctx.out.push(cardTop(cols));
  // Your own words are the title: they are the reason the files moved. A
  // running turn keeps it to two lines, the terminal beside it has the rest.
  const lines = wrap(turn.prompt, cols - 12);
  const shown = lines.slice(0, change.running ? 2 : 3);
  shown.forEach((text, i) => {
    const last = i === shown.length - 1 && lines.length > shown.length;
    ctx.out.push(
      cardRow(
        cols,
        [
          i === 0 ? seg(change.running ? spinner(ctx.frame) : glyph.open, theme.accent) : sp(1),
          sp(1),
          seg(text + (last ? ` ${glyph.ellipsis}` : ''), theme.ink, {bold: true}),
        ],
        i === 0 ? [seg(clock(turn.at), theme.dim)] : [],
        {bg: here ? theme.surface2 : undefined, act, ...(i === 0 ? {id, pick: true} : {})},
      ),
    );
  });
  ctx.out.push(cardRow(cols, [sp(2), ...meta(change, agents, now)], [], {pins}));

  // What Claude said about it. Only once the turn is over: while it runs, the
  // conversation is on screen right next to this pane.
  if (!change.running && (turn.says || turn.firstReplyAt)) {
    ctx.out.push(cardRow(cols, [], [], {pins}));
    const thought = turn.firstReplyAt - turn.at;
    if (thought >= 1000) ctx.out.push(cardRow(cols, [seg(glyph.thought, theme.faint), seg(` Thought for ${span(thought)}`, theme.dim)], [], {pins}));
    if (turn.says) {
      const saysId = `s:${key}`;
      const all = open.says.has(key);
      const text = wrap(turn.says.replace(/[*_`#>]/g, ''), cols - 8);
      const some = all ? text : text.slice(0, 2);
      some.forEach((line, i) => {
        const more = !all && i === some.length - 1 && text.length > some.length;
        // Leave room for the word "more" rather than letting it be cut off.
        const shownText = more ? [...line].slice(0, cols - 16).join('').trimEnd() + glyph.ellipsis : line;
        ctx.out.push(
          cardRow(cols, [sp(2), seg(shownText, theme.text), ...(more ? [sp(1), seg('more', theme.dim, {underline: true})] : [])], [], {
            pins,
            bg: saysId === sel ? theme.surface2 : undefined,
            act: {type: 'toggle', set: 'says', key},
            ...(i === 0 ? {id: saysId, pick: text.length > 2} : {}),
          }),
        );
      });
    }
  }

  if (change.files.length || agents.length || turn.actions.length) ctx.out.push(cardRow(cols, [], [], {pins}));

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
      cardRow(cols, [sp(2), seg(`${change.files.length - FILES_SHOWN} more files`, moreId === sel ? theme.accent : theme.dim)], [], {
        id: moreId, pick: true, pins, bg: moreId === sel ? theme.surface2 : undefined, act: {type: 'toggle', set: 'more', key},
      }),
    );
  }

  // Subagents, grouped by agent. One row each; open one for what it did.
  agents.forEach((agent, i) => agentRow(ctx, agent, i, change, pins));

  // Every tool call, folded into one row. The list is there when you want it.
  if (turn.actions.length) {
    const stepsId = `w:${key}`;
    const isOpen = open.steps.has(key);
    const tally = new Map<string, number>();
    for (const action of turn.actions) tally.set(action.tool, (tally.get(action.tool) ?? 0) + 1);
    const summary = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([tool, n]) => `${tool} ${n}`).join('  ');
    const last = turn.actions[turn.actions.length - 1]!;
    const bg = stepsId === sel ? theme.surface2 : undefined;
    ctx.out.push(
      change.running
        ? cardRow(cols, [seg(spinner(ctx.frame), theme.accent), sp(1), seg(last.tool.padEnd(9), theme.accent), seg(last.why || path.basename(last.file ?? ''), theme.text)], [seg(`${turn.actions.length} steps`, theme.faint)], {
            id: stepsId, pick: true, pins, bg, act: {type: 'toggle', set: 'steps', key},
          })
        : cardRow(cols, [seg(isOpen ? glyph.open : glyph.closed, stepsId === sel || isOpen ? theme.accent : theme.faint), sp(1), seg('Steps'.padEnd(9), theme.dim), seg(summary, theme.faint)], [seg(String(turn.actions.length), theme.dim)], {
            id: stepsId, pick: true, pins, bg, act: {type: 'toggle', set: 'steps', key},
          }),
    );
    if (isOpen) {
      const from = Math.max(0, turn.actions.length - STEPS_SHOWN);
      if (from > 0) ctx.out.push(cardRow(cols, [sp(4), seg(`${from} earlier steps`, theme.faint)], [], {pins: [...pins, stepsId]}));
      for (const action of turn.actions.slice(from)) {
        const label = action.why || (action.file ? path.basename(action.file) : action.detail);
        ctx.out.push(
          cardRow(cols, [sp(4), seg(action.tool.padEnd(9), action.wrote ? theme.text : theme.faint), seg(label, action.wrote ? theme.text : theme.dim)], [seg(clock(action.at), theme.faint)], {
            pins: [...pins, stepsId],
          }),
        );
      }
    }
  }

  ctx.out.push(cardBottom(cols));
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
  const bg = here ? theme.surface2 : undefined;

  ctx.out.push(
    cardRow(
      cols,
      [
        seg(isOpen ? glyph.open : glyph.closed, here || isOpen ? theme.accent : theme.faint),
        sp(1),
        seg(agentLabel(index).padEnd(3), agentColour(index), {bold: true}),
        sp(agent.depth > 1 ? 2 : 0),
        // "general-purpose" says nothing. A kind that was chosen does.
        ...(agent.type === 'general-purpose' ? [] : [seg(`${agent.type}  `, theme.ink)]),
        seg(doing, status === 'running' ? theme.ink : theme.text),
      ],
      [...agentStatus(agent, now, ctx.frame), sp(1), seg(span((status === 'running' ? now : agent.endedAt) - agent.startedAt).padStart(7), theme.dim), sp(1), seg(tokens(agent.tokens).padStart(5), theme.faint)],
      {id, pick: true, pins, bg, act: {type: 'toggle', set: 'agents', key: agent.id}},
    ),
  );
  if (!isOpen) return;

  const inner = [...pins, id];
  const row = (left: Seg[], right: Seg[] = []) => ctx.out.push(cardRow(cols, [sp(5), ...left], right, {pins: inner}));
  row([seg(`${agent.type}  ·  ${modelName(agent.model)}  ·  ${agent.steps.length} step${agent.steps.length === 1 ? '' : 's'}  ·  ${tokens(agent.tokens)} tokens`, theme.faint)]);
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
  const newest = changes[changes.length - 1];

  for (const change of [...changes].reverse()) {
    const when = dayLabel(change.turn.at, now);
    const mark = `${change.chatId}|${when}`;
    if (mark !== section) {
      if (section) ctx.out.push(blankRow(cols));
      section = mark;
      ctx.out.push(pageRow(cols, [seg(change.chat, theme.dim)], [seg(when, theme.faint)]));
    }

    const key = turnKey(change);
    const agents = byAgent.get(key) ?? [];
    // Flipped by hand, or the newest turn, but not both.
    const isOpen = open.turns.has(key) !== (change === newest);
    if (isOpen) openTurn(ctx, change, agents);
    else closedTurn(ctx, change, agents);
  }
}

const LETTER: Record<FileStatus, string> = {added: 'A', modified: 'M', deleted: 'D', renamed: 'R'};
const LETTER_COLOUR: Record<FileStatus, string> = {added: theme.add, modified: theme.warn, deleted: theme.del, renamed: theme.link};

function byFile(ctx: Ctx): void {
  const {cols, sel, open} = ctx;
  if (ctx.histories.length === 0) return;
  ctx.out.push(cardTop(cols));
  for (const history of ctx.histories) {
    const id = `h:${history.rel}`;
    const here = id === sel;
    const isOpen = open.hists.has(history.rel);
    const n = history.touches.length;
    ctx.out.push(
      cardRow(
        cols,
        [seg(isOpen ? glyph.open : glyph.closed, here || isOpen ? theme.accent : theme.faint), sp(1), seg(LETTER[history.status], LETTER_COLOUR[history.status]), sp(2), ...pathSegs(history.rel, true)],
        [seg(`${n} turn${n === 1 ? '' : 's'}`, theme.faint), sp(2), ...(history.measured ? counts(history.added, history.removed) : [seg('not recorded', theme.faint, {italic: true})])],
        {id, pick: true, bg: here ? theme.surface2 : undefined, act: {type: 'toggle', set: 'hists', key: history.rel}},
      ),
    );
    if (!isOpen) continue;
    for (const touch of [...history.touches].reverse()) {
      fileRow(
        ctx,
        fileKey(turnKey(touch.change), history.rel),
        history.rel,
        history.status === 'deleted' ? null : history.path,
        [sp(2), seg(clock(touch.change.turn.at), theme.accent), sp(2), seg(touch.change.turn.prompt, theme.text)],
        touch.change.measured ? counts(touch.added, touch.removed) : [seg('not recorded', theme.faint, {italic: true})],
        [id],
      );
    }
  }

  ctx.out.push(cardBottom(cols));
}

function flat(ctx: Ctx): void {
  const {cols} = ctx;
  if (!ctx.flat || ctx.flat.length === 0) return;
  ctx.out.push(cardTop(cols));
  for (const file of ctx.flat) {
    fileRow(
      ctx,
      fileKey('git', file.rel),
      file.rel,
      file.status === 'deleted' ? null : file.path,
      [seg(LETTER[file.status], LETTER_COLOUR[file.status]), sp(2), ...pathSegs(file.rel, true), ...(file.status === 'renamed' && file.fromRel ? [seg(`  from ${file.fromRel}`, theme.faint)] : [])],
      file.binary ? [seg('binary', theme.faint)] : counts(file.added, file.removed),
      [],
    );
  }

  ctx.out.push(cardBottom(cols));
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
