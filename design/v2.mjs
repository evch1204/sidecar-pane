// Version 2, "Workbench". The pane paints every cell, so it stops looking like a terminal.
import {C, setTheme, s, sp, bar, fit, len, plain, box, lower, upper, rightHalf, leftHalf, column, pill, meter, hline, pipe,
  tok, sliceSegs, markRange, page, dump} from './lib.mjs';

setTheme({
  page: '#0E1014', surface: '#161920', surface2: '#20242E', well: '#0A0B0E', scope: '#12141A',
  ink: '#E7E9EE', text: '#B3B8C4', dim: '#8A90A0', faint: '#596070', rule: '#2A2E39',
  accent: '#7C9CFF', add: '#56D68B', del: '#FF7B86', addBg: '#0F2A1C', delBg: '#30141A',
  addWord: '#1E5C3A', delWord: '#722A35', warn: '#F2C66D', link: '#8DB7FF', keyword: '#C3A6FF', string: '#9AD6A4', thumb: '#3A4050',
});
const T = {bar: '#1A1D25', shade: '#07080A', menu: '#232733', menuHi: '#3D5BD9', spine: '#363C4B', pillBg: '#2A3350',
  tintBlue: '#1B2740', tintGreen: '#14301F', tintAmber: '#33290F', tintViolet: '#2A1F3D', dark: '#0E1014'};
const AG = [
  {id: 'A1', name: 'tmux', color: '#7C9CFF'}, {id: 'A2', name: 'wezterm', color: '#5FD3BC'},
  {id: 'A3', name: 'iterm2', color: '#E6A86C'}, {id: 'A4', name: 'kitty', color: '#D48BE8'},
];
const files = {}, text = {};

// ---------- rows ----------
const V = (prefix, l = [], r = [], o = {}) => ({...o, segs: [sp(1), ...prefix, ...fit(l, r, 62 - len(prefix), o.bg)]});
const qLR = (c, o) => box(1, [.5, .5, .5, .5], c, o), qLL = (c, o) => box(1, [0, .5, .5, .5], c, o);
const qUR = (c, o) => box(1, [.5, 0, .5, .5], c, o), qUL = (c, o) => box(1, [0, 0, .5, .5], c, o);
const panelTop = (prefix, color = C.surface2) => ({segs: [sp(1), ...prefix, qLR(color), lower(60 - len(prefix), color), qLL(color)]});
const panelBottom = (prefix, color = C.surface) => ({segs: [sp(1), ...prefix, qUR(color), upper(60 - len(prefix), color), qUL(color)]});
const panelRow = (prefix, l = [], r = [], o = {}) => V(prefix, [sp(1), ...l], [...r, sp(1)], {bg: C.surface, ...o});
const wellRow = (prefix, l = [], r = [], o = {}) => { const w = 60 - len(prefix); return {segs: [sp(1), ...prefix, {t: ' ', bg: C.surface}, ...fit(l, r, w, o.bg ?? C.well), {t: ' ', bg: C.surface}]}; };
const wellHalf = (prefix, top, bottom) => ({segs: [sp(1), ...prefix, {t: ' ', bg: C.surface}, box(60 - len(prefix), [0, 0, 1, .5], top, {bg: bottom}), {t: ' ', bg: C.surface}]});
const vblank = prefix => V(prefix);

function diffRows(prefix, sign, no, code, o = {}) {
  const cw = 60 - len(prefix) - 8;
  const bg = sign === '+' ? C.addBg : sign === '-' ? C.delBg : undefined;
  const tone = sign === '+' ? C.add : sign === '-' ? C.del : C.faint;
  let segs = tok(code, sign === ' ' ? C.text : C.ink);
  for (const m of o.marks ?? []) { const a = code.indexOf(m); segs = markRange(segs, a, a + m.length, sign === '+' ? C.addWord : C.delWord); }
  const edge = o.agent ? bar(o.agent) : sign === ' ' ? sp(1) : bar(tone);
  const gutter = [edge, s(String(no).padStart(4), sign === ' ' ? C.faint : C.dim), sp(1), s(sign === ' ' ? ' ' : sign === '-' ? '−' : '+', tone), sp(1)];
  const total = len(segs);
  if (total <= cw) return [wellRow(prefix, [...gutter, ...segs], [], {bg})];
  if (sign === ' ') return [wellRow(prefix, [...gutter, ...sliceSegs(segs, 0, cw - 1), s('…', C.faint)], [], {bg})];
  const txt = plain(segs), rows = []; let pos = 0, first = true;
  while (pos < total) {
    const room = first ? cw : cw - 2; let end = Math.min(total, pos + room);
    if (end < total) { const cut = txt.lastIndexOf(' ', end - 1); if (cut > pos + room / 2) end = cut + 1; }
    const part = sliceSegs(segs, pos, end);
    rows.push(first ? wellRow(prefix, [...gutter, ...part], [], {bg}) : wellRow(prefix, [edge, sp(5), s('↪', C.faint), sp(1), sp(2), ...part], [], {bg}));
    pos = end; first = false;
  }
  return rows;
}
const hunkRow = (prefix, open, label, range, add, del) => wellRow(prefix, [sp(1), s(open ? '▾' : '▸', C.faint), sp(1), s(label, C.link)],
  [s(range, C.faint), sp(2), ...(add ? [s('+' + add, C.add)] : []), ...(del ? [sp(1), s('−' + del, C.del)] : []), sp(1)], {bg: C.scope});
const gapRow = (prefix, t) => wellRow(prefix, [sp(6), s('⋯ ' + t, C.faint)]);

// ---------- chrome ----------
const tone = f => (f >= .9 ? C.del : f >= .75 ? C.warn : C.accent);
function menubar(open, interactive) {
  const bg = T.bar;
  const item = (label, key) => { const on = open === label; return [{...s(' ' + label + ' ', on ? '#FFFFFF' : C.text, {bg: on ? T.menuHi : bg}), ...(interactive && key ? {on: key} : {})}]; };
  const left = [sp(1), s('◆', C.accent), sp(1), s('Sidecar', C.ink, {b: 1}), sp(1), ...item('View', 'toggleMenu'), ...item('Group'), ...item('Agents')];
  const right = [s('5h', C.dim), sp(1), meter(6, .58, tone(.58), {track: '#363C4B'}), sp(1), s('58%', C.ink), sp(2), s('wk', C.dim), sp(1), meter(4, .23, tone(.23), {track: '#363C4B'}), sp(1), s('23%', C.ink), sp(1)].map(x => ({...x, href: 'V2-Usage.dc.html'}));
  return [{full: true, segs: fit(left, right, 64, bg)}, {full: true, segs: [upper(64, T.shade)]}];
}
function toolbar(view, status) {
  const tabs = [['Changes', '10', 'V2-Changes.dc.html'], ['Files', '', 'V2-Files.dc.html'], ['Agents', '4', 'V2-Agents.dc.html'], ['Usage', '', 'V2-Usage.dc.html']];
  const left = tabs.flatMap(([label, n, href]) => (label === view
    ? [...pill(' ' + label + (n ? ' ' : ''), T.pillBg, C.ink, {b: 1}).slice(0, 2), ...(n ? [s(n + ' ', C.accent, {bg: T.pillBg, b: 1})] : []), leftHalf(T.pillBg)]
    : [sp(2), s(label, C.dim), ...(n ? [s(' ' + n, C.faint)] : []), sp(2)]).map(x => ({...x, href})));
  const right = {
    working: [s('⠹', C.accent, {cls: 'pulse'}), s(' working', C.ink)],
    idle: [s('●', C.faint), s(' idle', C.dim)],
    agents: [s('⠹', C.accent, {cls: 'pulse'}), s(' 3 agents running', C.ink)],
  }[status];
  return [V([], left, right), V([])];
}
function statusbar(pairs) {
  const left = [sp(1), ...pairs.flatMap(([k, label], i) => [...(i ? [sp(2)] : []), s(k, C.ink), s(' ' + label, C.dim)])];
  return [V([]), {full: true, segs: fit(left, [s('sidecar-pane', C.dim), s('  ', C.dim), s('main', C.text), sp(1)], 64, T.bar)}];
}
const chip = (label, bg, fg) => pill(label, bg, fg);
const verbChip = verb => ({Edited: chip('Edited ', T.tintBlue, C.link), Created: chip('Created', T.tintGreen, C.add), Ran: chip('Ran    ', T.tintAmber, C.warn),
  Writing: chip('Writing', T.pillBg, C.accent), Running: chip('Running', T.pillBg, C.accent), Read: chip('Read   ', C.surface2, C.dim)}[verb]);
const agentChip = a => pill(a.id, a.color, T.dark, {b: 1});
const ratio = (add, del) => { const n = del ? Math.max(1, Math.min(4, Math.round(5 * add / (add + del)))) : 5; return [lower(n, C.add), ...(n < 5 ? [lower(5 - n, C.del)] : [])]; };
const stat = (add, del) => [add ? s(('+' + add).padStart(5), C.add) : sp(5), sp(1), del ? s(('−' + del).padStart(4), C.del) : sp(4)];
const stepRow = (prefix, verb, dir, name, add, del, o = {}) => V(prefix, [...(o.lead ?? []), ...verbChip(verb).map(x => ({...x, bg: x.bg ?? o.bg})), sp(1), s(dir, C.dim), s(name, o.nameFg ?? C.ink), ...(o.tail ?? [])],
  o.right ?? [...(o.noRatio ? [] : [...ratio(add, del), sp(1)]), ...stat(add, del), sp(1)], {bg: o.bg});

// ---------- the single spine ----------
const SP = T.spine;
const spine = [pipe({u: 1, d: 1, color: SP}), sp(2)];
const nodeRow = (kind, color, first) => [pipe({u: !first, d: 1, color: SP, node: kind, nodeColor: color}), sp(2)];
const pastTurn = (prompt, meta) => { const chars = [...prompt]; const shown = chars.length > 52 ? chars.slice(0, 51).join('').trimEnd() + '…' : prompt; return [V(nodeRow('ring', C.faint), [s(shown, C.text)], [s(meta[0], C.faint)]), V(spine, meta[1])]; };

function changesStream() {
  const p = spine;
  return [
    V([], [s('TODAY', C.faint, {b: 1}), s('   Terminal CLI diff viewer with mouse support', C.dim)]),
    V(nodeRow('fill', C.accent, true), [s('wait so what did you do? did you rebuild or just', C.ink, {b: 1})], [s('22:36', C.dim)]),
    V(p, [s('plan out. and it seems like uiux wise nothing changed?', C.ink, {b: 1})]),
    V(p, [...chip('10 files', C.surface2, C.text), sp(1), ...chip('+1139', T.tintGreen, C.add), sp(1), ...chip('−173', '#33161B', C.del), s('   18 min  ·  64 steps', C.dim)]),
    vblank(p),
    V(p, [s('✦', C.accent), s(' Thought for 14s', C.dim)]),
    V(p, [s("The list now groups by chat, day and prompt. Each file's", C.text)]),
    V(p, [s('diff says which turn wrote which hunk. ', C.text), s('more', C.accent)]),
    vblank(p),
    stepRow(p, 'Read', '', '9 files, searched 4 times', 0, 0, {nameFg: C.dim, right: []}),
    stepRow(p, 'Edited', 'src/ui/', 'App.tsx', 381, 91),
    stepRow(p, 'Edited', 'src/ui/', 'Chrome.tsx', 4, 2, {bg: C.surface2}),
    panelTop(p),
    panelRow(p, [s('Chrome.tsx', C.ink, {b: 1}), s('   2 hunks', C.dim)], [s('n', C.text), s(' next hunk   ', C.dim), s('esc', C.text), s(' close', C.dim)], {bg: C.surface2}),
    hunkRow(p, 1, 'type TabsProps', '10–14', 1, 0),
    ...diffRows(p, ' ', 12, '  filtered: boolean;'),
    ...diffRows(p, '+', 13, '  note?: string;'),
    ...diffRows(p, ' ', 14, '};'),
    gapRow(p, '4 unchanged lines'),
    hunkRow(p, 1, 'Tabs()', '19–23', 2, 2),
    ...diffRows(p, '-', 18, 'export function Tabs({view, changedCount, project, branch, cols, filtered}: TabsProps) {'),
    ...diffRows(p, '+', 19, 'export function Tabs({view, changedCount, project, branch, cols, filtered, note}: TabsProps) {', {marks: [', note']}),
    ...diffRows(p, '-', 21, '  const used = stops[1]!.end + (filtered ? 10 : 0);'),
    ...diffRows(p, '+', 22, '  const used = stops[1]!.end + (filtered ? 10 : 0) + (note ? note.length + 3 : 0);', {marks: [' + (note ? note.length + 3 : 0)']}),
    wellHalf(p, C.well, C.surface),
    panelBottom(p),
    stepRow(p, 'Edited', 'src/ui/', 'Diff.tsx', 94, 44),
    stepRow(p, 'Created', 'src/ui/', 'TurnList.tsx', 184, 0),
    stepRow(p, 'Created', 'src/ui/', 'Why.tsx', 154, 0),
    stepRow(p, 'Ran', '', 'npm run typecheck', 0, 0, {nameFg: C.text, right: [s('✓ 3.1s', C.add), sp(1)]}),
    V(p, [s('5 more', C.dim), s('   turnrows.ts  PLAN.md  README.md  smoke.tsx …', C.faint)]),
    vblank(p),
    ...pastTurn('i think right now for the changes diff view. it isnt as clean as i want', ['22:14', [s('3 files', C.dim), s('  +577', C.add)]]),
    ...pastTurn("wait so you are telling me right now it wouldn't work on mac?", ['22:09', [s('no file changes', C.faint)]]),
    ...pastTurn('i have this project that i was originally working on to try testing', ['21:36', [s('18 files  ·  ', C.dim), s('not recorded', C.faint, {i: 1})]]),
  ];
}

// ---------- the View menu ----------
function viewMenu() {
  const W_ = 32, bg = T.menu, shade = 'rgba(0,0,0,0.5)';
  const item = (check, label, key, o = {}) => ({segs: [...fit([sp(1), s(check ? '✓' : ' ', o.hi ? '#FFFFFF' : C.accent), sp(1), s(label, o.hi ? '#FFFFFF' : C.ink)], [s(key, o.hi ? '#DCE3FF' : C.dim), sp(2)], W_, o.hi ? T.menuHi : bg), box(1, [0, 0, 1, 1], shade)]});
  const label = t => ({segs: [...fit([sp(3), s(t, C.faint)], [], W_, bg), box(1, [0, 0, 1, 1], shade)]});
  const rule = () => ({segs: [...fit([sp(1), hline(W_ - 2, '#3A4050')], [], W_, bg), box(1, [0, 0, 1, 1], shade)]});
  return [
    {segs: [...fit([], [], W_, bg), sp(1)]},
    item(1, 'Changes', '1'), item(0, 'Files', '2', {hi: 1}), item(0, 'Agents', '3'), item(0, 'Usage', '4'),
    rule(), label('Group changes by'),
    item(1, 'Turn', 'v'), item(0, 'File', ''), item(0, 'Agent', ''), item(0, 'All changes', ''),
    rule(),
    item(1, 'Follow Claude', 'f'), item(1, 'Wrap changed lines', 'w'), item(0, 'Changed files only', 'c'), item(1, 'Mouse', 'm'),
    {segs: [qUR(bg), upper(W_ - 2, bg), qUL(bg), box(1, [0, 0, 1, .5], shade)]},
    {segs: [sp(1), box(W_, [0, 0, 1, .5], shade)]},
  ].map((r, i, all) => (i === all.length - 2 ? {segs: [box(1, [.5, 0, .5, .5], bg, {bg: undefined}), upper(W_ - 2, bg), qUL(bg), box(1, [0, 0, 1, 1], shade)]} : r));
}
{
  const stream = changesStream();
  stream.forEach((r, i) => { if (i >= 1 && i <= 27) r.rail = C.thumb; });
  const logic = `class Component extends DCLogic {
renderVals() {
const st = this.state || {};
const menu = st.menu ?? false;
return { menuOpen: menu, toggleMenu: () => this.setState({ menu: !menu }) };
}
}`;
  const bottom = statusbar([['↑↓', 'move'], ['enter', 'open'], ['m', 'menu'], ['/', 'find']]);
  files['V2-Changes.dc.html'] = page({title: 'Version 2, Changes timeline', top: [...menubar(null, true), ...toolbar('Changes', 'idle')], stream, bottom, logic,
    overlays: [{row: 1, col: 11, rows: viewMenu(), backdrop: 1, flag: 'menuOpen'}]});
  files['V2-Menu.dc.html'] = page({title: 'Version 2, the View menu', top: [...menubar('View'), ...toolbar('Changes', 'idle')], stream, bottom,
    overlays: [{row: 1, col: 11, rows: viewMenu(), backdrop: 1}]});
  text['V2-Changes'] = stream; text['V2-Menu (overlay)'] = viewMenu().map(r => ({segs: [...r.segs, sp(Math.max(0, 63 - len(r.segs)))]}));
}

// ---------- parallel lanes ----------
const LANE = 10; // orchestrator lane + four agents, two columns each
function lanes(o = {}) { // o.node = lane index with a node, o.kind, o.live
  const out = [];
  for (let i = 0; i < 5; i++) {
    const color = i === 0 ? SP : AG[i - 1].color;
    const ended = o.ended?.includes(i);
    out.push(ended ? sp(1) : pipe({u: 1, d: o.stop === i ? 0 : 1, color, ...(o.node === i ? {node: o.kind ?? 'fill', cls: o.live ? 'pulse' : undefined} : {})}), sp(1));
  }
  return out;
}
const fanOut = () => { const out = []; for (let i = 0; i < 5; i++) { const c = i === 0 ? SP : AG[i - 1].color; out.push(i === 0 ? pipe({u: 1, d: 1, r: 1, color: SP}) : i === 4 ? pipe({curve: 'dl', color: c, curveColor: c}) : pipe({l: 1, r: 1, d: 1, color: SP, dColor: c}), i < 4 ? hline(1, SP, {heavy: 1}) : sp(1)); } return out; };
const fanIn = () => { const out = []; for (let i = 0; i < 5; i++) { const c = i === 0 ? SP : AG[i - 1].color; out.push(i === 0 ? pipe({u: 1, d: 1, r: 1, color: SP}) : i === 4 ? pipe({curve: 'ul', color: c, curveColor: c}) : pipe({l: 1, r: 1, u: 1, color: SP, uColor: c}), i < 4 ? hline(1, SP, {heavy: 1}) : sp(1)); } return out; };
{
  const L = lanes();
  const at = (i, verb, dir, name, add, del, o = {}) => stepRow(lanes({node: i, kind: o.kind, live: o.live, ended: o.ended}), verb, dir, name, add, del, {lead: [...agentChip(AG[i - 1]), sp(1)], noRatio: 1, ...o});
  const bandRow = (a, time) => wellRow(L, [sp(1), ...agentChip(a).map(x => ({...x, bg: C.scope})), s(' ' + a.name, C.text)], [s(time, C.faint), sp(1)], {bg: C.scope});
  const stream = [
    V([], [s('TODAY', C.faint, {b: 1}), s('   Day 3 launchers', C.dim)]),
    V(nodeRow('fill', C.accent, true), [s('build the day 3 launchers in parallel. one agent per', C.ink, {b: 1})], [s('22:58', C.dim)]),
    V(spine, [s('terminal: tmux, wezterm, iterm2, kitty', C.ink, {b: 1})]),
    V(spine, [...chip('4 agents', T.pillBg, C.accent), sp(1), ...chip('5 files', C.surface2, C.text), sp(1), ...chip('+219', T.tintGreen, C.add), sp(1), ...chip('1 overlap', T.tintAmber, C.warn)]),
    vblank(spine),
    V(spine, [s('✦', C.accent), s(' Thought for 9s', C.dim)]),
    V(spine, [s("I'll split this by terminal. Each agent writes one", C.text)]),
    V(spine, [s('launcher, then I wire them together and run the checks.', C.text)]),
    V(fanOut(), AG.flatMap((a, i) => [...(i ? [sp(1)] : []), ...agentChip(a), s(' ' + a.name, C.dim)])),
    at(1, 'Created', 'src/launch/', 'tmux.ts', 64, 0),
    at(2, 'Created', 'src/launch/', 'wezterm.ts', 58, 0),
    at(3, 'Created', 'src/launch/', 'iterm2.ts', 47, 0),
    at(1, 'Edited', 'src/launch/', 'index.ts', 6, 1),
    at(4, 'Created', 'src/launch/', 'kitty.ts', 39, 0),
    at(2, 'Edited', 'src/launch/', 'index.ts', 5, 1, {bg: C.surface2, tail: [s('  ⚠ A1', C.warn, {bg: C.surface2})]}),
    panelTop(L),
    panelRow(L, [s('index.ts', C.ink, {b: 1}), s('   banded by agent', C.dim)], [s('esc', C.text), s(' close', C.dim)], {bg: C.surface2}),
    bandRow(AG[0], '22:59'),
    ...diffRows(L, '+', 2, "import {tmux} from './tmux';", {agent: AG[0].color}),
    ...diffRows(L, ' ', 6, 'export const launchers = ['),
    ...diffRows(L, '-', 7, '  windowsTerminal];'),
    ...diffRows(L, '+', 7, '  windowsTerminal,', {agent: AG[0].color}),
    ...diffRows(L, '+', 8, '  tmux,', {agent: AG[0].color}),
    ...diffRows(L, '+', 9, '];', {agent: AG[0].color}),
    bandRow(AG[1], '23:00'),
    ...diffRows(L, '+', 3, "import {wezterm} from './wezterm';", {agent: AG[1].color}),
    ...diffRows(L, '+', 10, '  wezterm,', {agent: AG[1].color}),
    wellRow(L, [sp(1), s('⚠ Both changed lines 7 to 10. A2 wrote last.', C.warn)], [], {bg: T.tintAmber}),
    wellHalf(L, C.well, C.surface),
    panelBottom(L),
    at(1, 'Ran', '', 'tmux -V', 0, 0, {nameFg: C.text, right: [s('✓', C.add), sp(1)]}),
    V(lanes({node: 1, kind: 'fill', stop: 1}), [...agentChip(AG[0]), sp(1), s('done', C.add), s('  2 files  1m 48s  38k tokens', C.dim)]),
    at(3, 'Running', '', 'osascript -e …', 0, 0, {kind: 'half', live: 1, nameFg: C.text, right: [s('12s', C.dim), sp(1)], ended: [1]}),
    at(2, 'Writing', 'src/launch/', 'wezterm.ts', 58, 0, {kind: 'half', live: 1, ended: [1]}),
    V(lanes({node: 4, kind: 'ring', live: 1, ended: [1]}), [...agentChip(AG[3]), sp(1), s('waiting for you', C.warn), s('  wants to run ', C.dim), s('kitty @ launch', C.text)]),
    V(lanes({ended: [1]}), [s('Claude is waiting on 3 of 4 agents', C.faint)]),
    vblank([pipe({u: 1, d: 1, color: SP}), sp(2)]),
    ...pastTurn('did you commit all of them into one commit? split them properly', ['22:56', [s('no file changes', C.faint)]]),
  ];
  files['V2-Parallel.dc.html'] = page({title: 'Version 2, parallel agents in Changes', top: [...menubar(null), ...toolbar('Changes', 'agents')], stream,
    bottom: statusbar([['↑↓', 'move'], ['enter', 'open'], ['a', 'agents'], ['m', 'menu']])});
  text['V2-Parallel'] = stream;
}

// ---------- Agents view ----------
{
  const stepper = [['Plan', 'fill', C.add], ['Build', 'half', C.accent], ['Verify', 'ring', C.faint], ['Report', 'ring', C.faint]];
  const stepSegs = stepper.flatMap(([name, kind, col], i) => [...(i ? [sp(1), hline(3, i <= 1 ? C.add : SP, {heavy: 1}), sp(1)] : []), pipe({node: kind, color: col, cls: kind === 'half' ? 'pulse' : undefined}), sp(1), s(name, kind === 'ring' ? C.dim : C.ink, {b: kind === 'half' ? 1 : 0})]);
  const tee = last => [pipe(last ? {curve: 'ur', color: SP, curveColor: SP} : {u: 1, d: 1, r: 1, color: SP}), hline(1, SP, {heavy: 1}), sp(1)];
  const cont = last => [last ? sp(1) : pipe({u: 1, d: 1, color: SP}), sp(2)];
  const agentPanel = (a, last, type, state, stepSegsRow, tokens, frac, filesLine) => [
    panelTop(cont(last).map((x, i) => (i === 0 && last ? pipe({u: 1, d: 1, color: SP}) : x)), C.surface),
    panelRow(tee(last), [...agentChip(a).map(x => ({...x, bg: C.surface})), s(' ' + a.name, C.ink, {b: 1}), s('   ' + type, C.dim)], state),
    panelRow(cont(last), stepSegsRow[0], stepSegsRow[1]),
    panelRow(cont(last), [meter(18, frac, a.color, {thin: 1}), s('  ' + tokens, C.dim)], filesLine),
    panelBottom(cont(last)),
  ];
  const gantt = (a, spans, now) => V([], [...agentChip(a), sp(2), ...(() => { const out = []; let pos = 0; for (const [from, to, live] of spans) { if (from > pos) out.push(hline(from - pos, C.rule)); out.push(box(to - from, [0, .3, 1, .4], a.color, live ? {cls: 'pulse'} : {})); pos = to; } if (pos < 48) out.push(hline(48 - pos, C.rule)); return out; })()]);
  const vc = v => verbChip(v).map(x => ({...x, bg: x.bg ?? C.surface}));
  const stream = [
    V([], stepSegs, [s('phase 2 of 4', C.dim)]),
    vblank([]),
    panelTop([], C.surface2),
    panelRow([], [s('◆', C.accent), s(' Orchestrator', C.ink, {b: 1}), s('   Fable 5.1', C.dim)], [s('6m 02s', C.dim)], {bg: C.surface2}),
    panelRow([], [s('build the day 3 launchers in parallel. one agent per', C.text)]),
    panelRow([], [s('terminal: tmux, wezterm, iterm2, kitty', C.text)]),
    panelRow([], [meter(18, .42, C.accent, {thin: 1}), s('  84k tokens', C.dim)], [s('waiting on 3 of 4 agents', C.dim)]),
    panelBottom([]),
    ...agentPanel(AG[0], 0, 'general-purpose', [s('✓ done', C.add)], [[...vc('Ran'), s(' tmux -V', C.text)], [s('1m 48s', C.dim)]], '38k tokens', .38, [s('2 files', C.dim), s('  +70', C.add), s(' −1', C.del)]),
    ...agentPanel(AG[1], 0, 'general-purpose', [s('⠹', C.accent, {cls: 'pulse'}), s(' running', C.ink)], [[...vc('Writing'), s(' src/launch/', C.dim), s('wezterm.ts', C.ink)], [s('2m 10s', C.dim)]], '52k tokens', .52, [s('2 files', C.dim), s('  +63', C.add), s(' −1', C.del)]),
    ...agentPanel(AG[2], 0, 'general-purpose', [s('⠹', C.accent, {cls: 'pulse'}), s(' running', C.ink)], [[...vc('Running'), s(' osascript -e …', C.text)], [s('2m 04s', C.dim)]], '47k tokens', .47, [s('1 file', C.dim), s('  +47', C.add)]),
    ...agentPanel(AG[3], 1, 'general-purpose', [s('●', C.warn, {cls: 'pulse'}), s(' waiting for you', C.warn)], [[s('wants to run ', C.dim), s('kitty @ launch --location=vsplit', C.text)], [s('1m 30s', C.dim)]], '29k tokens', .29, [s('1 file', C.dim), s('  +39', C.add)]),
    vblank([]),
    V([], [s('TIMELINE', C.faint, {b: 1})], [s('now', C.accent), sp(1)]),
    gantt(AG[0], [[2, 20]]),
    gantt(AG[1], [[3, 48, 1]]),
    gantt(AG[2], [[4, 30], [33, 48, 1]]),
    gantt(AG[3], [[6, 36]]),
    V([], [sp(6), s('22:58', C.faint)], [s('23:04', C.faint), sp(1)]),
  ];
  files['V2-Agents.dc.html'] = page({title: 'Version 2, Agents', top: [...menubar(null), ...toolbar('Agents', 'agents')], stream,
    bottom: statusbar([['↑↓', 'agent'], ['enter', 'changes'], ['t', 'transcript']])});
  text['V2-Agents'] = stream;
}

// ---------- Files with agents ----------
{
  const br = (depth, last) => [...Array.from({length: depth - 1}, () => [pipe({u: 1, d: 1, color: C.rule}), sp(2)]).flat(), ...(depth ? [pipe(last ? {curve: 'ur', color: C.rule, curveColor: C.rule} : {u: 1, d: 1, r: 1, color: C.rule}), hline(1, C.rule), sp(1)] : [])];
  const dir = (depth, last, open, name, note) => V([], [...br(depth, last), s(open ? '▾' : '▸', C.dim), sp(1), s(name, C.ink, {b: 1})], note ? [s(note, C.faint), sp(1)] : []);
  const file = (depth, last, name, o = {}) => V([], [...br(depth, last).map(x => ({...x, bg: o.bg})), s(name, o.add ? C.ink : C.text, {bg: o.bg})],
    [...(o.add ? stat(o.add, o.del) : []), sp(2), ...(o.agents ?? []).flatMap(a => agentChip(a)), ...(o.mark ? [sp(1), o.mark] : [sp(2)]), sp(1)].map(x => ({...x, bg: x.bg ?? o.bg})), {bg: o.bg});
  const P3 = [pipe({u: 1, d: 1, color: C.rule}), sp(2)];
  const stream = [
    V([], [...pill(' All ', T.pillBg, C.ink, {b: 1}), sp(2), s('Changed 5', C.dim), sp(3), s('By agent', C.dim), sp(3), s('Live only', C.dim)], [s('/', C.text), s(' find a file', C.faint)]),
    V([], AG.flatMap((a, i) => [...(i ? [sp(2)] : []), ...agentChip(a), s(' ' + a.name + ' ', C.dim), i === 0 ? s('✓', C.add) : i === 3 ? s('●', C.warn, {cls: 'pulse'}) : s('⠹', C.accent, {cls: 'pulse'})])),
    vblank([]),
    dir(0, 0, 0, 'scripts'),
    dir(0, 0, 1, 'src', '5 changed'),
    dir(1, 0, 0, 'core'),
    dir(1, 0, 1, 'launch', '4 agents here'),
    file(2, 0, 'index.ts', {add: 11, del: 2, agents: [AG[0], AG[1]], mark: s('⚠', C.warn), bg: C.surface2}),
    panelTop(P3),
    panelRow(P3, [s('src › launch › ', C.dim), s('index.ts', C.ink, {b: 1})], [s('TS · 14 lines', C.dim)], {bg: C.surface2}),
    wellRow(P3, [sp(1), s('⚠ Two agents wrote here. Bars show who wrote each line.', C.warn)], [], {bg: T.tintAmber}),
    ...diffRows(P3, ' ', 1, "import {windowsTerminal} from './wt';"),
    ...diffRows(P3, ' ', 2, "import {tmux} from './tmux';", {agent: AG[0].color}),
    ...diffRows(P3, ' ', 3, "import {wezterm} from './wezterm';", {agent: AG[1].color}),
    ...diffRows(P3, ' ', 4, ''),
    ...diffRows(P3, ' ', 5, '// One small file per terminal. detect() picks the first that fits.'),
    ...diffRows(P3, ' ', 6, 'export const launchers = ['),
    ...diffRows(P3, ' ', 7, '  windowsTerminal,', {agent: AG[0].color}),
    ...diffRows(P3, ' ', 8, '  tmux,', {agent: AG[0].color}),
    ...diffRows(P3, ' ', 9, '  wezterm,', {agent: AG[1].color}),
    ...diffRows(P3, ' ', 10, '];', {agent: AG[0].color}),
    wellHalf(P3, C.well, C.surface),
    panelRow(P3, [s('enter', C.text), s(' read all   ', C.dim), s('d', C.text), s(' diff   ', C.dim), s('a', C.text), s(' by agent', C.dim)], [s('esc', C.text), s(' close', C.dim)]),
    panelBottom(P3),
    file(2, 0, 'iterm2.ts', {add: 47, agents: [AG[2]], mark: s('⠹', C.accent, {cls: 'pulse'})}),
    file(2, 0, 'kitty.ts', {add: 39, agents: [AG[3]], mark: s('●', C.warn, {cls: 'pulse'})}),
    file(2, 0, 'tmux.ts', {add: 64, agents: [AG[0]], mark: s('✓', C.add)}),
    file(2, 0, 'wezterm.ts', {add: 58, agents: [AG[1]], mark: s('⠹', C.accent, {cls: 'pulse'})}),
    file(2, 1, 'wt.ts'),
    dir(1, 0, 0, 'ui'),
    file(1, 1, 'cli.tsx'),
    file(0, 0, 'CLAUDE.md'),
    file(0, 0, 'PLAN.md'),
    file(0, 0, 'package.json'),
  ];
  files['V2-Files.dc.html'] = page({title: 'Version 2, Files with agents', top: [...menubar(null), ...toolbar('Files', 'agents')], stream,
    bottom: statusbar([['↑↓', 'move'], ['enter', 'peek'], ['a', 'by agent'], ['m', 'menu']])});
  text['V2-Files'] = stream;
}

// ---------- Usage ----------
{
  const FONT = {'0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001', '5': '111100111001111', '6': '111100111101111', '7': '111001001001001', '8': '111101111101111', '9': '111101111001111', '%': '101001010100101'};
  const big = (str, color, bg) => [0, 1, 2].map(r => [...str].flatMap((ch, gi) => { const g = FONT[ch]; const cells = []; for (let x = 0; x < 3; x++) { const top = g[r * 2 * 3 + x] === '1', bot = r < 2 ? g[(r * 2 + 1) * 3 + x] === '1' : false; cells.push(top && bot ? box(2, [0, 0, 1, 1], color, {bg}) : top ? box(2, [0, 0, 1, .5], color, {bg}) : bot ? box(2, [0, .5, 1, .5], color, {bg}) : {t: '  ', bg}); } return [...(gi ? [{t: '  ', bg}] : []), ...cells]; }));
  const PACE = [3, 5, 4, 9, 14, 11, 17, 21, 16, 19, 24, 27];
  const chartRow = level => PACE.flatMap((v, i) => { const e = Math.max(0, Math.min(8, v - level * 8)); const proj = i >= 10; const col = proj ? C.warn : i === 9 ? C.accent : '#4A5A8F'; return [e ? column(e, col) : sp(1), e ? column(e, col) : sp(1), sp(1)]; });
  const digits = big('58%', C.ink, C.surface);
  const share = [['Fable 5.1', .71, C.accent], ['Opus 5', .18, '#5FD3BC'], ['Sonnet 5', .09, '#E6A86C'], ['Haiku 4.5', .02, '#D48BE8']];
  const cells = share.map(([, f]) => Math.max(1, Math.round(f * 58))); cells[0] = 58 - cells.slice(1).reduce((a, n) => a + n, 0);
  const title = (name, note) => panelRow([], [s(name, C.ink, {b: 1}), s('   ' + note, C.dim)], [], {bg: C.surface2});
  const stream = [
    panelTop([]), title('Session', '5 hour window'),
    panelRow([]),
    panelRow([], [sp(1), ...digits[0]], [s('resets in ', C.dim), s('1h 52m', C.ink, {b: 1}), sp(1)]),
    panelRow([], [sp(1), ...digits[1]], [s('at 00:40', C.dim), sp(1)]),
    panelRow([], [sp(1), ...digits[2]]),
    panelRow([], [sp(1), lower(34, C.accent), lower(24, C.rule)]),
    panelRow([]),
    panelRow([], [sp(1), s('Pace', C.ink), s('   tokens per half hour', C.dim)], [s('■', '#4A5A8F'), s(' used  ', C.dim), s('■', C.warn), s(' projected', C.dim), sp(1)]),
    panelRow([], [sp(1), ...chartRow(3)]), panelRow([], [sp(1), ...chartRow(2)]), panelRow([], [sp(1), ...chartRow(1)]), panelRow([], [sp(1), ...chartRow(0)]),
    panelRow([], [sp(1), s('18:00', C.faint), sp(22), s('now', C.accent)]),
    panelRow([], [sp(1), s('At this pace you reach the limit around 00:10,', C.warn)]),
    panelRow([], [sp(1), s('30 minutes before it resets.', C.warn)]),
    panelBottom([]),
    panelTop([]), title('This week', 'all models, resets Thursday 09:00'),
    panelRow([], [sp(1), lower(13, C.accent), lower(45, C.rule)], []),
    panelRow([], [sp(1), s('23%', C.ink, {b: 1}), s(' used', C.dim)]),
    panelRow([]),
    panelRow([], [sp(1), s('By model', C.ink), s("   share of this week's tokens", C.dim)]),
    panelRow([], [sp(1), ...share.map(([, , col], i) => lower(cells[i], col))]),
    ...[[0, 1], [2, 3]].map(pair => panelRow([], [sp(1), ...pair.flatMap(i => { const [name, f, col] = share[i]; const cell = [s('■', col), s(' ' + name + ' ', C.text), s(Math.round(f * 100) + '%', C.dim)]; return [...cell, sp(24 - len(cell))]; })])),
    panelBottom([]),
    panelTop([]), title('This chat', 'Fable 5.1'),
    panelRow([], [sp(1), s('Context  ', C.dim), lower(14, C.link), lower(31, C.rule), s('  31%', C.ink)]),
    panelRow([], [sp(1), s('312k of 1M tokens  ·  cache hit 91%', C.dim)]),
    panelRow([]),
    panelRow([], [sp(1), s('This turn by agent', C.ink), s('   212k tokens', C.dim)]),
    ...[[null, 84], [AG[0], 38], [AG[1], 52], [AG[2], 47], [AG[3], 29]].slice(0, 5).map(([a, k]) => panelRow([], [sp(1), ...(a ? agentChip(a).map(x => ({...x, bg: x.kind ? C.surface : x.bg})) : [s(' ◆ ', C.accent), sp(1)]), sp(1), lower(Math.round(k / 2), a ? a.color : C.accent), sp(1), s(k + 'k', C.dim)])),
    panelBottom([]),
  ];
  files['V2-Usage.dc.html'] = page({title: 'Version 2, Usage', top: [...menubar(null), ...toolbar('Usage', 'agents')], stream,
    bottom: statusbar([['esc', 'back'], ['m', 'menu']])});
  text['V2-Usage'] = stream;
}

export {files as files2, text as text2};
