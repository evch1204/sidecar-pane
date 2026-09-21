// Version 3 is not drawn. `capture.tsx` saves what the real pane printed, and
// this turns each saved frame into an artboard: the escape codes become
// colours, and the block characters become the same shapes the other boards
// use, so a half block looks like a half block and not like a font glyph.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {C, s, bar, box, lower, upper, column, hline, guide, page} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const hex = (r, g, b) => '#' + [r, g, b].map(n => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();

function parse(line) {
  const cells = [];
  let style = {};
  const re = /\x1b\[([0-9;]*)m|([\s\S])/gu;
  for (const m of line.matchAll(re)) {
    if (m[2] !== undefined) {
      cells.push({ch: m[2], ...style});
      continue;
    }

    const codes = (m[1] || '0').split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) style = {};
      else if (c === 1) style = {...style, b: 1};
      else if (c === 22) style = {...style, b: 0};
      else if (c === 3) style = {...style, i: 1};
      else if (c === 23) style = {...style, i: 0};
      else if (c === 4) style = {...style, u: 1};
      else if (c === 24) style = {...style, u: 0};
      else if (c === 39) style = {...style, fg: undefined};
      else if (c === 49) style = {...style, bg: undefined};
      else if ((c === 38 || c === 48) && codes[i + 1] === 2) {
        style = {...style, [c === 38 ? 'fg' : 'bg']: hex(codes[i + 2], codes[i + 3], codes[i + 4])};
        i += 4;
      }
    }
  }

  return cells;
}

const QUAD = {'▗': [.5, .5, .5, .5], '▖': [0, .5, .5, .5], '▝': [.5, 0, .5, .5], '▘': [0, 0, .5, .5], '▐': [.5, 0, .5, 1]};
const COLUMNS = '▁▂▃▄▅▆▇█';

function shape(ch, n, cell) {
  const fg = cell.fg ?? C.ink, o = {bg: cell.bg};
  if (ch === '▄') return lower(n, fg, o);
  if (ch === '▀') return upper(n, fg, o);
  if (QUAD[ch]) return Array.from({length: n}, () => box(1, QUAD[ch], fg, o));
  if (ch === '▎') return Array.from({length: n}, () => ({...bar(fg), bg: cell.bg}));
  if (ch === '│') return Array.from({length: n}, () => ({...guide(), bg: cell.bg}));
  if (ch === '━') return hline(n, fg, {heavy: 1, bg: cell.bg});
  if (ch === '─') return hline(n, fg, {bg: cell.bg});
  if (ch === '╸') return box(1, [0, .44, .5, .12], fg, o);
  if (COLUMNS.includes(ch) && ch !== '▄') return Array.from({length: n}, () => column(COLUMNS.indexOf(ch) + 1, fg, o));
  return null;
}

function toSegs(cells) {
  const out = [];
  let i = 0;
  while (i < cells.length) {
    const cell = cells[i];
    let n = 1;
    const same = other => other && other.ch === cell.ch && other.fg === cell.fg && other.bg === cell.bg;
    while (same(cells[i + n])) n++;
    const made = shape(cell.ch, n, cell);
    if (made) {
      out.push(...[made].flat());
      i += n;
      continue;
    }

    // Plain text: a run of cells that share a style.
    let text = '';
    const like = other => other && other.fg === cell.fg && other.bg === cell.bg && other.b === cell.b && other.i === cell.i && other.u === cell.u && !shape(other.ch, 1, other);
    while (like(cells[i])) text += cells[i++].ch;
    out.push(s(text, cell.fg, {bg: cell.bg, b: cell.b, i: cell.i, u: cell.u}));
  }

  return out;
}

export const BOARDS = [
  ['changes', 'V3-Changes.dc.html', 'Changes, the real pane'],
  ['menu', 'V3-Menu.dc.html', 'The View menu, the real pane'],
  ['working', 'V3-Working.dc.html', 'While Claude works, with agents'],
  ['agents', 'V3-Agents.dc.html', 'Agents, the real pane'],
  ['usage', 'V3-Usage.dc.html', 'Usage, the real pane'],
  ['files', 'V3-Files.dc.html', 'Files with a peek, the real pane'],
  ['reader', 'V3-Reader.dc.html', 'Markdown in the reader, the real pane'],
];

export const files3 = {};
for (const [frame, name, title] of BOARDS) {
  const file = path.join(HERE, 'frames', `${frame}.ans`);
  if (!fs.existsSync(file)) continue;
  const rows = fs.readFileSync(file, 'utf8').split('\n').slice(0, 52).map(line => {
    const cells = parse(line);
    while (cells.length < 64) cells.push({ch: ' '});
    return {segs: toSegs(cells.slice(0, 64)), free: true};
  });
  files3[name] = page({title, top: rows, stream: [], bottom: []});
}
