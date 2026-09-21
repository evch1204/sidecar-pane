import {
  cacheHitOf, modelName, paceOf, shareByModel, splitBySub, windowOf,
  type Limits, type SessionWindow, type Spend, type Window,
} from '../../core/usage';
import {
  bigDigits, INDENT, lowerMeter, meterTone, pageRow, RIGHT_PAD, seg, sp, span, tokens,
  type Line, type Seg,
} from '../cells';
import {glyph, theme} from '../theme';

// Three sections, each answering one question: what is left of this session,
// where the last seven days went, and what this chat is carrying.
//
// Two kinds of number live here and the view keeps them apart. Tokens are
// counted from the transcripts, so they are always there. The plan limits only
// exist if a status line script is feeding them, and without that feed the view
// shows what it counted and never guesses a percentage.

export type UsageInput = {
  cols: number;
  now: number;
  spends: Spend[] | null;
  limits: Limits | null;
  // The chat in this project that is furthest along.
  context: {tokens: number; model: string; chat?: string} | null;
};

const STALE_MS = 15 * 60_000;
const SHARE_COLOURS = [theme.accent, theme.link, theme.string, theme.keyword, theme.warn];

// The one separator between facts on a row.
const sep = (): Seg => seg(`  ${glyph.sep}  `, theme.faint);

// A reading describes a window, so it is good until that window resets. Once
// the script has been quiet for a while it is drawn dim, not dropped.
export type Feed = {limits: Limits; stale: boolean};

const live = (win: Window | null, now: number): Window | null => (win && win.resetsAt > now ? win : null);

export function feedOf(limits: Limits | null, now: number): Feed | null {
  if (!limits || (!live(limits.fiveHour, now) && !live(limits.sevenDay, now))) return null;
  return {limits, stale: now - limits.at >= STALE_MS};
}

// Everything inside a section is indented to the content column.
const bodyWidth = (cols: number): number => cols - 2 - RIGHT_PAD - INDENT;
const row = (cols: number, left: Seg[] = [], right: Seg[] = []): Line => pageRow(cols, [sp(INDENT), ...left], right);

const section = (cols: number, name: string, note: string, right: Seg[] = []): Line =>
  pageRow(cols, [seg(name, theme.ink, {bold: true}), seg(`   ${note}`, theme.dim)], right);

function when(at: number, now: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit', hour12: false});
  if (at - now < 20 * 3_600_000) return `at ${time}`;
  return `${date.toLocaleDateString(undefined, {weekday: 'short'})} ${time}`;
}

const pct = (part: number): string => `${Math.round(part * 100)}%`;

// Tokens per half hour over the last five hours: two columns a bucket, the
// half hour we are in now in accent, the ones before it dim.
function paceRows(cols: number, spends: Spend[], reading: boolean, now: number): Line[] {
  const pace = paceOf(spends, now);
  const tallest = Math.max(0, ...pace.buckets);
  const peak = Math.max(1, tallest);
  const ROWS = 3;
  const grid = pace.buckets.length * 3 - 1;
  const note = reading ? 'reading…' : tallest ? `peak ${tokens(tallest)}` : 'idle';
  const out: Line[] = [
    row(cols, [seg('Pace', theme.ink), seg('   new tokens per half hour', theme.dim)], [seg(note, theme.faint)]),
  ];

  for (let level = ROWS - 1; level >= 0; level--) {
    const segs: Seg[] = [];
    pace.buckets.forEach((value, i) => {
      const eighths = Math.round((value / peak) * ROWS * 8);
      const here = Math.max(0, Math.min(8, eighths - level * 8));
      // Even an idle half hour keeps a floor, so the time axis stays readable.
      const char = level === 0 && here === 0 ? glyph.columns[1]! : glyph.columns[here]!;
      const colour = i === pace.buckets.length - 1 ? theme.accent : value ? theme.dim : theme.rule;
      segs.push(seg(char.repeat(2), colour), sp(1));
    });
    out.push(row(cols, segs));
  }

  const from = new Date(pace.from).toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit', hour12: false});
  out.push(row(cols, [seg(from, theme.faint), sp(grid - from.length - 3), seg('now', theme.faint)]));
  return out;
}

// Section one. With a feed this is the share of the allowance that is gone;
// without one it is what the window has cost, counted from the transcripts.
function sessionRows(cols: number, spends: Spend[], reading: boolean, feed: Feed | null, now: number): Line[] {
  const wide = bodyWidth(cols);
  const five = feed ? live(feed.limits.fiveHour, now) : null;
  if (feed && five) {
    const part = five.usedPercentage / 100;
    const ink = feed.stale ? theme.dim : theme.ink;
    return [
      section(cols, 'Session', feed.stale ? '5 hour window, feed quiet' : '5 hour window', [
        seg('resets in ', theme.dim),
        seg(span(five.resetsAt - now), ink, {bold: true}),
      ]),
      pageRow(cols, [], [seg(when(five.resetsAt, now), theme.dim)]),
      ...bigDigits(pct(part), ink).map(segs => row(cols, segs)),
      row(cols, lowerMeter(wide, part, feed.stale ? theme.dim : meterTone(part))),
    ];
  }

  // No feed. Claude Code hands the allowance to a status line script and
  // nowhere else, so the only honest number here is the one we counted.
  const win: SessionWindow | null = reading ? null : windowOf(spends, now);
  const hint = seg(
    feed ? 'The limits feed has gone quiet.' : 'Set hooks/statusline.mjs as your status line for limits.',
    theme.dim,
  );
  if (!win) {
    return [
      section(cols, 'Session', reading ? 'reading…' : '5 hour window', []),
      row(cols, [seg(reading ? 'Reading your transcripts…' : 'No replies in the last five hours.', theme.dim)]),
      row(cols, [hint]),
    ];
  }

  return [
    section(cols, 'Session', 'estimated from your transcripts', [
      seg('resets in ', theme.dim),
      seg('~', theme.faint),
      seg(span(win.resetsAt - now), theme.ink, {bold: true}),
    ]),
    ...bigDigits(`~${tokens(win.tokens)}`).map(segs => row(cols, segs)),
    row(cols, [hint]),
  ];
}

// Section two. The count is a rolling seven days from the transcripts; only a
// feed knows about a real weekly allowance and when it resets.
function weekRows(cols: number, spends: Spend[], reading: boolean, feed: Feed | null, now: number): Line[] {
  const wide = bodyWidth(cols);
  const total = spends.reduce((n, s) => n + s.tokens, 0);
  const out: Line[] = [
    section(cols, 'Last 7 days', 'all projects', [seg(reading ? 'reading…' : `${tokens(total)} new tokens`, reading ? theme.faint : theme.dim)]),
  ];

  const week = feed ? live(feed.limits.sevenDay, now) : null;
  if (feed && week) {
    const part = week.usedPercentage / 100;
    out.push(row(cols, lowerMeter(wide, part, feed.stale ? theme.dim : meterTone(part))));
    out.push(row(cols, [seg(`${pct(part)} of the weekly limit`, theme.dim), sep(), seg(`resets ${when(week.resetsAt, now)}`, theme.dim)]));
  }

  const shares = shareByModel(spends).slice(0, SHARE_COLOURS.length);
  out.push(row(cols, [seg('By model', theme.ink), seg('   share of new tokens, cache reads excluded', theme.dim)]));
  if (!shares.length) {
    out.push(row(cols, [seg(reading ? 'Reading transcripts…' : 'No replies in the last 7 days.', theme.dim)]));
    return out;
  }

  // One stacked bar: a colour a model, widest first, nothing rounded away.
  const cells = shares.map(s => Math.max(1, Math.round(s.part * wide)));
  cells[0] = Math.max(1, wide - cells.slice(1).reduce((a, n) => a + n, 0));
  out.push(row(cols, shares.map((_, i) => seg(glyph.lower.repeat(cells[i]!), SHARE_COLOURS[i]))));
  const half = Math.floor(wide / 2);
  for (let i = 0; i < shares.length; i += 2) {
    const cell = (n: number): Seg[] => {
      const share = shares[n];
      if (!share) return [];
      const made = [seg(glyph.square, SHARE_COLOURS[n]), seg(` ${modelName(share.model)} `, theme.text), seg(pct(share.part), theme.dim)];
      return [...made, sp(half - made.reduce((w, s) => w + s.text.length, 0))];
    };

    out.push(row(cols, [...cell(i), ...cell(i + 1)]));
  }

  // The whole subagent story in one line: no per-agent list lives here.
  const split = splitBySub(spends);
  if (split.sub) {
    out.push(row(cols, [
      seg('Subagents ', theme.text),
      seg(pct(split.part), theme.ink),
      sep(),
      seg(`${tokens(split.sub)} of ${tokens(split.total)}`, theme.dim),
      sep(),
      seg(`main thread ${tokens(split.main)}`, theme.dim),
    ]));
  }

  return out;
}

// Section three. How full this chat's context window is, and how much of what
// it sends comes back out of the cache.
function chatRows(cols: number, input: UsageInput, spends: Spend[], feed: Feed | null): Line[] {
  const chat = input.context;
  if (!chat) return [];
  const wide = bodyWidth(cols);
  // Only the feed knows how big the window is; without it we have the tokens.
  const size = feed ? feed.limits.contextSize : null;
  const part = size ? Math.min(1, chat.tokens / size) : null;
  const out: Line[] = [section(cols, 'This chat', modelName(chat.model))];
  const label = 'Context  ';
  if (part !== null) {
    out.push(row(
      cols,
      [seg(label, theme.dim), ...lowerMeter(wide - label.length - 6, part, part >= 0.8 ? theme.warn : theme.link)],
      [seg(pct(part), theme.ink, {bold: true})],
    ));
  }

  const facts: Seg[] = [seg(size ? `${tokens(chat.tokens)} of ${tokens(size)} tokens` : `${tokens(chat.tokens)} tokens in context`, theme.dim)];
  const hit = cacheHitOf(spends, chat.chat);
  if (hit !== null) facts.push(sep(), seg(`cache hit ${pct(hit)}`, theme.dim));
  out.push(row(cols, facts));
  return out;
}

export function usageLines(input: UsageInput): Line[] {
  const {cols, now} = input;
  const spends = input.spends ?? [];
  const reading = input.spends === null;
  const feed = feedOf(input.limits, now);
  const blank = pageRow(cols);
  const out = [
    ...sessionRows(cols, spends, reading, feed, now),
    blank,
    ...paceRows(cols, spends, reading, now),
    blank,
    ...weekRows(cols, spends, reading, feed, now),
    blank,
    ...chatRows(cols, input, spends, feed),
  ];
  // A section that had nothing to say must not leave a gap at the bottom.
  while (out[out.length - 1] === blank) out.pop();
  return out;
}

// How much of the bar the meters may have. Phase 3 shrinks them in steps.
export type ExtrasRoom = 'full' | 'noWeek' | 'plain';

// The meters at the right end of the menu bar. With a feed they are the real
// allowance; without one they are the window counted from the transcripts,
// marked `~` so it never reads as a limit.
export function usageExtras(
  limits: Limits | null,
  now: number,
  more: {spends?: Spend[] | null; room?: ExtrasRoom} = {},
): Seg[] {
  const room = more.room ?? 'full';
  const feed = feedOf(limits, now);
  const five = feed ? live(feed.limits.fiveHour, now) : null;
  const thin = (): Seg => seg(` ${glyph.sep} `, theme.faint);
  if (feed && five) {
    const part = five.usedPercentage / 100;
    const ink = feed.stale ? theme.dim : theme.text;
    const out: Seg[] = [seg('5h ', theme.dim)];
    if (room !== 'plain') out.push(...lowerMeter(6, part, feed.stale ? theme.dim : meterTone(part)), sp(1));
    out.push(seg(pct(part), ink), thin(), seg(span(five.resetsAt - now), ink));
    const week = live(feed.limits.sevenDay, now);
    if (week && room === 'full') out.push(sp(2), seg('wk ', theme.dim), seg(pct(week.usedPercentage / 100), ink));
    return out;
  }

  const win = windowOf(more.spends ?? [], now);
  if (!win) return [];
  return [
    seg('5h ', theme.dim),
    seg('~', theme.faint),
    seg(tokens(win.tokens), theme.dim),
    thin(),
    seg('~', theme.faint),
    seg(`${span(win.resetsAt - now)} left`, theme.dim),
  ];
}
