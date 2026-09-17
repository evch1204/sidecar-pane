import {RIGHT_PAD, seg, sp, type Seg} from './cells';
import {glyph, theme} from './theme';

// The pane's name in the six-row block font, the way it opens. The face is
// the only thing with a colour of its own; the shadow edge stays quiet, so the
// word reads as one shape and not as a box drawing.
//
// The word is spelled out here rather than taken from splash's `NAME`: splash
// draws with this file, and the font only has these seven letters anyway.
const LETTERS = [...'SIDECAR'].map(char => glyph.block[char as keyof typeof glyph.block]);

// Seven letters and a column between each: 8+3+8+8+8+8+8 and six gaps.
export const WORDMARK_COLS = 57;

// The face of every letter is the full block, which the theme already has as
// the tallest of its column glyphs (`█`); everything else in the font is the
// shadow edge.
const FACE = glyph.columns[8]!;

// Two hex colours, `t` of the way from `a` to `b`, straight across RGB. The
// two ends are close enough in hue that a straight line does not go muddy in
// the middle, so nothing cleverer is worth it.
function mix(a: string, b: string, t: number): string {
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const from = rgb(a);
  const to = rgb(b);
  return `#${from.map((v, i) => Math.round(v + (to[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

// SIDECAR in the block font: six rows of segments, the face in a gradient from
// accent to gold across the columns, the shadow in faint. `tone: 'add'` draws
// the row as a line being added: face in add, shadow in addWordBg's hue, so a
// row being typed reads as a diff line before it settles into the name.
export function wordmarkRows(tone: 'gradient' | 'add' = 'gradient'): Seg[][] {
  const shadow = tone === 'add' ? theme.addWordBg : theme.faint;
  return [0, 1, 2, 3, 4, 5].map(row => {
    const text = LETTERS.map(letter => letter[row]!).join(' ');
    // One segment a cell. The screen joins neighbours of the same colour, and
    // each face cell has a colour of its own anyway.
    return [...text].map((char, x): Seg => {
      if (char === ' ') return sp(1);
      if (char !== FACE) return seg(char, shadow);
      return seg(char, tone === 'add' ? theme.add : mix(theme.accent, theme.gold, x / (WORDMARK_COLS - 1)));
    });
  });
}

// Whether a page row has room for it: the margin, the scrollbar and the pad
// before it come off the pane's width first.
export const wordmarkFits = (cols: number): boolean => cols - 2 - RIGHT_PAD >= WORDMARK_COLS;
