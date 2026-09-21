// Terminal-grid mockup builder. Every row is exactly 64 columns.
export const COLS = 64, RH = 20, ROWS = 52;
export const BW = 564, BH = ROWS * RH + 24;

export const C = {
  page: '#0C0C0C', surface: '#181817', surface2: '#262523', well: '#000000', scope: '#121211',
  ink: '#ECEAE6', text: '#BDBAB4', dim: '#928F89', faint: '#5F5C58', rule: '#2E2C2A',
  accent: '#E58C64', add: '#4ADE80', del: '#F87171', addBg: '#0D2616', delBg: '#2B1013',
  addWord: '#1F5A33', delWord: '#6B2227', warn: '#E5C07B', link: '#8FB4E8',
  keyword: '#C6A0F0', string: '#A8CF8E', thumb: '#4A4743',
};

export const s = (t, fg, o = {}) => ({t: String(t), fg, ...o});
export const sp = (n = 1) => ({t: ' '.repeat(Math.max(0, n))});
export const bar = color => ({kind: 'bar', color, t: ' '});
export const guide = () => ({kind: 'guide', t: ' '});
export const hole = (name, fg, o = {}) => ({kind: 'hole', name, fg, t: ' ', ...o});
export const len = segs => segs.reduce((n, x) => n + [...x.t].length, 0);
const GLYPH = {hole: '?', bar: '▎', guide: '│', box: '▄', split: '▄', meter: '━', hline: '─'};
export const plain = segs => segs.map(x => (x.kind === 'pipe' ? (x.node ? '●' : x.curve ? '╭' : x.l || x.r ? (x.u || x.d ? '┼' : '─') : '│') : x.kind ? [...x.t].map(() => GLYPH[x.kind] ?? ' ').join('') : x.t)).join('');
export const setTheme = t => Object.assign(C, t);
// A run of cells, each holding one block-element rectangle. rect = [x, y, w, h] as fractions of ONE cell.
export const box = (n, rect, color, o = {}) => ({kind: 'box', t: ' '.repeat(n), rect, color, ...o});
export const lower = (n, color, o) => box(n, [0, .5, 1, .5], color, o);
export const upper = (n, color, o) => box(n, [0, 0, 1, .5], color, o);
export const rightHalf = (color, o) => box(1, [.5, 0, .5, 1], color, o);
export const leftHalf = (color, o) => box(1, [0, 0, .5, 1], color, o);
export const column = (eighths, color, o) => box(1, [0, 1 - eighths / 8, 1, eighths / 8], color, o);
export const pill = (text, bg, fg, o = {}) => [rightHalf(bg, o), s(text, fg, {bg, ...o}), leftHalf(bg, o)];
// Several colours in ONE box: parts = [[cells, color], ...]. Separate boxes side by side each round their
// own top edge when the canvas zooms, and end up a pixel apart.
export const split = (parts, o = {}) => { const live = parts.filter(([n]) => n > 0); return {kind: 'split', t: ' '.repeat(live.reduce((n, [c]) => n + c, 0)), parts: live, ...o}; };
export const meter = (n, frac, color, o = {}) => ({kind: 'meter', t: ' '.repeat(n), frac, color, ...o});
export const hline = (n, color, o = {}) => ({kind: 'hline', t: ' '.repeat(n), color, ...o});
export const pipe = (o) => ({kind: 'pipe', t: ' ', ...o});

export function fit(left, right, w, bg) {
  const lw = len(left), rw = len(right);
  if (lw + rw > w) throw new Error(`overflow ${lw + rw} > ${w}: "${plain(left)}" | "${plain(right)}"`);
  return [...left, sp(w - lw - rw), ...right].map(x => ({...x, bg: x.bg ?? bg}));
}

// Row kinds. Column 0 is the page margin, 1..62 the content, 63 the rail.
export const P = (l = [], r = [], o = {}) => ({...o, segs: [sp(1), ...fit(l, r, 62, o.bg)]});
export const K = (l = [], r = [], o = {}) => ({...o, segs: [sp(1), ...fit([sp(1), ...l], [...r, sp(1)], 62, o.bg ?? C.surface)]});
export const W = (l = [], r = [], o = {}) => ({...o, segs: [sp(1), {t: ' ', bg: C.surface}, ...fit(l, r, 60, o.bg ?? C.well), {t: ' ', bg: C.surface}]});
export const blank = () => P();
export const edgeTop = (o = {}) => ({...o, special: 'edgeTop'});
export const edgeBottom = (o = {}) => ({...o, special: 'edgeBottom'});
export const halfK = (top, bottom, o = {}) => ({...o, special: 'halfK', top, bottom});   // 62 wide
export const halfW = (top, bottom, o = {}) => ({...o, special: 'halfW', top, bottom});   // inside a card
export const when = (flag, rows) => ({group: flag, rows});

// ---------- tiny TS highlighter ----------
const KW = new Set('import from export function const let type return if else await async new true false null for of as'.split(' '));
export function tok(code, base = C.text) {
  const out = [];
  const re = /(\/\/.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b\d[\d_]*\b)|([A-Za-z_$][\w$]*)|(\s+)|(.)/g;
  let m;
  while ((m = re.exec(code))) {
    if (m[1]) out.push(s(m[1], C.dim, {i: 1}));
    else if (m[2]) out.push(s(m[2], C.string));
    else if (m[3]) out.push(s(m[3], C.warn));
    else if (m[4]) out.push(s(m[4], KW.has(m[4]) ? C.keyword : /^[A-Z]/.test(m[4]) ? C.link : base));
    else if (m[5]) out.push(sp(m[5].length));
    else out.push(s(m[6], base === C.ink ? C.text : C.dim));
  }
  return out;
}
export function sliceSegs(segs, a, b) {
  const out = []; let pos = 0;
  for (const x of segs) {
    const chars = [...x.t]; const start = pos, end = pos + chars.length; pos = end;
    const lo = Math.max(a, start), hi = Math.min(b, end);
    if (lo < hi) out.push({...x, t: chars.slice(lo - start, hi - start).join('')});
  }
  return out;
}
export function markRange(segs, a, b, bg) {
  const total = len(segs);
  return [...sliceSegs(segs, 0, a), ...sliceSegs(segs, a, b).map(x => ({...x, bg, fg: C.ink})), ...sliceSegs(segs, b, total)];
}

// A diff line inside a well. Changed lines wrap, context lines truncate.
const CW = 52;
export function dl(sign, no, code, o = {}) {
  const bg = sign === '+' ? C.addBg : sign === '-' ? C.delBg : o.bg;
  const tone = sign === '+' ? C.add : sign === '-' ? C.del : C.faint;
  let segs = tok(code, sign === ' ' ? C.text : C.ink);
  for (const m of o.marks ?? []) { const a = typeof m === 'string' ? code.indexOf(m) : m[0]; const b = typeof m === 'string' ? a + m.length : m[1]; if (a < 0) throw new Error('mark not found: ' + m); segs = markRange(segs, a, b, sign === '+' ? C.addWord : C.delWord); }
  const edge = o.turn ? bar(o.turn) : sign === ' ' ? sp(1) : bar(tone);
  const gutter = [edge, s(String(no).padStart(4), sign === ' ' ? C.faint : C.dim), sp(1), s(sign === ' ' ? ' ' : sign === '-' ? '−' : '+', tone), sp(1)];
  const total = len(segs);
  if (total <= CW) return [W([...gutter, ...segs], [], {bg})];
  if (sign === ' ') return [W([...gutter, ...sliceSegs(segs, 0, CW - 1), s('…', C.faint)], [], {bg})];
  const text = plain(segs); const rows = []; let pos = 0, first = true;
  while (pos < total) {
    const room = first ? CW : CW - 2;
    let end = Math.min(total, pos + room);
    if (end < total) { const cut = text.lastIndexOf(' ', end - 1); if (cut > pos + room / 2) end = cut + 1; }
    const part = sliceSegs(segs, pos, end);
    rows.push(first ? W([...gutter, ...part], [], {bg}) : W([edge, sp(4), sp(1), s('↪', C.faint), sp(1), sp(2), ...part], [], {bg}));
    pos = end; first = false;
  }
  return rows;
}
export const hunkHead = (chev, label, range, add, del, o = {}) =>
  W([sp(1), chev, sp(1), s(label, C.link)], [s(range, C.faint), sp(2), ...(add ? [s('+' + add, C.add)] : []), ...(del ? [sp(1), s('−' + del, C.del)] : []), sp(1)], {bg: C.scope, ...o});
export const gap = text => W([sp(6), s('⋯', C.faint), s(' ' + text, C.faint)]);

// ---------- rendering ----------
const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function css(o) { return Object.entries(o).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}:${v}`).join(';'); }
function span(n, text, x) {
  const style = css({flex: 'none', width: `${n}ch`, 'white-space': 'pre', color: x.fg, background: x.bg,
    'font-weight': x.b ? 700 : undefined, 'font-style': x.i ? 'italic' : undefined,
    'text-decoration': x.u ? 'underline' : undefined, 'text-underline-offset': x.u ? '3px' : undefined,
    'text-align': x.center ? 'center' : undefined});
  if (text.includes('{{') || text.includes('}}')) throw new Error('template braces in text: ' + text);
  return `<span${x.cls ? ` class="${x.cls}"` : ''} style="${style}">${text.trim() === '' ? '' : esc(text)}</span>`;
}
function renderSeg(x) {
  const n = [...x.t].length;
  if (x.kind === 'box') {
    const [rx, ry, rw, rh] = x.rect;
    const cellsHtml = Array.from({length: n}, () => `<span style="position:absolute;left:0;top:0"></span>`);
    const inner = n === 1 || (rx === 0 && rw === 1)
      ? `<span style="position:absolute;left:${rx * 100}%;top:${ry * 100}%;width:${rw * 100}%;height:${rh * 100}%;background:${x.color}"></span>`
      : Array.from({length: n}, (_, i) => `<span style="position:absolute;left:${((i + rx) / n) * 100}%;top:${ry * 100}%;width:${(rw / n) * 100}%;height:${rh * 100}%;background:${x.color}"></span>`).join('');
    return `<span${x.cls ? ` class="${x.cls}"` : ''} style="${css({flex: 'none', width: n + 'ch', position: 'relative', background: x.bg})}">${inner}</span>`;
  }
  if (x.kind === 'split') {
    let at = 0; const stops = x.parts.map(([c, color]) => { const from = (at / n) * 100; at += c; return `${color} ${from}% ${(at / n) * 100}%`; }).join(', ');
    return `<span${x.cls ? ` class="${x.cls}"` : ''} style="${css({flex: 'none', width: n + 'ch', position: 'relative', background: x.bg})}"><span style="position:absolute;left:0;right:0;top:${RH / 2}px;height:${RH / 2}px;background:linear-gradient(90deg, ${stops})"></span></span>`;
  }
  if (x.kind === 'meter') {
    const q = Math.round(x.frac * n * 2) / 2 / n; // half-cell precision, like the glyphs
    const h = x.thin ? 2 : 4;
    return `<span style="${css({flex: 'none', width: n + 'ch', position: 'relative', background: x.bg})}"><span style="position:absolute;left:0;right:0;top:calc(50% - 1px);height:2px;background:${x.track ?? C.rule}"></span><span style="position:absolute;left:0;top:calc(50% - ${h / 2}px);height:${h}px;width:${q * 100}%;background:${x.color}"></span></span>`;
  }
  if (x.kind === 'hline') return `<span style="${css({flex: 'none', width: n + 'ch', position: 'relative', background: x.bg})}"><span style="position:absolute;left:0;right:0;top:calc(50% - 1px);height:${x.heavy ? 2 : 1}px;background:${x.color}"></span></span>`;
  if (x.kind === 'pipe') {
    const c = x.color, L = 2, parts = [];
    const abs = st => `<span style="position:absolute;${st}"></span>`;
    if (x.u) parts.push(abs(`left:calc(50% - 1px);top:0;width:${L}px;height:50%;background:${x.uColor ?? c}`));
    if (x.d) parts.push(abs(`left:calc(50% - 1px);top:50%;width:${L}px;height:50%;background:${x.dColor ?? c}`));
    if (x.l) parts.push(abs(`left:0;top:calc(50% - 1px);width:50%;height:${L}px;background:${x.lColor ?? c}`));
    if (x.r) parts.push(abs(`left:50%;top:calc(50% - 1px);width:50%;height:${L}px;background:${x.rColor ?? c}`));
    const cv = {dr: 'left:calc(50% - 1px);top:calc(50% - 1px);right:0;bottom:0;border-left:2px solid;border-top:2px solid;border-top-left-radius:6px',
      dl: 'right:calc(50% - 1px);top:calc(50% - 1px);left:0;bottom:0;border-right:2px solid;border-top:2px solid;border-top-right-radius:6px',
      ur: 'left:calc(50% - 1px);bottom:calc(50% - 1px);right:0;top:0;border-left:2px solid;border-bottom:2px solid;border-bottom-left-radius:6px',
      ul: 'right:calc(50% - 1px);bottom:calc(50% - 1px);left:0;top:0;border-right:2px solid;border-bottom:2px solid;border-bottom-right-radius:6px'}[x.curve];
    if (cv) parts.push(abs(`${cv};border-color:${x.curveColor ?? c};box-sizing:border-box`));
    if (x.node) {
      const nc = x.nodeColor ?? c, ground = x.bg ?? C.page;
      const fillCss = x.node === 'ring' ? `background:${ground};border:2px solid ${nc}` : x.node === 'half' ? `background:linear-gradient(90deg, ${nc} 50%, ${ground} 50%);border:2px solid ${nc}` : `background:${nc};border:2px solid ${nc}`;
      parts.push(`<span${x.cls ? ` class="${x.cls}"` : ''} style="position:absolute;left:calc(50% - 4.5px);top:calc(50% - 4.5px);width:9px;height:9px;box-sizing:border-box;border-radius:50%;${fillCss}"></span>`);
    }
    return `<span style="${css({flex: 'none', width: '1ch', position: 'relative', background: x.bg})}">${parts.join('')}</span>`;
  }
  if (x.kind === 'bar') return `<span style="${css({flex: 'none', width: '1ch', background: x.bg})}"><span style="display:block;width:2px;height:100%;background:${x.color}"></span></span>`;
  if (x.kind === 'guide') return `<span style="${css({flex: 'none', width: '1ch', background: x.bg})}"><span style="display:block;width:1px;height:100%;margin-left:0.45ch;background:${C.rule}"></span></span>`;
  if (x.kind === 'hole') return `<span style="${css({flex: 'none', width: '1ch', 'text-align': 'center', color: x.fg, background: x.bg})}">{{ ${x.name} }}</span>`;
  let out = '', run = '';
  const flush = () => { if (run) { out += span([...run].length, run, x); run = ''; } };
  for (const ch of [...x.t]) {
    const code = ch.codePointAt(0);
    if (code >= 0x20 && code <= 0x7e) run += ch;
    else { flush(); out += span(1, ch, {...x, center: 1}); }
  }
  flush();
  return out;
}
function renderSegs(segs) {
  let out = '', i = 0;
  while (i < segs.length) {
    const on = segs[i].on;
    if (on) {
      let inner = '';
      while (i < segs.length && segs[i].on === on) inner += renderSeg(segs[i++]);
      out += `<button type="button" onClick="{{ ${on} }}" style="display:flex;flex:none;height:100%;padding:0;margin:0;border:0;background:transparent;font:inherit;color:inherit;cursor:pointer">${inner}</button>`;
      continue;
    }
    const href = segs[i].href;
    if (!href) { out += renderSeg(segs[i++]); continue; }
    let inner = '';
    while (i < segs.length && segs[i].href === href) inner += renderSeg(segs[i++]);
    out += `<a href="${href}" style="display:flex;flex:none;height:100%;color:inherit;text-decoration:none">${inner}</a>`;
  }
  return out;
}
function railCell(color) {
  return `<span style="flex:none;width:1ch">${color ? `<span style="display:block;width:50%;height:100%;margin-left:50%;background:${color}"></span>` : ''}</span>`;
}
const ROW = `display:flex;flex:none;height:${RH}px`;
const BTN = `${ROW};width:100%;padding:0;margin:0;border:0;background:transparent;font:inherit;color:inherit;text-align:left;cursor:pointer`;
function halfBox(w, top, bottom) {
  const t = top ? `background:${top}` : '', b = bottom ? `background:${bottom}` : '';
  return `<span style="flex:none;width:${w}ch;display:flex;flex-direction:column"><span style="display:block;height:50%;${t}"></span><span style="display:block;height:50%;${b}"></span></span>`;
}
function corner(pos, color) { // quadrant glyphs ▗ ▖ ▝ ▘
  const m = {tl: 'margin-left:50%;margin-top:10px', tr: 'margin-top:10px', bl: 'margin-left:50%', br: ''}[pos];
  return `<span style="flex:none;width:1ch"><span style="display:block;width:50%;height:10px;${m};background:${color}"></span></span>`;
}
export function renderRow(row) {
  if (row.group) return `<sc-if value="{{ ${row.group} }}" hint-placeholder-val="{{ ${row.hint ?? 'true'} }}">\n${row.rows.map(renderRow).join('\n')}\n</sc-if>`;
  const col = row.color ?? C.surface;
  let inner;
  if (row.special === 'edgeTop') inner = `<span style="flex:none;width:1ch"></span>${corner('tl', col)}${halfBox(60, null, col)}${corner('tr', col)}`;
  else if (row.special === 'edgeBottom') inner = `<span style="flex:none;width:1ch"></span>${corner('bl', col)}${halfBox(60, col, null)}${corner('br', col)}`;
  else if (row.special === 'halfK') inner = `<span style="flex:none;width:1ch"></span>${halfBox(62, row.top, row.bottom)}`;
  else if (row.special === 'halfW') inner = `<span style="flex:none;width:1ch"></span><span style="flex:none;width:1ch;background:${C.surface}"></span>${halfBox(60, row.top, row.bottom)}<span style="flex:none;width:1ch;background:${C.surface}"></span>`;
  else {
    const want = row.full ? 64 : 63;
    if (!row.free && len(row.segs) !== want) throw new Error(`row is ${len(row.segs)} wide, not ${want}: ` + plain(row.segs));
    inner = renderSegs(row.segs);
  }
  if (!row.full && !row.free) inner += railCell(row.rail);
  if (row.btn) return `<button type="button" onClick="{{ ${row.btn} }}" style="${BTN}">${inner}</button>`;
  return `<div style="${ROW}">${inner}</div>`;
}
export function dump(rows, depth = 0) {
  const out = [];
  for (const r of rows) {
    if (r.group) out.push(`  [if ${r.group}]`, ...dump(r.rows, depth + 1), `  [end]`);
    else if (r.special) out.push(' ' + ({edgeTop: '▗' + '▄'.repeat(60) + '▖', edgeBottom: '▝' + '▀'.repeat(60) + '▘'}[r.special] ?? '·'.repeat(62)));
    else out.push(plain(r.segs) + (r.rail ? '▐' : ''));
  }
  return out;
}
export function setRail(rows, from, to, color) { for (let i = from; i < to && i < rows.length; i++) if (!rows[i].group) rows[i].rail = color; return rows; }

const FONT = `'JetBrains Mono',ui-monospace,'SF Mono',Menlo,Consolas,monospace`;
export function page({title, top, stream, bottom, logic, w = BW, h = BH, overlays = []}) {
  const over = overlays.map(o => {
    const html = `${o.backdrop ? `<div style="position:absolute;left:0;right:0;top:${o.backdrop * RH}px;bottom:0;background:${o.scrim ?? 'rgba(8,9,12,0.62)'}"></div>` : ''}<div style="position:absolute;left:${o.col}ch;top:${o.row * RH}px;display:flex;flex-direction:column">${o.rows.map(r => renderRow({...r, free: true})).join('\n')}</div>`;
    return o.flag ? `<sc-if value="{{ ${o.flag} }}" hint-placeholder-val="{{ false }}">${html}</sc-if>` : html;
  }).join('\n');
  const body = `<div style="position:relative;width:64ch;height:${h - 24}px;overflow:hidden;display:flex;flex-direction:column">
${top.map(renderRow).join('\n')}
<div style="flex:1 1 0;min-height:0;overflow:hidden;display:flex;flex-direction:column">
${stream.map(renderRow).join('\n')}
</div>
${bottom.map(renderRow).join('\n')}
${over}
</div>`;
  return shell({title, w, h, body, logic});
}
export function shell({title, w, h, body, logic, pad = '12px'}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,700;1,400&amp;display=swap" rel="stylesheet">
<style>
body{margin:0;background:${C.page};font-family:${FONT}}
a{color:inherit}a:hover{color:inherit}
a:hover span{filter:brightness(1.25)}
button:hover span{filter:brightness(1.18)}
button:focus-visible,a:focus-visible{outline:1px solid ${C.accent};outline-offset:-1px}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
.pulse{animation:pulse 1.2s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.pulse{animation:none}}
</style>
</helmet>
<div style="width: ${w}px; height: ${h}px; box-sizing: border-box; padding: ${pad}; overflow: hidden; background: ${C.page}; color: ${C.ink}; font-family: ${FONT}; font-size: 14px; line-height: ${RH}px; font-variant-ligatures: none;">
${body}
</div>
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{"$preview":{"width":${w},"height":${h}}}'>
${logic ?? `class Component extends DCLogic {
renderVals() {
return {};
}
}`}
</script>
</body>
</html>
`;
}

// ---------- shared chrome ----------
export function header(view, status) {
  const tab = (label, n, on, href) => (on
    ? [s(' ' + label, C.ink, {bg: C.surface2, b: 1}), ...(n ? [s(' ' + n, C.accent, {bg: C.surface2, b: 1})] : []), s(' ', undefined, {bg: C.surface2})]
    : [s(' ' + label + (n ? ' ' + n : '') + ' ', C.dim)]).map(x => ({...x, href}));
  const right = {
    working: () => [s('⠹', C.accent, {cls: 'pulse'}), s(' working', C.ink)],
    idle: () => [s('●', C.faint), s(' idle', C.dim)],
    waiting: () => [s('●', C.warn, {cls: 'pulse'}), s(' waiting for you', C.warn)],
  }[status[0]](status[1]);
  const use = (status[2] ?? [0.58, 0.23]);
  const tone = f => (f >= 0.9 ? C.del : f >= 0.75 ? C.warn : C.accent);
  const usage = [s('5h', C.dim), sp(1), meter(6, use[0], tone(use[0])), sp(1), s(Math.round(use[0] * 100) + '%', C.text), sp(2), s('wk', C.dim), sp(1), s(Math.round(use[1] * 100) + '%', C.text), sp(3)].map(x => ({...x, href: 'Usage.dc.html'}));
  right.unshift(...usage);
  return [P([...tab('Changes', 10, view === 'changes', 'Main.dc.html'), sp(1), ...tab('Files', null, view === 'files', 'Files.dc.html')], right), blank()];
}
export function hints(pairs, right = [s('sidecar-pane', C.faint), s(' • ', C.faint), s('main', C.faint)]) {
  const left = pairs.flatMap(([k, label], i) => [...(i ? [sp(2)] : []), s(k, C.text), s(' ' + label, C.faint)]);
  return [blank(), P(left, right)];
}
export const stats = (add, del, w = 5) => [add ? s(('+' + add).padStart(w), C.add) : sp(w), sp(1), del ? s(('−' + del).padStart(w), C.del) : sp(w)];
export function step({chev, verb, dir = '', name, add, del, right, bg, verbFg, nameFg, btn}) {
  return K([chev ?? sp(1), sp(1), s(verb.padEnd(9), verbFg ?? C.dim), s(dir, C.dim), s(name, nameFg ?? C.ink)], right ?? stats(add, del), {bg, btn});
}
export function turnRow(prompt, meta, o = {}) {
  const chars = [...prompt]; const shown = chars.length > 59 ? chars.slice(0, 58).join('').trimEnd() + '…' : prompt;
  return [P([o.chev ?? s('▸', C.faint), sp(1), s(shown, C.text)], [], {btn: o.btn}), P([sp(2), ...meta])];
}
