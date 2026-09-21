// Version 4, a proposal. Same terminal, same theme as the build, but numbers
// become shapes, a turn's files are grouped by folder, the agents are drawn as
// the chart Claude Code itself prints, and worktrees are first class.
import {C, s, sp, bar, fit, len, lower, upper, column, pill, hline, pipe, tok, sliceSegs, page, RH} from './lib.mjs';

// The build's own extras (src/ui/theme.ts), which lib.mjs predates.
const X = {spine: '#3A3835', track: '#3A3835', teal: '#6FC7C1', pink: '#E39AC0', tintAdd: '#12301D', tintDel: '#33161A'};
const HUES = [C.link, C.string, C.keyword, X.teal, X.pink];
export const files4 = {}, text4 = {};

// ---------- rows ----------
const V = (prefix, l = [], r = [], o = {}) => ({...o, segs: [sp(1), ...prefix, ...fit(l, r, 62 - len(prefix), o.bg)]});
const none = [];
const line = (color = X.spine) => [pipe({u: 1, d: 1, color}), sp(2)];
const node = (kind, color, o = {}) => [pipe({u: o.first ? 0 : 1, d: o.last ? 0 : 1, color: o.line ?? X.spine, node: kind, nodeColor: color, cls: o.cls}), sp(2)];
const gapRow = (prefix = none) => V(prefix);
const chip = (text, bg, fg, o) => pill(text, bg, fg, o);
const dot = () => s('  ·  ', C.faint);

// Five cells: how much changed (how many are lit) and which way (green, red).
const size = (g, r) => [lower(g, C.add), lower(r, C.del), lower(5 - g - r, X.track)];
const stat = (add, del) => [add ? s(('+' + add).padStart(5), C.add) : sp(5), sp(1), del ? s(('−' + del).padStart(5), C.del) : sp(5)];
const LETTER = {A: C.add, M: C.link, D: C.del, R: C.keyword};
const fileRow = (prefix, letter, name, g, r, add, del, o = {}) =>
  V(prefix, [sp(1), s(letter, LETTER[letter], {b: 1}), sp(2), s(name, o.nameFg ?? C.ink), ...(o.tail ?? [])], [...size(g, r), sp(2), ...stat(add, del), sp(1)], {bg: o.bg});
const folderRow = (prefix, name, note) => V(prefix, [s(name, C.dim)], note ? [s(note, C.faint), sp(1)] : []);

// A closed turn is one line: the prompt, how big it was, when.
function closedTurn(prompt, files, g, r, time, o = {}) {
  const room = 32;
  const chars = [...prompt];
  const shown = chars.length > room ? chars.slice(0, room - 1).join('').trimEnd() + '…' : prompt;
  const right = files === null
    ? [s(o.note ?? 'no file changes', C.faint, {i: o.note ? 1 : 0}), sp(3), s(time, C.faint), sp(1)]
    : [s(String(files).padStart(2) + (files === 1 ? ' file ' : ' files'), C.dim), sp(1), ...size(g, r), sp(1), s((o.tag ?? '').padEnd(3), C.faint), sp(2), s(time, C.faint), sp(1)];
  return V(node('ring', o.color ?? C.faint), [s(shown, C.text)], right);
}

// ---------- a diff, hanging on the line ----------
const wellRow = (prefix, l = [], r = [], o = {}) => ({segs: [sp(1), ...prefix, ...fit(l, r, 62 - len(prefix), o.bg ?? C.well)]});
const wellEdge = (prefix, top) => ({segs: [sp(1), ...prefix, (top ? lower : upper)(62 - len(prefix), C.well)]});
function diffRow(prefix, sign, no, code) {
  const cw = 62 - len(prefix) - 9;
  const bg = sign === '+' ? C.addBg : sign === '-' ? C.delBg : undefined;
  const tone = sign === '+' ? C.add : sign === '-' ? C.del : C.faint;
  let segs = tok(code, sign === ' ' ? C.text : C.ink);
  if (len(segs) > cw) segs = [...sliceSegs(segs, 0, cw - 1), s('…', C.faint)];
  const edge = sign === ' ' ? sp(1) : bar(tone);
  return wellRow(prefix, [edge, s(String(no).padStart(4), sign === ' ' ? C.faint : C.dim), sp(1), s(sign === ' ' ? ' ' : sign === '-' ? '−' : '+', tone), sp(1), ...segs], [], {bg});
}
const hunkRow = (prefix, label, range, add, del) => wellRow(prefix, [sp(1), s('▾', C.dim), sp(1), s(label, C.link)],
  [s(range, C.faint), sp(2), ...(add ? [s('+' + add, C.add)] : []), ...(del ? [sp(1), s('−' + del, C.del)] : []), sp(1)], {bg: C.scope});

// ---------- chrome, as built ----------
const tone = f => (f >= .9 ? C.del : f >= .75 ? C.warn : C.accent);
function menubar({feed = 'on', status = 'idle', used = .58}) {
  const bg = C.surface;
  const left = [sp(1), s('◆', C.accent), sp(1), s('Sidecar', C.ink, {b: 1}), sp(2), s('View', C.text)];
  const lit = Math.round(used * 6);
  const meters = {
    on: [s('5h', C.dim), sp(1), lower(lit, tone(used)), lower(6 - lit, X.track), sp(1), s(Math.round(used * 100) + '%', C.ink, {b: 1}), sp(2), s('1h 52m', C.dim), s(' · ', C.faint), s('wk', C.dim), sp(1), s('23%', C.text)],
    off: [s('5h', C.dim), sp(1), s('~', C.faint), s('4.3M', C.text), sp(2), s('32m left', C.dim), s(' · ', C.faint), s('connect for %', C.link, {u: 1})],
    quiet: [s('5h', C.faint), sp(1), s('58%', C.faint), sp(2), s('feed quiet 40m', C.warn), s(' · ', C.faint), s('reconnect', C.link, {u: 1})],
  }[feed].map(x => ({...x, href: 'V4-Bar.dc.html'}));
  const state = {
    idle: [s('●', C.faint), s(' idle', C.dim)],
    working: [s('⠹', C.accent, {cls: 'pulse'}), s(' working', C.ink)],
    agents: [s('⠹', C.accent, {cls: 'pulse'}), s(' 3 agents', C.ink)],
  }[status];
  return [{full: true, segs: fit(left, [...meters, sp(3), ...state, sp(1)], 64, bg)}];
}
function tabs(view, badge) {
  const all = [['Changes', 'V4-Changes.dc.html'], ['Files', ''], ['Agents', 'V4-Agents.dc.html'], ['Usage', '']];
  const left = [sp(1), ...all.flatMap(([label, href]) => {
    const extra = label === 'Agents' && badge ? [s(' ⠹', C.accent, {cls: 'pulse'}), s(' ' + badge, C.accent, {b: 1})] : [];
    const on = label === view;
    return [s(' ' + label, on ? C.ink : C.dim, {b: on}), ...extra, s(' ', undefined), sp(1)].map(x => ({...x, bg: on ? C.surface2 : undefined, ...(href ? {href} : {})}));
  })];
  return V(none, left);
}
function pills(active, where, o = {}) {
  const names = ['By turn', 'By file', 'Uncommitted'];
  const left = [sp(1), ...names.flatMap((name, i) => [...(i ? [s(' · ', C.faint)] : []), s(' ' + name + ' ', name === active ? C.ink : C.dim, {bg: name === active ? C.surface2 : undefined})])];
  const right = [s('in ', C.faint), s(where, o.all ? C.accent : C.text, {b: 1}), s(' ▾', C.dim), sp(1)].map(x => ({...x, href: 'V4-Worktrees.dc.html'}));
  return V(none, left, right);
}
const top = (view, o = {}) => [...menubar(o), gapRow(), tabs(view, o.badge), ...(o.pills === false ? [] : [pills(o.group ?? 'By turn', o.where ?? 'jiaolong', {all: o.all})]), gapRow()];
const foot = (pairs, right = 'jiaolong') => [gapRow(), V(none, pairs.flatMap(([k, label], i) => [...(i ? [sp(2)] : [sp(1)]), s(k, C.text), s(' ' + label, C.dim)]), [s(right, C.faint), sp(1)])];

// A day's turns as columns: where the big ones were. The open turn is lit.
function activity(prefix, heights, open) {
  const cols = heights.flatMap((h, i) => [column(h, i === open ? C.accent : C.faint), column(h, i === open ? C.accent : C.faint), sp(1)]);
  return cols;
}
// Where a turn landed, by folder: one bar, split.
function landed(prefix, parts) {
  const w = 62 - len(prefix) - 1;
  let used = 0;
  const cells = parts.map(([, share], i) => { const n = i === parts.length - 1 ? w - used : Math.round(share * w); used += n; return n; });
  return [
    V(prefix, parts.map(([, ], i) => lower(cells[i], HUES[i % HUES.length])), []),
    V(prefix, parts.flatMap(([name, share], i) => [...(i ? [sp(3)] : []), s('■', HUES[i % HUES.length]), s(' ' + name, C.text), s(' ' + Math.round(share * 100) + '%', C.dim)])),
  ];
}

// =====================================================================
// Board 1 · Changes, the stream redrawn
// =====================================================================
{
  const p = line();
  const stream = [
    V(none, [s('TODAY', C.faint, {b: 1}), s('   Layout polish, usage and agents', C.dim)], [s('11 turns', C.dim), dot(), s('5h 40m', C.dim), sp(1)]),
    V(none, [sp(8), ...activity(none, [2, 1, 8, 1, 1, 3, 6, 5, 7, 4, 2], 8)], [s('+4,180', C.add), sp(1), s('−1,630', C.del), sp(1)]),
    gapRow(),
    V(node('fill', C.accent, {first: true}), [s('i think option 3 is exactly what i want. and when i…', C.ink, {b: 1})], [s('13:05', C.dim), sp(1)]),
    V(p, [...chip('8 files', C.surface2, C.text), sp(1), ...chip('+310', X.tintAdd, C.add), sp(1), ...chip('−76', X.tintDel, C.del), s('   14m 12s', C.dim), dot(), s('1 agent', C.dim), dot(), s('166k', C.dim)]),
    ...landed(p, [['src/core', .58], ['src/ui', .31], ['docs', .11]]),
    gapRow(p),
    folderRow(p, 'src/core'),
    fileRow(p, 'M', 'turns.ts', 4, 1, 114, 12),
    fileRow(p, 'M', 'git.ts', 4, 0, 96, 0),
    fileRow(p, 'M', 'snapshot.ts', 1, 2, 6, 45),
    folderRow(p, 'src/ui'),
    fileRow(p, 'M', 'views/changes.ts', 2, 1, 17, 5),
    fileRow(p, 'M', 'App.tsx', 2, 1, 14, 6, {bg: C.surface2, tail: [s('   1 hunk', C.dim, {bg: C.surface2})]}),
    wellEdge(p, true),
    hunkRow(p, 'load()', '246–259', 8, 4),
    diffRow(p, ' ', 253, "      if (scope === 'git') return fromGit();"),
    diffRow(p, '-', 254, '      if (change?.measured && history.store) {'),
    diffRow(p, '+', 254, '      const known = change?.files.find(f => f.rel === rel)?.known;'),
    diffRow(p, '+', 255, '      if (change?.measured && known) {'),
    diffRow(p, ' ', 256, '        const one = await fileInTurn(root, history.store, change, rel);'),
    wellEdge(p, false),
    folderRow(p, 'docs'),
    fileRow(p, 'M', 'PLAN.md', 3, 1, 63, 8),
    fileRow(p, 'A', 'scratch-notes.md', 0, 0, 0, 0, {nameFg: C.dim, tail: [s('   not recorded', C.faint, {i: 1})]}),
    gapRow(p),
    V(p, [s('▸', C.dim), sp(1), s('40 steps', C.text), s('   Read 14  Edit 11  Bash 9  Grep 6', C.dim)], [s('1 agent', C.dim), sp(1)]),
    V(p, [s('✦', C.accent), sp(1), s('Turns the pane did not watch now read their files', C.text)]),
    V(p, [sp(2), s('from the commits made before your next prompt. ', C.text), s('more', C.link, {u: 1})]),
    gapRow(p),
    closedTurn('wait im not sure about the new section. lets plan this', null, 0, 0, '12:58'),
    closedTurn('so i currently dont see any changes or any diffs', 4, 3, 1, '12:41'),
    closedTurn('can you run npm run pane for me for this session?', null, 0, 0, '12:30'),
    closedTurn('sorry i forgot to pull from main before i started', 20, 4, 1, '11:21', {tag: 'git'}),
    closedTurn('try running orchestrating agent in this session', null, 0, 0, '11:14', {note: '4 agents'}),
    closedTurn('i think right now there is overall needs to have a', null, 0, 0, '11:12'),
    V(none, [sp(3), hline(20, X.spine), s('  yesterday  ', C.faint), hline(26, X.spine)]),
    closedTurn('write the one-stream design into the plan', 3, 2, 0, '19:38'),
    closedTurn('rebuild the pane as one stream, with a menu bar', 31, 5, 0, '18:02'),
  ];
  files4['V4-Changes.dc.html'] = page({title: 'Changes, the stream redrawn', top: top('Changes', {}), stream, bottom: foot([['enter', 'open'], ['esc', 'back'], ['m', 'menu'], ['↑↓', 'move']])});
  text4['V4-Changes.dc.html'] = [...top('Changes', {}), ...stream];
}

// =====================================================================
// Board 2 · While Claude works: the agent chart
// =====================================================================
const AG = [
  {name: 'Write the WezTerm launcher', color: HUES[0]},
  {name: 'Try the AppleScript split', color: HUES[1]},
  {name: 'Write kitty.ts', color: HUES[2]},
];
const branch = (last, color = X.spine) => [pipe({u: 1, d: last ? 0 : 1, r: 1, color}), pipe({l: 1, r: 1, color}), sp(1)];
const trunk = (last, color = X.spine) => [last ? sp(1) : pipe({u: 1, d: 1, color}), sp(2)];
{
  const live = line(C.accent);
  const agentRow = (last, a, state, time, tok2, o = {}) => V([...live, ...branch(last)],
    [s('■', a.color), sp(1), s(a.name, state === 'run' ? C.ink : C.text, {b: state === 'run'}), ...(o.kind ? [sp(2), ...chip(o.kind, C.surface2, C.dim)] : [])],
    [state === 'run' ? s('⠹', C.accent, {cls: 'pulse'}) : s('✓', C.add), sp(1), s(time.padStart(7), C.dim), sp(1), s(tok2.padStart(5), C.faint), sp(1)], {bg: o.bg});
  const doing = (last, tool, what) => V([...live, ...trunk(last)], [sp(2), s('⎿', C.faint), sp(2), s(tool.padEnd(6), C.dim), s(what, C.text)]);
  const facts = (last, text) => V([...live, ...trunk(last)], [sp(5), s(text, C.faint)]);
  const who = ids => ids.flatMap(i => [s('■', AG[i].color)]);
  const stream = [
    V(none, [s('TODAY', C.faint, {b: 1}), s('   Day 3 launchers', C.dim)], [s('3 turns', C.dim), dot(), s('41m', C.dim), sp(1)]),
    gapRow(),
    V(node('fill', C.accent, {first: true, line: C.accent, cls: 'pulse'}), [s('build the rest of the day 3 launchers in parallel', C.ink, {b: 1})], [s('19:31', C.dim), sp(1)]),
    V(live, [s('running 3m 16s', C.accent), s('   ', C.dim), ...chip('3 files', C.surface2, C.text), sp(1), ...chip('+18', X.tintAdd, C.add), sp(1), ...chip('−1', X.tintDel, C.del)]),
    gapRow(live),
    V(live, [s('⠹', C.accent, {cls: 'pulse'}), sp(1), s('3 agents', C.ink, {b: 1}), dot(), s('2 running', C.accent), dot(), s('1 done', C.dim)], [s('264k tokens', C.dim), sp(1)]),
    agentRow(false, AG[0], 'done', '1m 45s', '73k'),
    facts(false, '12 tool uses  ·  wrote wezterm.ts, index.ts'),
    agentRow(false, AG[1], 'run', '3m 01s', '98k', {kind: 'Sonnet 5'}),
    doing(false, 'Bash', 'osascript split.scpt'),
    facts(false, '9 tool uses'),
    agentRow(true, AG[2], 'run', '3m 01s', '93k'),
    doing(true, 'Write', 'src/launch/kitty.ts'),
    facts(true, '7 tool uses'),
    gapRow(live),
    folderRow(live, 'src/launch', 'the squares say who wrote it'),
    fileRow(live, 'M', 'index.ts', 1, 1, 2, 1, {tail: [sp(3), ...who([0, 1]), sp(1), s('⚠ two agents', C.warn)]}),
    fileRow(live, 'A', 'kitty.ts', 2, 0, 8, 0, {tail: [sp(3), ...who([2])]}),
    fileRow(live, 'A', 'wezterm.ts', 2, 0, 8, 0, {tail: [sp(3), ...who([0])]}),
    gapRow(live),
    V(live, [s('⠹', C.accent, {cls: 'pulse'}), sp(1), s('Agent', C.dim), sp(2), s('waiting for 2 agents', C.text)], [s('4 steps', C.dim), sp(1)]),
    gapRow(live),
    closedTurn('add a tmux launcher and wire it into the launcher list', 3, 2, 1, '19:00'),
    closedTurn('fix the wt launcher so the split closes on q', 2, 2, 1, '18:40'),
  ];
  const o = {status: 'agents', badge: '2'};
  files4['V4-Working.dc.html'] = page({title: 'While Claude works: the agent chart', top: top('Changes', o), stream, bottom: foot([['enter', 'open an agent'], ['3', 'agents'], ['m', 'menu']], 'main')});
  text4['V4-Working.dc.html'] = [...top('Changes', o), ...stream];
}

// =====================================================================
// Board 3 · Agents: who ran when
// =====================================================================
{
  const p = line();
  const LANE = 26;
  // A lane is a time axis 26 cells wide: from, to in cells.
  const lane = (from, to, color, run) => [sp(from), lower(to - from, color, run ? {cls: 'pulse'} : {}), sp(LANE - to)];
  const row = (name, from, to, state, time, o = {}) => {
    const mark = state === 'done' ? s('✓', C.add) : state === 'run' ? s('⠹', C.accent, {cls: 'pulse'}) : s('●', C.faint);
    const fg = state === 'run' ? C.ink : state === 'stop' ? C.dim : C.text;
    return V(o.prefix ?? p, [s(name.padEnd(21), fg, {b: state === 'run'}), sp(1), ...lane(from, to, state === 'stop' ? C.faint : o.color ?? C.dim, state === 'run')], [mark, sp(1), s(time.padStart(7), state === 'run' ? C.accent : C.dim), sp(1)], {bg: o.bg});
  };
  const axis = V(p, [sp(22), s('11:21', C.faint), sp(7), s('12:00', C.faint), sp(6), s('12:39', C.faint)]);
  const wt = (name, note, color, tail) => V(p, [s('in ', C.faint), s(name, color, {b: 1}), s('   ' + note, C.dim)], tail);
  const stream = [
    V(none, [s('⠹', C.accent, {cls: 'pulse'}), sp(1), s('1 running', C.accent, {b: 1}), dot(), s('7 done', C.text), dot(), s('1 stopped', C.dim)], [s('898k tokens', C.dim), sp(1)]),
    gapRow(),
    V(node('fill', C.accent, {first: true}), [s('i think right now there is overall needs to have a…', C.ink, {b: 1})], [s('11:21', C.dim), sp(1)]),
    V(p, [s('9 agents', C.text), dot(), s('at most 3 at once', C.dim), dot(), s('1h 18m', C.dim)]),
    gapRow(p),
    axis,
    wt('jiaolong', 'the folder you are in', C.text, [s('read only', C.faint), sp(1)]),
    row('Audit Usage view', 0, 1, 'done', '2m 39s'),
    row('Audit cards, collapse', 0, 2, 'done', '5m 09s'),
    row('Audit Agents view', 0, 1, 'stop', 'stopped'),
    row('Audit chrome, menus', 0, 2, 'done', '4m 31s'),
    row('Phase 1 · left line', 5, 11, 'done', '18m 02s', {color: HUES[0]}),
    gapRow(p),
    wt('three worktrees', 'one agent in each', C.text, [s('✓ 3 merged', C.add), sp(1)]),
    row('Phase 2a · Usage', 12, 16, 'done', '12m 50s', {color: HUES[1]}),
    row('Phase 2b · Agents', 12, 18, 'done', '18m 35s', {color: HUES[2], bg: C.surface2}),
    V(p, [sp(2), s('general-purpose', C.dim), dot(), s('Opus 5', C.dim), dot(), s('75 tool uses', C.dim), dot(), s('171k', C.dim)]),
    V(p, [sp(2), s('in ', C.faint), s('agent-a764', HUES[2], {b: 1}), s('   3 files ', C.dim), ...size(4, 1)], [s('✓ merged 13:02', C.add), sp(1)]),
    V(p, [sp(2), s('“Status first, fixed right columns. Nesting is exact:', C.text)]),
    V(p, [sp(2), s('each agent records its real parent.” ', C.text), s('more', C.link, {u: 1})]),
    row('Phase 2c · Files', 12, 15, 'done', '7m 40s', {color: X.teal}),
    gapRow(p),
    wt('jiaolong', '', C.text),
    row('Phase 3 · chrome', 19, 26, 'run', '21m 10s', {color: C.accent}),
    V(p, [sp(2), s('⎿', C.faint), sp(2), s('Edit  ', C.dim), s('src/ui/menu.ts', C.text)], [s('146 tool uses', C.faint), sp(1)]),
    gapRow(p),
    closedTurn('try running orchestrating agent in this session', null, 0, 0, '11:14', {note: '4 agents · 5m'}),
    V(none, [sp(3), hline(20, X.spine), s('  yesterday  ', C.faint), hline(26, X.spine)]),
    closedTurn('rebuild the pane as one stream, with a menu bar', null, 0, 0, '18:02', {note: '2 agents · 31m'}),
  ];
  const o = {status: 'agents', badge: '1', pills: false};
  files4['V4-Agents.dc.html'] = page({title: 'Agents: who ran when', top: top('Agents', o), stream, bottom: foot([['enter', 'open an agent'], ['esc', 'back'], ['m', 'menu']])});
  text4['V4-Agents.dc.html'] = [...top('Agents', o), ...stream];
}

// =====================================================================
// Board 4 · Changes across worktrees
// =====================================================================
{
  const WT = {main: C.dim, here: C.accent, a: HUES[1], b: HUES[2], c: X.teal};
  const tree = (depth, last, color, kind) => [
    ...(depth === 0 ? [pipe({d: 1, color: X.spine, node: kind, nodeColor: color})] : depth === 1
      ? [pipe({u: 1, d: last ? 0 : 1, r: 1, color: X.spine}), pipe({l: 1, d: 1, color: X.spine, node: kind, nodeColor: color})]
      : [pipe({u: 1, d: 1, color: X.spine}), sp(1), pipe({u: 1, d: last ? 0 : 1, r: 1, color: X.spine}), pipe({l: 1, color: X.spine, node: kind, nodeColor: color})]),
    sp(1),
  ];
  const wtRow = (depth, last, kind, color, name, where, ahead, state, o = {}) => {
    const pre = tree(depth, last, color, kind);
    return V(pre, [s(name.padEnd(25 - len(pre)), o.fg ?? C.ink, {b: o.b}), s(where.padEnd(16), C.faint)], [s(ahead.padStart(4), C.dim), sp(2), ...state, sp(1)], {bg: o.bg});
  };
  const tagged = (color, name) => chip(name, C.surface2, color);
  const p = line();
  const stream = [
    V(none, [s('WORKTREES', C.faint, {b: 1}), s('   one repo, five folders', C.dim)], [s('3 active', C.accent), sp(1)]),
    wtRow(0, false, 'ring', WT.main, 'main', 'Desktop/sidecar…', '', [s('clean', C.faint)]),
    wtRow(1, true, 'fill', WT.here, 'improve-pane-layout', 'orca/jiaolong', '↑22', [s('⠹', C.accent, {cls: 'pulse'}), s(' you + Claude', C.ink)], {b: 1}),
    wtRow(2, false, 'ring', WT.a, 'commit-backed turns', 'agent-a868', '↑1', [s('✓ merged 13:20', C.add)], {fg: C.text}),
    wtRow(2, false, 'fill', WT.b, 'usage round three', 'agent-a384', '↑1', [s('⠹', C.accent, {cls: 'pulse'}), s(' Opus 5 · 12m', C.text)]),
    wtRow(2, true, 'fill', WT.c, 'markdown page view', 'agent-aeed', '↑2', [s('⠹', C.accent, {cls: 'pulse'}), s(' Opus 5 · 31m', C.text)]),
    gapRow(),
    V(none, [s('TODAY', C.faint, {b: 1}), s('   everything, in the order it happened', C.dim)], [s('11 turns', C.dim), sp(1)]),
    gapRow(),
    V(node('fill', WT.c, {first: true, cls: 'pulse'}), [...tagged(WT.c, 'page view'), sp(1), s('Read a markdown file as a page', C.ink, {b: 1})], [s('14:31', C.dim), sp(1)]),
    V(p, [s('agent', C.dim), dot(), s('running 31m', C.accent), s('   ', C.dim), ...chip('7 files', C.surface2, C.text), sp(1), ...chip('+598', X.tintAdd, C.add), sp(1), ...chip('−94', X.tintDel, C.del)]),
    folderRow(p, 'src/core'),
    fileRow(p, 'M', 'markdown.ts', 5, 0, 412, 61),
    folderRow(p, 'src/ui/views'),
    fileRow(p, 'M', 'files.ts', 3, 1, 148, 22),
    V(p, [s('▸', C.dim), sp(1), s('5 more files', C.dim)], [s('not in your folder until it is merged', C.faint, {i: 1}), sp(1)]),
    gapRow(p),
    V(node('fill', WT.b, {cls: 'pulse'}), [...tagged(WT.b, 'usage'), sp(1), s('Put the Usage view back on panels', C.ink, {b: 1})], [s('14:02', C.dim), sp(1)]),
    V(p, [s('agent', C.dim), dot(), s('running 12m', C.accent), s('   ', C.dim), ...chip('5 files', C.surface2, C.text), sp(1), ...chip('+380', X.tintAdd, C.add), sp(1), ...chip('−172', X.tintDel, C.del)]),
    gapRow(p),
    V(node('fill', WT.here), [...tagged(WT.here, 'jiaolong'), sp(1), s('wait is the usage page real? i see the…', C.ink, {b: 1})], [s('13:58', C.dim), sp(1)]),
    V(p, [s('you', C.dim), dot(), s('3 agents started', C.text), s('   ', C.dim), ...chip('2 files', C.surface2, C.text), sp(1), ...chip('+5', X.tintAdd, C.add)]),
    folderRow(p, 'src/ui'),
    fileRow(p, 'M', 'theme.ts', 1, 0, 5, 0),
    gapRow(p),
    V(node('ring', WT.a), [...tagged(WT.a, 'commits'), sp(1), s('Fill a turn nobody watched from…', C.text)], [s('13:05', C.faint), sp(1)]),
    V(p, [s('agent', C.dim), dot(), s('14m', C.dim), s('   7 files ', C.dim), ...size(4, 1)], [s('✓ merged 13:20', C.add), sp(1)]),
    gapRow(p),
    closedTurn('so i currently dont see any changes or any diffs', 4, 3, 1, '12:41', {color: WT.here}),
    closedTurn('sorry i forgot to pull from main before i started', 20, 4, 1, '11:21', {color: WT.here, tag: 'git'}),
    closedTurn('pull the latest and check the smoke scripts', 2, 1, 0, '10:50', {color: WT.main}),
  ];
  const o = {status: 'agents', badge: '2', where: 'all 5 worktrees', all: true};
  files4['V4-Worktrees.dc.html'] = page({title: 'Changes across worktrees', top: top('Changes', o), stream, bottom: foot([['w', 'worktree'], ['enter', 'open'], ['esc', 'back'], ['m', 'menu']])});
  text4['V4-Worktrees.dc.html'] = [...top('Changes', o), ...stream];
}

// =====================================================================
// Board 5 · The bar: session and week, in every state
// =====================================================================
{
  const label = text => V(none, [sp(1), s(text, C.faint, {i: 1})]);
  const under = (view, o) => [...menubar(o), gapRow(), tabs(view, o.badge)];
  const stream = [
    label('connected: the session, its reset, the week'),
    ...under('Changes', {feed: 'on', status: 'idle'}),
    gapRow(), gapRow(),
    label('connected, 82% used: the tone warns'),
    ...under('Changes', {feed: 'on', status: 'working', used: .82}),
    gapRow(), gapRow(),
    label('connected, 96% used'),
    ...under('Changes', {feed: 'on', status: 'working', used: .96}),
    gapRow(), gapRow(),
    label('not connected: the estimate, and the way to a percentage'),
    ...under('Changes', {feed: 'off', status: 'idle'}),
    gapRow(), gapRow(),
    label('another tool took the status line back'),
    ...under('Usage', {feed: 'quiet', status: 'idle'}),
  ];
  const h = 27 * RH + 24;
  files4['V4-Bar.dc.html'] = page({title: 'The bar: session and week, in every state', top: [], stream, bottom: [], h});
  text4['V4-Bar.dc.html'] = stream;
}
