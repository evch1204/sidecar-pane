import {
  cacheHitOf, modelName, paceOf, shareByModel, splitBySub, windowOf,
  type Limits, type SessionWindow, type Spend, type SubSplit, type Window,
} from '../../core/usage';
import {
  bigDigits, bigWidth, lowerMeter, meterTone, pageRow, panelInner, panelRow, panelTitle,
  seg, sp, span, tokens, width, type Line, type Seg,
} from '../cells';
import {glyph, theme} from '../theme';
import {fit as fitText, wrap} from '../util';

// Four sections, each answering one question: what is left of this session,
// where the last seven days went, what this chat is carrying, and how hard the
// last five hours were worked. Each one gets a panel: a run of rows on one
// background. The panel is what makes the rest honest — it gives the section a
// left and a right edge, so a value can be right-aligned against something,
// and it gives a meter ground, so the part that is still free can go quiet
// instead of reading as a second solid bar.
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

// One grid for every body row in every panel: a name column, then whatever the
// row has to show, then the value hard against the right edge. Because the
// columns never move, a column of percentages reads as a column.
const NAME_W = 12;
const VALUE_W = 3;

// The one separator between facts on a row.
const sep = (): Seg => seg(`  ${glyph.sep}  `, theme.faint);

// The right-hand value: the one thing on a body row that is allowed weight.
const value = (text: string): Seg[] => [seg(text.padStart(VALUE_W), theme.ink, {bold: true})];

// A heading inside a panel's body. Like a title strip, it would rather lose
// what it is counting than be cut off mid-word.
function heading(cols: number, name: string, note: string): Line {
  const room = panelInner(cols) - width(name);
  return panelRow(cols, [seg(name, theme.ink), ...(width(note) + 2 <= room ? [seg(`  ${note}`, theme.dim)] : [])]);
}

// A reading describes a window, so it is good until that window resets. Once
// the script has been quiet for a while it is drawn dim, not dropped.
export type Feed = {limits: Limits; stale: boolean};

const live = (win: Window | null, now: number): Window | null => (win && win.resetsAt > now ? win : null);

export function feedOf(limits: Limits | null, now: number): Feed | null {
  if (!limits || (!live(limits.fiveHour, now) && !live(limits.sevenDay, now))) return null;
  return {limits, stale: now - limits.at >= STALE_MS};
}

function when(at: number, now: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit', hour12: false});
  if (at - now < 20 * 3_600_000) return `at ${time}`;
  return `${date.toLocaleDateString(undefined, {weekday: 'short'})} ${time}`;
}

const pct = (part: number): string => `${Math.round(part * 100)}%`;

// A share that rounds to nothing is not nothing: it had some of the tokens.
const sharePct = (part: number): string => (part > 0 && part < 0.005 ? '<1%' : pct(part));

// A title strip, one blank row of ground either side of the body, and nothing
// between panels but a row with no background at all.
const panel = (cols: number, title: Line, body: Line[]): Line[] =>
  body.length ? [title, panelRow(cols), ...body, panelRow(cols)] : [];

// The one meter grammar in this view: a heading with its value on the right,
// the bar, one dim note. Every limit in the pane is drawn this way, and there
// is at most one of them a panel, so two identical bars never stack.
function limitBlock(cols: number, name: string, part: number, note: string, stale: boolean): Line[] {
  return [
    panelRow(cols, [seg(name, theme.ink)], value(pct(part))),
    panelRow(cols, lowerMeter(panelInner(cols), part, stale ? theme.dim : meterTone(part), theme.track)),
    ...(note ? [panelRow(cols, [seg(note, theme.dim)])] : []),
  ];
}

// Digits shout louder than a bar, so they only change colour when there is
// something to say: plain ink until three quarters are gone.
const heroTone = (part: number): string => (part >= 0.9 ? theme.del : part >= 0.75 ? theme.warn : theme.ink);

// The big number, which is the Session panel's heading. Nothing shares its
// rows but the one word that says what it counts.
//
// When it will not fit, it gives way in steps rather than being cut: full size
// first; then the `~` as ordinary text on the middle row, which buys back the
// widest glyph in the font and keeps the digits their size; then half size.
function heroRows(cols: number, text: string, label: string, color: string): Line[] {
  const inner = panelInner(cols);
  const bare = text.startsWith('~') ? text.slice(1) : text;
  const tries = [
    {text, scale: 2, tilde: false},
    {text: bare, scale: 2, tilde: bare !== text},
    {text, scale: 1, tilde: false},
    {text: bare, scale: 1, tilde: bare !== text},
  ];
  const lead = (t: {tilde: boolean}): number => (t.tilde ? 2 : 0);
  const pick = tries.find(t => bigWidth(t.text, t.scale) + lead(t) <= inner) ?? tries[tries.length - 1]!;
  const took = bigWidth(pick.text, pick.scale) + lead(pick);
  const rows = bigDigits(pick.text, color, {bg: theme.surface, scale: pick.scale});
  const tail = label && took + 2 + width(label) <= inner ? [sp(2, theme.surface), seg(label, theme.dim)] : [];
  return rows.map((segs, i) => {
    const front = pick.tilde ? (i === 1 ? [seg('~', theme.dim), sp(1, theme.surface)] : [sp(2, theme.surface)]) : [];
    return panelRow(cols, [...front, ...segs, ...(i === 2 ? tail : [])]);
  });
}

// Panel one. With a feed this is the share of the allowance that is gone;
// without one it is what the window has cost, counted from the transcripts.
function sessionRows(cols: number, spends: Spend[], reading: boolean, feed: Feed | null, now: number): Line[] {
  const inner = panelInner(cols);
  const strip = (right: string, faint = false): Line =>
    panelTitle(cols, 'Session', '5 hour window', right ? [seg(right, faint ? theme.faint : theme.dim)] : []);

  const five = feed ? live(feed.limits.fiveHour, now) : null;
  if (feed && five) {
    const part = five.usedPercentage / 100;
    return panel(cols, strip(feed.stale ? 'feed quiet' : ''), [
      ...heroRows(cols, pct(part), 'used', feed.stale ? theme.dim : heroTone(part)),
      panelRow(cols, lowerMeter(inner, part, feed.stale ? theme.dim : meterTone(part), theme.track)),
      panelRow(cols, [seg(`resets in ${span(five.resetsAt - now)}, ${when(five.resetsAt, now)}`, theme.dim)]),
    ]);
  }

  if (feed) {
    return panel(cols, strip('feed quiet'), [panelRow(cols, [seg('Feed quiet: no session reading.', theme.dim)])]);
  }

  // No feed. Claude Code hands the allowance to a status line script and
  // nowhere else, so the only honest number here is the one we counted. There
  // is one status line slot and it may already be taken, so the instruction is
  // to chain: the script passes the old one's output through.
  const hint = wrap('For a percentage, chain hooks/statusline.mjs', inner).map(text =>
    panelRow(cols, [seg(text, theme.faint)]),
  );
  const win: SessionWindow | null = reading ? null : windowOf(spends, now);
  if (!win) {
    return panel(cols, strip(reading ? 'reading…' : 'new tokens, estimated', reading), [
      panelRow(cols, [seg(reading ? 'Reading your transcripts…' : 'Nothing in the last 5 hours.', theme.dim)]),
      ...(reading ? [] : hint),
    ]);
  }

  return panel(cols, strip('new tokens, estimated'), [
    ...heroRows(cols, `~${tokens(win.tokens)}`, '', theme.ink),
    panelRow(cols, [seg(`resets in about ${span(win.resetsAt - now)}, ${when(win.resetsAt, now)}`, theme.dim)]),
    ...hint,
  ]);
}

// One model, one row. The bar has no track, because a track means "this has a
// limit" and a share has none, and the share lands in the same column as every
// other value in the pane.
function modelRow(cols: number, name: string, part: number): Line {
  const bar = panelInner(cols) - NAME_W - VALUE_W - 3;
  const used = Math.max(1, Math.round(part * bar));
  return panelRow(
    cols,
    [seg(fitText(name, NAME_W).padEnd(NAME_W), theme.text), seg(glyph.lower.repeat(used), theme.dim)],
    value(sharePct(part)),
  );
}

// The whole subagent story in one line, on the same grid. No per-agent list
// lives here: that belongs to the Agents view.
function subRow(cols: number, split: SubSplit): Line {
  const room = panelInner(cols) - NAME_W - VALUE_W - 1;
  const short = `${tokens(split.sub)} of ${tokens(split.total)}`;
  const main = `main thread ${tokens(split.main)}`;
  const facts: Seg[] = width(short) <= room ? [seg(short, theme.dim)] : [];
  if (width(short) + 5 + width(main) <= room) facts.push(sep(), seg(main, theme.dim));
  return panelRow(cols, [seg('Subagents'.padEnd(NAME_W), theme.text), ...facts], value(pct(split.part)));
}

// Panel two. The count is a rolling seven days from the transcripts; only a
// feed knows about a real weekly allowance and when it resets.
function weekRows(cols: number, spends: Spend[], reading: boolean, feed: Feed | null, now: number): Line[] {
  const total = spends.reduce((n, s) => n + s.tokens, 0);
  const title = panelTitle(cols, 'Last 7 days', 'all projects', [
    reading ? seg('reading…', theme.faint) : seg(`${tokens(total)} new tokens`, theme.dim),
  ]);

  const body: Line[] = [];
  const week = feed ? live(feed.limits.sevenDay, now) : null;
  if (feed && week) {
    const part = week.usedPercentage / 100;
    body.push(...limitBlock(cols, 'Weekly limit', part, `resets ${when(week.resetsAt, now)}`, feed.stale));
    body.push(panelRow(cols));
  }

  body.push(heading(cols, 'By model', 'share of new tokens'));
  const shares = shareByModel(spends).slice(0, 5);
  if (!shares.length) {
    body.push(panelRow(cols, [seg(reading ? 'Reading your transcripts…' : 'Nothing in the last 7 days.', theme.dim)]));
    return panel(cols, title, body);
  }

  body.push(...shares.map(share => modelRow(cols, modelName(share.model), share.part)));
  const split = splitBySub(spends);
  if (split.sub) body.push(panelRow(cols), subRow(cols, split));
  return panel(cols, title, body);
}

// Panel three. How full this chat's context window is, and how much of what it
// sends comes back out of the cache.
function chatRows(cols: number, input: UsageInput, spends: Spend[], feed: Feed | null): Line[] {
  const chat = input.context;
  if (!chat) return [];
  const title = panelTitle(cols, 'This chat', modelName(chat.model), []);
  const hit = cacheHitOf(spends, chat.chat);
  const note = hit === null ? '' : `cache hit ${pct(hit)}`;
  // Only the feed knows how big the window is; without it we have the tokens.
  const size = feed ? feed.limits.contextSize : null;
  if (size) {
    const part = Math.min(1, chat.tokens / size);
    const facts: Seg[] = [seg(`${tokens(chat.tokens)} of ${tokens(size)}`, theme.dim)];
    if (note) facts.push(sep(), seg(note, theme.dim));
    return panel(cols, title, [...limitBlock(cols, 'Context', part, '', false), panelRow(cols, facts)]);
  }

  return panel(cols, title, [
    panelRow(cols, [seg('Context', theme.ink)], [seg(`${tokens(chat.tokens)} tokens`, theme.ink, {bold: true})]),
    ...(note ? [panelRow(cols, [seg(note, theme.dim)])] : []),
  ]);
}

// Panel four, and the first to fall off a short pane. Tokens per half hour
// over the last five hours: one column a bucket, the half hour we are in now
// in accent, and a floor under an idle one so the time axis stays readable.
function paceRows(cols: number, spends: Spend[], reading: boolean, now: number): Line[] {
  const inner = panelInner(cols);
  const pace = paceOf(spends, now);
  const count = pace.buckets.length;
  // Two columns of air between bars when there is room for it, otherwise one.
  const gap = inner >= 58 ? 2 : 1;
  const bar = Math.floor((inner - (count - 1) * gap) / count);
  const chart = bar * count + (count - 1) * gap;
  const tallest = Math.max(0, ...pace.buckets);
  const peak = Math.max(1, tallest);
  const ROWS = 3;
  const note = reading
    ? seg('reading…', theme.faint)
    : seg(tallest ? `peak ${tokens(tallest)}` : 'idle', theme.dim);

  const body: Line[] = [];
  for (let level = ROWS - 1; level >= 0; level--) {
    const segs: Seg[] = [];
    pace.buckets.forEach((amount, i) => {
      const eighths = Math.round((amount / peak) * ROWS * 8);
      const here = Math.max(0, Math.min(8, eighths - level * 8));
      const char = level === 0 && here === 0 ? glyph.columns[1]! : glyph.columns[here]!;
      const colour = i === count - 1 ? theme.accent : amount ? theme.dim : theme.faint;
      if (i) segs.push(sp(gap, theme.surface));
      segs.push(seg(char.repeat(bar), colour));
    });
    body.push(panelRow(cols, segs));
  }

  const from = new Date(pace.from).toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit', hour12: false});
  body.push(panelRow(cols, [seg(from, theme.faint), sp(chart - width(from) - 3), seg('now', theme.faint)]));
  return panel(cols, panelTitle(cols, 'Pace', 'new tokens per half hour', [note]), body);
}

export function usageLines(input: UsageInput): Line[] {
  const {cols, now} = input;
  const spends = input.spends ?? [];
  const reading = input.spends === null;
  const feed = feedOf(input.limits, now);
  const gap = pageRow(cols);
  const panels = [
    sessionRows(cols, spends, reading, feed, now),
    weekRows(cols, spends, reading, feed, now),
    chatRows(cols, input, spends, feed),
    paceRows(cols, spends, reading, now),
  ].filter(rows => rows.length);
  // A panel that had nothing to say leaves no gap behind it either.
  return panels.flatMap((rows, i) => (i ? [gap, ...rows] : rows));
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
