// Version 5, two directions. The owner asked for the pane to work the way an
// IDE's side panel does: a primary list that says what is going on, a
// secondary panel that shows the thing you picked, and a quick menu, so a
// terminal user gets the "which worktree is doing what" picture without
// opening an IDE. Both directions keep the built pane's grid, theme, glyphs
// and the one rule for a row that opens; they differ in where the menu lives
// and where the detail goes.
//
//   A · Workspaces   a list of folders on top, the detail under it, a palette
//   B · Rail + map   the menu on the left edge, worktrees on a clock, detail
//                    opens in place
//
// `node design/v5.mjs` writes the V5-* boards only. `--text` prints them.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {C, s, sp, bar, fit, len, lower, upper, column, pill, split, hline, pipe, tok, sliceSegs, page, RH, BW, dump} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// The pane's own pixel font, read from the theme so the opening draws the
// wordmark the pane really draws.
const {glyph} = await import('../src/ui/theme.ts');
const X = {spine: '#3A3835', track: '#3A3835', teal: '#6FC7C1', pink: '#E39AC0', tintAdd: '#12301D', tintDel: '#33161A', menu: '#232220'};
const HUES = [C.link, C.string, C.keyword, X.teal, X.pink];
export const files5 = {}, text5 = {};

// The same fake afternoon on every board. Now is 14:45.
const WT = {
  here: {name: 'improve-pane-layout', folder: 'jiaolong', hue: C.accent},
  a: {name: 'commit-backed turns', folder: 'agent-a868', hue: HUES[1]},
  b: {name: 'usage round three', folder: 'agent-a384', hue: HUES[2]},
  c: {name: 'markdown page view', folder: 'agent-aeed', hue: X.teal},
  main: {name: 'main', folder: 'Desktop', hue: C.dim},
};

// ---------- rows, as the built pane draws them ----------
const none = [];
const V = (prefix, l = [], r = [], o = {}) => ({...o, segs: [sp(1), ...prefix.map(x => ({...x, bg: x.bg ?? o.bg})), ...fit(l, r, 62 - len(prefix), o.bg)]});
const line = (color = X.spine) => [pipe({u: 1, d: 1, color}), sp(2)];
const head = (glyph, color, o = {}) => [s(glyph, color, {cls: o.cls}), sp(2)];
const gapRow = (prefix = none) => V(prefix);
const chip = (text, bg, fg, o) => pill(text, bg, fg, o);
const dot = () => s('  ·  ', C.faint);
const spin = (color = C.accent) => s('⠹', color, {cls: 'pulse'});
const size = (g, r) => [split([[g, C.add], [r, C.del], [5 - g - r, X.track]])];
const stat = (add, del) => [add ? s(('+' + add).padStart(5), C.add) : sp(5), sp(1), del ? s(('−' + del).padStart(5), C.del) : sp(5)];
const LETTER = {A: C.add, M: C.link, D: C.del, R: C.keyword};
const fileRow = (prefix, letter, name, g, r, add, del, o = {}) =>
  V(prefix, [sp(1), s(letter, LETTER[letter], {b: 1}), sp(2), s(name, o.nameFg ?? C.ink), ...(o.tail ?? [])], [...size(g, r), sp(2), ...stat(add, del), sp(1)], {bg: o.bg});
const folderRow = (prefix, name, note) => V(prefix, [s(name, C.dim)], note ? [s(note, C.faint), sp(1)] : []);
const commitRow = (prefix, sha, subject, time) => V(prefix, [s('◆', C.link), sp(1), s(sha, C.link), sp(2), s(subject, C.dim)], [s(time, C.faint), sp(1)]);
const mergeRow = (prefix, sha, into, time) => V(prefix, [s('✓', C.add), sp(1), s(sha, C.link), sp(2), s('merged into ', C.dim), s(into, C.text, {b: 1})], [s(time, C.faint), sp(1)]);
const cut = (text, room) => { const ch = [...text]; return ch.length > room ? ch.slice(0, room - 1).join('').trimEnd() + '…' : text; };

function closedTurn(prompt, files, g, r, time, o = {}) {
  const right = files === null
    ? [s(o.note ?? 'no file changes', C.faint, {i: o.note ? 1 : 0}), sp(3), s(time, C.faint), sp(1)]
    : [s(String(files).padStart(2) + (files === 1 ? ' file ' : ' files'), C.dim), sp(1), ...size(g, r), sp(1), ...(o.git === 'merged' ? [s('✓', C.add), sp(2)] : o.git ? [s('◆', C.link), s(String(o.git).padEnd(2), C.dim)] : [sp(3)]), sp(2), s(time, C.faint), sp(1)];
  return V(head('▸', o.color ?? C.dim), [...(o.tag ? [...chip(o.tag[0], C.surface2, o.tag[1]), sp(1)] : []), s(cut(prompt, o.tag ? 32 - o.tag[0].length - 3 : 32), C.text)], right, {btn: o.btn, href: o.href});
}
const wellRow = (prefix, l = [], r = [], o = {}) => ({segs: [sp(1), ...prefix, ...fit(l, r, 62 - len(prefix), o.bg ?? C.well)]});
const wellEdge = (prefix, top) => ({segs: [sp(1), ...prefix, (top ? lower : upper)(62 - len(prefix), C.well)]});
function diffRow(prefix, sign, no, code) {
  const cw = 62 - len(prefix) - 9;
  const bg = sign === '+' ? C.addBg : sign === '-' ? C.delBg : undefined;
  const tone = sign === '+' ? C.add : sign === '-' ? C.del : C.faint;
  let segs = tok(code, sign === ' ' ? C.text : C.ink);
  if (len(segs) > cw) segs = [...sliceSegs(segs, 0, cw - 1), s('…', C.faint)];
  return wellRow(prefix, [sign === ' ' ? sp(1) : bar(tone), s(String(no).padStart(4), sign === ' ' ? C.faint : C.dim), sp(1), s(sign === ' ' ? ' ' : sign === '-' ? '−' : '+', tone), sp(1), ...segs], [], {bg});
}
const hunkRow = (prefix, label, range, add, del) => wellRow(prefix, [sp(1), s('▾', C.dim), sp(1), s(label, C.link)],
  [s(range, C.faint), sp(2), ...(add ? [s('+' + add, C.add)] : []), ...(del ? [sp(1), s('−' + del, C.del)] : []), sp(1)], {bg: C.scope});

// The wordmark: five pixel rows a glyph on three screen rows of half blocks,
// `scale` cells a pixel, as `bigDigits` draws it. Each pixel column is one
// box, so a column can be given its own class and appear on its own tick.
function wordmark(text, color, scale = 2, o = {}) {
  const rows = [[], [], []];
  let col = 0;
  const cell = (top, bottom) => (top && bottom ? [0, 0, 1, 1] : top ? [0, 0, 1, .5] : bottom ? [0, .5, 1, .5] : null);
  [...text.toUpperCase()].forEach((ch, gi) => {
    const px = glyph.font[ch];
    if (gi) { rows.forEach(r => r.push(sp(scale))); col++; }
    for (let x = 0; x < px[0].length; x++) {
      const pairs = [[px[0][x] === '#', px[1][x] === '#'], [px[2][x] === '#', px[3][x] === '#'], [px[4][x] === '#', false]];
      pairs.forEach(([t, b], ri) => { const rect = cell(t, b); rows[ri].push(rect ? {kind: 'box', t: ' '.repeat(scale), rect, color, cls: o.cls ? o.cls(col) : undefined} : sp(scale)); });
      col++;
    }
  });
  return rows;
}

// The day's turns as columns. The open one is lit.
const skyline = (heights, open) => heights.flatMap((h, i) => [column(h, i === open ? C.accent : C.faint), column(h, i === open ? C.accent : C.faint), sp(1)]);
// Where a turn landed, by folder.
function landed(prefix, parts) {
  const w = 62 - len(prefix) - 1;
  let used = 0;
  const cells = parts.map(([, share], i) => { const n = i === parts.length - 1 ? w - used : Math.round(share * w); used += n; return n; });
  return [
    V(prefix, [split(parts.map((_, i) => [cells[i], HUES[i % HUES.length]]))]),
    V(prefix, parts.flatMap(([name, share], i) => [...(i ? [sp(3)] : []), s('■', HUES[i % HUES.length]), s(' ' + name, C.text), s(' ' + Math.round(share * 100) + '%', C.dim)])),
  ];
}

// ---------- chrome ----------
function menubar(status = 'agents') {
  const bg = C.surface;
  const left = [sp(1), s('◆', C.accent), sp(1), s('Sidecar', C.ink, {b: 1}), sp(2), s('View', C.text)];
  const meters = [s('5h', C.dim), sp(1), split([[3, C.accent], [3, X.track]]), sp(1), s('58%', C.ink, {b: 1}), sp(2), s('1h 52m', C.dim), s(' · ', C.faint), s('wk', C.dim), sp(1), s('23%', C.text)];
  const state = {
    idle: [s('●', C.faint), s(' idle', C.dim)],
    agents: [spin(), s(' 3 agents', C.ink)],
  }[status];
  return [{full: true, segs: fit(left, [...meters, sp(3), ...state, sp(1)], 64, bg)}];
}
function tabs(view, badge, links = {}) {
  const left = [sp(1), ...['Changes', 'Files', 'Agents', 'Usage'].flatMap(label => {
    const extra = label === 'Agents' && badge ? [s(' ⠹', C.accent, {cls: 'pulse'}), s(' ' + badge, C.accent, {b: 1})] : [];
    const on = label === view;
    return [s(' ' + label, on ? C.ink : C.dim, {b: on}), ...extra, s(' ', undefined), sp(1)].map(x => ({...x, bg: on ? C.surface2 : undefined, ...(links[label] ? {href: links[label]} : {})}));
  })];
  return V(none, left);
}
function pills(active, right = []) {
  const names = ['By turn', 'By file', 'Uncommitted'];
  return V(none, [sp(1), ...names.flatMap((name, i) => [...(i ? [s(' · ', C.faint)] : []), s(' ' + name + ' ', name === active ? C.ink : C.dim, {bg: name === active ? C.surface2 : undefined})])], right);
}
const foot = (pairs, right = 'jiaolong') => [gapRow(), V(none, pairs.flatMap(([k, label], i) => [...(i ? [sp(2)] : [sp(1)]), s(k, C.text), s(' ' + label, C.dim)]), [s(right, C.faint), sp(1)])];
const when = (flag, rows, hint) => ({group: flag, rows, hint});

// =====================================================================
// Shared pieces both directions use
// =====================================================================

// A worktree's journey, as four stops on one line: started, committed,
// merged, removed. Filled up to where it has got; the current stop's label
// is the bright one. This is the one picture that answers "is that agent's
// work in my folder yet?" without a sentence.
function journey(prefix, hue, stage, labels, o = {}) {
  const nodes = [];
  for (let i = 0; i < 4; i++) {
    const on = i < stage;
    nodes.push(pipe({node: on ? 'fill' : 'ring', nodeColor: on ? hue : C.faint, l: i > 0 ? 1 : 0, r: i < 3 ? 1 : 0, lColor: i < stage ? hue : X.spine, rColor: i < stage - 1 ? hue : X.spine, color: X.spine, bg: o.bg}));
    if (i < 3) nodes.push(hline(13, i < stage - 1 ? hue : X.spine, {heavy: i < stage - 1, bg: o.bg}));
  }
  const words = labels.map((t, i) => s(i === 3 ? t : t.padEnd(14), i === stage - 1 ? C.ink : i < stage ? C.dim : C.faint, {b: i === stage - 1, bg: o.bg}));
  return [V(prefix, [sp(1), ...nodes], [], o), V(prefix, [sp(1), ...words], [], o)];
}

// A merge that landed in your folder is a row of your stream, so forty files
// never appear out of nowhere. It opens like a turn: where it came from, what
// it brought.
function landing(open, wt, files, g, r, time, o = {}) {
  const chev = open ? '▾' : '▸';
  const row = V(head(chev, C.add), [s('✓ ', C.add), s('merged', C.dim), sp(2), s(wt.name, wt.hue, {b: 1})], [s(files + ' files', C.dim), sp(1), ...size(g, r), sp(5), s(time, C.dim), sp(1)], {btn: o.btn});
  if (o.href) row.segs = row.segs.map(x => ({...x, href: o.href}));
  if (!open) return [row];
  const p = line(C.add);
  return [row,
    V(p, [s('from ', C.dim), s(wt.folder, C.text), dot(), s('1 commit', C.dim), dot(), s('14m', C.dim), dot(), s('folder removed', C.dim)]),
    gapRow(p),
    folderRow(p, 'src/core'),
    fileRow(p, 'M', 'turns.ts', 4, 1, 114, 12),
    fileRow(p, 'M', 'git.ts', 4, 0, 96, 0),
    fileRow(p, 'M', 'snapshot.ts', 1, 2, 6, 45),
    folderRow(p, 'src/ui'),
    fileRow(p, 'M', 'views/changes.ts', 2, 1, 17, 5),
    V(p, [s('▸', C.dim), sp(1), s('3 more files', C.dim)]),
    gapRow(p),
    commitRow(p, '2fa351d', 'Fill a turn nobody watched from commits', '13:19'),
    mergeRow(p, 'bffa4d9', WT.here.name, '13:20'),
  ];
}

// Your folder's own stream, as the built pane draws it. Trimmed to fit under
// a primary panel.
function yourStream(o = {}) {
  const p = line(C.accent);
  return [
    V(none, [s('TODAY', C.faint, {b: 1}), s('   Layout polish, usage and agents', C.dim)], [s('11 turns', C.dim), dot(), s('5h 40m', C.dim), sp(1)]),
    V(none, [sp(8), ...skyline([2, 1, 8, 1, 1, 3, 6, 5, 7, 4, 2], 10)], [s('+4,180', C.add), sp(1), s('−1,630', C.del), sp(1)]),
    gapRow(),
    V(head('⠹', C.accent, {cls: 'pulse'}), [s('i think option 3 is exactly what i want. and when i…', C.ink, {b: 1})], [s('13:58', C.dim), sp(1)]),
    V(p, [s('running 47m', C.accent), dot(), s('3 agents', C.dim), s('   ', C.dim), ...chip('2 files', C.surface2, C.text), sp(1), ...chip('+5', X.tintAdd, C.add)]),
    gapRow(p),
    V(p, [spin(), s(' 3 agents', C.text), dot(), s('2 running', C.accent), dot(), s('1 done', C.dim)], [s('264k tokens', C.dim), sp(1)]),
    V(p, [s('▸', C.dim), sp(1), s('■', WT.a.hue), sp(1), s('Fill a turn nobody watched', C.text)], [s('✓', C.add), sp(1), s('14m', C.dim), sp(2), s('73k', C.faint), sp(1)]),
    V(p, [sp(4), s('in ', C.faint), s(WT.a.folder, C.text)], [s('✓ merged 13:20', C.add), sp(1)]),
    V(p, [s('▸', C.dim), sp(1), s('■', WT.b.hue), sp(1), s('Put the Usage view back on panels', C.text)], [spin(), sp(1), s('43m', C.dim), sp(2), s('98k', C.faint), sp(1)]),
    V(p, [sp(4), s('in ', C.faint), s(WT.b.folder, C.text), s('   5 files ', C.dim), ...size(4, 1)], [s('↑1 · not in jiaolong yet', C.dim), sp(1)]),
    V(p, [s('▸', C.dim), sp(1), s('■', WT.c.hue), sp(1), s('Read a markdown file as a page', C.text)], [spin(), sp(1), s('31m', C.dim), sp(2), s('93k', C.faint), sp(1)]),
    V(p, [sp(4), s('in ', C.faint), s(WT.c.folder, C.text), s('   7 files ', C.dim), ...size(5, 0)], [s('↑2 · not in jiaolong yet', C.dim), sp(1)]),
    gapRow(p),
    folderRow(p, 'src/ui'),
    fileRow(p, 'M', 'theme.ts', 1, 0, 5, 0),
    gapRow(p),
    ...(o.landing ?? landing(false, WT.a, 7, 4, 1, '13:20', {href: 'V5A-Landing.dc.html'})),
    closedTurn('wait im not sure about the new section. lets plan this', null, 0, 0, '12:58'),
    closedTurn('so i currently dont see any changes or any diffs', 4, 3, 1, '12:41', {git: 'merged'}),
    closedTurn('can you run npm run pane for me for this session?', null, 0, 0, '12:30'),
    closedTurn('sorry i forgot to pull from main before i started', 20, 4, 1, '11:21', {git: 3}),
    closedTurn('try running orchestrating agent in this session', null, 0, 0, '11:14', {note: '4 agents'}),
    closedTurn('i think right now there is overall needs to have a', null, 0, 0, '11:12'),
    V(none, [sp(3), hline(20, X.spine), s('  yesterday  ', C.faint), hline(26, X.spine)]),
    closedTurn('write the one-stream design into the plan', 3, 2, 0, '19:38', {git: 'merged'}),
    closedTurn('rebuild the pane as one stream, with a menu bar', 31, 5, 0, '18:02', {git: 'merged'}),
  ];
}

// =====================================================================
// Direction A · Workspaces. A primary list of every folder of the repo on
// top; the tabs and the stream under it belong to the folder you picked.
// =====================================================================

// One row per folder: a mark, the name, and on the right one sentence, the
// first true thing about it. Who is in it is the first word of that sentence.
// The columns for "who" and "how far ahead" are gone: they were two more
// things to read on every row, and both are one row in once you pick it.
function wsRow(wt, state, o = {}) {
  const sel = o.sel;
  const bg = sel ? C.surface2 : undefined;
  const mark = o.live ? spin() : o.merged ? s('○', C.faint) : s('●', wt.hue);
  const left = [sel ? s('▎', C.accent) : sp(1), sp(1), mark, sp(1), s(wt.name, sel ? C.ink : wt.hue, {b: sel})];
  return V(none, left, [...state, sp(1)], {bg, btn: o.btn});
}
const wsHead = () => V(none, [s('WORKSPACES', C.faint, {b: 1})], [s('3 active', C.accent), s(' of 5', C.dim), sp(1)]);
const rowHere = sel => wsRow(WT.here, [s('you', C.text), s(' · ', C.faint), s('3 uncommitted', C.dim)], {sel, live: true, btn: 'pickHere'});
const rowB = sel => wsRow(WT.b, [s('agent', C.text), s(' · ', C.faint), s('43m', C.dim), s(' · ', C.faint), s('not merged', C.dim)], {sel, live: true, btn: 'pickB'});
const rowC = sel => wsRow(WT.c, [s('agent', C.text), s(' · ', C.faint), s('31m', C.dim), s(' · ', C.faint), s('not merged', C.dim)], {sel, live: true, btn: 'pickC'});
const rowA = sel => wsRow(WT.a, [s('✓ merged 13:20', C.add)], {sel, merged: true, btn: 'pickA'});
const rowMain = () => wsRow(WT.main, [s('clean', C.faint)], {merged: true});

// Under the list: the tabs, and for your own folder the grouping pills. A
// picked worktree has one short stream, so the pills would be noise there.
const secondaryHead = (wt, badge) => [tabs('Changes', badge), ...(wt === WT.here ? [pills('By turn', [s('in ', C.faint), s(wt.folder, C.ink, {b: 1}), sp(1)])] : [V(none, [sp(2), s('in ', C.faint), s(wt.folder, C.ink, {b: 1})])]), gapRow()];

// The secondary panel for an agent's worktree that is still running.
function streamC() {
  const p = line(WT.c.hue);
  return [
    ...journey(none, WT.c.hue, 2, ['started 14:14', '2 commits', 'not merged', 'folder kept']),
    V(none, [sp(1), s('↑2 ahead of ', C.dim), s(WT.here.name, C.text), s(' · not there until merged', C.dim)]),
    gapRow(),
    V(head('⠹', WT.c.hue, {cls: 'pulse'}), [s('Read a markdown file as a page', C.ink, {b: 1})], [s('14:14', C.dim), sp(1)]),
    V(p, [s('agent', C.dim), dot(), s('running 31m', C.accent), s('   ', C.dim), ...chip('7 files', C.surface2, C.text), sp(1), ...chip('+598', X.tintAdd, C.add), sp(1), ...chip('−94', X.tintDel, C.del)]),
    ...landed(p, [['src/core', .71], ['src/ui', .29]]),
    gapRow(p),
    folderRow(p, 'src/core'),
    fileRow(p, 'M', 'markdown.ts', 5, 0, 412, 61),
    fileRow(p, 'A', 'markdown.test.ts', 3, 0, 88, 0),
    folderRow(p, 'src/ui/views'),
    fileRow(p, 'M', 'files.ts', 3, 1, 148, 22),
    V(p, [s('▸', C.dim), sp(1), s('4 more files', C.dim)]),
    gapRow(p),
    V(p, [spin(), s(' Edit', C.text), s('  Wire the page into the peek', C.dim)], [s('14 steps', C.dim), sp(1)]),
    gapRow(p),
    commitRow(p, '9c1e04a', 'Render markdown as a page in the reader', '14:29'),
    commitRow(p, 'd41b77e', 'Add a markdown parser with tests', '14:22'),
  ];
}
// The secondary panel for a worktree that has landed and is gone.
function streamA() {
  const p = line(WT.a.hue);
  return [
    ...journey(none, WT.a.hue, 4, ['started 13:05', '1 commit', '✓ merged 13:20', 'removed']),
    V(none, [sp(1), s('everything it did is in ', C.dim), s(WT.here.name, C.text), s(' now', C.dim)]),
    gapRow(),
    V(head('▾', WT.a.hue), [s('Fill a turn nobody watched from commits', C.ink, {b: 1})], [s('13:05', C.dim), sp(1)]),
    V(p, [s('agent', C.dim), dot(), s('14m', C.dim), s('   ', C.dim), ...chip('7 files', C.surface2, C.text), sp(1), ...chip('+296', X.tintAdd, C.add), sp(1), ...chip('−62', X.tintDel, C.del)], [...chip('✓ merged', X.tintAdd, C.add), sp(1)]),
    ...landed(p, [['src/core', .82], ['src/ui', .18]]),
    gapRow(p),
    folderRow(p, 'src/core'),
    fileRow(p, 'M', 'turns.ts', 4, 1, 114, 12),
    fileRow(p, 'M', 'git.ts', 4, 0, 96, 0),
    fileRow(p, 'M', 'snapshot.ts', 1, 2, 6, 45),
    folderRow(p, 'src/ui'),
    fileRow(p, 'M', 'views/changes.ts', 2, 1, 17, 5),
    V(p, [s('▸', C.dim), sp(1), s('3 more files', C.dim)]),
    gapRow(p),
    commitRow(p, '2fa351d', 'Fill a turn nobody watched from commits', '13:19'),
    mergeRow(p, 'bffa4d9', WT.here.name, '13:20'),
  ];
}

// Board A1 · the primary list, and the detail that follows the pick
{
  const primary = (sel) => [wsHead(), rowHere(sel === 'here'), rowB(sel === 'b'), rowC(sel === 'c'), rowA(sel === 'a'), rowMain(), gapRow()];
  const stream = [
    when('selHere', [...primary('here'), ...secondaryHead(WT.here, '3'), ...yourStream()]),
    when('selB', [...primary('b'), ...secondaryHead(WT.b, '1'), ...streamB()], 'false'),
    when('selC', [...primary('c'), ...secondaryHead(WT.c, '1'), ...streamC()], 'false'),
    when('selA', [...primary('a'), ...secondaryHead(WT.a, null), ...streamA()], 'false'),
  ];
  const logic = `class Component extends DCLogic {
renderVals() {
const st = this.state || {};
const sel = st.sel ?? 'here';
const pick = (k) => () => this.setState({ sel: k });
return {
selHere: sel === 'here', selB: sel === 'b', selC: sel === 'c', selA: sel === 'a',
pickHere: pick('here'), pickB: pick('b'), pickC: pick('c'), pickA: pick('a'),
};
}
}`;
  files5['V5A-Workspaces.dc.html'] = page({title: 'Workspaces: a list on top, the detail under it', top: [...menubar(), gapRow()], stream, bottom: foot([['w', 'pick'], ['enter', 'open'], ['h', 'home'], ['m', 'menu']]), logic});
  text5['V5A-Workspaces.dc.html'] = [...menubar(), gapRow(), ...primary('c'), ...secondaryHead(WT.c, '1'), ...streamC()];
}
function streamB() {
  const p = line(WT.b.hue);
  return [
    ...journey(none, WT.b.hue, 1, ['started 14:02', 'no commit yet', 'not merged', 'folder kept']),
    V(none, [sp(1), s('5 files edited, nothing committed · nothing there yet', C.dim)]),
    gapRow(),
    V(head('⠹', WT.b.hue, {cls: 'pulse'}), [s('Put the Usage view back on panels', C.ink, {b: 1})], [s('14:02', C.dim), sp(1)]),
    V(p, [s('agent', C.dim), dot(), s('running 43m', C.accent), s('   ', C.dim), ...chip('5 files', C.surface2, C.text), sp(1), ...chip('+380', X.tintAdd, C.add), sp(1), ...chip('−172', X.tintDel, C.del)]),
    gapRow(p),
    folderRow(p, 'src/ui/views'),
    fileRow(p, 'M', 'usage.ts', 4, 2, 301, 160),
    folderRow(p, 'src/ui'),
    fileRow(p, 'M', 'theme.ts', 2, 0, 41, 0),
    fileRow(p, 'M', 'cells.ts', 2, 1, 22, 9),
    V(p, [s('▸', C.dim), sp(1), s('2 more files', C.dim)]),
    gapRow(p),
    V(p, [spin(), s(' Bash', C.text), s('  npx tsx scripts/smoke.tsx', C.dim)], [s('31 steps', C.dim), sp(1)]),
  ];
}

// Board A2 · the palette: one key from anywhere, and it lists what a key does
{
  const W = 56;
  const R = (l = [], r = [], o = {}) => ({free: true, segs: fit([sp(1), ...l], [...r, sp(1)], W, o.bg ?? X.menu)});
  const edge = top => ({free: true, segs: [(top ? lower : upper)(W, X.menu)]});
  const section = t => R([s(t, C.faint, {b: 1})]);
  const item = (key, label, right = [], o = {}) => R([s(key.padEnd(3), o.sel ? C.accent : C.text, {b: 1}), s(label, o.sel ? C.ink : C.text, {b: o.sel})], right, {bg: o.sel ? C.surface2 : undefined});
  const rows = [
    edge(true),
    R([s('›', C.accent), sp(1), s('go to', C.dim), sp(1), s(' ', C.ink, {bg: C.accent})], [s('esc', C.faint), s(' close', C.faint)]),
    R(),
    section('VIEWS'),
    item('1', 'Changes', [s('by turn', C.dim)]),
    item('2', 'Files', [s('82 files · 3 changed', C.dim)]),
    item('3', 'Agents', [spin(), s(' 2 running', C.accent)]),
    item('4', 'Usage', [s('58% · 1h 52m left', C.dim)]),
    R(),
    section('WORKSPACES'),
    item('w', WT.here.name, [s('you + Claude', C.dim)], {sel: true}),
    item('', WT.b.name, [spin(), s(' 43m · not merged', C.dim)]),
    item('', WT.c.name, [spin(), s(' 31m · not merged', C.dim)]),
    item('', WT.a.name, [s('✓ merged 13:20', C.add)]),
    item('', 'main', [s('clean', C.faint)]),
    R(),
    section('SHOW'),
    item('u', 'Uncommitted only', [s('off', C.faint)]),
    item('f', 'Follow the newest turn', [s('on', C.text)]),
    item('a', 'All worktrees in one stream', [s('off', C.faint)]),
    R(),
    item('?', 'Every key', [s('the keys, view by view', C.dim)]),
    edge(false),
  ];
  const stream = [...[wsHead(), rowHere(true), rowB(false), rowC(false), rowA(false), rowMain(), gapRow()], ...secondaryHead(WT.here, '3'), ...yourStream()];
  files5['V5A-Palette.dc.html'] = page({title: 'The palette: one key, every place you can go', top: [...menubar(), gapRow()], stream, bottom: foot([['↑↓', 'move'], ['enter', 'go'], ['esc', 'close']]),
    overlays: [{col: 4, row: 3, rows, backdrop: 1}]});
  text5['V5A-Palette.dc.html'] = rows;
}

// Board A3 · a merge lands in your stream as a row of its own
{
  const stream = [wsHead(), rowHere(true), rowB(false), rowC(false), rowA(false), rowMain(), gapRow(), ...secondaryHead(WT.here, '3'), ...yourStream({landing: landing(true, WT.a, 7, 4, 1, '13:20')})];
  files5['V5A-Landing.dc.html'] = page({title: 'A merge lands as a row of your stream', top: [...menubar(), gapRow()], stream, bottom: foot([['enter', 'close'], ['esc', 'back'], ['w', 'pick a workspace'], ['m', 'menu']])});
  text5['V5A-Landing.dc.html'] = stream;
}

// =====================================================================
// Direction B · Rail and map. The menu is a rail on the left edge, one
// letter a view and the letter is the key. Worktrees are a view of their own:
// every folder as a lane on today's clock, and a lane opens in place.
// =====================================================================

// Every row of a rail board starts with three cells of the rail. `rail()`
// fills them in afterwards, by row number, so the panel rows never know.
const RB = (prefix, l = [], r = [], o = {}) => ({...o, segs: [sp(3), sp(1), ...prefix.map(x => ({...x, bg: x.bg ?? o.bg})), ...fit(l, r, 59 - len(prefix), o.bg)]});
const R0 = (l, r, o) => RB(none, l, r, o);
const rgap = (prefix = none) => RB(prefix);
function rail(rows, view, badges = {}) {
  const items = [['C', 'Changes'], ['F', 'Files'], ['A', 'Agents'], ['U', 'Usage'], ['W', 'Worktrees']];
  const cells = {};
  let at = 1;
  for (const [key, label] of items) {
    const on = label === view;
    const href = label === 'Worktrees' ? 'V5B-Map.dc.html' : label === 'Changes' ? 'V5B-Changes.dc.html' : undefined;
    cells[at] = [on ? bar(C.accent) : sp(1), s(key, on ? C.ink : C.dim, {b: on}), sp(1)].map(x => ({...x, bg: on ? C.surface2 : C.surface, ...(href ? {href} : {})}));
    const badge = badges[key];
    cells[at + 1] = badge ? [sp(1), s(badge.text, badge.color, {cls: badge.live ? 'pulse' : undefined, b: 1}), sp(1)].map(x => ({...x, bg: C.surface})) : null;
    at += 2;
  }
  cells[rows.length - 3] = [sp(1), s('m', C.dim), sp(1)].map(x => ({...x, bg: C.surface, href: 'V5B-Rail.dc.html'}));
  cells[rows.length - 1] = [sp(1), s('?', C.dim), sp(1)].map(x => ({...x, bg: C.surface}));
  return rows.map((row, i) => {
    if (row.group) return row;
    const fillers = [sp(1), sp(1), sp(1)].map(x => ({...x, bg: C.surface}));
    return {...row, segs: [...(cells[i] ?? fillers), ...row.segs.slice(1)]};
  });
}
const rfoot = (pairs, right = 'jiaolong') => [rgap(), R0(pairs.flatMap(([k, label], i) => [...(i ? [sp(2)] : [sp(1)]), s(k, C.text), s(' ' + label, C.dim)]), [s(right, C.faint), sp(1)])];
const rline = (color = X.spine) => [pipe({u: 1, d: 1, color}), sp(2)];
const rfile = (prefix, letter, name, g, r, add, del) => RB(prefix, [sp(1), s(letter, LETTER[letter], {b: 1}), sp(2), s(name, C.ink)], [...size(g, r), sp(2), ...stat(add, del), sp(1)]);
const rfolder = (prefix, name) => RB(prefix, [s(name, C.dim)]);
function rclosed(prompt, files, g, r, time, o = {}) {
  const right = files === null
    ? [s(o.note ?? 'no file changes', C.faint, {i: o.note ? 1 : 0}), sp(3), s(time, C.faint), sp(1)]
    : [s(String(files).padStart(2) + (files === 1 ? ' file ' : ' files'), C.dim), sp(1), ...size(g, r), sp(1), ...(o.git === 'merged' ? [s('✓', C.add), sp(2)] : o.git ? [s('◆', C.link), s(String(o.git).padEnd(2), C.dim)] : [sp(3)]), sp(2), s(time, C.faint), sp(1)];
  const tag = o.tag ? [...chip(o.tag[0], C.surface2, o.tag[1]), sp(1)] : [];
  return RB(head('▸', o.color ?? C.dim), [...tag, s(cut(prompt, 29 - (o.tag ? o.tag[0].length + 3 : 0)), C.text)], right);
}
// Fills exactly `n` rows so the footer sits on the last two.
const pad = (rows, n, mk) => { while (rows.length < n) rows.push(mk()); return rows; };

// A lane on the clock: 30 cells from 11:00 to now (14:45), 7.5 minutes each.
function lane(from, to, hue, end) {
  const cells = [];
  for (let i = 0; i < 30; i++) {
    if (i < from || i > to) cells.push(sp(1));
    else if (i === from && i === to) cells.push(pipe({node: 'fill', nodeColor: hue, color: hue}));
    else if (i === from) cells.push(pipe({node: 'fill', nodeColor: hue, r: 1, color: hue}));
    else if (i === to) cells.push(end === 'live' ? spin() : end === 'merged' ? s('✓', C.add) : pipe({l: 1, node: 'ring', nodeColor: hue, color: hue}));
    else cells.push(pipe({l: 1, r: 1, color: hue}));
  }
  return cells;
}
const laneRow = (wt, from, to, end, right, o = {}) => RB(none, [s(wt.name.padEnd(19), o.sel ? C.ink : wt.hue, {b: o.sel || o.here}), sp(1), ...(from === null ? [hline(30, X.spine)] : lane(from, to, wt.hue, end))], [sp(8 - len(right)), ...right, sp(1)], {bg: o.sel ? C.surface2 : undefined});
const factRow = (segs) => RB(none, [sp(2), ...segs]);

// Board B1 · the map, one lane open in place
{
  const p = rline(WT.b.hue);
  const rows = [
    rgap(),
    R0([s('WORKTREES', C.faint, {b: 1}), s('   one repo · 5 folders', C.dim)], [s('3 active', C.accent), dot(), s('today', C.dim), sp(1)]),
    R0([sp(20), s('11:00', C.faint), sp(3), s('12:00', C.faint), sp(3), s('13:00', C.faint), sp(3), s('14:00', C.faint)], [s('now', C.dim), sp(1)]),
    laneRow(WT.here, 0, 29, 'live', [s('you', C.text)], {here: true}),
    factRow([s(WT.here.folder, C.text), dot(), s('↑22', C.dim), dot(), s('3 uncommitted', C.dim), dot(), s('started 3 agents', C.dim)]),
    laneRow(WT.a, 17, 19, 'merged', [s('13:20', C.add)]),
    factRow([s(WT.a.folder, C.text), dot(), s('✓ merged 13:20', C.add), dot(), s('folder removed', C.dim)]),
    laneRow(WT.b, 24, 29, 'live', [s('43m', C.text)], {sel: true}),
    factRow([s(WT.b.folder, C.text), dot(), s('Opus 5', C.dim), dot(), s('↑1', C.dim), dot(), s('not in jiaolong yet', C.dim)]),
    RB(p, [s('▾', C.accent), sp(1), s('Put the Usage view back on panels', C.ink, {b: 1})], [s('14:02', C.dim), sp(1)]),
    RB(p, [s('agent', C.dim), dot(), s('running 43m', C.accent), s('   ', C.dim), ...chip('5 files', C.surface2, C.text), sp(1), ...chip('+380', X.tintAdd, C.add), sp(1), ...chip('−172', X.tintDel, C.del)]),
    rfolder(p, 'src/ui/views'),
    rfile(p, 'M', 'usage.ts', 4, 2, 301, 160),
    rfolder(p, 'src/ui'),
    rfile(p, 'M', 'theme.ts', 2, 0, 41, 0),
    rfile(p, 'M', 'cells.ts', 2, 1, 22, 9),
    RB(p, [s('▸', C.dim), sp(1), s('2 more files', C.dim)], [s('not here until it is merged', C.faint, {i: 1}), sp(1)]),
    RB(p, [spin(), s(' Bash', C.text), s('  npx tsx scripts/smoke.tsx', C.dim)], [s('31 steps', C.dim), sp(1)]),
    rgap(p),
    laneRow(WT.c, 26, 29, 'live', [s('31m', C.text)]),
    factRow([s(WT.c.folder, C.text), dot(), s('Opus 5', C.dim), dot(), s('↑2', C.dim), dot(), s('not in jiaolong yet', C.dim)]),
    laneRow(WT.main, null, null, null, [s('clean', C.faint)]),
    factRow([s('Desktop', C.text), dot(), s('nothing today', C.dim), dot(), s('where jiaolong lands', C.dim)]),
    rgap(),
    R0([sp(1), s('a lane is one folder. it starts where its agent did,', C.faint, {i: 1})]),
    R0([sp(1), s('and ends ⠹ still working, ✓ landed here, ○ stopped', C.faint, {i: 1})]),
  ];
  const all = pad(rows, 49, rgap);
  const stream = rail([...all, ...rfoot([['enter', 'close'], ['esc', 'back'], ['c f a u w', 'views'], ['m', 'menu']])], 'Worktrees', {A: {text: '2', color: C.accent, live: true}, W: {text: '3', color: C.accent}});
  files5['V5B-Map.dc.html'] = page({title: 'Worktrees: every folder as a lane on the clock', top: menubar(), stream, bottom: []});
  text5['V5B-Map.dc.html'] = stream;
}

// Board B2 · Changes, with the rail instead of tabs; a turn from another folder
{
  const p = rline(C.accent);
  const rows = [
    rgap(),
    R0([sp(1), s(' By turn ', C.ink, {bg: C.surface2}), s(' · ', C.faint), s(' By file ', C.dim), s(' · ', C.faint), s(' Uncommitted ', C.dim)], [s('in ', C.faint), s('all 5 folders', C.accent, {b: 1}), s(' ▾', C.dim), sp(1)]),
    rgap(),
    R0([s('TODAY', C.faint, {b: 1}), s('   everything, in the order it happened', C.dim)], [s('11 turns', C.dim), sp(1)]),
    R0([sp(8), ...skyline([2, 1, 8, 1, 1, 3, 6, 5, 7, 4, 2], 10)], [s('+4,180', C.add), sp(1), s('−1,630', C.del), sp(1)]),
    rgap(),
    RB(head('⠹', WT.c.hue, {cls: 'pulse'}), [...chip(WT.c.folder, C.surface2, WT.c.hue), sp(1), s('Read a markdown file as a page', C.ink, {b: 1})], [s('14:14', C.dim), sp(1)]),
    RB(rline(WT.c.hue), [s('agent', C.dim), dot(), s('running 31m', C.accent), s('   ', C.dim), ...chip('7 files', C.surface2, C.text), sp(1), ...chip('+598', X.tintAdd, C.add), sp(1), ...chip('−94', X.tintDel, C.del)]),
    RB(rline(WT.c.hue), [s('▸', C.dim), sp(1), s('7 files', C.dim)], [s('not here until it is merged', C.faint, {i: 1}), sp(1)]),
    rgap(rline(WT.c.hue)),
    RB(head('⠹', WT.b.hue, {cls: 'pulse'}), [...chip(WT.b.folder, C.surface2, WT.b.hue), sp(1), s('Put the Usage view back on panels', C.ink, {b: 1})], [s('14:02', C.dim), sp(1)]),
    RB(rline(WT.b.hue), [s('agent', C.dim), dot(), s('running 43m', C.accent), s('   ', C.dim), ...chip('5 files', C.surface2, C.text), sp(1), ...chip('+380', X.tintAdd, C.add), sp(1), ...chip('−172', X.tintDel, C.del)]),
    RB(rline(WT.b.hue), [s('▸', C.dim), sp(1), s('5 files', C.dim)], [s('not here until it is merged', C.faint, {i: 1}), sp(1)]),
    rgap(rline(WT.b.hue)),
    RB(head('⠹', C.accent, {cls: 'pulse'}), [s('i think option 3 is exactly what i want. and…', C.ink, {b: 1})], [s('13:58', C.dim), sp(1)]),
    RB(p, [s('you', C.dim), dot(), s('running 47m', C.accent), dot(), s('3 agents', C.dim), s('   ', C.dim), ...chip('2 files', C.surface2, C.text), sp(1), ...chip('+5', X.tintAdd, C.add)]),
    rfolder(p, 'src/ui'),
    rfile(p, 'M', 'theme.ts', 1, 0, 5, 0),
    rgap(p),
    RB(p, [spin(), s(' 3 agents', C.text), dot(), s('2 running', C.accent), dot(), s('1 done', C.dim)], [s('264k tokens', C.dim), sp(1)]),
    RB(p, [s('▸', C.dim), sp(1), s('■', WT.a.hue), sp(1), s('Fill a turn nobody watched', C.text)], [s('✓', C.add), sp(1), s('14m', C.dim), sp(2), s('73k', C.faint), sp(1)]),
    RB(p, [s('▸', C.dim), sp(1), s('■', WT.b.hue), sp(1), s('Put the Usage view back on…', C.text)], [spin(), sp(1), s('43m', C.dim), sp(2), s('98k', C.faint), sp(1)]),
    RB(p, [s('▸', C.dim), sp(1), s('■', WT.c.hue), sp(1), s('Read a markdown file as a…', C.text)], [spin(), sp(1), s('31m', C.dim), sp(2), s('93k', C.faint), sp(1)]),
    rgap(p),
    RB(head('▸', C.add), [s('✓ ', C.add), s('merged', C.dim), sp(2), s(WT.a.name, WT.a.hue, {b: 1})], [s('7 files', C.dim), sp(1), ...size(4, 1), sp(5), s('13:20', C.dim), sp(1)]),
    rclosed('Fill a turn nobody watched from commits', 7, 4, 1, '13:05', {tag: [WT.a.folder, WT.a.hue], color: WT.a.hue, git: 'merged'}),
    rclosed('wait im not sure about the new section. lets plan this', null, 0, 0, '12:58'),
    rclosed('so i currently dont see any changes or any diffs', 4, 3, 1, '12:41', {git: 'merged'}),
    rclosed('can you run npm run pane for me for this session?', null, 0, 0, '12:30'),
    rclosed('sorry i forgot to pull from main before i started', 20, 4, 1, '11:21', {git: 3}),
    rclosed('pull the latest and check the smoke scripts', 2, 1, 0, '10:50', {tag: ['Desktop', C.dim], git: 1}),
    rclosed('try running orchestrating agent in this session', null, 0, 0, '11:14', {note: '4 agents'}),
  ];
  const all = pad(rows, 49, rgap);
  const stream = rail([...all, ...rfoot([['enter', 'open'], ['esc', 'back'], ['c f a u w', 'views'], ['m', 'menu']])], 'Changes', {A: {text: '2', color: C.accent, live: true}, W: {text: '3', color: C.accent}});
  files5['V5B-Changes.dc.html'] = page({title: 'Changes: the rail is the menu, a chip says the folder', top: menubar(), stream, bottom: []});
  text5['V5B-Changes.dc.html'] = stream;
}

// Board B3 · the rail, expanded: the same letters with their names, so the
// menu and the key legend are one thing
{
  const W = 26;
  const R = (l = [], r = [], o = {}) => ({free: true, segs: fit(l, [...r, sp(1)], W, o.bg ?? C.surface)});
  const item = (key, label, right = [], on = false) => R([on ? bar(C.accent) : sp(1), s(key, on ? C.ink : C.text, {b: 1}), sp(2), s(label, on ? C.ink : C.text, {b: on})], right, {bg: on ? C.surface2 : undefined});
  const rows = [
    R(),
    item('C', 'Changes', [s('by turn', C.dim)], true),
    R(),
    item('F', 'Files', [s('3 changed', C.dim)]),
    R(),
    item('A', 'Agents', [spin(), s(' 2', C.accent)]),
    R(),
    item('U', 'Usage', [s('58%', C.dim)]),
    R(),
    item('W', 'Worktrees', [s('3 active', C.accent)]),
    R(),
    R([sp(1), hline(W - 2, X.spine)]),
    R(),
    item('w', 'Pick a worktree', [s('▾', C.dim)]),
    item('u', 'Uncommitted', [s('off', C.faint)]),
    item('f', 'Follow', [s('on', C.dim)]),
    R(),
    R([sp(1), hline(W - 2, X.spine)]),
    R(),
    item('?', 'Every key'),
    item('q', 'Quit'),
    R(),
    R([sp(1), s('esc', C.dim), s(' closes this', C.faint)]),
  ];
  while (rows.length < 51) rows.push(R());
  const p = rline(C.accent);
  const under = [
    rgap(),
    R0([sp(1), s(' By turn ', C.ink, {bg: C.surface2}), s(' · ', C.faint), s(' By file ', C.dim), s(' · ', C.faint), s(' Uncommitted ', C.dim)], [s('in ', C.faint), s('jiaolong', C.text, {b: 1}), s(' ▾', C.dim), sp(1)]),
    rgap(),
    R0([s('TODAY', C.faint, {b: 1}), s('   Layout polish, usage and agents', C.dim)], [s('11 turns', C.dim), sp(1)]),
    R0([sp(8), ...skyline([2, 1, 8, 1, 1, 3, 6, 5, 7, 4, 2], 10)], [s('+4,180', C.add), sp(1), s('−1,630', C.del), sp(1)]),
    rgap(),
    RB(head('⠹', C.accent, {cls: 'pulse'}), [s('i think option 3 is exactly what i want. and…', C.ink, {b: 1})], [s('13:58', C.dim), sp(1)]),
    RB(p, [s('running 47m', C.accent), dot(), s('3 agents', C.dim), s('   ', C.dim), ...chip('2 files', C.surface2, C.text), sp(1), ...chip('+5', X.tintAdd, C.add)]),
    rgap(p),
    RB(p, [spin(), s(' 3 agents', C.text), dot(), s('2 running', C.accent), dot(), s('1 done', C.dim)], [s('264k tokens', C.dim), sp(1)]),
    RB(p, [s('▸', C.dim), sp(1), s('■', WT.a.hue), sp(1), s('Fill a turn nobody watched', C.text)], [s('✓', C.add), sp(1), s('14m', C.dim), sp(2), s('73k', C.faint), sp(1)]),
    RB(p, [sp(4), s('in ', C.faint), s(WT.a.folder, C.text)], [s('✓ merged 13:20', C.add), sp(1)]),
    RB(p, [s('▸', C.dim), sp(1), s('■', WT.b.hue), sp(1), s('Put the Usage view back on…', C.text)], [spin(), sp(1), s('43m', C.dim), sp(2), s('98k', C.faint), sp(1)]),
    RB(p, [sp(4), s('in ', C.faint), s(WT.b.folder, C.text), s('   5 files ', C.dim), ...size(4, 1)], [s('↑1 · not here yet', C.dim), sp(1)]),
    RB(p, [s('▸', C.dim), sp(1), s('■', WT.c.hue), sp(1), s('Read a markdown file as a…', C.text)], [spin(), sp(1), s('31m', C.dim), sp(2), s('93k', C.faint), sp(1)]),
    RB(p, [sp(4), s('in ', C.faint), s(WT.c.folder, C.text), s('   7 files ', C.dim), ...size(5, 0)], [s('↑2 · not here yet', C.dim), sp(1)]),
    rgap(p),
    rfolder(p, 'src/ui'),
    rfile(p, 'M', 'theme.ts', 1, 0, 5, 0),
    rgap(p),
    RB(head('▸', C.add), [s('✓ ', C.add), s('merged', C.dim), sp(2), s(WT.a.name, WT.a.hue, {b: 1})], [s('7 files', C.dim), sp(1), ...size(4, 1), sp(5), s('13:20', C.dim), sp(1)]),
    rclosed('wait im not sure about the new section. lets plan this', null, 0, 0, '12:58'),
    rclosed('so i currently dont see any changes or any diffs', 4, 3, 1, '12:41', {git: 'merged'}),
    rclosed('can you run npm run pane for me for this session?', null, 0, 0, '12:30'),
    rclosed('sorry i forgot to pull from main before i started', 20, 4, 1, '11:21', {git: 3}),
  ];
  const all = pad(under, 49, rgap);
  const stream = rail([...all, ...rfoot([['↑↓', 'move'], ['enter', 'go'], ['esc', 'close']])], 'Changes', {A: {text: '2', color: C.accent, live: true}, W: {text: '3', color: C.accent}});
  files5['V5B-Rail.dc.html'] = page({title: 'The rail, expanded: the menu and the key legend are one thing', top: menubar(), stream, bottom: [],
    overlays: [{col: 0, row: 1, rows, backdrop: 1}]});
  text5['V5B-Rail.dc.html'] = rows;
}

// =====================================================================
// Shared · a worktree's states, one word each, the same everywhere
// =====================================================================
{
  const row = (mark, markColor, word, means, shown) => V(none, [sp(1), mark === 'spin' ? spin() : s(mark, markColor), sp(2), s(word.padEnd(13), C.ink, {b: 1}), s(means.padEnd(26), C.dim)], [...shown, sp(1)]);
  const stream = [
    V(none, [s('A WORKTREE\'S STATE', C.faint, {b: 1}), s('   the first true one is the whole truth', C.dim)]),
    gapRow(),
    V(none, [sp(4), s('word', C.faint), sp(9), s('what it means', C.faint)], [s('how the row says it', C.faint), sp(1)]),
    row('spin', C.accent, 'working', 'someone is in it now', [spin(), s(' 43m · not merged', C.text)]),
    row('●', HUES[2], 'ahead', 'commits your folder lacks', [s('↑2', C.dim), s(' · ', C.faint), s('not merged', C.dim)]),
    row('●', HUES[2], 'dirty', 'edits not committed yet', [s('3 uncommitted', C.text)]),
    row('✓', C.add, 'merged', 'landed in your folder', [s('✓ merged 13:20', C.add)]),
    row('○', C.faint, 'clean', 'nothing to bring over', [s('clean', C.faint)]),
    row('○', C.faint, 'removed', 'folder gone, never landed', [s('removed', C.faint)]),
    row('○', C.faint, 'not recorded', 'gone before we looked', [s('not recorded', C.faint)]),
    gapRow(),
    ...journey(none, HUES[2], 2, ['started 14:14', '2 commits', 'not merged', 'folder kept']),
    gapRow(),
    V(none, [sp(1), s('the journey: four stops, filled up to where it has got.', C.dim)]),
    V(none, [sp(1), s('one line under the tabs of a picked worktree (A), or under', C.dim)]),
    V(none, [sp(1), s('an open lane (B). the bright word is where it is now.', C.dim)]),
  ];
  const h = (stream.length + 1) * RH + 24;
  files5['V5-States.dc.html'] = page({title: 'A worktree\'s states: one word, the same everywhere', top: [], stream, bottom: [], h});
  text5['V5-States.dc.html'] = stream;
}

// =====================================================================
// Home, and the opening. The pane opens on a page that says where you are,
// what is happening right now, what today has been, and where the keys go.
// It is a view (`h`), not a gate: it carries live facts, and you come back to
// it. The splash card the pane already draws becomes the first second of it.
// =====================================================================
const HEIGHTS = [2, 1, 8, 1, 1, 3, 6, 5, 7, 4, 2];
function homeRows(o = {}) {
  const link = {1: 'V5A-Workspaces.dc.html', w: 'V5A-Workspaces.dc.html', m: 'V5A-Palette.dc.html'};
  const key = (k, label, what, right, sel) => {
    const row = V(none, [sel ? s('▎', C.accent) : sp(1), sp(1), s(k, sel ? C.ink : C.text, {b: 1}), sp(2), s(label.padEnd(12), sel ? C.ink : C.text, {b: sel}), s(what.padEnd(30), C.dim)], [...right, sp(1)], {bg: sel ? C.surface2 : undefined});
    if (link[k] && !o.plain) row.segs = row.segs.map(x => ({...x, href: link[k]}));
    return row;
  };
  return [
    gapRow(),
    V(none, [sp(1), s('Good afternoon', C.ink, {b: 1})], [s('Tue 23 Sep', C.dim), dot(), s('14:45', C.dim), sp(1)]),
    V(none, [sp(1), s('sidecar-pane', C.text), dot(), s(WT.here.name, C.text), dot(), s(WT.here.folder, C.text)]),
    gapRow(),
    V(none, [sp(1), s('NOW', C.faint, {b: 1})]),
    V(none, [sp(1), spin(), sp(2), s('Claude is on your turn', C.ink)], [s('47m in', C.dim), sp(1)]),
    V(none, [sp(4), s('i think option 3 is exactly what i want. and when i…', C.dim)]),
    V(none, [sp(1), spin(), sp(2), s('2 agents in folders of their own', C.text)], [s('not merged yet', C.dim), sp(1)]),
    V(none, [sp(1), s('✓', C.add), sp(2), s('1 branch landed here today', C.text)], [s('13:20', C.dim), sp(1)]),
    gapRow(),
    V(none, [sp(1), s('TODAY', C.faint, {b: 1})]),
    V(none, [sp(1), s('11 turns', C.text), sp(3), ...HEIGHTS.map(h => column(h, C.faint)), sp(3), s('+4,180', C.add), sp(1), s('−1,630', C.del), sp(3), s('5h 40m', C.dim)]),
    gapRow(),
    V(none, [sp(1), s('GO TO', C.faint, {b: 1})]),
    key('1', 'Changes', 'what each turn did', [s('8 files', C.dim)], true),
    key('2', 'Files', 'the tree, changed files first', [s('3 changed', C.dim)]),
    key('3', 'Agents', 'who is doing what, and where', [spin(), s(' 2 running', C.accent)]),
    key('4', 'Usage', 'how much of the day is left', [s('58% · 1h 52m', C.dim)]),
    key('w', 'Workspaces', 'every folder of the repo', [s('3 active', C.accent)]),
    key('m', 'Menu', 'every key, in one place', []),
  ];
}
const homeFoot = () => foot([['enter', 'go'], ['h', 'home'], ['↑↓', 'move']]);

// Board · Home, settled
{
  const stream = homeRows();
  files5['V5-Home.dc.html'] = page({title: 'Home: where you are, what is happening, where the keys go', top: menubar(), stream, bottom: homeFoot()});
  text5['V5-Home.dc.html'] = [...menubar(), ...stream, ...homeFoot()];
}

// The splash the pane already draws: the wordmark a third of the way down,
// the folder and the branch, and what the read has found so far.
const SPLASH_LEFT = 4; // (62 − 54) / 2
const splashRows = (o = {}) => {
  const mark = wordmark('Sidecar', C.accent, 2, {cls: o.col});
  const tag = x => (o.tag ? {...x, cls: o.tag} : x);
  return [
    ...mark.map(r => ({free: true, segs: r})),
    {free: true, segs: [sp(1)]},
    {free: true, segs: [s('sidecar-pane', C.text), dot(), s(WT.here.name, C.text)].map(tag)},
    {free: true, segs: [s('⠹', C.accent), s(' reading 58 chats…', C.dim)].map(tag)},
  ];
};

// The wordmark, six rows tall: block capitals with a shadow edge drawn in box
// glyphs, the face in a warm gradient from accent to gold, the shadow in
// faint. Fifty-seven columns, so it fits the 62 the pane has at a split.
const FONT6 = {
  S: ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝'],
  I: ['██╗', '██║', '██║', '██║', '██║', '╚═╝'],
  D: ['██████╗ ', '██╔══██╗', '██║  ██║', '██║  ██║', '██████╔╝', '╚═════╝ '],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
  C: [' ██████╗', '██╔════╝', '██║     ', '██║     ', '╚██████╗', ' ╚═════╝'],
  A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
};
const BANNER = Array.from({length: 6}, (_, r) => [...'SIDECAR'].map(ch => FONT6[ch][r]).join(' '));
const BW6 = [...BANNER[0]].length;
for (const line of BANNER) if ([...line].length !== BW6) throw new Error('ragged banner: ' + line);
const BANNER_LEFT = Math.floor((62 - BW6) / 2);
const hex = (a, b, t) => '#' + [0, 1, 2].map(i => Math.round(parseInt(a.slice(1 + 2 * i, 3 + 2 * i), 16) * (1 - t) + parseInt(b.slice(1 + 2 * i, 3 + 2 * i), 16) * t).toString(16).padStart(2, '0')).join('');
// tone: the settled gradient, or `add`, the row as a line being added.
function bannerRows(tone = 'gradient', clsOf) {
  return BANNER.map((line, r) => ({free: true, segs: [...line].map((ch, x) => {
    if (ch === ' ') return sp(1);
    const face = ch === '█';
    const fg = tone === 'add' ? (face ? C.add : C.addWord) : face ? hex(C.accent, C.warn, x / (BW6 - 1)) : C.faint;
    return s(ch, fg, {cls: clsOf ? clsOf(r, x) : undefined});
  })}));
}

// Board · the opening, live. A terminal loading, in the diff's own idiom.
// The cursor blinks where the name will start. Then the name is added the
// way a diff adds lines: each row typed left to right in green behind a `+`,
// and the moment a row is whole it settles into its own colours. Under it
// the read reports what it found, and today's changes fill in as git's own
// stat bar of pluses and minuses, with the totals at the end. The card
// clears, the bar draws, and Home arrives a row a tick with the cursor mark
// sweeping down the margin ahead of it. Every step is a cell appearing or
// changing colour; any key skips it.
//
// No CSS animation. The board's own logic keeps a clock, ticks it thirty
// times a second, and draws each frame from the time: which rows exist,
// how much of a row is typed, where the caret is. That is how the pane
// itself would draw it, one full frame at a time.
{
  const TOP = 15, ROW_MS = 130, T0 = 400, FLIP = ROW_MS - 10;
  const typeAt = r => T0 + r * ROW_MS;
  const DONE = typeAt(5) + FLIP;
  const READ1 = DONE + 80, READ2 = READ1 + 320, STAT = READ1 + 60, STAT_MS = 18, STAT_N = 40, TOTAL = STAT + STAT_N * STAT_MS + 60;
  const PLUS = Math.round(STAT_N * 4180 / (4180 + 1630));
  const CLEAR = TOTAL + 380, BAR = CLEAR + 300, ROW0 = BAR + 40, STEP = 26, END = ROW0 + 22 * STEP;

  // A text hole wide enough for the whole string it will hold.
  const tokens = {};
  const tok = (name, width, fg) => { const key = `@@${name}@@`.padEnd(width); tokens[key] = `{{ ${name} }}`; return s(key, fg); };
  const home = homeRows();
  const overlays = [
    {col: 1 + BANNER_LEFT, row: TOP, rows: [{free: true, segs: [s('▎', C.accent)]}], flag: 'cb'},
    ...BANNER.map((_, r) => ({col: 1 + BANNER_LEFT - 2, row: TOP + r, rows: [{free: true, segs: [s('+', C.add), sp(1), tok(`g${r}`, BW6, C.add)]}], flag: `ty${r}`})),
    ...bannerRows().map((row, r) => ({col: 1 + BANNER_LEFT, row: TOP + r, rows: [row], flag: `st${r}`})),
    {col: 1 + BANNER_LEFT, row: TOP + 7, rows: [{free: true, segs: [s('⠹', C.accent), s(' reading 58 chats…', C.dim)]}], flag: 'rd1'},
    {col: 1 + BANNER_LEFT, row: TOP + 7, rows: [{free: true, segs: [s('3 chats   41 turns   12 agents', C.text)]}], flag: 'rd2'},
    {col: 1 + BANNER_LEFT, row: TOP + 8, rows: [{free: true, segs: [tok('plus', PLUS, C.add), tok('minus', STAT_N - PLUS, C.del)]}], flag: 'rd2'},
    {col: 1 + BANNER_LEFT + STAT_N + 2, row: TOP + 8, rows: [{free: true, segs: [s('+4,180', C.add), sp(1), s('−1,630', C.del)]}], flag: 'tt'},
    ...Array.from({length: 22}, (_, i) => ({col: 1, row: 1 + i, rows: [{free: true, segs: [s('▎', C.accent)]}], flag: `ct${i}`})),
  ];
  const stream = [when('bar', menubar()), ...home.map((row, i) => when(`h${i}`, [row])), when('h22', homeFoot())];
  const replay = V(none, [sp(1), s('▶', C.accent), s(' play the opening again', C.text)], [s(`${(END / 1000).toFixed(1)} s · any key skips it in the pane`, C.faint), sp(1)], {btn: 'play', bg: C.surface});

  const logic = `class Component extends DCLogic {
componentDidMount() { this.start(); }
componentWillUnmount() { clearInterval(this.timer); }
start() {
  clearInterval(this.timer);
  this.t0 = performance.now();
  this.setState({ t: 0 });
  this.timer = setInterval(() => {
    const t = performance.now() - this.t0;
    this.setState({ t });
    if (t > ${END} + 100) clearInterval(this.timer);
  }, 33);
}
renderVals() {
  const t = (this.state && this.state.t) || 0;
  const rows = ${JSON.stringify(BANNER)};
  const v = { play: () => this.start() };
  v.cb = t < ${T0} && Math.floor(t / 100) % 2 === 0;
  rows.forEach((line, r) => {
    const at = ${T0} + r * ${ROW_MS};
    const typing = t >= at && t < at + ${FLIP};
    v['ty' + r] = typing;
    v['st' + r] = t >= at + ${FLIP} && t < ${CLEAR};
    const k = typing ? Math.floor((t - at) / ${FLIP} * line.length) : 0;
    v['g' + r] = Array.from(line).slice(0, k).join('');
  });
  v.rd1 = t >= ${READ1} && t < ${READ2};
  v.rd2 = t >= ${READ2} && t < ${CLEAR};
  const n = Math.max(0, Math.min(${STAT_N}, Math.floor((t - ${STAT}) / ${STAT_MS})));
  v.plus = '+'.repeat(Math.min(n, ${PLUS}));
  v.minus = '−'.repeat(Math.max(0, n - ${PLUS}));
  v.tt = t >= ${TOTAL} && t < ${CLEAR};
  v.bar = t >= ${BAR};
  for (let i = 0; i < 23; i++) v['h' + i] = t >= ${ROW0} + i * ${STEP};
  for (let i = 0; i < 22; i++) v['ct' + i] = t >= ${ROW0} + i * ${STEP} && t < ${ROW0} + (i + 1) * ${STEP};
  return v;
}
}`;
  let html = page({title: 'The opening, live', top: [], stream, bottom: [replay], logic, overlays});
  for (const [key, hole] of Object.entries(tokens)) html = html.replace(key, hole);
  files5['V5-Opening.dc.html'] = html;
  text5['V5-Opening.dc.html'] = [{segs: [s(`type ${T0}–${DONE} · read ${READ1} · stat ${STAT}–${TOTAL} · clear ${CLEAR} · bar ${BAR} · home ${ROW0}–${END}`, C.dim)]}, ...bannerRows().map(r => ({segs: [sp(1 + BANNER_LEFT), ...r.segs]}))];
}

// Board · the opening as frames, for the record
{
  const label = (t, text) => V(none, [sp(1), s(t.padEnd(9), C.accent, {b: 1}), s(text, C.dim, {i: 1})]);
  const win = segs => ({segs: [sp(1), ...fit(segs, [], 62, C.scope)]});
  const blank = () => win([]);
  const at = segs => [sp(BANNER_LEFT), ...segs];
  const frame = (t, text, rows) => [label(t, text), ...rows];
  const settled = bannerRows().map(r => r.segs);
  const green = bannerRows('add').map(r => r.segs);
  const stat = n => Array.from({length: n}, (_, i) => s(i < 29 ? '+' : '−', i < 29 ? C.add : C.del));
  const first = homeRows({plain: true});
  const stream = [
    ...frame('0 ms', 'the cursor blinks where the name will start', [win(at([s('▎', C.accent)])), blank(), blank(), blank(), blank(), blank(), blank(), blank(), blank()]),
    ...frame('700 ms', 'the name is added like a diff, a row at a time', [
      win(at(settled[0])), win(at(settled[1])), win([sp(BANNER_LEFT - 2), s('+', C.add), sp(1), ...sliceSegs(green[2], 0, 31)]), blank(), blank(), blank(), blank(), blank(), blank()]),
    ...frame('1300 ms', 'the name settles into its colours; the read reports', [...settled.map(r => win(at(r))), blank(), win(at([s('3 chats   41 turns   12 agents', C.text)])), win(at(stat(9)))]),
    ...frame('2100 ms', 'today fills in as a git stat bar, then the totals', [...settled.map(r => win(at(r))), blank(), win(at([s('3 chats   41 turns   12 agents', C.text)])), win(at([...stat(40), sp(2), s('+4,180', C.add), sp(1), s('−1,630', C.del)]))]),
    ...frame('2800 ms', 'the card clears, the bar draws, home a row a tick', [
      {...menubar()[0]}, ...first.slice(0, 6).map(r => ({...r, segs: r.segs.map(x => ({...x, bg: x.bg ?? C.scope}))})), win([s('▎', C.accent)]), blank()]),
  ];
  files5['V5-Opening-frames.dc.html'] = page({title: 'The opening, frame by frame', top: [], stream, bottom: []});
  text5['V5-Opening-frames.dc.html'] = stream;
}

// =====================================================================
// Direction A, with a side panel. The panel is the primary panel of an IDE:
// views, then workspaces, each with its key beside it. It is always open and
// it pushes the content, never covers it. It exists only when the pane is 80
// columns or wider; narrower than that the tab row comes back, as built.
// There is no folded state, because a column of letters was the thing that
// was hard to read.
// =====================================================================
{
  const PW = 21, TOTAL = 86;
  const P = (l = [], r = [], o = {}) => [...fit(l, r, PW, o.bg), s('│', C.faint, {bg: o.bg})];
  const blankP = () => P();
  const sect = t => P([sp(1), s(t, C.faint, {b: 1})]);
  const view = (key, label, right = [], on = false) => P([on ? s('▎', C.accent) : sp(1), s(key, on ? C.ink : C.text, {b: 1}), sp(2), s(label, on ? C.ink : C.text, {b: on})], [...right, sp(1)], {bg: on ? C.surface2 : undefined});
  const ws = (wt, live, sel) => P([sel ? s('▎', C.accent) : sp(1), live ? spin() : s('○', C.faint), sp(1), s(cut(wt.name, 16), sel ? C.ink : wt.hue, {b: sel})], [], {bg: sel ? C.surface2 : undefined});
  const panel = [
    blankP(),
    view('h', 'Home'),
    view('1', 'Changes', [s('8', C.dim)], true),
    view('2', 'Files', [s('3', C.dim)]),
    view('3', 'Agents', [spin(), s(' 2', C.accent)]),
    view('4', 'Usage', [s('58%', C.dim)]),
    blankP(),
    sect('WORKSPACES'),
    ws(WT.here, true, true),
    ws(WT.b, true, false),
    ws(WT.c, true, false),
    ws(WT.a, false, false),
    ws(WT.main, false, false),
    blankP(),
    P([sp(1), s('w', C.text), s('  next workspace', C.dim)]),
    P([sp(1), s('m', C.text), s('  palette', C.dim)]),
  ];
  const bar = fit([sp(1), s('◆', C.accent), sp(1), s('Sidecar', C.ink, {b: 1}), sp(2), s('View', C.text)],
    [s('5h', C.dim), sp(1), split([[3, C.accent], [3, X.track]]), sp(1), s('58%', C.ink, {b: 1}), sp(2), s('1h 52m', C.dim), s(' · ', C.faint), s('wk', C.dim), sp(1), s('23%', C.text), sp(3), spin(), s(' 3 agents', C.ink), sp(1)], TOTAL, C.surface);
  const content = [gapRow(), pills('By turn', [s('in ', C.faint), s(WT.here.folder, C.ink, {b: 1}), sp(1)]), gapRow(), ...yourStream()];
  const footP = P([sp(1), s('at 80 columns and up', C.faint, {i: 1})]);
  const footC = foot([['enter', 'open'], ['esc', 'back'], ['h', 'home']])[1];
  const rows = [{free: true, segs: bar}];
  for (let i = 0; i < 49; i++) rows.push({free: true, segs: [...(panel[i] ?? blankP()), ...(content[i] ?? gapRow()).segs, sp(1)]});
  rows.push({free: true, segs: [...blankP(), ...gapRow().segs, sp(1)]});
  rows.push({free: true, segs: [...footP, ...footC.segs, sp(1)]});
  const w = Math.round(BW / 64 * TOTAL);
  const html = page({title: 'Workspaces as a side panel: views and folders, always open, never covering', top: [], stream: rows, bottom: [], w});
  files5['V5A-Panel.dc.html'] = html.replace('width:64ch', `width:${TOTAL}ch`);
  text5['V5A-Panel.dc.html'] = rows;
}

// The side panel, collapsed. Eight columns, not three: each view keeps a
// glyph that says what it is, the key that opens it, and its live mark, so
// the folded panel is still the legend and still the status. `+−` in the
// diff's colours is Changes; `■` is an agent, as everywhere; `▄▆` is the
// meter; `⎇` is a branch. Open at 80 columns and up, folded from 64 to 79,
// gone under 64, and `b` folds or unfolds it by hand at any width.
{
  const PW = 8, TOTAL = PW + 1 + 64;
  const P = (l = [], r = [], o = {}) => [...fit(l, r, PW, o.bg), s('│', C.faint, {bg: o.bg})];
  const blankP = () => P();
  const item = (glyphSegs, key, mark = [], on = false) => P([on ? s('▎', C.accent) : sp(1), ...glyphSegs, sp(1), s(key, on ? C.ink : C.text, {b: 1})], [...mark, sp(1)], {bg: on ? C.surface2 : undefined});
  const panel = [
    blankP(),
    item([s('◆', C.accent), sp(1)], 'h'),
    item([s('+', C.add), s('−', C.del)], '1', [], true),
    item([s('≡', C.dim), sp(1)], '2'),
    item([s('■', C.text), sp(1)], '3', [spin()]),
    item([s('▄', C.accent), s('▆', C.faint)], '4'),
    blankP(),
    item([s('⎇', C.text), sp(1)], 'w', [s('3', C.accent)]),
    blankP(),
    P([sp(1), s('b', C.text), sp(1), s('»', C.dim)]),
  ];
  const bar = fit([sp(1), s('◆', C.accent), sp(1), s('Sidecar', C.ink, {b: 1}), sp(2), s('View', C.text)],
    [s('5h', C.dim), sp(1), split([[3, C.accent], [3, X.track]]), sp(1), s('58%', C.ink, {b: 1}), sp(2), s('1h 52m', C.dim), s(' · ', C.faint), s('wk', C.dim), sp(1), s('23%', C.text), sp(3), spin(), s(' 3 agents', C.ink), sp(1)], TOTAL, C.surface);
  const content = [gapRow(), pills('By turn', [s('in ', C.faint), s(WT.here.folder, C.ink, {b: 1}), sp(1)]), gapRow(), ...yourStream()];
  const footP = P([sp(1), s('64–79', C.faint, {i: 1})]);
  const footC = foot([['enter', 'open'], ['esc', 'back'], ['b', 'unfold'], ['h', 'home']])[1];
  const rows = [{free: true, segs: bar}];
  for (let i = 0; i < 49; i++) rows.push({free: true, segs: [...(panel[i] ?? blankP()), ...(content[i] ?? gapRow()).segs, sp(1)]});
  rows.push({free: true, segs: [...blankP(), ...gapRow().segs, sp(1)]});
  rows.push({free: true, segs: [...footP, ...footC.segs, sp(1)]});
  const w = Math.round(BW / 64 * TOTAL);
  const html = page({title: 'The side panel, folded: a glyph, a key and a mark per view', top: [], stream: rows, bottom: [], w});
  files5['V5A-Panel-folded.dc.html'] = html.replace('width:64ch', `width:${TOTAL}ch`);
  text5['V5A-Panel-folded.dc.html'] = rows;
}

// ---------- write ----------
const outs = [path.join(HERE, 'project'), ...(process.env.V5_OUT ? [process.env.V5_OUT] : [])];
for (const out of outs) {
  fs.mkdirSync(out, {recursive: true});
  for (const [name, html] of Object.entries(files5)) fs.writeFileSync(path.join(out, name), html);
}
if (process.argv.includes('--text')) for (const [name, rows] of Object.entries(text5)) { console.log('\n=== ' + name); console.log(dump(rows).join('\n')); }
for (const [name, html] of Object.entries(files5)) console.log(name, (html.length / 1024).toFixed(0) + ' KB');
