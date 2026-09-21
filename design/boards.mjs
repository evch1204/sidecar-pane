import fs from 'node:fs';
import path from 'node:path';
import {box, lower, column, meter, hline,
  C, s, sp, bar, guide, hole, P, K, W, blank, edgeTop, edgeBottom, halfK, halfW, when, tok, dl, hunkHead, gap,
  page, header, hints, stats, step, turnRow, setRail, dump, len, fit} from './lib.mjs';

import {fileURLToPath} from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'project');
// The boards quote real code. These are the files as they were when the boards
// were drawn, so a rebuild gives the same picture after the code moves on.
const src = rel => fs.readFileSync(path.join(HERE, 'samples', path.basename(rel)), 'utf8').split('\n');
const files = {};
const text = {};

const changesBar = active => {
  const chip = (label, on) => s(label, on ? C.ink : C.dim, on ? {b: 1, u: 1} : {});
  return [P([chip('by turn', active === 'turn'), sp(3), chip('by file', active === 'file'), sp(3), chip('all changes', active === 'all')],
    [s('10 files', C.dim), s('  +1139', C.add), s(' −173', C.del)]), blank()];
};
const chatLabel = (title, day) => P([s(title, C.dim)], [s(day, C.faint)]);
const notRecorded = [s('21:36', C.dim), s('  ·  18 files  ·  ', C.dim), s('not recorded', C.faint, {i: 1})];

// ============================================================
// A. Changes, the stream. Interactive: rows open in place.
// ============================================================
{
  const chromeDiff = [
    halfW(C.surface, C.well),
    hunkHead(s('▾', C.faint), 'type TabsProps', '10–14', 1, 0),
    ...dl(' ', 11, '  cols: number;'),
    ...dl(' ', 12, '  filtered: boolean;'),
    ...dl('+', 13, '  note?: string;'),
    ...dl(' ', 14, '};'),
    gap('4 unchanged lines'),
    hunkHead(s('▾', C.faint), 'Tabs()', '19–23', 2, 2),
    ...dl('-', 18, 'export function Tabs({view, changedCount, project, branch, cols, filtered}: TabsProps) {'),
    ...dl('+', 19, 'export function Tabs({view, changedCount, project, branch, cols, filtered, note}: TabsProps) {', {marks: [', note']}),
    ...dl(' ', 20, '  const stops = tabStops(changedCount);'),
    ...dl('-', 21, '  const used = stops[1]!.end + (filtered ? 10 : 0);'),
    ...dl('+', 22, '  const used = stops[1]!.end + (filtered ? 10 : 0) + (note ? note.length + 3 : 0);', {marks: [' + (note ? note.length + 3 : 0)']}),
    ...dl(' ', 23, '  const room = cols - used - 2;'),
    halfW(C.well, C.surface),
  ];
  const appDiff = [
    halfW(C.surface, C.well),
    hunkHead(s('▸', C.faint), 'imports', '1–44', 9, 3),
    hunkHead(s('▸', C.faint), 'useHistory()', '126–166', 41, 0),
    hunkHead(s('▸', C.faint), 'App()', '174–612', 288, 80),
    hunkHead(s('▸', C.faint), 'hintsFor()', '903–955', 43, 8),
    halfW(C.well, C.surface),
  ];
  const tl = src('src/ui/TurnList.tsx');
  const turnListDiff = [
    halfW(C.surface, C.well),
    hunkHead(s('▾', C.faint), 'new file', '1–184', 184, 0),
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8].flatMap(i => dl('+', i + 1, tl[i])),
    gap('175 more added lines'),
    halfW(C.well, C.surface),
  ];
  const cmdOut = [
    halfW(C.surface, C.well),
    W([sp(2), s('> sidecar-pane@0.0.1 typecheck', C.dim)]),
    W([sp(2), s('> tsc --noEmit', C.dim)]),
    W([sp(2), s('exit 0 · 3.1s', C.faint)]),
    halfW(C.well, C.surface),
  ];

  const stream = [
    chatLabel('Terminal CLI diff viewer with mouse support', 'today'),
    edgeTop(),
    K([s('▾', C.accent), sp(1), s('wait so what did you do? did you rebuild or just', C.ink, {b: 1})], [s('22:36', C.dim)]),
    K([sp(2), s('plan out. and it seems like uiux wise nothing changed?', C.ink, {b: 1})]),
    K([sp(2), s('10 files', C.dim), s('  +1139', C.add), s(' −173', C.del), s('  ·  18 min  ·  64 steps', C.dim)]),
    K(),
    K([s('✦', C.faint), s(' Thought for 14s', C.dim)]),
    K([sp(2), s("The list now groups by chat, day and prompt. Each file's", C.text)]),
    K([sp(2), s('diff says which turn wrote which hunk. ', C.text), s('more', C.dim, {u: 1})]),
    K(),
    K([sp(2), s('Read 9 files, searched 4 times', C.faint)]),
    step({chev: hole('chevApp', C.faint), verb: 'Edited', dir: 'src/ui/', name: 'App.tsx', add: 381, del: 91, btn: 'toggleApp'}),
    when('openApp', appDiff),
    step({chev: hole('chevChrome', C.accent, {bg: C.surface2}), verb: 'Edited', dir: 'src/ui/', name: 'Chrome.tsx', add: 4, del: 2, bg: C.surface2, btn: 'toggleChrome'}),
    when('openChrome', chromeDiff),
    step({chev: s('▸', C.faint), verb: 'Edited', dir: 'src/ui/', name: 'Diff.tsx', add: 94, del: 44}),
    step({chev: hole('chevTurnList', C.faint), verb: 'Created', dir: 'src/ui/', name: 'TurnList.tsx', add: 184, btn: 'toggleTurnList'}),
    when('openTurnList', turnListDiff),
    step({chev: s('▸', C.faint), verb: 'Created', dir: 'src/ui/', name: 'Why.tsx', add: 154}),
    step({chev: s('▸', C.faint), verb: 'Created', dir: 'src/ui/', name: 'turnrows.ts', add: 102}),
    step({chev: hole('chevCmd', C.faint), verb: 'Ran', name: 'npm run typecheck', nameFg: C.text, right: [s('✓', C.add)], btn: 'toggleCmd'}),
    when('openCmd', cmdOut),
    K([sp(2), s('4 more', C.dim), s('  PLAN.md  README.md  smoke.tsx  smoke-history.tsx', C.faint)]),
    edgeBottom(),
    blank(),
    when('closedT2', turnRow('i think right now for the changes diff view. it isnt as cl…',
      [s('22:14', C.dim), s('  ·  3 files', C.dim), s('  +577', C.add)], {btn: 'toggleT2'})),
    when('openT2', [
      edgeTop(),
      K([s('▾', C.accent), sp(1), s('i think right now for the changes diff view. it isnt', C.ink, {b: 1})], [s('22:14', C.dim)], {btn: 'toggleT2'}),
      K([sp(2), s('as clean as i want. i want it to be a very well build…', C.ink, {b: 1})]),
      K([sp(2), s('3 files', C.dim), s('  +577', C.add), s('  ·  21 min  ·  38 steps', C.dim)]),
      K(),
      step({chev: s('▸', C.faint), verb: 'Created', dir: 'src/core/', name: 'sessions.ts', add: 237}),
      step({chev: s('▸', C.faint), verb: 'Created', dir: 'src/core/', name: 'snapshot.ts', add: 175}),
      step({chev: s('▸', C.faint), verb: 'Created', dir: 'src/core/', name: 'turns.ts', add: 165}),
      edgeBottom(),
    ]),
    ...turnRow("wait so you are telling me right now it wouldn't work on mac?", [s('22:09', C.dim), s('  ·  no file changes', C.faint)]),
    ...turnRow('i have this project that i was originally working on to tr…', notRecorded),
  ];
  // hint for closed-by-default groups
  for (const r of stream) if (r.group && ['openApp', 'openTurnList', 'openCmd', 'openT2'].includes(r.group)) r.hint = 'false';
  setRail(stream, 1, 30, C.thumb);

  const logic = `class Component extends DCLogic {
renderVals() {
const st = this.state || {};
const open = { app: st.app ?? false, chrome: st.chrome ?? true, turnList: st.turnList ?? false, cmd: st.cmd ?? false, t2: st.t2 ?? false };
const flip = (key) => () => this.setState({ [key]: !open[key] });
const chev = (on) => (on ? '▾' : '▸');
return {
openApp: open.app, chevApp: chev(open.app), toggleApp: flip('app'),
openChrome: open.chrome, chevChrome: chev(open.chrome), toggleChrome: flip('chrome'),
openTurnList: open.turnList, chevTurnList: chev(open.turnList), toggleTurnList: flip('turnList'),
openCmd: open.cmd, chevCmd: chev(open.cmd), toggleCmd: flip('cmd'),
openT2: open.t2, closedT2: !open.t2, toggleT2: flip('t2'),
};
}
}`;
  files['Main.dc.html'] = page({title: 'Changes, the stream', top: [...header('changes', ['idle']), ...changesBar('turn')], stream,
    bottom: hints([['↑↓', 'move'], ['enter', 'open'], ['v', 'group'], ['/', 'find']]), logic});
  text['Main'] = stream;
}

// ============================================================
// B. Changes while Claude works.
// ============================================================
{
  const t = src('src/core/turns.ts');
  const live = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].flatMap(i => dl('+', i + 1, t[i]));
  const stream = [
    chatLabel('Terminal CLI diff viewer with mouse support', 'today'),
    edgeTop(),
    K([s('⠹', C.accent, {cls: 'pulse'}), sp(1), s('i think right now for the changes diff view. it isnt', C.ink, {b: 1})], [s('22:14', C.dim)]),
    K([sp(2), s('as clean as i want. i want it to be a very well build', C.ink, {b: 1})]),
    K([sp(2), s('clean changes file almost like it will show exactly… ', C.ink, {b: 1}), s('more', C.dim, {u: 1})]),
    K([sp(2), s('running', C.accent), s('  ·  6m 02s  ·  3 files so far', C.dim), s('  +440', C.add)]),
    K(),
    K([s('✦', C.faint), s(' Thought for 21s', C.dim)]),
    K([sp(2), s("Every change needs a reason. I'll read Claude Code's own", C.text)]),
    K([sp(2), s('session files and tie each change to the prompt behind it.', C.text)]),
    K(),
    K([sp(2), s('Read 11 files, searched 5 times', C.faint)]),
    step({chev: s('▸', C.faint), verb: 'Created', dir: 'src/core/', name: 'sessions.ts', add: 237}),
    step({chev: s('▸', C.faint), verb: 'Created', dir: 'src/core/', name: 'snapshot.ts', add: 175}),
    step({chev: s('▾', C.accent, {bg: C.surface2}), verb: 'Writing', verbFg: C.accent, dir: 'src/core/', name: 'turns.ts', add: 28, bg: C.surface2}),
    halfW(C.surface, C.well),
    hunkHead(s('▾', C.faint), 'new file', 'lines land as Claude writes them', 0, 0),
    ...live,
    W([bar(C.add), sp(4), sp(1), s('+', C.add), sp(1), s('▍', C.accent, {cls: 'pulse'})], [], {bg: C.addBg}),
    halfW(C.well, C.surface),
    K([s('⠹', C.accent, {cls: 'pulse'}), sp(1), s('Running'.padEnd(9), C.accent), s('npx tsx scripts/smoke.tsx', C.text)], [s('8s', C.dim)]),
    edgeBottom(),
    blank(),
    ...turnRow("wait so you are telling me right now it wouldn't work on mac?", [s('22:09', C.dim), s('  ·  no file changes', C.faint)]),
    ...turnRow('i have this project that i was originally working on to tr…', notRecorded),
  ];
  files['Changes-live.dc.html'] = page({title: 'Changes while Claude works', top: [...header('changes', ['working']), ...changesBar('turn')], stream,
    bottom: hints([['↑↓', 'move'], ['enter', 'open'], ['f', 'follow'], ['v', 'group']])});
  text['Changes-live'] = stream;
}

// ============================================================
// C. A long diff. The turn and the file stay pinned.
// ============================================================
{
  const stream = [
    K([s('▾', C.faint), sp(1), s('wait so what did you do? did you rebuild or just…', C.dim)], [s('22:36', C.faint)]),
    step({chev: s('▾', C.accent, {bg: C.surface2}), verb: 'Edited', dir: 'src/ui/', name: 'Diff.tsx', bg: C.surface2,
      right: [s('hunk 2 of 5', C.dim), sp(2), ...stats(94, 44, 4)]}),
    halfW(C.surface2, C.well),
    ...dl('+', 17, '};'),
    ...dl('+', 18, ''),
    ...dl('+', 19, "// A file's diff can arrive in several pieces, one per turn that touched it."),
    ...dl('+', 20, 'export type DiffGroup = {'),
    ...dl('+', 21, '  key: string;'),
    ...dl('+', 22, '  band: Band | null;'),
    ...dl('+', 23, '  file: FileDiff | null;'),
    ...dl('+', 24, '  note?: string;'),
    ...dl('+', 25, '};'),
    ...dl('+', 26, ''),
    hunkHead(s('▾', C.faint), 'type ViewRow', '27–46', 4, 1),
    ...dl(' ', 27, 'export type ViewRow ='),
    ...dl('+', 28, "  | {kind: 'band'; band: Band}"),
    ...dl(' ', 29, '  | {'),
    ...dl(' ', 30, "      kind: 'hunk';"),
    ...dl('+', 31, '      group: number;'),
    ...dl(' ', 32, '      hunk: number;'),
    gap('9 unchanged lines'),
    ...dl(' ', 42, '    }'),
    ...dl('-', 25, "  | {kind: 'gap'; hunk: number; count: number}"),
    ...dl('+', 43, "  | {kind: 'gap'; group: number; hunk: number; count: number}", {marks: ['group: number; ']}),
    ...dl(' ', 44, "  | {kind: 'line'; line: DiffLine}"),
    ...dl(' ', 45, "  | {kind: 'note'; text: string; tone?: 'dim' | 'warn'};"),
    hunkHead(s('▸', C.faint), 'viewRows()', '48–115', 38, 29),
    hunkHead(s('▸', C.faint), 'DiffBody()', '131–204', 31, 11),
    hunkHead(s('▸', C.faint), 'bandRow()', '238–266', 20, 3),
    halfW(C.well, C.surface),
    step({chev: s('▸', C.faint), verb: 'Created', dir: 'src/ui/', name: 'TurnList.tsx', add: 184}),
    step({chev: s('▸', C.faint), verb: 'Created', dir: 'src/ui/', name: 'Why.tsx', add: 154}),
    step({chev: s('▸', C.faint), verb: 'Created', dir: 'src/ui/', name: 'turnrows.ts', add: 102}),
    step({chev: s('▸', C.faint), verb: 'Ran', name: 'npm run typecheck', nameFg: C.text, right: [s('✓', C.add)]}),
    K([sp(2), s('4 more', C.dim), s('  PLAN.md  README.md  smoke.tsx  smoke-history.tsx', C.faint)]),
    edgeBottom(),
    blank(),
    ...turnRow('i think right now for the changes diff view. it isnt as cl…', [s('22:14', C.dim), s('  ·  3 files', C.dim), s('  +577', C.add)]),
    ...turnRow("wait so you are telling me right now it wouldn't work on mac?", [s('22:09', C.dim), s('  ·  no file changes', C.faint)]),
  ];
  setRail(stream, 9, 31, C.thumb);
  files['Changes-pinned.dc.html'] = page({title: 'Changes, a long diff', top: [...header('changes', ['idle']), ...changesBar('turn')], stream,
    bottom: hints([['↑↓', 'line'], ['n', 'hunk'], [']', 'file'], ['enter', 'fold']])});
  text['Changes-pinned'] = stream;
}

// ============================================================
// D. Files. The tree, with a file peeked in place. Interactive.
// ============================================================
const filesBar = () => [P([s('all', C.ink, {b: 1, u: 1}), sp(3), s('changed 10', C.dim), sp(3), s('this turn 10', C.dim)], [s('/', C.text), s(' find a file', C.faint)]), blank()];
const LETTER = {M: C.warn, A: C.add, D: C.del};
function treeRow(depth, kind, name, o = {}) {
  const guides = Array.from({length: depth}, () => [guide(), sp(1)]).flat().map(x => ({...x, bg: o.bg}));
  const mark = kind === 'dir' ? (o.chev ?? s(o.open ? '▾' : '▸', C.dim)) : kind === 'open' ? (o.chev ?? s('▾', C.accent)) : sp(1);
  const right = kind === 'dir'
    ? (o.changed ? [s(o.changed + ' changed', C.faint)] : [])
    : o.letter ? [...stats(o.add, o.del), sp(2), s(o.letter, LETTER[o.letter])] : [];
  const fg = kind === 'dir' ? C.ink : o.letter ? C.ink : C.text;
  return P([...guides, mark, sp(1), s(name, fg, {b: kind === 'dir' ? 0 : 0})], [...right, sp(1)], {bg: o.bg, btn: o.btn});
}
const app = src('src/ui/App.tsx');
const CHANGED_APP = new Set([129, 130, 131, 132, 133, 137, 141, 142]);
function codeRow(no, line, o = {}) { // page-level code, 62 wide: bar, 4 no, 2 sp, 55 code
  let segs = tok(line, C.text);
  if (len(segs) > 55) segs = [...fitCode(segs, 54), s('…', C.faint)];
  const edge = o.turn ? bar(o.turn) : sp(1);
  return P([edge, s(String(no).padStart(4), o.turn ? C.dim : C.faint), sp(2), ...segs], o.right ?? [], {bg: o.bg});
}
function fitCode(segs, n) { const out = []; let used = 0; for (const x of segs) { const c = [...x.t]; if (used + c.length <= n) { out.push(x); used += c.length; } else { out.push({...x, t: c.slice(0, n - used).join('')}); break; } } return out; }
{
  const peekLines = [];
  for (let n = 128; n <= 141; n++) peekLines.push(...dl(' ', n, app[n - 1], CHANGED_APP.has(n) ? {turn: C.accent, bg: '#15100D'} : {}));
  const peek = [
    edgeTop(),
    K([s('src', C.dim), s(' › ', C.faint), s('ui', C.dim), s(' › ', C.faint), s('App.tsx', C.ink, {b: 1})], [s('TSX · 955 lines', C.dim)]),
    K([s('last changed 22:36 by ', C.dim), s('“wait so what did you do? did you…”', C.text)]),
    halfW(C.surface, C.well),
    W([sp(1), s('function useHistory(root, active, live)', C.link)], [s('change 1 of 4', C.faint), sp(1)], {bg: C.scope}),
    ...peekLines,
    gap('3 more changed places below'),
    halfW(C.well, C.surface),
    K([{...s('enter', C.text), href: 'Files-reader.dc.html'}, {...s(' read all', C.dim), href: 'Files-reader.dc.html'}, sp(3), s('d', C.text), s(' diff', C.dim), sp(3), s(']', C.text), s(' next change', C.dim)], [s('esc', C.text), s(' close', C.dim)]),
    edgeBottom(),
  ];
  const coreRows = ['diff.ts', 'file.ts', 'git.ts', 'highlight.ts', 'sessions.ts', 'snapshot.ts', 'tree.ts', 'turns.ts', 'words.ts'].map(n => treeRow(2, 'file', n));
  const stream = [
    treeRow(0, 'dir', 'scripts', {changed: 2}),
    treeRow(0, 'dir', 'src', {open: 1, changed: 6}),
    treeRow(1, 'dir', 'core', {chev: hole('chevCore', C.dim), btn: 'toggleCore'}),
    when('openCore', coreRows),
    treeRow(1, 'dir', 'ui', {open: 1, changed: 6}),
    treeRow(2, 'open', 'App.tsx', {letter: 'M', add: 381, del: 91, bg: C.surface2, chev: hole('chevPeek', C.accent, {bg: C.surface2}), btn: 'togglePeek'}),
    when('openPeek', peek),
    treeRow(2, 'file', 'ChangeList.tsx'),
    treeRow(2, 'file', 'Chrome.tsx', {letter: 'M', add: 4, del: 2}),
    treeRow(2, 'file', 'Diff.tsx', {letter: 'M', add: 94, del: 44}),
    treeRow(2, 'file', 'Preview.tsx'),
    treeRow(2, 'file', 'Tree.tsx'),
    treeRow(2, 'file', 'TurnList.tsx', {letter: 'A', add: 184}),
    treeRow(2, 'file', 'Why.tsx', {letter: 'A', add: 154}),
    treeRow(2, 'file', 'layout.ts'),
    treeRow(2, 'file', 'mouse.ts'),
    treeRow(2, 'file', 'theme.ts'),
    treeRow(2, 'file', 'turnrows.ts', {letter: 'A', add: 102}),
    treeRow(2, 'file', 'util.ts'),
    treeRow(1, 'file', 'cli.tsx'),
    treeRow(0, 'file', 'CLAUDE.md'),
    treeRow(0, 'file', 'PLAN.md', {letter: 'M', add: 50, del: 2}),
    treeRow(0, 'file', 'README.md', {letter: 'M', add: 32, del: 22}),
    treeRow(0, 'file', 'package.json'),
  ];
  stream.find(r => r.group === 'openCore').hint = 'false';
  const logic = `class Component extends DCLogic {
renderVals() {
const st = this.state || {};
const peek = st.peek ?? true;
const core = st.core ?? false;
return {
openPeek: peek, chevPeek: peek ? '▾' : '▸', togglePeek: () => this.setState({ peek: !peek }),
openCore: core, chevCore: core ? '▾' : '▸', toggleCore: () => this.setState({ core: !core }),
};
}
}`;
  files['Files.dc.html'] = page({title: 'Files, with a peek', top: [...header('files', ['idle']), ...filesBar()], stream,
    bottom: hints([['↑↓', 'move'], ['enter', 'peek'], ['c', 'changed only'], ['/', 'find']]), logic});
  text['Files'] = stream;
}

// ============================================================
// E. Files, the reader. Full height, with who wrote what.
// ============================================================
const crumb = (parts, right) => [P([{...s('‹ Files', C.dim), href: 'Files.dc.html'}, sp(3), ...parts.flatMap((p, i) => [...(i ? [s(' › ', C.faint)] : []), s(p, i === parts.length - 1 ? C.ink : C.dim, {b: i === parts.length - 1 ? 1 : 0})])], right), blank()];
{
  const A = C.accent, B = C.link;
  const who = {129: A, 130: A, 131: B, 132: B, 133: B, 137: A, 141: A, 142: A, 145: B, 146: B, 147: B, 152: A, 153: A};
  const code = [];
  for (let n = 128; n <= 160; n++) {
    const cursor = n === 137;
    code.push(codeRow(n, app[n - 1], {turn: who[n], bg: cursor ? C.surface : undefined,
      right: cursor ? [s('22:36', C.dim, {bg: C.surface}), s(' ●', A, {bg: C.surface}), sp(1)] : []}));
  }
  const stream = [
    edgeTop(),
    K([s('Changed by 2 turns in this chat', C.ink, {b: 1})], stats(465, 91)),
    K([s('●', A), s(' 22:36  ', C.dim), s('wait so what did you do? did you reb…', C.text)], stats(381, 91)),
    K([s('●', B), s(' 22:14  ', C.dim), s('i think right now for the changes di…', C.text)], stats(84, 0)),
    edgeBottom(),
    blank(),
    P([sp(1), s('function useHistory(root, active, live)', C.link)], [s('126–166', C.faint), sp(1)], {bg: C.surface}),
    halfK(C.surface, null),
    ...code,
  ];
  // overview rail: where the changes are in the whole file, and where you are.
  const ticks = {16: A, 17: B, 22: A, 27: A, 31: B, 36: A, 39: B};
  stream.forEach((r, i) => { r.rail = ticks[i] ?? (i >= 8 && i <= 13 ? C.thumb : undefined); });
  files['Files-reader.dc.html'] = page({title: 'Files, the reader', top: [...header('files', ['idle']), ...crumb(['src', 'ui', 'App.tsx'], [s('TSX · 955 lines', C.dim)])], stream,
    bottom: hints([['↑↓', 'scroll'], [']/[', 'change'], ['b', 'who wrote this'], ['d', 'diff'], ['esc', 'back']], [])});
  text['Files-reader'] = stream;
}

// ============================================================
// F. Files, a markdown file, formatted.
// ============================================================
{
  // Word-wrap a rich paragraph to the reading measure.
  const MEASURE = 58;
  function wrapSegs(segs, width) {
    const words = []; // each word: list of {ch, style}
    let cur = [];
    for (const x of segs) for (const ch of [...x.t]) { if (ch === ' ') { if (cur.length) words.push(cur); cur = []; } else cur.push({ch, x}); }
    if (cur.length) words.push(cur);
    const lines = []; let line = [];
    for (const w of words) {
      if (line.length && line.length + 1 + w.length > width) { lines.push(line); line = []; }
      if (line.length) line.push({ch: ' ', x: {}});
      line.push(...w);
    }
    if (line.length) lines.push(line);
    return lines.map(l => { const out = []; let prev = null; for (const c of l) { if (prev && prev.x === c.x) prev.seg.t += c.ch; else { prev = {x: c.x, seg: {...c.x, t: c.ch}}; out.push(prev.seg); } } return out; });
  }
  const para = (segs, o = {}) => wrapSegs(typeof segs === 'string' ? [s(segs, C.text)] : segs, o.width ?? MEASURE).map((l, i) => P([o.turn ? bar(o.turn) : sp(1), sp(1), ...(o.first && i === 0 ? o.first : o.first ? [sp(len(o.first))] : []), ...l]));
  const h2 = t => P([sp(2), s(t, C.accent, {b: 1})]);
  const cellRow = (a, b, o = {}) => P([sp(2), ...fit([sp(1), ...a], [], 11, o.bg), ...fit(b, [], 47, o.bg)]);
  const tr = (name, answer) => wrapSegs([s(answer, C.text)], 46).map((l, i) => cellRow(i ? [] : [s(name, C.ink, {b: 1})], l));
  const li = (done, textLine, o = {}) => para(textLine, {...o, width: MEASURE - 2, first: [s(done ? '✓' : '○', done ? C.add : C.faint), sp(1)]});
  const stream = [
    P([sp(2), s('Sidecar: project plan', C.ink, {b: 1, u: 1})]),
    blank(),
    h2('1. What this is'),
    ...para([s('Sidecar is a ', C.text), s('viewer', C.ink, {b: 1}), s(' that sits beside the Claude Code CLI and shows what Claude is doing to your project while it happens.', C.text)]),
    blank(),
    ...para('You keep typing to Claude on the left. On the right you see your files, which ones Claude just touched, what changed, and a readable preview of any file.'),
    blank(),
    ...para('It has three views:'),
    blank(),
    cellRow([s('View', C.dim)], [s('What it answers', C.dim)], {bg: C.surface}),
    ...tr('Files', 'What is in this project, and which files did Claude just touch?'),
    ...tr('Changes', 'What changed this turn, and this session? Red and green.'),
    ...tr('Preview', 'What does this file look like? Code in colour, markdown formatted.'),
    blank(),
    h2('Progress'),
    ...li(1, 'Day 1 skeleton.'),
    ...li(1, 'Tabs, and the Changes view.'),
    ...li(1, 'Mouse. Click, wheel, drag the divider, drag a scrollbar.'),
    ...li(1, 'Provenance. The Changes view groups by chat, day and prompt, and says which turn wrote which hunk.', {turn: C.accent}),
    ...li(0, 'Formatted markdown, Docs view, status, follow.'),
    blank(),
    h2('Where the history comes from'),
    ...para('Claude Code already writes everything needed, and writes it live. This was checked on this machine, not assumed.', {turn: C.accent}),
    blank(),
    ...para([s('No hooks.', C.ink, {b: 1}), s(' The transcript is flushed message by message: opening the file and reading the bytes appended since last time tells you the chat, the prompt, the tool running right now and when the turn ended. The ', C.text), s('hook.mjs', C.warn), s(' plan stays unbuilt until something actually needs it.', C.text)], {turn: C.accent}),
  ];
  stream.forEach((r, i) => { const changed = r.segs && r.segs[1] && r.segs[1].kind === 'bar'; r.rail = changed ? C.accent : i <= 12 ? C.thumb : undefined; });
  files['Files-markdown.dc.html'] = page({title: 'Files, markdown formatted', top: [...header('files', ['idle']), ...crumb(['PLAN.md'], [s('Markdown · formatted', C.dim)])], stream,
    bottom: hints([['↑↓', 'scroll'], [']/[', 'change'], ['r', 'raw text'], ['d', 'diff'], ['esc', 'back']], [])});
  text['Files-markdown'] = stream;
}

// ============================================================
// G. Usage, opened from the header meters (Version 1 style).
// ============================================================
const PACE = [3, 5, 4, 9, 14, 11, 17, 21, 16, 19];
{
  const chartRow = level => K([sp(2), ...PACE.flatMap((v, i) => { const e = Math.max(0, Math.min(8, v - level * 8)); const col = i === PACE.length - 1 ? C.accent : C.dim; return [e ? column(e, col) : sp(1), e ? column(e, col) : sp(1), sp(1)]; })]);
  const share = [['Fable 5.1', .71, C.accent], ['Opus 5', .18, C.link], ['Sonnet 5', .09, C.string], ['Haiku 4.5', .02, C.keyword]];
  const cells = share.map(([, f]) => Math.max(1, Math.round(f * 60))); cells[0] = 60 - cells.slice(1).reduce((a, n) => a + n, 0);
  const stream = [
    edgeTop(),
    K([s('Usage', C.ink, {b: 1})], [s('esc', C.text), s(' close', C.dim)]),
    K(),
    K([s('Session', C.ink), s('  5 hour window', C.dim)], [s('58%', C.ink, {b: 1})]),
    K([meter(60, .58, C.accent)]),
    K([s('resets in 1h 52m, at 00:40', C.dim)]),
    K(),
    K([s('This week', C.ink), s('  all models', C.dim)], [s('23%', C.ink, {b: 1})]),
    K([meter(60, .23, C.accent)]),
    K([s('resets Thursday 09:00', C.dim)]),
    K(),
    K([s('Pace', C.ink), s('  tokens per half hour, last 5 hours', C.dim)]),
    chartRow(2), chartRow(1), chartRow(0),
    K([sp(2), s('18:00', C.faint)], [s('now', C.faint), sp(29)]),
    K([s('At this pace you reach the session limit around 00:10,', C.warn)]),
    K([s('30 minutes before it resets.', C.warn)]),
    K(),
    K([s('By model', C.ink), s("  share of this week's tokens", C.dim)]),
    K(share.map(([, , col], i) => lower(cells[i], col))),
    K(share.flatMap(([name, f, col], i) => [...(i ? [sp(2)] : []), s('■', col), s(' ' + name + ' ', C.text), s(Math.round(f * 100) + '%', C.dim)])),
    K(),
    K([s('This chat', C.ink), s('  context window', C.dim)], [s('31%', C.ink, {b: 1})]),
    K([meter(60, .31, C.link)]),
    K([s('312k of 1M tokens  ·  cache hit 91%', C.dim)]),
    edgeBottom(),
    blank(),
    chatLabel('Terminal CLI diff viewer with mouse support', 'today'),
    ...turnRow('wait so what did you do? did you rebuild or just plan out. and it seems', [s('22:36', C.dim), s('  ·  10 files', C.dim), s('  +1139', C.add), s(' −173', C.del)]),
    ...turnRow('i think right now for the changes diff view. it isnt as clean as i want', [s('22:14', C.dim), s('  ·  3 files', C.dim), s('  +577', C.add)]),
    ...turnRow("wait so you are telling me right now it wouldn't work on mac?", [s('22:09', C.dim), s('  ·  no file changes', C.faint)]),
  ];
  files['Usage.dc.html'] = page({title: 'Usage, from the header', top: [...header('changes', ['idle']), ...changesBar('turn')], stream,
    bottom: hints([['u', 'usage'], ['esc', 'close'], ['↑↓', 'move']])});
  text['Usage'] = stream;
}

// ============================================================
// H. A turn that ran parallel agents (Version 1 style): grouped by agent.
// ============================================================
{
  const AG = {A1: C.link, A2: C.string, A3: C.warn, A4: C.keyword};
  const agent = (id, name, state, o = {}) => K([o.open ? s('▾', C.accent, {bg: o.bg}) : s('▸', C.faint), sp(1), s(id, AG[id], {b: 1}), sp(2), s(name.padEnd(9), C.ink), ...state], o.right ?? [], {bg: o.bg});
  const sub = (verb, dir, name, add, del, tail = []) => K([sp(5), s(verb.padEnd(9), C.dim), s(dir, C.dim), s(name, C.ink), ...tail], stats(add, del));
  const band = (id, name, time) => W([sp(1), s(id, AG[id], {b: 1}), s(' ' + name, C.text)], [s(time, C.faint), sp(1)], {bg: C.scope});
  const stream = [
    chatLabel('Day 3 launchers', 'today'),
    edgeTop(),
    K([s('⠹', C.accent, {cls: 'pulse'}), sp(1), s('build the day 3 launchers in parallel. one agent per', C.ink, {b: 1})], [s('22:58', C.dim)]),
    K([sp(2), s('terminal: tmux, wezterm, iterm2, kitty', C.ink, {b: 1})]),
    K([sp(2), s('running', C.accent), s('  ·  4 agents  ·  5 files', C.dim), s('  +219', C.add), s(' −2', C.del), s('  ·  ', C.dim), s('1 overlap', C.warn)]),
    K(),
    K([s('✦', C.faint), s(' Thought for 9s', C.dim)]),
    K([sp(2), s("I'll split this by terminal. Each agent writes one", C.text)]),
    K([sp(2), s('launcher, then I wire them together and run the checks.', C.text)]),
    K(),
    agent('A1', 'tmux', [s('✓', C.add), s(' done', C.dim)], {open: 1, right: [s('2 files', C.dim), sp(2), ...stats(70, 1, 4), sp(2), s('1m 48s', C.faint)]}),
    sub('Created', 'src/launch/', 'tmux.ts', 64),
    sub('Edited', 'src/launch/', 'index.ts', 6, 1, [s('  ⚠ also A2', C.warn)]),
    halfW(C.surface, C.well),
    band('A1', 'tmux', '22:59'),
    ...dl(' ', 1, "import {windowsTerminal} from './wt';"),
    ...dl('+', 2, "import {tmux} from './tmux';", {turn: AG.A1}),
    gap('3 unchanged lines'),
    ...dl(' ', 6, 'export const launchers = ['),
    ...dl('-', 7, '  windowsTerminal];'),
    ...dl('+', 7, '  windowsTerminal,', {turn: AG.A1}),
    ...dl('+', 8, '  tmux,', {turn: AG.A1}),
    ...dl('+', 9, '];', {turn: AG.A1}),
    band('A2', 'wezterm', '23:00'),
    ...dl('+', 3, "import {wezterm} from './wezterm';", {turn: AG.A2}),
    ...dl('+', 10, '  wezterm,', {turn: AG.A2}),
    W([sp(1), s('⚠', C.warn), s(' A1 and A2 both changed lines 7 to 10. A2 wrote last.', C.warn)], [], {bg: C.scope}),
    halfW(C.well, C.surface),
    agent('A2', 'wezterm', [s('⠹', C.accent, {cls: 'pulse'}), s(' Writing ', C.accent), s('wezterm.ts', C.text)], {right: [...stats(58, 0, 4), sp(2), s('2m 10s', C.faint)]}),
    agent('A3', 'iterm2', [s('⠹', C.accent, {cls: 'pulse'}), s(' Running ', C.accent), s('osascript -e …', C.text)], {right: [...stats(47, 0, 4), sp(2), s('2m 04s', C.faint)]}),
    agent('A4', 'kitty', [s('●', C.warn, {cls: 'pulse'}), s(' waiting for you', C.warn)], {right: [...stats(39, 0, 4), sp(2), s('1m 30s', C.faint)]}),
    K(),
    K([sp(2), s('Claude is waiting on 3 of 4 agents', C.faint)]),
    edgeBottom(),
    blank(),
    ...turnRow('did you commit all of them into one commit? split them properly', [s('22:56', C.dim), s('  ·  no file changes', C.faint)]),
  ];
  files['Changes-parallel.dc.html'] = page({title: 'Changes, parallel agents', top: [...header('changes', ['working']), ...changesBar('turn')], stream,
    bottom: hints([['↑↓', 'move'], ['enter', 'open'], ['a', 'agents'], ['v', 'group']])});
  text['Changes-parallel'] = stream;
}

export {files, text, OUT};
