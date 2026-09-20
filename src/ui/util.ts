import stringWidth from 'string-width';
import {glyph} from './theme';

// Cut text to `max` columns, ending in an ellipsis when it does not fit.
export function fit(text: string, max: number): string {
  if (max <= 0) return '';
  if (stringWidth(text) <= max) return text;
  let out = '';
  for (const char of text) {
    if (stringWidth(out + char) > max - 1) break;
    out += char;
  }

  return out + glyph.ellipsis;
}

// Cut a path from the left instead of the right, so the file name survives.
export function fitPath(text: string, max: number): string {
  if (max <= 0) return '';
  if (stringWidth(text) <= max) return text;
  const chars = [...text];
  let out = '';
  for (let i = chars.length - 1; i >= 0; i--) {
    if (stringWidth(chars[i]! + out) > max - 1) break;
    out = chars[i]! + out;
  }

  return glyph.ellipsis + out;
}

export function width(text: string): number {
  return stringWidth(text);
}

export function spaces(n: number): string {
  return ' '.repeat(Math.max(0, n));
}

// Break text onto lines that fit, without cutting words in half.
export function wrap(text: string, max: number): string[] {
  if (max <= 0) return [];
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line === '') line = word;
    else if (stringWidth(`${line} ${word}`) <= max) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }

    // A single word longer than the pane still has to break somewhere.
    while (stringWidth(line) > max) {
      out.push(line.slice(0, max));
      line = line.slice(max);
    }
  }

  if (line) out.push(line);
  return out;
}
