import {
  cacheHitOf, modelName, paceOf, paceOutlook, shareByModel, splitBySub, windowOf,
  type Limits, type Share, type Spend, type SubSplit, type Window,
} from '../../core/usage';
import {
  bigDigits, bigWidth, lowerMeter, meterTone, pageRow, panelInner, panelRow, panelTitle,
  seg, sp, span, thinMeter, tokens, width, widthOf, type Line, type Seg,
} from '../cells';
import {glyph, modelColours, theme} from '../theme';
import {fit as fitText, wrap} from '../util';

// Three sections, each answering one question: what is left of this session and
// where its pace is heading, where the week's tokens went, and what this chat is
// carrying. Each one gets a panel: a run of rows on one background. The panel is
// what makes the rest honest — it gives the section a left and a right edge, so
// a value can be right-aligned against something, and it gives a meter ground,
// so the part that is still free can go quiet instead of reading as a second
// solid bar. Nothing pads it: a panel is title strip then rows, and the only
// blank row in the view is the unpainted one between two panels.
//
// Two kinds of number live here and the view keeps them apart. Tokens are
// counted from the transcripts, so they are always there. The plan limits only
// exist if a status line script is feeding them, and without that feed the view
// shows what it counted and never guesses a percentage. There are exactly two
// limits in that feed, the 5 hour window and the week, and no per-model one, so
// a model's figure is a share of the week's tokens and is labelled as one.

export type UsageInput = {
  cols: number;
  now: number;
  spends: Spend[] | null;
  limits: Limits | null;
  // The chat in this project that is furthest along.
  context: {tokens: number; model: string; chat?: string} | null;
};

const STALE_MS = 15 * 60_000;

// Four columns for a percentage, so `9%` and `100%` end in the same column and
// a column of values reads as a column.
const PCT_W = 4;

// The one separator between facts on a row.
const sep = (): Seg => seg(`  ${glyph.sep}  `, theme.faint);

// The right-hand value: the figure is the one thing on a body row allowed any
// weight, and the word after it says what the figure is a share of.
const value = (figure: string, of: string): Seg[] => [
  seg(figure.padStart(PCT_W), theme.ink, {bold: true}),
  seg(` ${of}`, theme.dim),
];

// A heading inside a panel's body. Like a title strip, it would rather lose
// what it is counting than be cut off mid-word, and the legend on its right
// only belongs there while the thing it names is on screen.
function heading(cols: number, name: string, note: string, right: Seg[] = []): Line {
  const wide = widthOf(right);
  const room = panelInner(cols) - width(name) - (wide ? wide + 1 : 0);
  return panelRow(
    cols,
    [seg(name, theme.ink), ...(width(note) + 3 <= room ? [seg(`   ${note}`, theme.dim)] : [])],
    right,
  );
}

// A reading describes a window, so it is good until that window resets. Once
// the script has been quiet for a while it is drawn dim, not dropped.
export type Feed = {limits: Limits; stale: boolean};

const live = (win: Window | null, now: number): Window | null => (win && win.resetsAt > now ? win : null);

export function feedOf(limits: Limits | null, now: number): Feed | null {
  if (!limits || (!live(limits.fiveHour, now) && !live(limits.sevenDay, now))) return null;
  return {limits, stale: now - limits.at >= STALE_MS};
}

const clock = (at: number): string =>
  new Date(at).toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit', hour12: false});

function when(at: number, now: number): string {
  if (at - now < 20 * 3_600_000) return `at ${clock(at)}`;
  return `${new Date(at).toLocaleDateString(undefined, {weekday: 'long'})} ${clock(at)}`;
}

const pct = (part: number): string => `${Math.round(part * 100)}%`;

// A share that rounds to nothing is not nothing: it had some of the tokens.
const sharePct = (part: number): string => (part > 0 && part < 0.005 ? '<1%' : pct(part));

// A panel is its title strip and its rows, with nothing between them. A section
// that had nothing to say draws no strip either.
const panel = (title: Line, body: Line[]): Line[] => (body.length ? [title, ...body] : []);

// The one meter grammar in this view: a heading with its value on the right,
// the line, one dim note. Every real limit is drawn this way.
function limitBlock(cols: number, name: string, part: number, note: string, stale: boolean): Line[] {
  return [
    panelRow(cols, [seg(name, theme.ink)], value(pct(part), 'used')),
    panelRow(cols, thinMeter(panelInner(cols), part, stale ? theme.dim : meterTone(part), theme.track)),
    ...(note ? [panelRow(cols, [seg(note, theme.dim)])] : []),
  ];
}

// The big number, which is the Session panel's heading, with the two facts about
// the reset right-aligned against rows one and two and the word for what is
// being counted after the digits on row three.
//
// When it will not fit, it gives way in steps rather than being cut: full size
// first; then the `~` as ordinary text on the middle row, which buys back the
// widest glyph in the font and keeps the digits their size; then half size. Only
// once none of those leaves room for the facts do they drop out of the rows and
// come back as notes under the meter.
function heroRows(
  cols: number,
  text: string,
  label: string,
  color: string,
  rights: string[],
): {rows: Line[]; notes: string[]} {
  const inner = panelInner(cols);
  const bare = text.startsWith('~') ? text.slice(1) : text;
  const tries = [
    {text, scale: 2, tilde: false},
    {text: bare, scale: 2, tilde: bare !== text},
    {text, scale: 1, tilde: false},
    {text: bare, scale: 1, tilde: bare !== text},
  ];
  const lead = (t: {tilde: boolean}): number => (t.tilde ? 2 : 0);
  const room = Math.max(0, ...rights.map(width));
  const pickWith = (reserve: number) => tries.find(t => bigWidth(t.text, t.scale) + lead(t) + reserve <= inner);
  const beside = room ? pickWith(room + 2) : undefined;
  const pick = beside ?? pickWith(0) ?? tries[tries.length - 1]!;
  const took = bigWidth(pick.text, pick.scale) + lead(pick);
  const rows = bigDigits(pick.text, color, {bg: theme.surface, scale: pick.scale});
  const tail = label && took + 2 + width(label) <= inner ? [sp(2, theme.surface), seg(label, theme.dim)] : [];
  return {
    rows: rows.map((segs, i) => {
      const front = pick.tilde ? (i === 1 ? [seg('~', theme.dim), sp(1, theme.surface)] : [sp(2, theme.surface)]) : [];
      const right = beside && rights[i] ? [seg(rights[i]!, theme.dim)] : [];
      return panelRow(cols, [...front, ...segs, ...(i === 2 ? tail : [])], right);
    }),
    notes: beside ? [] : rights,
  };
}

// The pace rows, which live inside the Session panel: tokens per half hour over
// the last five hours, the half hour we are in now in accent, and — when a
// reading says how much of the allowance is gone — where that pace lands.
//
// A bar is two columns with one of air beside it at every width, so the chart
// has the same shape in a 40 column pane as in a wide one. What gives way is
// the projection first, then the bar.
function paceRows(cols: number, spends: Spend[], five: Window | null, now: number): Line[] {
  const inner = panelInner(cols);
  const pace = paceOf(spends, now);
  const past = pace.buckets;
  if (!past.some(n => n > 0)) return [];

  // The next half hours at the current pace: the mean of the last two half
  // hours that had tokens in them, so one quiet bucket does not flatten it.
  const recent = past.filter(n => n > 0).slice(-2);
  const rate = recent.reduce((a, n) => a + n, 0) / recent.length;
  const wanted = five && rate > 0 ? 2 : 0;
  const plans = [
    {bar: 2, gap: 1, ahead: wanted},
    {bar: 2, gap: 1, ahead: 0},
    {bar: 1, gap: 1, ahead: 0},
    {bar: 1, gap: 0, ahead: 0},
  ];
  const chart = (p: {bar: number; gap: number; ahead: number}): number => {
    const count = past.length + p.ahead;
    return count * p.bar + (count - 1) * p.gap;
  };

  const plan = plans.find(p => chart(p) <= inner) ?? plans[plans.length - 1]!;
  const amounts = [...past, ...Array.from({length: plan.ahead}, () => rate)];
  const peak = Math.max(1, ...amounts);
  const ROWS = 3;

  const legend = plan.ahead
    ? [seg(glyph.square, theme.dim), seg(' used  ', theme.dim), seg(glyph.square, theme.warn), seg(' projected', theme.dim)]
    : [];
  const body: Line[] = [heading(cols, 'Pace', 'tokens per half hour', legend)];
  for (let level = ROWS - 1; level >= 0; level--) {
    const segs: Seg[] = [];
    amounts.forEach((amount, i) => {
      const eighths = Math.round((amount / peak) * ROWS * 8);
      const here = Math.max(0, Math.min(8, eighths - level * 8));
      // A floor under an idle half hour, so the time axis stays readable.
      const char = level === 0 && here === 0 ? glyph.columns[1]! : glyph.columns[here]!;
      const colour =
        i >= past.length ? theme.warn : i === past.length - 1 ? theme.accent : amount ? theme.dim : theme.faint;
      if (i) segs.push(sp(plan.gap));
      segs.push(seg(char.repeat(plan.bar), colour));
    });
    body.push(panelRow(cols, segs));
  }

  const done = past.length * plan.bar + (past.length - 1) * plan.gap;
  const from = clock(pace.from);
  body.push(panelRow(cols, [seg(from, theme.faint), sp(Math.max(1, done - width(from) - 3)), seg('now', theme.accent)]));

  const outlook = five ? paceOutlook(five, now) : null;
  if (outlook) {
    const text =
      outlook.kind === 'limit'
        ? `At this pace you reach the limit around ${clock(outlook.at)}, ${outlook.minutes} minutes before it resets.`
        : `At this pace you end the window at about ${pct(outlook.part)}.`;
    const tone = outlook.kind === 'limit' ? theme.warn : theme.dim;
    body.push(...wrap(text, inner).map(line => panelRow(cols, [seg(line, tone)])));
  }

  return body;
}

// Panel one. With a feed the big number is the share of the allowance that is
// gone; without one it is what the window has cost, counted from the
// transcripts. Either way the pace rows follow it inside the same panel.
function sessionRows(cols: number, spends: Spend[], reading: boolean, feed: Feed | null, now: number): Line[] {
  const inner = panelInner(cols);
  const strip = (right: string, faint = false): Line =>
    panelTitle(cols, 'Session', '5 hour window', right ? [seg(right, faint ? theme.faint : theme.dim)] : []);
  const note = (text: string): Line => panelRow(cols, [seg(text, theme.dim)]);

  const five = feed ? live(feed.limits.fiveHour, now) : null;
  if (feed && five) {
    const part = five.usedPercentage / 100;
    const tone = feed.stale ? theme.dim : meterTone(part);
    const hero = heroRows(cols, pct(part), 'used', tone, [`resets in ${span(five.resetsAt - now)}`, when(five.resetsAt, now)]);
    return panel(strip(feed.stale ? 'feed quiet' : '', true), [
      ...hero.rows,
      panelRow(cols, lowerMeter(inner, part, tone, theme.track)),
      ...hero.notes.map(note),
      // A stale reading is not a pace: it is a photograph of one.
      ...paceRows(cols, spends, feed.stale ? null : five, now),
    ]);
  }

  if (feed) {
    return panel(strip('feed quiet', true), [
      note('Feed quiet: no session reading.'),
      ...paceRows(cols, spends, null, now),
    ]);
  }

  // No feed. Claude Code hands the allowance to a status line script and
  // nowhere else, so the only honest number here is the one we counted.
  const hint = wrap('For percentages, run: npm run connect', inner).map(text =>
    panelRow(cols, [seg(text, theme.faint)]),
  );
  const win = reading ? null : windowOf(spends, now);
  if (!win) {
    return panel(strip(reading ? 'reading…' : 'new tokens, estimated', reading), [
      note(reading ? 'Reading your transcripts…' : 'Nothing in the last 5 hours.'),
      ...(reading ? [] : hint),
    ]);
  }

  const hero = heroRows(cols, `~${tokens(win.tokens)}`, '', theme.ink, [
    `resets in about ${span(win.resetsAt - now)}`,
    when(win.resetsAt, now),
  ]);
  return panel(strip('new tokens, estimated'), [
    ...hero.rows,
    ...hero.notes.map(note),
    ...paceRows(cols, spends, null, now),
    ...hint,
  ]);
}

// One colour a model, held by the model's name and handed out in name order, so
// a model keeps the same hue in its own line, in the stacked bar and in the
// legend, and keeps it when the shares move around.
function coloursOf(shares: Share[]): Map<string, string> {
  const names = [...new Set(shares.map(share => modelName(share.model)))].sort();
  return new Map(names.map((name, i) => [name, modelColours[i % modelColours.length]!]));
}

// The model the chat is on, against the week's tokens. It has no limit of its
// own — there is no per-model limit in anything Claude Code exposes — so the
// figure is a share and says so, and the line is the model's own colour.
function modelRow(cols: number, name: string, part: number, colour: string): Line[] {
  return [
    panelRow(cols, [seg(name, theme.ink)], value(sharePct(part), 'of tokens')),
    panelRow(cols, thinMeter(panelInner(cols), part, colour, theme.track)),
  ];
}

// Every model at once, as one bar the width of the panel. Largest remainder, so
// the slices add up to the bar exactly and a model with tokens always shows.
function stackRow(cols: number, shares: Share[], colours: Map<string, string>): Line {
  const inner = panelInner(cols);
  const want = shares.map(share => share.part * inner);
  const cells = want.map(n => Math.max(1, Math.floor(n)));
  const order = want.map((_, i) => i).sort((a, b) => (want[b]! % 1) - (want[a]! % 1));
  let left = inner - cells.reduce((a, n) => a + n, 0);
  for (let i = 0; left > 0; i++, left--) cells[order[i % order.length]!]!++;
  // The floors can overrun the bar when several models round up to their one
  // column; the widest slice is the one that can spare a column.
  while (left < 0) {
    const big = cells.indexOf(Math.max(...cells));
    if (cells[big]! <= 1) break;
    cells[big]!--;
    left++;
  }

  return panelRow(
    cols,
    cells.map((n, i) => seg(glyph.lower.repeat(n), colours.get(modelName(shares[i]!.model))!)),
  );
}

// The legend that names the slices, in fixed cells so the chips line up down
// the rows: three across a wide panel, two across a narrow one.
function legendRows(cols: number, shares: Share[], colours: Map<string, string>): Line[] {
  const inner = panelInner(cols);
  const per = inner >= 54 ? 3 : 2;
  const cell = Math.floor(inner / per);
  const rows: Line[] = [];
  for (let i = 0; i < shares.length; i += per) {
    const segs: Seg[] = [];
    for (const share of shares.slice(i, i + per)) {
      const name = modelName(share.model);
      const figure = sharePct(share.part);
      const chip = [
        seg(glyph.square, colours.get(name)!),
        seg(` ${fitText(name, cell - 4 - width(figure))} `, theme.text),
        seg(figure, theme.dim),
      ];
      segs.push(...chip, sp(Math.max(0, cell - widthOf(chip))));
    }

    rows.push(panelRow(cols, segs));
  }

  return rows;
}

// The whole subagent story in one line. No per-agent list lives here: that
// belongs to the Agents view. The `main thread` half goes first when the pane
// is narrow, then the counts; the share never does.
function subRow(cols: number, split: SubSplit): Line {
  const inner = panelInner(cols);
  const segs: Seg[] = [seg('Subagents ', theme.text), seg(pct(split.part), theme.ink, {bold: true})];
  const add = (text: string) => {
    if (widthOf(segs) + 5 + width(text) <= inner) segs.push(sep(), seg(text, theme.dim));
  };

  add(`${tokens(split.sub)} of ${tokens(split.total)}`);
  add(`main thread ${tokens(split.main)}`);
  return panelRow(cols, segs);
}

// Panel two. A feed's 7 day window is a real week with a real reset, so with
// one this is "This week"; without one it is a rolling seven days from the
// transcripts and says so, and loses the limit it cannot know.
function weekRows(cols: number, spends: Spend[], reading: boolean, feed: Feed | null, now: number, model?: string): Line[] {
  const week = feed ? live(feed.limits.sevenDay, now) : null;
  const total = spends.reduce((n, s) => n + s.tokens, 0);
  const title = week
    ? panelTitle(cols, 'This week', '')
    : panelTitle(cols, 'Last 7 days', '', [
        reading ? seg('reading…', theme.faint) : seg(`${tokens(total)} new tokens`, theme.dim),
      ]);

  const body: Line[] = week
    ? limitBlock(cols, 'All models', week.usedPercentage / 100, `resets ${when(week.resetsAt, now)}`, feed!.stale)
    : [];

  const shares = shareByModel(spends).slice(0, 5);
  if (!shares.length) {
    body.push(panelRow(cols, [seg(reading ? 'Reading your transcripts…' : 'Nothing in the last 7 days.', theme.dim)]));
    return panel(title, body);
  }

  // The chat's own model if it is in there, otherwise whichever spent most.
  const colours = coloursOf(shares);
  const mine = (model && shares.find(share => share.model === model)) || shares[0]!;
  body.push(...modelRow(cols, modelName(mine.model), mine.part, colours.get(modelName(mine.model))!));
  body.push(heading(cols, 'By model', "share of this week's tokens"));
  body.push(stackRow(cols, shares, colours), ...legendRows(cols, shares, colours));
  const split = splitBySub(spends);
  if (split.sub) body.push(subRow(cols, split));
  return panel(title, body);
}

// Panel three. How full this chat's context window is, and how much of what it
// sends comes back out of the cache.
function chatRows(cols: number, input: UsageInput, spends: Spend[], feed: Feed | null): Line[] {
  const chat = input.context;
  if (!chat) return [];
  const inner = panelInner(cols);
  const title = panelTitle(cols, 'This chat', modelName(chat.model));
  const hit = cacheHitOf(spends, chat.chat);
  const note = hit === null ? '' : `cache hit ${pct(hit)}`;
  // Only the feed knows how big the window is; without it we have the tokens.
  const size = feed ? feed.limits.contextSize : null;
  if (size) {
    const part = Math.min(1, chat.tokens / size);
    const facts: Seg[] = [seg(`${tokens(chat.tokens)} of ${tokens(size)} tokens`, theme.dim)];
    if (note && widthOf(facts) + 5 + width(note) <= inner) facts.push(sep(), seg(note, theme.dim));
    return panel(title, [...limitBlock(cols, 'Context', part, '', feed!.stale), panelRow(cols, facts)]);
  }

  return panel(title, [
    panelRow(cols, [seg('Context', theme.ink)], [seg(`${tokens(chat.tokens)} tokens`, theme.ink, {bold: true})]),
    ...(note ? [panelRow(cols, [seg(note, theme.dim)])] : []),
  ]);
}

export function usageLines(input: UsageInput): Line[] {
  const {cols, now} = input;
  const spends = input.spends ?? [];
  const reading = input.spends === null;
  const feed = feedOf(input.limits, now);
  const gap = pageRow(cols);
  const panels = [
    sessionRows(cols, spends, reading, feed, now),
    weekRows(cols, spends, reading, feed, now, input.context?.model),
    chatRows(cols, input, spends, feed),
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
