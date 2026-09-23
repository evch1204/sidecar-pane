// Prints the side panel for the afternoon the boards were drawn with, open and
// folded, in a tall pane and a short one, so the panel can be read without a
// terminal. Every row is checked to be exactly as wide as the panel; a row that
// is not says which, and the run exits non-zero.
//   npx tsx scripts/panel-demo.tsx
import {widthOf} from '../src/ui/cells';
import {panelMode, panelRows, panelWidth, type PanelInput, type PanelRow} from '../src/ui/panel';
import {hues} from '../src/ui/theme';

// jiaolong on improve-pane-layout, 14:45: two agents running in folders of
// their own, one that merged at 13:20 and whose folder is gone, and main.
const now = new Date(2026, 8, 23, 14, 45).getTime();
const base: Omit<PanelInput, 'mode' | 'rows'> = {
  view: 'changes',
  // The frame that draws `⠹`, as the boards do.
  frame: 2,
  now,
  counts: {changes: 8, files: 3, agents: 2, agentsLive: true, usage: '58%', workspaces: 3},
  agentsTab: true,
  workspaces: [
    {path: null, label: 'improve-pane-layout', hue: hues[0], state: 'working', live: true},
    {path: 'C:/work/sidecar-pane/.claude/worktrees/agent-a384', label: 'usage round three', hue: hues[1], state: 'working', live: true},
    {path: 'C:/work/sidecar-pane/.claude/worktrees/agent-aeed', label: 'markdown page view', hue: hues[2], state: 'working', live: true},
    {path: 'C:/work/sidecar-pane/.claude/worktrees/agent-a868', label: 'commit-backed turns', hue: hues[3], state: 'merged', live: false},
    {path: 'C:/Users/evanc/Desktop/sidecar-pane', label: 'main', hue: hues[4], state: 'clean', live: false},
  ],
  focus: null,
  scope: 'mine',
  cursor: null,
};

// What a row does, in a word, so the printout shows the zones as well as the text.
const does = (row: PanelRow): string => {
  const act = row.zones[0]?.act;
  if (!act) return '';
  if (act.type === 'view') return `view ${act.view}`;
  if (act.type === 'focus') return `focus ${act.path === null ? 'here' : act.path.split('/').pop()}`;
  if (act.type === 'scope') return `scope ${act.scope}`;
  if (act.type === 'panel') return `panel ${act.to ?? ''}`.trim();
  if (act.type === 'menu') return `menu ${act.menu}`;
  return act.type;
};

let failed = 0;
for (const mode of ['open', 'folded'] as const) {
  for (const rows of [40, 12]) {
    const want = panelWidth(mode);
    const out = panelRows({...base, mode, rows});
    console.log(`\n${mode}, ${rows} rows, ${want} columns`);
    if (out.length !== rows) {
      failed++;
      console.log(`  FAIL: ${out.length} rows, expected ${rows}`);
    }

    out.forEach((row, i) => {
      const text = row.segs.map(s => s.text).join('');
      const w = widthOf(row.segs);
      const zoneOk = row.zones.every(z => z.from === 0 && z.to === want);
      if (w !== want || !zoneOk) failed++;
      const note = w !== want ? `  FAIL: ${w} columns` : !zoneOk ? '  FAIL: zone does not cover the row' : '';
      // The tall pane is mostly blank at the bottom: stop printing once only
      // blank rows are left.
      if (rows === 40 && out.slice(i).every(r => !r.zones.length && !r.segs.map(s => s.text).join('').slice(0, -1).trim())) return;
      console.log(`  ${text}  ${does(row)}${note}`);
    });
    if (rows === 40) console.log(`  … blank to row ${rows}`);
  }
}

// The widths each mode comes in at, and the environment winning over both.
const modes: [number, 'open' | 'folded' | undefined, string | undefined, string][] = [
  [100, undefined, undefined, 'open'],
  [72, undefined, undefined, 'folded'],
  [72, 'open', undefined, 'open'],
  [60, 'open', undefined, 'off'],
  [100, 'folded', 'off', 'off'],
];
for (const [cols, pref, env, want] of modes) {
  const got = panelMode(cols, pref, env);
  if (got !== want) {
    failed++;
    console.log(`FAIL: panelMode(${cols}, ${pref}, ${env}) = ${got}, expected ${want}`);
  }
}

console.log(failed ? `\n${failed} failed` : '\nevery row is exactly as wide as its panel');
process.exit(failed ? 1 : 0);
