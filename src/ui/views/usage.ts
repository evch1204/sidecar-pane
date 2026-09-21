import {modelName, paceOf, shareByModel, type Limits, type Spend, type Window} from '../../core/usage';
import {cardBottom, cardRow, cardTop, meter, meterTone, seg, sp, span, tokens, type Line, type Seg} from '../cells';
import {glyph, theme} from '../theme';
import {wrap} from '../util';

// Two kinds of number live here and the view keeps them apart. Tokens are
// counted from the transcripts, so they are always there. The plan limits only
// exist if the status line script is feeding them, and when it is not the view
// says so rather than drawing an empty meter.

export type UsageInput = {
  cols: number;
  now: number;
  spends: Spend[] | null;
  limits: Limits | null;
  // The chat in this project that is furthest along.
  context: {tokens: number; model: string} | null;
};

const STALE_MS = 15 * 60_000;
const SHARE_COLOURS = [theme.accent, theme.link, theme.string, theme.keyword, theme.warn];

export const fresh = (limits: Limits | null, now: number): limits is Limits => Boolean(limits && now - limits.at < STALE_MS);

function when(at: number, now: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit', hour12: false});
  if (at - now < 20 * 3_600_000) return `at ${time}`;
  return `${date.toLocaleDateString(undefined, {weekday: 'long'})} ${time}`;
}

function limitRows(cols: number, title: string, note: string, win: Window, now: number): Line[] {
  const part = win.usedPercentage / 100;
  const resets = win.resetsAt > now ? `resets in ${span(win.resetsAt - now)}, ${when(win.resetsAt, now)}` : '';
  return [
    cardRow(cols, [seg(title, theme.ink), seg(`  ${note}`, theme.dim)], [seg(`${Math.round(win.usedPercentage)}%`, theme.ink, {bold: true})]),
    cardRow(cols, meter(cols - 4, part, meterTone(part))),
    cardRow(cols, [seg(resets, theme.dim)]),
    cardRow(cols),
  ];
}

// When this pace would reach the 5 hour limit, if that is before it resets.
function projection(limits: Limits, spends: Spend[], now: number): string | null {
  const win = limits.fiveHour;
  if (!win || win.usedPercentage <= 0 || win.usedPercentage >= 100 || win.resetsAt <= now) return null;
  const start = win.resetsAt - 5 * 3_600_000;
  const inWindow = spends.filter(s => s.at >= start).reduce((n, s) => n + s.tokens, 0);
  const lastHour = spends.filter(s => s.at >= now - 3_600_000).reduce((n, s) => n + s.tokens, 0);
  if (!inWindow || !lastHour) return null;
  const left = (inWindow / win.usedPercentage) * (100 - win.usedPercentage);
  const hitsAt = now + (left / lastHour) * 3_600_000;
  if (hitsAt >= win.resetsAt) return null;
  return `At this pace you reach the session limit ${when(hitsAt, now)}, ${span(win.resetsAt - hitsAt)} before it resets.`;
}

export function usageLines(input: UsageInput): Line[] {
  const {cols, now, limits} = input;
  const out: Line[] = [cardTop(cols)];
  const spends = input.spends ?? [];

  if (fresh(limits, now) && (limits.fiveHour || limits.sevenDay)) {
    if (limits.fiveHour) out.push(...limitRows(cols, 'Session', '5 hour window', limits.fiveHour, now));
    if (limits.sevenDay) out.push(...limitRows(cols, 'This week', 'all models', limits.sevenDay, now));
  } else {
    out.push(cardRow(cols, [seg('Session and weekly limits', theme.ink)], [seg(limits ? 'feed is stale' : 'not connected', theme.warn)]));
    const why =
      'Claude Code only hands these numbers to a status line script. Add hooks/statusline.mjs as your status line and they show up here and in the menu bar. Everything below is counted from your transcripts and needs nothing.';
    for (const text of wrap(why, cols - 6)) out.push(cardRow(cols, [seg(text, theme.dim)]));
    out.push(cardRow(cols));
  }

  // Pace: tokens per half hour, scaled to the busiest half hour.
  const pace = paceOf(spends, now);
  const peak = Math.max(1, ...pace.buckets);
  const ROWS = 3;
  out.push(cardRow(cols, [seg('Pace', theme.ink), seg('  tokens per half hour, last 5 hours', theme.dim)], [seg(input.spends ? `peak ${tokens(peak)}` : 'reading…', theme.faint)]));
  for (let row = ROWS - 1; row >= 0; row--) {
    const segs: Seg[] = [sp(2)];
    pace.buckets.forEach((value, i) => {
      const eighths = Math.round((value / peak) * ROWS * 8);
      const here = Math.max(0, Math.min(8, eighths - row * 8));
      // Even an idle half hour keeps a floor, so the time axis stays readable.
      const char = row === 0 && here === 0 ? glyph.columns[1]! : glyph.columns[here]!;
      const colour = i === pace.buckets.length - 1 ? theme.accent : value ? theme.dim : theme.rule;
      segs.push(seg(char.repeat(3), colour), sp(1));
    });
    out.push(cardRow(cols, segs));
  }

  const startLabel = new Date(pace.from).toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit', hour12: false});
  out.push(cardRow(cols, [sp(2), seg(startLabel, theme.faint), sp(pace.buckets.length * 4 - 5 - 4), seg('now', theme.faint)]));
  const warning = fresh(limits, now) ? projection(limits, spends, now) : null;
  if (warning) for (const text of wrap(warning, cols - 6)) out.push(cardRow(cols, [seg(text, theme.warn)]));
  out.push(cardRow(cols));

  // Share by model. This is a share of tokens, not a limit: Claude Code does
  // not expose a per-model allowance.
  const shares = shareByModel(spends).slice(0, SHARE_COLOURS.length);
  const total = spends.reduce((n, s) => n + s.tokens, 0);
  out.push(cardRow(cols, [seg('By model', theme.ink), seg("  share of this week's tokens", theme.dim)], [seg(tokens(total), theme.faint)]));
  if (shares.length) {
    const wide = cols - 4;
    const cells = shares.map(s => Math.max(1, Math.round(s.part * wide)));
    cells[0] = Math.max(1, wide - cells.slice(1).reduce((a, n) => a + n, 0));
    out.push(cardRow(cols, shares.map((_, i) => seg(glyph.lower.repeat(cells[i]!), SHARE_COLOURS[i]))));
    const half = Math.floor((cols - 4) / 2);
    for (let i = 0; i < shares.length; i += 2) {
      const cell = (n: number): Seg[] => {
        const share = shares[n];
        if (!share) return [];
        const made = [seg(glyph.square, SHARE_COLOURS[n]), seg(` ${modelName(share.model)} `, theme.text), seg(`${Math.round(share.part * 100)}%`, theme.dim)];
        return [...made, sp(half - made.reduce((w, s) => w + s.text.length, 0))];
      };
      out.push(cardRow(cols, [...cell(i), ...cell(i + 1)]));
    }
  } else {
    out.push(cardRow(cols, [seg(input.spends ? 'No replies in the last week.' : 'Reading transcripts…', theme.dim)]));
  }

  out.push(cardRow(cols));

  // This chat's context window.
  const size = fresh(limits, now) ? limits.contextSize : null;
  if (input.context) {
    const part = size ? input.context.tokens / size : null;
    out.push(cardRow(cols, [seg('This chat', theme.ink), seg(`  context window  ·  ${modelName(input.context.model)}`, theme.dim)], part === null ? [] : [seg(`${Math.round(part * 100)}%`, theme.ink, {bold: true})]));
    if (part !== null) out.push(cardRow(cols, meter(cols - 4, part, part >= 0.8 ? theme.warn : theme.link)));
    out.push(cardRow(cols, [seg(size ? `${tokens(input.context.tokens)} of ${tokens(size)} tokens` : `${tokens(input.context.tokens)} tokens in context`, theme.dim)]));
  }

  out.push(cardBottom(cols));
  return out;
}

// The two small meters in the menu bar. Nothing at all when there is no feed.
export function usageExtras(limits: Limits | null, now: number): Seg[] {
  if (!fresh(limits, now)) return [];
  const out: Seg[] = [];
  if (limits.fiveHour) {
    const part = limits.fiveHour.usedPercentage / 100;
    out.push(seg('5h ', theme.dim), ...meter(6, part, meterTone(part)), seg(` ${Math.round(limits.fiveHour.usedPercentage)}%`, theme.text));
  }

  if (limits.sevenDay) out.push(sp(out.length ? 2 : 0), seg('wk ', theme.dim), seg(`${Math.round(limits.sevenDay.usedPercentage)}%`, theme.text));
  return out;
}
