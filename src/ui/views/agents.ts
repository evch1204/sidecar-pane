import {statusOf, type AgentRun} from '../../core/agents';
import type {TurnChange} from '../../core/turns';
import {blankRow, pageRow, RIGHT_PAD, seg, sp, spineRow, tokens, widthOf, type Line, type Seg} from '../cells';
import {glyph, theme} from '../theme';
import {wrap} from '../util';
import {
  agentBranch, agentRows, agentsByTurn, agentSummary, agentTree, clock, dayLabel, spinner, turnKey, type Open,
} from './changes';

// When Claude hands work to subagents, its own screen mostly goes quiet. This
// view is the part you cannot see from the terminal: who was started, for
// which prompt, what each one is doing now and what it handed back. The turn's
// prompt is the root of a tree and every agent is a branch off it.

export type AgentsInput = {
  cols: number;
  now: number;
  frame: number;
  root: string;
  changes: TurnChange[];
  agents: AgentRun[];
  open: Pick<Open, 'agents'>;
  sel: string | null;
};

// Past this many agents in one turn, the finished ones fold into one row. The
// ones still running, and the ones that gave up, are always listed.
const FOLD_OVER = 8;

export function agentsLines(input: AgentsInput): Line[] {
  const {cols, now, changes, open} = input;
  const out: Line[] = [];
  const byTurn = agentsByTurn(changes, input.agents);
  let section = '';

  for (const change of [...changes].reverse()) {
    const agents = byTurn.get(turnKey(change));
    if (!agents?.length) continue;

    const when = dayLabel(change.turn.at, now);
    const head = `${change.chatId}|${when}`;
    if (head !== section) {
      section = head;
      out.push(pageRow(cols, [seg(change.chat, theme.dim)], [seg(when, theme.faint)]));
    }

    const key = turnKey(change);
    const id = `g:${key}`;
    const here = id === input.sel;
    const running = agents.filter(a => statusOf(a, now) === 'running').length;
    const live = change.running || running > 0;
    const act = {type: 'goTurn', key} as const;

    // The orchestrator is the root: its own words, with the spinner in the
    // mark column while any of its agents is still working.
    const mark = live ? seg(spinner(input.frame), theme.accent) : seg(glyph.diamond, theme.faint);
    wrap(change.turn.prompt, cols - 13).slice(0, 2).forEach((text, i) => {
      out.push(
        spineRow(cols, [seg(text, theme.ink, {bold: true})], i === 0 ? [seg(clock(change.turn.at), theme.dim)] : [], {
          bg: here ? theme.surface2 : undefined, act, live, ...(i === 0 ? {mark, id, pick: true} : {}),
        }),
      );
    });

    // "tokens" is worth saying when there is room for the word.
    const full = agentSummary(agents, now, true);
    const summary = widthOf(full) <= cols - 4 - RIGHT_PAD ? full : agentSummary(agents, now);
    out.push(spineRow(cols, summary, [], {pins: [id], live, act}));
    out.push(spineRow(cols, [], [], {pins: [id], live}));

    // A crowd of agents folds its finished ones away. The row that says so
    // toggles like an agent row: no chevron, the cursor carries it.
    const foldKey = `fold:${key}`;
    const crowd = agents.length > FOLD_OVER;
    const folded = crowd && !open.agents.has(foldKey);
    const tree = agentTree(agents, agent => !folded || statusOf(agent, now) !== 'done');
    const finished = agents.filter(a => statusOf(a, now) === 'done');
    if (crowd && finished.length) {
      const foldId = `gf:${key}`;
      const onIt = foldId === input.sel;
      const spent = finished.reduce((n, a) => n + a.tokens, 0);
      out.push(
        spineRow(cols, [seg(glyph.check, theme.add), sp(1), seg(`${finished.length} finished`, theme.dim), seg(`  ${glyph.sep}  `, theme.faint), seg(tokens(spent), theme.dim)], [], {
          id: foldId, pick: true, pins: [id], mark: agentBranch([tree.length > 0]).mark, bg: onIt ? theme.surface2 : undefined,
          act: {type: 'toggle', set: 'agents', key: foldKey},
        }),
      );
    }

    agentRows({...input, out}, tree, change, [id]);
    // One blank row after a turn's tree, below it only.
    out.push(blankRow(cols));
  }

  if (out.length === 0) {
    const text = [
      'No subagents yet.',
      '',
      'Ask Claude to hand part of a job to an agent, and each one shows up here while it works: what it was asked, the step it is on, and what it handed back.',
    ];
    for (const para of text) for (const line of para ? wrap(para, cols - 4) : ['']) out.push(pageRow(cols, [seg(line, theme.dim)]));
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
