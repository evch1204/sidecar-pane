// Word-level diff for a pair of changed lines, so a one-word edit reads as a
// one-word edit instead of a whole red line beside a whole green line.

export type Span = {start: number; end: number};

// Words, runs of spaces and single punctuation characters each become one
// token. Splitting this way keeps `foo.bar(baz)` from collapsing into one blob.
function tokenize(text: string): string[] {
  return text.match(/[\p{L}\p{N}_$]+|\s+|[^\p{L}\p{N}_$\s]/gu) ?? [];
}

function spansOf(tokens: string[], changed: boolean[], offset: number): Span[] {
  const out: Span[] = [];
  let at = offset;
  for (let i = 0; i < tokens.length; i++) {
    const width = tokens[i]!.length;
    if (changed[i]) {
      const last = out[out.length - 1];
      if (last && last.end === at) last.end = at + width;
      else out.push({start: at, end: at + width});
    }

    at += width;
  }

  return out;
}

// Longest common subsequence over tokens. Bounded: very long lines fall back to
// "the whole line changed", which is honest and costs nothing.
const MAX_TOKENS = 400;

function lcsChanged(a: string[], b: string[]): {a: boolean[]; b: boolean[]} {
  const aChanged: boolean[] = new Array(a.length).fill(true);
  const bChanged: boolean[] = new Array(b.length).fill(true);
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return {a: aChanged, b: bChanged};

  const table: number[][] = Array.from({length: a.length + 1}, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      aChanged[i] = false;
      bChanged[j] = false;
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;
  }

  return {a: aChanged, b: bChanged};
}

const WORD_CHAR = /[\p{L}\p{N}_$]/u;

export type WordDiff = {
  removed: Span[];
  added: Span[];
  // Share of the longer line the two versions have in common, 0 to 1.
  similarity: number;
};

// Character ranges that differ between two versions of a line.
export function wordDiff(before: string, after: string): WordDiff {
  // Matching ends are the common case (an edit in the middle of a line), and
  // trimming them first keeps the table small.
  const limit = Math.min(before.length, after.length);
  let head = 0;
  while (head < limit && before[head] === after[head]) head++;
  // Never cut a word in half: walk back to a boundary.
  while (head > 0 && WORD_CHAR.test(before[head - 1] ?? '')) head--;

  let tail = 0;
  while (tail < limit - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  while (tail > 0 && WORD_CHAR.test(before[before.length - tail] ?? '')) tail--;

  const aTokens = tokenize(before.slice(head, before.length - tail));
  const bTokens = tokenize(after.slice(head, after.length - tail));
  const changed = lcsChanged(aTokens, bTokens);

  // Similarity counts every character the two lines actually share, not just
  // the matching ends, or "hello" -> "hi there" would look like a rewrite.
  let same = head + tail;
  for (let i = 0; i < aTokens.length; i++) if (!changed.a[i]) same += aTokens[i]!.length;

  return {
    removed: spansOf(aTokens, changed.a, head),
    added: spansOf(bTokens, changed.b, head),
    similarity: Math.min(1, same / Math.max(before.length, after.length, 1)),
  };
}
