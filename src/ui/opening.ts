import {num, overlay, pageRow, plural, seg, slice, sp, spinner, thinMeter, widthOf, type Line, type Seg} from './cells';
import {nameRows, whereSegs, type Counts} from './splash';
import {glyph, theme} from './theme';

// The three seconds the pane spends opening, while its first read runs. The
// name is added the way a diff adds lines, the read says what it found, a bar
// fills with the read's real progress and turns into git's own stat bar of
// today's real pluses and minuses, and then Home pushes the card down and off.
//
// Everything here is a function of the time since the opening started and of
// what the read has found so far. There is no state and no timer in this file:
// App ticks the clock and hands in what it knows, so a frame for any moment can
// be drawn, tested or printed without waiting for it.

export type OpeningInput = {
  cols: number;
  // The body rows the card owns.
  height: number;
  folder: string;
  branch: string;
  // What one readdir said, known at t = 0.
  chats: number;
  // What the transcripts said, once they have been read.
  counts: Counts | null;
  // The commits have been measured.
  loaded: boolean;
  // Today's real totals, once loaded; null when today has none.
  today: {added: number; removed: number} | null;
  // Milliseconds since the opening started.
  t: number;
  frame: number;
  // When `counts` and `loaded` arrived, in the same clock as `t`. The bar
  // never jumps, and without these it cannot know how long it has been
  // heading for its new target, so it assumes the read was that fast all
  // along. Pass them and a slow read fills the bar at the same steady pace.
  countsAt?: number;
  loadedAt?: number;
};

export const OPENING = {
  // The caret blinks alone for this long before the first row is added.
  T0: 400,
  // One wordmark row starts this long after the one above it, and takes FLIP
  // to be typed across before it settles into the name's own colours.
  ROW_MS: 130,
  FLIP: 120,
  // The readout and the folder line appear once the name is in.
  READ: 1250,
  // The bar appears, and takes BAR_MS to cross its whole width.
  BAR: 1310,
  BAR_MS: 700,
  // Each cell of the stat bar flips this long after the one before it.
  STAT_MS: 18,
  STAT_N: 40,
  // How long the finished card is left to be read before Home arrives.
  HOLD: 1000,
  // One row of Home arrives every PUSH_STEP.
  PUSH_STEP: 26,
};

// The read's real progress, as the share of the bar it has earned: a little
// for having started, most of it once the chats are read, all of it once the
// commits are measured.
const START_PART = 0.15;
const COUNTS_PART = 0.55;

// Blinks of the caret before the first row: on for this long, off for as long.
const BLINK_MS = 100;

const barCells = (cols: number): number => Math.max(1, Math.min(OPENING.STAT_N, cols - 8));

// Where the bar is at time `t`, and when it reached full (null while it has
// not been told the read is over). The part moves toward its target at one
// bar per BAR_MS and never faster, so a read that is over at once still fills
// over BAR_MS, and a target that moves up is walked to rather than jumped to.
function bar(input: OpeningInput): {part: number; full: number | null} {
  const {BAR, BAR_MS} = OPENING;
  const steps: [number, number][] = [[BAR, START_PART]];
  if (input.counts) steps.push([Math.max(BAR, input.countsAt ?? BAR), COUNTS_PART]);
  if (input.loaded) steps.push([Math.max(BAR, input.loadedAt ?? BAR), 1]);
  steps.sort((a, b) => a[0] - b[0]);

  // Walk the steps in order: between two of them the part climbs toward the
  // highest target reached so far.
  const at = (t: number): number => {
    let part = 0;
    let target = 0;
    let from = BAR;
    for (const [when, goal] of steps) {
      if (when > t) break;
      part = Math.min(target, part + (when - from) / BAR_MS);
      target = Math.max(target, goal);
      from = when;
    }

    return t < BAR ? 0 : Math.min(target, part + (t - from) / BAR_MS);
  };

  let full: number | null = null;
  if (input.loaded) {
    const last = steps[steps.length - 1]![0];
    full = last + (1 - at(last)) * BAR_MS;
  }

  return {part: at(input.t), full};
}

// Today's totals as the stat bar reads them: nothing when today has no lines.
const todayOf = (input: OpeningInput) => {
  const today = input.today;
  return today && today.added + today.removed > 0 ? today : null;
};

// When the totals appear beside the finished stat bar, or the bar is full
// when there is nothing to flip it into.
function tDone(input: OpeningInput): number | null {
  const {full} = bar(input);
  if (full === null) return null;
  return todayOf(input) ? full + (barCells(input.cols) - 1) * OPENING.STAT_MS : full;
}

// When the card is finished and has held: t >= tPushStart(input). Null while
// the commits are still being measured, because until then there is no end.
export function tPushStart(input: OpeningInput): number | null {
  const done = tDone(input);
  return done === null ? null : done + OPENING.HOLD;
}

// The card, `height` rows, for time t. The rows are laid out the way
// splashLines lays them out, a third of the way down with the name centred,
// so a pane that skips the opening draws its card in the same place.
export function openingCard(input: OpeningInput): Line[] {
  const {cols, height, t} = input;
  const {T0, ROW_MS, FLIP, READ, BAR, STAT_MS} = OPENING;
  const {rows: name, left} = nameRows(cols);
  const typed = nameRows(cols, 'add').rows;
  const nameW = widthOf(name[0] ?? []);
  // The screen column of the name's left edge: the margin, then the indent.
  const x0 = 1 + left;
  const total = cols - 1;
  const row = (segs: Seg[]): Line => pageRow(cols, [sp(left), ...segs]);
  const blank = pageRow(cols);
  const mark = (line: Line, at: number, over: Seg): Line => ({...line, segs: overlay(line.segs, at, [over], total)});

  // The name, one row at a time. A row being added is a diff line: a `+` two
  // columns out and its cells typed across in the add colours. Before the
  // first one, the caret blinks where it will start.
  const nameLines = name.map((settled, r): Line => {
    const start = T0 + r * ROW_MS;
    if (t < start) {
      const on = r === 0 && Math.floor(t / BLINK_MS) % 2 === 0;
      return on ? mark(blank, x0, seg(glyph.bar, theme.accent)) : blank;
    }

    if (t >= start + FLIP) return row(settled);
    const k = Math.floor(((t - start) / FLIP) * nameW);
    return mark(row(slice(typed[r]!, 0, k)), Math.max(0, x0 - 2), seg(glyph.plus, theme.add));
  });

  const read = t >= READ;
  const readout: Seg[] = !read ? [] : readoutSegs(input);
  const where: Seg[] = !read ? [] : whereSegs(input.folder, input.branch);

  let meter: Seg[] = [];
  if (t >= BAR) {
    const n = barCells(cols);
    const {part, full} = bar(input);
    const today = todayOf(input);
    if (full === null || t < full) {
      meter = thinMeter(n, part, theme.accent);
    } else if (!today) {
      meter = [seg('no changes today', theme.dim)];
    } else {
      // Git's own stat bar: the share of today's lines that were added, in
      // pluses, and the rest in minuses, flipped in one cell at a time from
      // the full bar.
      const plus = today.removed ? Math.round((n * today.added) / (today.added + today.removed)) : n;
      const flipped = Math.min(n, Math.floor((t - full) / STAT_MS) + 1);
      const cells = Array.from({length: n}, (_, i): Seg => {
        if (i >= flipped) return seg(glyph.heavy, theme.accent);
        return i < plus ? seg(glyph.plus, theme.add) : seg(glyph.minus, theme.del);
      });
      const totals: Seg[] =
        flipped < n
          ? []
          : [
              sp(2),
              ...(today.added ? [seg(`${glyph.plus}${num(today.added)}`, theme.add)] : []),
              ...(today.added && today.removed ? [sp(1)] : []),
              ...(today.removed ? [seg(`${glyph.minus}${num(today.removed)}`, theme.del)] : []),
            ];
      meter = [...cells, ...totals];
    }
  }

  // The name, a blank row, then the card's own three: readout, bar, where.
  const card: Line[] = [...nameLines, blank, row(readout), row(meter), row(where)];
  const lead = Math.min(Math.floor(height / 3), Math.max(0, height - card.length - 2));
  return Array.from({length: height}, (_, i) => card[i - lead] ?? blank);
}

// What the read has found. Before the transcripts are in, one readdir is all
// it knows, so it says how many it is opening.
function readoutSegs(input: OpeningInput): Seg[] {
  const {counts, loaded, frame} = input;
  const chats = counts?.chats ?? input.chats;
  if (counts && chats) {
    const {turns, agents} = counts;
    return [seg(`${plural(chats, 'chat')}   ${plural(turns, 'turn')}   ${plural(agents, 'agent')}`, theme.text)];
  }

  if (counts && loaded) return [seg('no chats yet', theme.text)];
  return [
    seg(spinner(frame), theme.accent),
    seg(chats ? ` reading ${plural(chats, 'chat')}${glyph.ellipsis}` : ` reading${glyph.ellipsis}`, theme.dim),
  ];
}

// The body during the push: k = floor((t - tPushStart) / PUSH_STEP) rows of
// Home have arrived from the top, the card sits k rows lower and is clipped at
// the bottom, and the caret sits on row k, where the next row will go in.
// Exactly `height` rows. `done` once every row of Home is in.
export function openingPush(input: OpeningInput, home: Line[]): {lines: Line[]; done: boolean} {
  const start = tPushStart(input);
  const card = openingCard(input);
  if (start === null || input.t < start) return {lines: card, done: false};

  const {cols, height} = input;
  const k = Math.floor((input.t - start) / OPENING.PUSH_STEP);
  const done = k > home.length;
  const blank = pageRow(cols);
  const lines = [...home.slice(0, k), ...card].slice(0, height);
  while (lines.length < height) lines.push(blank);
  if (!done && k < height) {
    const under = lines[k]!;
    lines[k] = {...under, segs: overlay(under.segs, 1, [seg(glyph.bar, theme.accent)], cols - 1)};
  }

  return {lines, done};
}
