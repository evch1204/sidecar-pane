import type {Kind, Segment} from './highlight';

// Markdown as something to read rather than something to parse by eye:
// paragraphs wrapped to the pane, markers gone, tables in columns. Every
// output line remembers which source lines it came from, so "this changed"
// marks still land in the right place.

export type MdLine = {segments: Segment[]; from: number; to: number};

type Word = {text: string; kind: Kind | null};

const len = (text: string): number => [...text].length;

// **bold**, `code`, [text](url), *emphasis*: split into words that keep a style.
function inline(text: string, base: Kind | null = null): Word[] {
  const out: Word[] = [];
  const pattern = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))|(\*([^*\s][^*]*)\*)|(_([^_\s][^_]*)_)/g;
  const push = (part: string, kind: Kind | null) => {
    for (const word of part.split(/\s+/).filter(Boolean)) out.push({text: word, kind});
  };

  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(last, match.index);
    push(before, base);
    const glued = before !== '' && !/\s$/.test(before) && out.length > 0;
    const startAt = out.length;
    if (match[2]) push(match[2], 'strong');
    else if (match[4]) out.push({text: match[4], kind: 'code'});
    else if (match[6]) push(match[6], 'link');
    else if (match[9]) push(match[9], 'emphasis');
    else if (match[11]) push(match[11], 'emphasis');
    // "(`x`)" must not come apart: glue a styled run to the text it touches.
    if (glued && out[startAt]) out[startAt] = {...out[startAt]!, text: `\u0000${out[startAt]!.text}`};
    last = match.index + match[0].length;
    const after = text.slice(last);
    if (after && !/^\s/.test(after)) {
      const tail = /^\S+/.exec(after)![0];
      out.push({text: `\u0000${tail}`, kind: base});
      last += tail.length;
    }
  }

  push(text.slice(last), base);
  return out;
}

// Words onto lines. A word starting with NUL joins the one before it.
function wrapWords(words: Word[], width: number): Segment[][] {
  const lines: Segment[][] = [];
  let line: Segment[] = [];
  let used = 0;
  for (const word of words) {
    const joined = word.text.startsWith('\u0000');
    const text = joined ? word.text.slice(1) : word.text;
    const need = len(text) + (joined || used === 0 ? 0 : 1);
    if (used > 0 && !joined && used + need > width) {
      lines.push(line);
      line = [];
      used = 0;
    }

    if (used > 0 && !joined) line.push({text: ' ', kind: null});
    line.push({text, kind: word.kind});
    used += used === 0 ? len(text) : need;
  }

  if (line.length) lines.push(line);
  return lines.length ? lines : [[]];
}

const cells = (row: string): string[] => row.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());

function table(rows: string[], start: number, width: number, out: MdLine[]): void {
  const body = rows.filter(row => !/^\s*\|?[\s:|-]+\|?\s*$/.test(row) || !row.includes('-'));
  const grid = body.map(cells);
  const count = Math.max(...grid.map(row => row.length));
  const natural = Array.from({length: count}, (_, c) => Math.max(...grid.map(row => len((row[c] ?? '').replace(/[*`]/g, '')))));
  // Every column but the last keeps its natural width, within reason. The
  // last one takes what is left and wraps.
  const widths = natural.map((w, c) => (c === count - 1 ? w : Math.min(w, 22)));
  const fixed = widths.slice(0, -1).reduce((a, w) => a + w + 2, 0);
  widths[count - 1] = Math.max(12, width - fixed);
  // Too many wide columns to do that: share the pane evenly instead.
  if (fixed + 12 > width) {
    const each = Math.max(6, Math.floor((width - 2 * (count - 1)) / count));
    widths.fill(each);
  }

  let source = start;
  rows.forEach((row, r) => {
    const at = source++;
    if (!body.includes(row)) return;
    const head = r === 0;
    const wrapped = cells(row).map((cell, c) => wrapWords(inline(cell, head ? 'meta' : c === 0 ? 'strong' : null), widths[c]!));
    const tall = Math.max(...wrapped.map(w => w.length));
    for (let i = 0; i < tall; i++) {
      const segments: Segment[] = [];
      wrapped.forEach((lines, c) => {
        const line = lines[i] ?? [];
        const used = line.reduce((n, s) => n + len(s.text), 0);
        // The last column has nothing to line up with, so it is not padded.
        segments.push(...line, ...(c === count - 1 ? [] : [{text: ' '.repeat(Math.max(0, widths[c]! - used) + 2), kind: null}]));
      });
      out.push({segments, from: at, to: at});
    }
  });
}

export function formatMarkdown(lines: string[], width: number): MdLine[] {
  const out: MdLine[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const at = i + 1;

    if (line.trim() === '') {
      out.push({segments: [], from: at, to: at});
      i++;
      continue;
    }

    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(fence[1]!)) {
        out.push({segments: [{text: `  ${lines[i]!}`, kind: 'code'}], from: i + 1, to: i + 1});
        i++;
      }

      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      for (const segs of wrapWords(inline(heading[2]!, 'section'), width)) out.push({segments: segs, from: at, to: at});
      i++;
      continue;
    }

    if (/^\s*\|/.test(line)) {
      const start = i;
      while (i < lines.length && /^\s*\|/.test(lines[i]!)) i++;
      table(lines.slice(start, i), start + 1, width, out);
      continue;
    }

    const item = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/.exec(line);
    const quote = /^\s*>\s?(.*)$/.exec(line);
    const isBreak = (text: string) => text.trim() === '' || /^(\s*([-*+]|\d+[.)])\s|#{1,6}\s|\s*\||\s*>|\s*(```|~~~))/.test(text);

    // A block runs until a blank line or until something else starts.
    let text = item ? item[4]! : quote ? quote[1]! : line.trim();
    let end = i + 1;
    while (end < lines.length && !isBreak(lines[end]!)) text += ` ${lines[end++]!.trim()}`;

    let lead: Segment[] = [];
    if (item) {
      const box = item[3];
      const mark = box ? (/x/i.test(box) ? '✓' : '○') : /\d/.test(item[2]!) ? item[2]! : '•';
      lead = [{text: ' '.repeat(Math.min(6, len(item[1]!))), kind: null}, {text: `${mark} `, kind: 'bullet'}];
    } else if (quote) {
      lead = [{text: '│ ', kind: 'meta'}];
    }

    const indent = lead.reduce((n, s) => n + len(s.text), 0);
    wrapWords(inline(text, quote ? 'meta' : null), Math.max(12, width - indent)).forEach((segs, n) => {
      out.push({segments: [...(n === 0 ? lead : [{text: ' '.repeat(indent), kind: null}]), ...segs], from: at, to: end});
    });
    i = end;
  }

  return out;
}

export const isMarkdown = (file: string): boolean => /\.(md|markdown|mdx)$/i.test(file);
