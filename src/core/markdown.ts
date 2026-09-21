import stringWidth from 'string-width';
import {highlightLines, layoutLine, type Kind, type Segment} from './highlight';

// Markdown as a page rather than as text: a title with a rule under it,
// sections, wrapped prose, real tables, boxed code. Every row says what kind
// of thing it is and which source lines it came from, so the pane can colour
// it, mark it as changed and map it back onto the file.
//
// Nothing here knows a colour. The few glyphs a page is drawn with are handed
// in, because they belong to the theme, and a row is measured in columns with
// `string-width`, never in characters.

export type MdKind =
  | 'blank'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'ruleHeavy'
  | 'ruleThin'
  | 'para'
  | 'list'
  | 'quote'
  | 'codeLabel'
  | 'code'
  | 'codeEnd'
  | 'tableHead'
  | 'tableRule'
  | 'tableRow';

export type MdLine = {kind: MdKind; segments: Segment[]; from: number; to: number};

// The glyphs a page is drawn with. `theme.glyph` satisfies this, which is how
// the one place that owns the look keeps owning it.
export type MdGlyphs = {
  bullet: string;
  boxOff: string;
  boxOn: string;
  bar: string;
  heavy: string;
  rule: string;
  codeTop: string;
  codeSide: string;
  codeBottom: string;
  ellipsis: string;
};

const len = (text: string): number => stringWidth(text);
const sp = (n: number): string => ' '.repeat(Math.max(0, n));
const pad = (n: number): Segment => ({text: sp(n), kind: null});
const spanOf = (segments: Segment[]): number => segments.reduce((n, s) => n + len(s.text), 0);

// How many characters of `text` fit in `room` columns.
function fitChars(text: string, room: number): number {
  let used = 0;
  let n = 0;
  for (const char of text) {
    const w = len(char);
    if (used + w > room) break;
    used += w;
    n++;
  }

  return n;
}

// A word longer than the line has to break somewhere: a narrow table column
// would otherwise push the page open.
function cut(text: string, width: number): string[] {
  const out: string[] = [];
  let part = '';
  for (const char of text) {
    if (part !== '' && len(part + char) > width) {
      out.push(part);
      part = '';
    }

    part += char;
  }

  if (part) out.push(part);
  return out;
}

type Word = {text: string; kind: Kind | null};

const INLINE = new RegExp(
  [
    String.raw`!\[(?<alt>[^\]]*)\]\([^)]*\)`,
    String.raw`\*\*(?<bold>[^*]+)\*\*`,
    String.raw`~~(?<gone>[^~]+)~~`,
    '`(?<code>[^`]+)`',
    String.raw`\[(?<link>[^\]]+)\]\([^)]*\)`,
    String.raw`\*(?<em>[^*\s][^*]*)\*`,
    String.raw`_(?<under>[^_\s][^_]*)_`,
  ].join('|'),
  'g',
);

// **bold**, `code`, ~~gone~~, [text](url), *emphasis*, ![alt](src): split into
// words that keep a style. The URL is never printed. `chipRoom` is the width
// inline code may pad itself out to a chip inside; 0 leaves it bare, which is
// what a table cell and a heading want.
function inline(text: string, base: Kind | null = null, chipRoom = 0): Word[] {
  const out: Word[] = [];
  const push = (part: string, kind: Kind | null) => {
    for (const word of part.split(/\s+/).filter(Boolean)) out.push({text: word, kind});
  };

  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const g = match.groups!;
    const before = text.slice(last, match.index);
    push(before, base);
    const glued = before !== '' && !/\s$/.test(before) && out.length > 0;
    const startAt = out.length;
    const after = text.slice(match.index + match[0].length);
    const tail = glued || (after !== '' && !/^\s/.test(after));

    if (g.alt !== undefined) push(`[image: ${g.alt}]`, 'meta');
    else if (g.bold !== undefined) push(g.bold, 'strong');
    else if (g.gone !== undefined) push(g.gone, 'strike');
    else if (g.code !== undefined) {
      // A chip needs a space of ground either side, so it is only worth it
      // when the code stands on its own and the line has room for it.
      const chip = chipRoom > 0 && !tail && len(g.code) + 2 <= chipRoom;
      out.push({text: chip ? ` ${g.code} ` : g.code, kind: chip ? 'chip' : 'code'});
    } else if (g.link !== undefined) push(g.link, 'link');
    else if (g.em !== undefined) push(g.em, 'emphasis');
    else if (g.under !== undefined) push(g.under, 'emphasis');

    // "(`x`)" must not come apart: glue a styled run to the text it touches.
    if (glued && out[startAt]) out[startAt] = {...out[startAt]!, text: `\u0000${out[startAt]!.text}`};
    last = match.index + match[0].length;
    if (after !== '' && !/^\s/.test(after)) {
      const stuck = /^\S+/.exec(after)![0];
      out.push({text: `\u0000${stuck}`, kind: base});
      last += stuck.length;
    }
  }

  push(text.slice(last), base);
  return out;
}

// Words onto lines. A word starting with NUL joins the one before it.
function wrapWords(words: Word[], width: number): Segment[][] {
  const room = Math.max(1, width);
  const lines: Segment[][] = [];
  let line: Segment[] = [];
  let used = 0;
  const place = (text: string, kind: Kind | null, joined: boolean) => {
    const need = len(text) + (joined || used === 0 ? 0 : 1);
    if (used > 0 && !joined && used + need > room) {
      lines.push(line);
      line = [];
      used = 0;
    }

    if (used > 0 && !joined) line.push({text: ' ', kind: null});
    line.push({text, kind});
    used += used === 0 ? len(text) : need;
  };

  for (const word of words) {
    const joined = word.text.startsWith('\u0000');
    const whole = joined ? word.text.slice(1) : word.text;
    const parts = len(whole) <= room ? [whole] : cut(whole, room);
    parts.forEach((part, n) => place(part, word.kind, joined && n === 0));
  }

  if (line.length) lines.push(line);
  return lines.length ? lines : [[]];
}

// How wide a cell reads once the markers are gone.
function inlineWidth(text: string): number {
  return inline(text).reduce((n, word, i) => {
    const joined = word.text.startsWith('\u0000');
    return n + len(joined ? word.text.slice(1) : word.text) + (i > 0 && !joined ? 1 : 0);
  }, 0);
}

// ---- tables -----------------------------------------------------------------

type Align = 'left' | 'center' | 'right';

const TABLE_INDENT = 1;
const TABLE_GAP = 2;

const cellsOf = (row: string): string[] =>
  row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());

const isDelim = (cells: string[]): boolean => cells.length > 0 && cells.every(cell => /^:?-{1,}:?$/.test(cell));

// Column widths from the content. A table too wide for the measure is not
// shrunk in proportion — that crushes a four column heading next to a column
// of prose. Instead every column is capped at the same width, the highest cap
// that fits, so a column that was already narrow keeps every column it had and
// the prose columns do all the wrapping.
function columnWidths(grid: string[][], count: number, room: number): number[] {
  const want = Array.from({length: count}, (_, c) => Math.max(1, ...grid.map(row => inlineWidth(row[c] ?? ''))));
  const fits = (cap: number) => want.reduce((n, w) => n + Math.min(w, cap), 0) <= room;
  if (fits(Math.max(...want))) return want;

  let cap = 1;
  while (cap < room && fits(cap + 1)) cap++;
  const out = want.map(w => Math.min(w, cap));

  // The cap lands on a whole number of columns, so it usually leaves a few
  // over. They go a column at a time to whoever is still short.
  let spare = room - out.reduce((a, b) => a + b, 0);
  while (spare > 0) {
    const hungry = out.map((w, c) => (w < want[c]! ? c : -1)).filter(c => c >= 0);
    if (hungry.length === 0) break;
    for (const c of hungry) {
      if (spare === 0) break;
      out[c] = out[c]! + 1;
      spare--;
    }
  }

  return out;
}

function table(rows: string[], start: number, width: number, g: MdGlyphs, out: MdLine[]): void {
  const grid = rows.map(cellsOf);
  const delimAt = grid.findIndex(isDelim);
  const count = Math.max(...grid.map(row => row.length));
  const align: Align[] = Array.from({length: count}, (_, c) => {
    const cell = delimAt >= 0 ? (grid[delimAt]![c] ?? '') : '';
    return cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left';
  });

  const room = Math.max(count, width - TABLE_INDENT - TABLE_GAP * (count - 1));
  const widths = columnWidths(
    grid.filter((_, i) => i !== delimAt),
    count,
    room,
  );
  // Everything above the `|---|` row is the header; without one, the first row is.
  const headRows = delimAt < 0 ? 1 : delimAt;

  grid.forEach((cells, r) => {
    const at = start + r;
    if (r === delimAt) {
      const segments: Segment[] = [pad(TABLE_INDENT)];
      widths.forEach((w, c) => {
        segments.push({text: g.rule.repeat(w), kind: null});
        if (c < count - 1) segments.push(pad(TABLE_GAP));
      });
      out.push({kind: 'tableRule', segments, from: at, to: at});
      return;
    }

    const head = r < headRows;
    const wrapped = widths.map((w, c) => wrapWords(inline(cells[c] ?? '', head ? 'strong' : null), w));
    const tall = Math.max(...wrapped.map(lines => lines.length));
    for (let i = 0; i < tall; i++) {
      const segments: Segment[] = [pad(TABLE_INDENT)];
      wrapped.forEach((lines, c) => {
        const w = widths[c]!;
        const cell = lines[i] ?? [];
        const used = Math.min(w, spanOf(cell));
        const before = align[c] === 'right' ? w - used : align[c] === 'center' ? Math.floor((w - used) / 2) : 0;
        segments.push(pad(before), ...cell, pad(w - used - before + (c < count - 1 ? TABLE_GAP : 0)));
      });
      out.push({kind: head ? 'tableHead' : 'tableRow', segments, from: at, to: at});
    }
  });
}

// ---- code -------------------------------------------------------------------

// A fence language is a file extension as far as the highlighter is concerned.
const FENCE_EXT: Record<string, string> = {
  ts: '.ts', typescript: '.ts', tsx: '.tsx', mts: '.ts',
  js: '.js', javascript: '.js', jsx: '.jsx', mjs: '.mjs', cjs: '.js',
  json: '.json', jsonc: '.json', css: '.css', scss: '.scss', less: '.less',
  html: '.html', xml: '.xml', svg: '.svg', vue: '.vue',
  md: '.md', markdown: '.md',
  sh: '.sh', bash: '.sh', shell: '.sh', zsh: '.sh', console: '.sh',
  yml: '.yml', yaml: '.yaml', toml: '.toml', ini: '.ini',
  py: '.py', python: '.py', go: '.go', rs: '.rs', rust: '.rs',
  java: '.java', kt: '.kt', c: '.c', h: '.c', cpp: '.cpp', cs: '.cs',
  php: '.php', rb: '.rb', ruby: '.rb', swift: '.swift', sql: '.sql', lua: '.lua',
  diff: '.diff', patch: '.diff',
};

// A fenced block: a labelled top rule, the lines inside on their own rows, and
// a bottom rule. Code never wraps — a drawing that wrapped would stop being
// one — so a long line is cut with an ellipsis.
function fenced(
  out: MdLine[],
  label: string,
  body: string[],
  openAt: number,
  closeAt: number,
  width: number,
  g: MdGlyphs,
  ext: string | null,
  tone: Kind | null = null,
): void {
  const head = label ? `${g.codeTop} ${label} ` : g.codeTop;
  out.push({
    kind: 'codeLabel',
    segments: [{text: head + g.rule.repeat(Math.max(0, width - len(head))), kind: null}],
    from: openAt,
    to: openAt,
  });

  const coloured = ext ? highlightLines(`page${ext}`, body) : null;
  const room = Math.max(1, width - 2);
  body.forEach((text, n) => {
    const over = len(text) > room;
    const keep = over ? fitChars(text, room - len(g.ellipsis)) : [...text].length;
    const pieces = layoutLine(text, coloured?.[n] ?? null, undefined, 0, keep);
    out.push({
      kind: 'code',
      segments: [
        {text: `${g.codeSide} `, kind: 'frame'},
        ...pieces.map(piece => ({text: piece.text, kind: ext ? piece.kind : tone})),
        ...(over ? [{text: g.ellipsis, kind: 'frame' as Kind}] : []),
      ],
      from: openAt + 1 + n,
      to: openAt + 1 + n,
    });
  });

  out.push({
    kind: 'codeEnd',
    segments: [{text: g.codeBottom + g.rule.repeat(Math.max(0, width - len(g.codeBottom))), kind: null}],
    from: closeAt,
    to: closeAt,
  });
}

// ---- lists ------------------------------------------------------------------

const ITEM = /^(\s*)([-*+]|\d+[.)])[ \t]+(\[[ xX]\][ \t]+)?(.*)$/;
const QUOTE = /^\s*(>+)[ \t]?(.*)$/;
const HEADING = /^(#{1,6})[ \t]+(.*)$/;
const FENCE = /^\s*(```+|~~~+)[ \t]*([^\s`~]*)/;
const BREAK = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const HTML = /^\s*<[A-Za-z!/]/;

// The page's own indents: a list and a table sit one column in from the prose,
// and each level of a list three more.
const LIST_INDENT = 1;
const LEVEL = 3;

// How wide the markers of one ordered list run, so `9.` and `10.` line up
// under each other instead of next to each other.
function orderedWidth(lines: string[], at: number, indent: number): number {
  let w = 2;
  for (let i = at; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') break;
    const item = ITEM.exec(line);
    if (!item) {
      // An indented line is this item still talking; anything else ends the run.
      if (/^\s/.test(line)) continue;
      break;
    }

    const level = len(item[1]!);
    if (level < indent) break;
    if (level > indent) continue;
    if (!/\d/.test(item[2]!)) break;
    w = Math.max(w, len(item[2]!));
  }

  return w;
}

// A block runs until a blank line or until something else starts.
const isBreak = (text: string): boolean =>
  text.trim() === '' ||
  BREAK.test(text) ||
  HTML.test(text) ||
  ITEM.test(text) ||
  QUOTE.test(text) ||
  HEADING.test(text) ||
  FENCE.test(text) ||
  /^\s*\|/.test(text);

export function formatMarkdown(lines: string[], width: number, g: MdGlyphs): MdLine[] {
  const out: MdLine[] = [];
  const push = (kind: MdKind, segments: Segment[], from: number, to = from) => out.push({kind, segments, from, to});

  // One empty row between blocks. It takes the source lines of the block it
  // follows, so every row on the page still names where it came from, and the
  // items of a tight list are allowed to sit against each other.
  const gap = (tight: MdKind[] = []) => {
    const last = out[out.length - 1];
    if (!last || last.kind === 'blank' || tight.includes(last.kind)) return;
    push('blank', [], last.to);
  };

  // A blank paper row at the top of the document, so the first line of a page
  // is not against the edge of the sheet.
  push('blank', [], 1);

  let i = 0;

  // Front matter only counts at the very top, and it is metadata rather than
  // prose, so it is shown the way code is.
  if (lines[0]?.trim() === '---') {
    const close = lines.findIndex((line, n) => n > 0 && line.trim() === '---');
    if (close > 0) {
      fenced(out, 'front matter', lines.slice(1, close), 1, close + 1, width, g, null, 'meta');
      i = close + 1;
    }
  }

  while (i < lines.length) {
    const line = lines[i]!;
    const at = i + 1;

    if (line.trim() === '') {
      const last = out[out.length - 1];
      // One empty row however many blank lines there are, and it keeps them all.
      if (last && last.kind === 'blank') last.to = at;
      else push('blank', [], at);
      i++;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      gap();
      const marker = fence[1]!;
      const lang = fence[2]!.toLowerCase();
      let end = i + 1;
      while (end < lines.length && !lines[end]!.trim().startsWith(marker)) end++;
      fenced(out, lang, lines.slice(i + 1, end), at, Math.min(end + 1, lines.length), width, g, FENCE_EXT[lang] ?? null);
      i = end + 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      gap();
      const level = heading[1]!.length;
      const kind: MdKind = level === 1 ? 'heading1' : level === 2 ? 'heading2' : level === 3 ? 'heading3' : 'heading4';
      for (const segments of wrapWords(inline(heading[2]!), width)) push(kind, segments, at);
      // A title gets a heavy rule and a section a thin one. Below that a
      // heading is weight and spacing alone, or the page becomes a ladder.
      if (level === 1) push('ruleHeavy', [{text: g.heavy.repeat(width), kind: null}], at);
      if (level === 2) push('ruleThin', [{text: g.rule.repeat(width), kind: null}], at);
      i++;
      continue;
    }

    if (BREAK.test(line)) {
      gap();
      push('ruleThin', [{text: g.rule.repeat(width), kind: null}], at);
      i++;
      continue;
    }

    if (/^\s*\|/.test(line)) {
      gap();
      const start = i;
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) i++;
      table(lines.slice(start, i), start + 1, width, g, out);
      continue;
    }

    if (HTML.test(line)) {
      gap();
      // Raw HTML is not prose, so it is shown as it is written and kept quiet.
      push('para', [{text: [...line].slice(0, fitChars(line, width)).join(''), kind: 'meta'}], at);
      i++;
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      gap(['quote']);
      const depth = quote[1]!.length;
      let text = quote[2]!;
      let end = i + 1;
      // The quote keeps going while the next line is at the same depth, and a
      // plain line under it is the same paragraph still.
      while (end < lines.length) {
        const next = QUOTE.exec(lines[end]!);
        if (next && next[1]!.length === depth) text += ` ${next[2]!.trim()}`;
        else if (!next && !isBreak(lines[end]!)) text += ` ${lines[end]!.trim()}`;
        else break;
        end++;
      }

      // Nested quotes stack their bars.
      const lead = `${g.bar.repeat(depth)} `;
      const hang = len(lead);
      wrapWords(inline(text, null, width - hang), width - hang).forEach((segments, n) => {
        push('quote', [n === 0 ? {text: lead, kind: 'frame'} : pad(hang), ...segments], at, end);
      });
      i = end;
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      gap(['list']);
      const spaces = len(item[1]!);
      const level = Math.min(3, Math.floor(spaces / 2));
      const indent = LIST_INDENT + level * LEVEL;
      const box = item[3];
      const ordered = /\d/.test(item[2]!);
      const mark = box
        ? `${/x/i.test(box) ? g.boxOn : g.boxOff}  `
        : ordered
          ? `${item[2]!.padStart(orderedWidth(lines, i, spaces))} `
          : `${g.bullet}  `;

      let text = item[4]!;
      let end = i + 1;
      while (end < lines.length && !isBreak(lines[end]!)) text += ` ${lines[end++]!.trim()}`;

      const hang = indent + len(mark);
      // A task already done is read as done: its words go quiet.
      const base: Kind | null = box && /x/i.test(box) ? 'meta' : null;
      wrapWords(inline(text, base, width - hang), width - hang).forEach((segments, n) => {
        const lead = n === 0 ? [pad(indent), {text: mark, kind: 'bullet' as Kind}] : [pad(hang)];
        push('list', [...lead, ...segments], at, end);
      });
      i = end;
      continue;
    }

    let text = line.trim();
    let end = i + 1;
    while (end < lines.length && !isBreak(lines[end]!)) text += ` ${lines[end++]!.trim()}`;
    gap();
    for (const segments of wrapWords(inline(text, null, width), width)) push('para', segments, at, end);
    i = end;
  }

  // And a blank paper row at the bottom, so the last line is not against the
  // edge either.
  const last = out[out.length - 1];
  if (last && last.kind !== 'blank') push('blank', [], last.to);
  return out;
}

export const isMarkdown = (file: string): boolean => /\.(md|markdown|mdx)$/i.test(file);
