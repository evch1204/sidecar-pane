import {statusOf, type AgentRun} from './agents';
import {pathKey} from './git';
import {sizeLit} from './size';
import {daySummary, type TurnChange} from './turns';
import {landingsOf, stateWord, type Landing, type WorktreeRun} from './worktrees';

// The facts Home is drawn from, worked out from what App already holds. Home
// says the same things the bar and the stream say, so it asks the same
// questions in the same order: a page that disagreed with the status beside it
// would be worse than no page.

export type NowState = 'reading' | 'agents' | 'asking' | 'working' | 'yours' | 'idle';

export type HomeFacts = {
  now: NowState;
  // The newest turn's prompt, and how long it has run or since it ended.
  prompt: string | null;
  elapsedMs: number | null;
  // The tool the turn is inside, or null.
  tool: string | null;
  agentsRunning: number;
  // Of those, in a folder that is not the pane's.
  agentsElsewhere: number;
  // Folders other than this one with work that has not arrived here.
  unmerged: number;
  // Today only.
  landings: Landing[];
  // Null until loaded, or when nothing happened today.
  today: {turns: number; added: number; removed: number; spanMs: number; heights: number[]} | null;
  workspaces: {total: number; active: number};
};

export type HomeFactsInput = {
  root: string;
  now: number;
  loaded: boolean;
  changes: TurnChange[];
  agents: AgentRun[];
  worktrees: WorktreeRun[];
  asking: boolean;
  working: boolean;
  newest: TurnChange | undefined;
};

const sameDay = (a: number, b: number): boolean => new Date(a).toDateString() === new Date(b).toDateString();

export function homeFacts(input: HomeFactsInput): HomeFacts {
  const {root, now, loaded, changes, agents, worktrees, asking, working, newest} = input;
  const rootKey = pathKey(root);

  const running = agents.filter(run => statusOf(run, now) === 'running');
  // An agent with no folder of its own ran in the pane's.
  const elsewhere = running.filter(run => {
    const folder = run.worktree?.path || run.cwd;
    return Boolean(folder) && pathKey(folder!) !== rootKey;
  });

  // The pane's own turn is work in its folder too, though no agent file says so.
  const words = worktrees.map(wt => ({wt, word: stateWord(wt, now, wt.here && working)}));
  const live = (word: string): boolean => word === 'working' || word === 'ahead' || word === 'dirty';

  // Same order as the status at the right of the bar.
  const state: NowState = !loaded
    ? 'reading'
    : running.length
      ? 'agents'
      : asking
        ? 'asking'
        : working && newest
          ? 'working'
          : newest?.turn.ended && sameDay(newest.turn.endedAt, now)
            ? 'yours'
            : 'idle';

  const lastAction = newest?.turn.actions[newest.turn.actions.length - 1];

  return {
    now: state,
    prompt: loaded && newest ? newest.turn.prompt : null,
    elapsedMs: loaded && newest ? Math.max(0, now - (newest.running ? newest.turn.at : newest.turn.endedAt)) : null,
    tool: working && lastAction ? lastAction.tool : null,
    agentsRunning: running.length,
    agentsElsewhere: elsewhere.length,
    unmerged: words.filter(({wt, word}) => !wt.here && live(word)).length,
    landings: landingsOf(worktrees).filter(landing => sameDay(landing.at, now)),
    today: loaded ? today(changes, now) : null,
    workspaces: {total: worktrees.length, active: words.filter(({word}) => live(word)).length},
  };
}

// Today across every chat: the day header's own grouping, summed, so Home and
// the stream never count a different day.
function today(changes: TurnChange[], now: number): HomeFacts['today'] {
  const groups = daySummary(changes, now).filter(group => sameDay(group.day, now));
  if (!groups.length) return null;

  const turns = groups.flatMap(group => group.turns).sort((a, b) => a.turn.at - b.turn.at);
  const first = turns[0]!.turn.at;
  // First prompt to last reply, not each chat's span added up: two chats open
  // at once are one stretch of the day, not two.
  const last = Math.max(...turns.map(change => (change.running ? now : change.turn.endedAt)));
  return {
    turns: turns.length,
    added: groups.reduce((n, group) => n + group.added, 0),
    removed: groups.reduce((n, group) => n + group.removed, 0),
    spanMs: Math.max(0, last - first),
    heights: turns.map(change => sizeLit(change.added + change.removed)),
  };
}
