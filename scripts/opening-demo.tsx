// Prints the opening as a strip of frames, so the sequence can be read without
// a terminal: the card at seven moments, then three moments of Home pushing it
// down and off. Colour is left out; what you see is the layout.
//   npx tsx scripts/opening-demo.tsx
// Every row is checked to be exactly one column short of the pane, the last
// column being the scrollbar's. A row that is not exits non-zero.

import {pageRow, seg, widthOf, type Line} from '../src/ui/cells';
import {OPENING, openingCard, openingPush, tPushStart, type OpeningInput} from '../src/ui/opening';
import {theme} from '../src/ui/theme';

const COLS = 62;
const HEIGHT = 40;

// A read that is not instant: the transcripts are in at 0.9s, the commits
// measured at 1.5s, so the bar is seen waiting and then catching up.
const COUNTS_AT = 900;
const LOADED_AT = 1500;

const at = (t: number): OpeningInput => ({
  cols: COLS,
  height: HEIGHT,
  folder: 'jiaolong',
  branch: 'improve-pane-layout',
  chats: 3,
  counts: t >= COUNTS_AT ? {chats: 3, turns: 41, agents: 12} : null,
  loaded: t >= LOADED_AT,
  today: t >= LOADED_AT ? {added: 4180, removed: 1630} : null,
  t,
  frame: Math.floor(t / 80),
  countsAt: COUNTS_AT,
  loadedAt: LOADED_AT,
});

let bad = 0;
const text = (line: Line): string => line.segs.map(s => s.text).join('');
const checkWidth = (lines: Line[], label: string) => {
  lines.forEach((line, i) => {
    const w = widthOf(line.segs);
    if (w !== COLS - 1) {
      bad++;
      console.error(`FAIL ${label}: row ${i} is ${w} columns, not ${COLS - 1}`);
    }
  });
  if (lines.length !== HEIGHT) {
    bad++;
    console.error(`FAIL ${label}: ${lines.length} rows, not ${HEIGHT}`);
  }
};

// Only the rows with something on them, and the row numbers they sit on, so
// forty mostly blank rows do not bury the card.
const show = (lines: Line[], label: string, all = false) => {
  const rows = lines.map(text);
  const used = rows.map((row, i) => (row.trim() ? i : -1)).filter(i => i >= 0);
  const from = all || !used.length ? 0 : used[0]!;
  const to = all || !used.length ? rows.length - 1 : used[used.length - 1]!;
  console.log(`--- ${label}  (rows ${from}-${to} of ${rows.length})`);
  for (let i = from; i <= to; i++) console.log(`${String(i).padStart(2)}|${rows[i]}|`);
  console.log('');
};

for (const t of [0, 450, 700, 1300, 2100, 2600, 3000]) {
  const card = openingCard(at(t));
  checkWidth(card, `t=${t}`);
  show(card, `t=${t}ms`);
}

// A Home of 22 rows, numbered so the push can be followed.
const home: Line[] = Array.from({length: 22}, (_, i) =>
  pageRow(COLS, [seg(`home row ${i + 1}`, theme.text)], [seg('·', theme.faint)]),
);

const start = tPushStart(at(3000));
if (start === null) {
  bad++;
  console.error('FAIL the push never starts: tPushStart is null once loaded');
} else {
  console.log(`tPushStart = ${start}ms\n`);
  for (const k of [5, 14, home.length + 1]) {
    const t = start + k * OPENING.PUSH_STEP;
    const {lines, done} = openingPush(at(t), home);
    checkWidth(lines, `push t=${t}`);
    show(lines, `push t=${t}ms  k=${k}  done=${done}`, true);
  }
}

if (bad) {
  console.error(`${bad} problem${bad === 1 ? '' : 's'}.`);
  process.exit(1);
}

console.log(`Every row is ${COLS - 1} columns.`);
