import {C, s, sp, bar, P, K, W, edgeTop, edgeBottom, halfW, dl, hunkHead, gap, step, stats, header, renderRow, shell} from './lib.mjs';

const KW = 1240, KH = 1040;
const rows = list => `<div style="width:64ch;display:flex;flex-direction:column">${list.map(renderRow).join('\n')}</div>`;
const label = t => `<div style="color:${C.dim};font-size:12px;line-height:18px;letter-spacing:0.08em;text-transform:uppercase">${t}</div>`;
const note = t => `<div style="color:${C.dim};font-size:12px;line-height:18px;max-width:520px;text-wrap:pretty">${t}</div>`;
const block = (title, body, caption) => `<div style="display:flex;flex-direction:column;gap:12px">${label(title)}${body}${caption ? note(caption) : ''}</div>`;

// --- card anatomy, 3x ---
const CW_ = 25, CH_ = 60, N = 16;
const cell = inner => `<div style="width:${CW_}px;height:${CH_}px;box-sizing:border-box;border-right:1px solid ${C.rule};border-bottom:1px solid ${C.rule};position:relative;display:flex;align-items:center;justify-content:center;font-size:40px;line-height:${CH_}px">${inner}</div>`;
const fill = (l, t, w, h, color = C.surface) => `<div style="position:absolute;left:${l}%;top:${t}%;width:${w}%;height:${h}%;background:${color}"></div>`;
const glyphRow = cells => `<div style="display:flex">${cells.join('')}</div>`;
const top = [cell(''), cell(fill(50, 50, 50, 50)), ...Array(N - 4).fill(cell(fill(0, 50, 100, 50))), cell(fill(0, 50, 50, 50)), cell('')];
const bottom = [cell(''), cell(fill(50, 0, 50, 50)), ...Array(N - 4).fill(cell(fill(0, 0, 100, 50))), cell(fill(0, 0, 50, 50)), cell('')];
const textCells = [...'  ▾ Edited App '].map((ch, i) => cell((i > 0 && i < N - 1 ? fill(0, 0, 100, 100) : '') + `<span style="position:relative;color:${ch === '▾' ? C.accent : i > 9 ? C.ink : C.dim}">${ch === ' ' ? '' : ch}</span>`));
while (textCells.length < N) textCells.push(cell(''));
const names = ['', '▗', ...Array(N - 4).fill('▄'), '▖', ''];
const names2 = ['', '▝', ...Array(N - 4).fill('▀'), '▘', ''];
const nameRow = list => `<div style="display:flex">${list.map(n => `<div style="width:${CW_}px;text-align:center;color:${C.faint};font-size:12px;line-height:18px">${n}</div>`).join('')}</div>`;
const anatomy = `<div style="display:flex;flex-direction:column;gap:4px">${nameRow(names)}<div style="border-left:1px solid ${C.rule};border-top:1px solid ${C.rule};width:${CW_ * N}px">${glyphRow(top)}${glyphRow(textCells)}${glyphRow(bottom)}</div>${nameRow(names2)}</div>`;

// --- swatches ---
const sw = (name, hex) => `<div style="display:flex;flex-direction:column;gap:6px;width:92px"><div style="height:36px;background:${hex};border:1px solid ${C.rule}"></div><div style="font-size:12px;line-height:16px;color:${C.text}">${name}</div><div style="font-size:12px;line-height:16px;color:${C.faint}">${hex}</div></div>`;
const swatches = list => `<div style="display:flex;flex-wrap:wrap;gap:16px 12px">${list.map(([n, h]) => sw(n, h)).join('')}</div>`;

const left = [
  block('Card anatomy, one cell at a time', anatomy, 'A card is filled background plus half-block edges. The edge glyphs take the surface colour and leave the background alone, so the card floats on any terminal theme. No box lines, no lost columns.'),
  block('Surfaces and ink', swatches([['page', C.page], ['surface', C.surface], ['surface 2', C.surface2], ['well', C.well], ['scope', C.scope], ['ink', C.ink], ['text', C.text], ['dim', C.dim], ['faint', C.faint], ['rule', C.rule]])),
  block('Signal', swatches([['accent', C.accent], ['add', C.add], ['del', C.del], ['add tint', C.addBg], ['del tint', C.delBg], ['add word', C.addWord], ['del word', C.delWord], ['warn', C.warn], ['link', C.link], ['keyword', C.keyword]])),
].join('');

const right = [
  block('Status, top right', rows([header('changes', ['working'])[0], header('changes', ['waiting'])[0], header('files', ['idle'])[0]])),
  block('Row states', rows([
    edgeTop(),
    step({chev: s('▸', C.faint), verb: 'Edited', dir: 'src/ui/', name: 'App.tsx', add: 381, del: 91}),
    step({chev: s('▸', C.accent, {bg: C.surface2}), verb: 'Edited', dir: 'src/ui/', name: 'Chrome.tsx', add: 4, del: 2, bg: C.surface2}),
    step({chev: s('▾', C.accent), verb: 'Writing', verbFg: C.accent, dir: 'src/core/', name: 'turns.ts', add: 28}),
    step({chev: s('▸', C.faint), verb: 'Ran', name: 'npm run typecheck', nameFg: C.text, right: [s('✓', C.add)]}),
    step({chev: s('▸', C.faint), verb: 'Ran', name: 'npx tsx scripts/smoke.tsx', nameFg: C.text, right: [s('✗', C.del)]}),
    edgeBottom(),
  ]), 'Rest, cursor, live, passed, failed. The cursor is a lighter surface, never a box.'),
  block('Diff lines', rows([
    edgeTop(),
    halfW(C.surface, C.well),
    hunkHead(s('▾', C.faint), 'Tabs()', '19–23', 2, 2),
    ...dl(' ', 20, '  const stops = tabStops(changedCount);'),
    ...dl('-', 21, '  const used = stops[1]!.end + (filtered ? 10 : 0);'),
    ...dl('+', 22, '  const used = stops[1]!.end + (filtered ? 10 : 0) + (note ? note.length + 3 : 0);', {marks: [' + (note ? note.length + 3 : 0)']}),
    gap('4 unchanged lines'),
    hunkHead(s('▸', C.faint), 'viewRows()', '48–115', 38, 29),
    halfW(C.well, C.surface),
    edgeBottom(),
  ]), 'Changed lines wrap, so the edit is never cut off. Unchanged lines truncate. Hunks are named after what they contain.'),
  block('Glyphs', `<div style="display:flex;flex-wrap:wrap;gap:10px 28px;font-size:14px;line-height:20px">${[
    ['▸ ▾', 'closed, open'], ['✦', 'thought'], ['⠹', 'working'], ['●', 'status, turn'], ['✓ ✗', 'passed, failed'], ['⋯', 'folded lines'], ['↪', 'wrapped line'], ['‹ ›', 'back, path'], ['▎', 'changed line'], ['▐', 'rail, thumb'],
  ].map(([g, n]) => `<div style="display:flex;gap:10px"><span style="color:${C.ink}">${g}</span><span style="color:${C.dim}">${n}</span></div>`).join('')}</div>`),
].join('');

const body = `<div style="display:flex;flex-direction:column;gap:36px">
<div style="display:flex;flex-direction:column;gap:6px"><div style="font-size:20px;line-height:28px;font-weight:700;color:${C.ink}">Terminal kit</div>${note('Everything on the other boards is built from these parts. Each one is a plain character with a colour.')}</div>
<div style="display:grid;grid-template-columns:repeat(2, minmax(0, 1fr));gap:48px">
<div style="display:flex;flex-direction:column;gap:40px">${left}</div>
<div style="display:flex;flex-direction:column;gap:40px">${right}</div>
</div>
</div>`;

export const kit = shell({title: 'Terminal kit', w: KW, h: KH, body, pad: '48px'});
export {KW, KH};
