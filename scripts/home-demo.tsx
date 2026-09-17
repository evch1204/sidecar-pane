// Prints the Home page for the fake afternoon the boards were drawn with, at
// 62 and at 40 columns, colours stripped, so a reviewer can read the layout
// without a terminal. Every row must be exactly `cols - 1` wide: the last
// column is the scrollbar's. A row that is not says which and the run exits
// non-zero.
//   npx tsx scripts/home-demo.tsx

import type {HomeFacts} from '../src/core/home';
import type {Landing, WorktreeRun} from '../src/core/worktrees';
import {widthOf} from '../src/ui/cells';
import {homeLines, type HomeInput} from '../src/ui/views/home';

// Tuesday 23 September, 14:45, in whatever zone the machine is in.
const now = new Date(2025, 8, 23, 14, 45).getTime();
const MIN = 60_000;

// Only the fields the page reads: the landing's time.
const landing = {
  wt: {name: 'agent-a868', branch: 'commit-backed-turns'} as WorktreeRun,
  at: new Date(2025, 8, 23, 13, 20).getTime(),
  files: [],
  added: 0,
  removed: 0,
  commits: 1,
} satisfies Landing;

const facts: HomeFacts = {
  now: 'agents',
  prompt: 'i think option 3 is exactly what i want. and when it opens\nit should say where i am',
  elapsedMs: 47 * MIN,
  tool: null,
  agentsRunning: 2,
  agentsElsewhere: 2,
  unmerged: 2,
  landings: [landing],
  today: {turns: 11, added: 4180, removed: 1630, spanMs: (5 * 60 + 40) * MIN, heights: [1, 0, 5, 0, 0, 2, 4, 3, 4, 3, 1]},
  workspaces: {total: 5, active: 3},
};

const input = (cols: number): HomeInput => ({
  cols,
  now,
  frame: 2,
  project: 'sidecar-pane',
  branch: 'improve-pane-layout',
  folder: 'jiaolong',
  facts,
  usage: {pct: 58, leftMs: 112 * MIN},
  changed: 3,
  agentsTab: true,
  workspaces: true,
  sel: 'home:go:1',
  working: true,
  next: {type: 'focus', path: '/work/agent-a384'},
});

let failed = 0;
for (const cols of [62, 40]) {
  console.log(`--- ${cols} columns ${'-'.repeat(Math.max(0, cols - 16))}`);
  homeLines(input(cols)).forEach((line, i) => {
    const text = line.segs.map(s => s.text).join('');
    const w = widthOf(line.segs);
    console.log(`${text}|`);
    if (w !== cols - 1) {
      failed++;
      console.error(`row ${i} at ${cols} columns is ${w} wide, not ${cols - 1}`);
    }
  });
}

if (failed) process.exit(1);
console.log('every row is cols - 1 wide');
