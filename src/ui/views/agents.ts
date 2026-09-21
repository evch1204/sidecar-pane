import {statusOf, type AgentRun} from '../../core/agents';
import type {TurnChange} from '../../core/turns';
import {blankRow, cardBottom, cardRow, cardTop, pageRow, seg, sp, tokens, type Line, type Seg} from '../cells';
import {glyph, theme} from '../theme';
import {wrap} from '../util';
import {agentRow, agentsByTurn, clock, dayLabel, spinner, turnKey, type Open} from './changes';

// When Claude hands work to subagents, its own screen mostly goes quiet. This
// view is the part you cannot see from the terminal: who was started, for
// which prompt, what each one is doing now and what it handed back.

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

export function agentsLines(input: AgentsInput): Line[] {
  const {cols, now, changes} = input;
  const out: Line[] = [];
  const byTurn = agentsByTurn(changes, input.agents);
  let section = '';

  for (const change of [...changes].reverse()) {
    const agents = byTurn.get(turnKey(change));
    if (!agents?.length) continue;

    const when = dayLabel(change.turn.at, now);
    const mark = `${change.chatId}|${when}`;
    if (mark !== section) {
      if (section) out.push(blankRow(cols));
      section = mark;
      out.push(pageRow(cols, [seg(change.chat, theme.dim)], [seg(when, theme.faint)]));
    }

    const running = agents.filter(a => statusOf(a, now) === 'running').length;
    const done = agents.filter(a => statusOf(a, now) === 'done').length;
    const spent = agents.reduce((n, a) => n + a.tokens, 0);
    const summary: Seg[] = [seg(`${agents.length} agent${agents.length === 1 ? '' : 's'}`, theme.dim)];
    if (running) summary.push(seg('  ·  ', theme.faint), seg(`${running} running`, theme.accent));
    if (done) summary.push(seg('  ·  ', theme.faint), seg(`${done} done`, theme.dim));
    summary.push(seg('  ·  ', theme.faint), seg(`${tokens(spent)} tokens`, theme.dim));

    const id = `g:${turnKey(change)}`;
    const here = id === input.sel;
    out.push(cardTop(cols));
    wrap(change.turn.prompt, cols - 12).slice(0, 2).forEach((text, i) => {
      out.push(
        cardRow(cols, [i === 0 ? seg(running ? spinner(input.frame) : glyph.diamond, theme.accent) : sp(1), sp(1), seg(text, theme.ink, {bold: true})], i === 0 ? [seg(clock(change.turn.at), theme.dim)] : [], {
          bg: here ? theme.surface2 : undefined,
          act: {type: 'goTurn', key: turnKey(change)},
          ...(i === 0 ? {id, pick: true} : {}),
        }),
      );
    });
    out.push(cardRow(cols, [sp(2), ...summary], [], {pins: [id]}), cardRow(cols, [], [], {pins: [id]}));
    const ctx = {...input, out};
    agents.forEach((agent, i) => agentRow(ctx, agent, i, change, [id]));
    out.push(cardBottom(cols));
  }

  if (out.length === 0) {
    const text = [
      'No subagents yet.',
      '',
      'When Claude hands part of a job to other agents, each one shows up here: what it was asked, what it is doing right now, and what it handed back.',
    ];
    for (const para of text) for (const line of para ? wrap(para, cols - 4) : ['']) out.push(pageRow(cols, [seg(line, theme.dim)]));
  }

  return out;
}

export function runningAgents(agents: AgentRun[], now: number): number {
  return agents.filter(a => statusOf(a, now) === 'running').length;
}
