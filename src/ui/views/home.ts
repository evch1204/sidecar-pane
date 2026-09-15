import type {HomeFacts} from '../../core/home';
import {
  brief, cut, num, padTo, pageRow, plural, RIGHT_PAD, seg, sep, SKYLINE, sp, span, spinner, width, widthOf,
  type Act, type Line, type Seg,
} from '../cells';
import {glyph, theme} from '../theme';
import {clock} from './changes';

// The page the pane opens on. It answers four questions in the order they are
// asked on coming back to a terminal: where am I, what is happening right now,
// what has today been, and where does each key go. Every fact on it is one the
// bar or a view already says, drawn from `homeFacts`, so Home never disagrees
// with the pane around it; it only says them all in one place.
//
// It is a page, not a panel: nothing paints a background except the row under
// the cursor, and the only rows the cursor stops on are the GO TO rows.

export type HomeInput = {
  cols: number;
  now: number;
  frame: number;
  project: string;
  branch: string;
  // The basename of the folder the pane is in.
  folder: string;
  facts: HomeFacts;
  // The five hour window: a percentage used, 0 to 100, and what is left of
  // it. Both null when no status line script is feeding the limits.
  usage: {pct: number | null; leftMs: number | null};
  // Uncommitted files in this folder.
  changed: number;
  // Whether the Agents tab exists right now.
  agentsTab: boolean;
  // More than one folder in the repository.
  workspaces: boolean;
  sel: string | null;
  // Whether the pane's own turn is live. The facts cannot say so while agents
  // run, because `now` is `agents` then whatever the main turn is doing; App
  // knows, so it can pass it. Left out, a turn inside a tool counts as live.
  working?: boolean;
  // Where `w` goes from here: the next folder along, or all of them. App
  // works it out once for the key, the panel and this row alike.
  next: Act;
};

// Columns before a GO TO row's label, and the widths its two text columns are
// padded to, so every row's description starts in the same place.
const LABEL = 12;
const DESC = 30;
// Under this many cells the day's skyline is a smear, not a shape.
const SKY_MIN = 4;

// Three spaces between the facts on the TODAY row, as the splash card spaces
// its readout.
const GAP = 3;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// `Tue 23 Sep`, spelled out here rather than by the locale: a locale can say
// `Sept`, or put a comma in, and the row is laid out for these ten columns.
function dateOf(at: number): string {
  const date = new Date(at);
  return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function greeting(at: number): string {
  const hour = new Date(at).getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

// The width a page row's own content has: the margin and the pad are taken,
// and the last column belongs to the scrollbar.
const inner = (cols: number): number => cols - 2 - RIGHT_PAD;

const blank = (cols: number): Line => pageRow(cols);

const head = (cols: number, name: string): Line => pageRow(cols, [sp(1), seg(name, theme.faint, {bold: true})]);

// ---- NOW ----------------------------------------------------------------------

// A NOW row: a mark, two spaces, what it is, and a fact on the right. The mark
// sits in column 2 so the words line up with the section heads above.
const nowRow = (cols: number, mark: Seg, text: Seg, right: Seg[] = []): Line =>
  pageRow(cols, [sp(1), mark, sp(2), text], right);

function turnRow(input: HomeInput): Line {
  const {cols, frame, facts} = input;
  const text = facts.tool ? `Claude is in ${facts.tool}` : 'Claude is on your turn';
  const right = facts.elapsedMs !== null ? [seg(`${brief(facts.elapsedMs)} in`, theme.dim)] : [];
  return nowRow(cols, seg(spinner(frame), theme.accent), seg(text, theme.ink), right);
}

function agentsRow(input: HomeInput): Line {
  const {cols, frame, facts} = input;
  const n = facts.agentsRunning;
  // Agents in worktrees of their own are the ones whose work is not here yet,
  // which is the thing worth knowing about them from Home.
  const short = `${plural(n, 'agent')} running`;
  const long = n === 1 ? '1 agent in a folder of its own' : `${n} agents in folders of their own`;
  const right = facts.unmerged > 0 ? [seg('not merged yet', theme.dim)] : [];
  // The long sentence only when it fits whole: cut, it says less than the short one.
  const room = inner(cols) - 4 - widthOf(right) - (right.length ? 1 : 0);
  const text = n > 0 && facts.agentsElsewhere === n && width(long) <= room ? long : short;
  return nowRow(cols, seg(spinner(frame), theme.accent), seg(text, theme.text), right);
}

function nowRows(input: HomeInput): Line[] {
  const {cols, frame, facts} = input;
  if (facts.now === 'reading') return [nowRow(cols, seg(spinner(frame), theme.accent), seg('reading…', theme.dim))];

  const out: Line[] = [];
  // Agents win the state whenever any runs, even with the main turn over, so
  // the turn's own row is only drawn when that turn is still going.
  const live = input.working ?? facts.tool !== null;
  switch (facts.now) {
    case 'working':
      out.push(turnRow(input));
      break;
    case 'agents':
      if (live) out.push(turnRow(input));
      out.push(agentsRow(input));
      break;
    case 'asking':
      out.push(nowRow(cols, seg(glyph.dot, theme.warn), seg('Claude is asking you something', theme.warn)));
      break;
    case 'yours':
      out.push(nowRow(
        cols,
        seg(glyph.dot, theme.ink),
        seg('Your turn', theme.ink),
        facts.elapsedMs !== null ? [seg(`since ${brief(facts.elapsedMs)}`, theme.dim)] : [],
      ));
      break;
    case 'idle':
      out.push(nowRow(cols, seg(glyph.dot, theme.faint), seg('Nothing running', theme.dim)));
      break;
  }

  if (facts.prompt) {
    // Under the turn it belongs to, in line with that row's words. A prompt
    // that ran over several lines is read here as one.
    const said = facts.prompt.replace(/\s+/g, ' ').trim();
    // With agents running and the turn over, it sits after the agents row:
    // it is still the prompt that set them going.
    const at = facts.now === 'agents' && live ? 1 : out.length;
    out.splice(at, 0, pageRow(cols, [sp(4), seg(cut(said, inner(cols) - 4), theme.dim)]));
  }

  if (facts.landings.length) {
    const n = facts.landings.length;
    out.push(nowRow(
      cols,
      seg(glyph.check, theme.add),
      seg(`${n === 1 ? '1 branch' : `${n} branches`} landed here today`, theme.text),
      [seg(clock(facts.landings[0]!.at), theme.dim)],
    ));
  }

  return out;
}

// ---- TODAY --------------------------------------------------------------------

// `+4,180 −1,630`, only the sides that moved.
function totals(added: number, removed: number): Seg[] {
  const out: Seg[] = [];
  if (added) out.push(seg(`+${num(added)}`, theme.add));
  if (removed) out.push(...(out.length ? [sp(1)] : []), seg(`${glyph.minus}${num(removed)}`, theme.del));
  return out;
}

// One row for the whole day: how many turns, the skyline of their sizes one
// cell a turn, the lines they moved and the stretch of time they covered. The
// skyline is the part that gives way: it keeps the newest turns that fit, then
// the span goes, then the skyline itself.
function todayRow(input: HomeInput): Line {
  const {cols, facts} = input;
  const day = facts.today;
  if (!day) {
    return pageRow(cols, [sp(1), seg(facts.now === 'reading' ? 'reading…' : 'nothing yet today', theme.dim)]);
  }

  const lead = seg(plural(day.turns, 'turn'), theme.text);
  const moved = totals(day.added, day.removed);
  const when = seg(span(day.spanMs), theme.dim);
  const gap = (): Seg => sp(GAP);
  const room = inner(cols) - 1;

  const tries: Seg[][] = [[...(moved.length ? [gap(), ...moved] : []), gap(), when], moved.length ? [gap(), ...moved] : []];
  for (const tail of tries) {
    const sky = Math.min(day.heights.length, room - width(lead.text) - GAP - widthOf(tail));
    if (sky >= Math.min(SKY_MIN, day.heights.length)) {
      const cells = day.heights
        .slice(-sky)
        .map(lit => glyph.columns[SKYLINE[Math.max(0, Math.min(SKYLINE.length - 1, lit))]!]!)
        .join('');
      return pageRow(cols, [sp(1), lead, gap(), seg(cells, theme.faint), ...tail]);
    }
  }

  return pageRow(cols, [sp(1), lead, ...(moved.length ? [gap(), ...moved] : [])]);
}

// ---- GO TO --------------------------------------------------------------------

type Go = {key: string; label: string; desc: string; right: Seg[]; act: Act};

function goes(input: HomeInput): Go[] {
  const {facts, usage, changed, frame} = input;
  const clean = [seg('all clean', theme.faint)];
  const out: Go[] = [
    {
      key: '1', label: 'Changes', desc: 'what each turn did',
      right: changed ? [seg(plural(changed, 'file'), theme.dim)] : clean,
      act: {type: 'view', view: 'changes'},
    },
    {
      key: '2', label: 'Files', desc: 'the tree, changed files first',
      right: changed ? [seg(`${changed} changed`, theme.dim)] : clean,
      act: {type: 'view', view: 'files'},
    },
  ];

  // The Agents tab only exists once there has been an agent; a row for a tab
  // that is not there would be a key that does nothing.
  if (input.agentsTab || facts.agentsRunning > 0) {
    out.push({
      key: '3', label: 'Agents', desc: 'who is doing what, and where',
      right: facts.agentsRunning
        ? [seg(`${spinner(frame)} ${facts.agentsRunning} running`, theme.accent)]
        : [seg('none running', theme.faint)],
      act: {type: 'view', view: 'agents'},
    });
  }

  out.push({
    key: '4', label: 'Usage', desc: 'how much of the day is left',
    right: usage.pct === null
      ? [seg('not connected', theme.faint)]
      : [seg(`${Math.round(usage.pct)}%${usage.leftMs !== null ? ` ${glyph.sep} ${brief(usage.leftMs)}` : ''}`, theme.dim)],
    act: {type: 'view', view: 'usage'},
  });

  if (input.workspaces) {
    out.push({
      key: 'w', label: 'Workspaces', desc: 'every folder of the repo',
      right: [seg(`${facts.workspaces.active} active`, theme.accent)],
      act: input.next,
    });
  }

  out.push({key: 'm', label: 'Menu', desc: 'every key, in one place', right: [], act: {type: 'menu', menu: 1}});
  return out;
}

function goRow(cols: number, go: Go, sel: string | null, described: boolean): Line {
  const id = `home:go:${go.key}`;
  const here = id === sel;
  const bg = here ? theme.surface2 : undefined;
  const fg = here ? theme.ink : theme.text;
  const front: Seg[] = [
    seg(here ? glyph.bar : ' ', theme.accent),
    sp(1),
    seg(go.key, fg, {bold: true}),
    sp(2),
    seg(go.label.padEnd(LABEL), fg),
  ];
  // Padded to the column, or as far as the right side lets it: the widest
  // right side (`58% · 1h 52m`) takes the last columns of the pad at 62.
  const pad = Math.min(DESC, inner(cols) - FRONT - (go.right.length ? 1 + widthOf(go.right) : 0));
  const desc = described ? [seg(padTo(go.desc, pad), theme.dim)] : [];
  return pageRow(cols, [...front, ...desc], go.right, {id, pick: true, hint: 'go', act: go.act, bg});
}

// Columns before a GO TO row's description: the mark, a space, the key, two
// spaces and the padded label.
const FRONT = 1 + 1 + 1 + 2 + LABEL;

// The description is what goes when the pane is narrow: the key and the name
// are the row, the right side is its news, and the description only repeats
// what the name says. They go all together, so the column never reads as a
// ragged list of half sentences.
const describable = (cols: number, all: Go[]): boolean =>
  all.every(go => FRONT + width(go.desc) + (go.right.length ? 1 + widthOf(go.right) : 0) <= inner(cols));

// ---- the page -------------------------------------------------------------------

export function homeLines(input: HomeInput): Line[] {
  const {cols, now, project, branch, folder, sel} = input;
  const rows = goes(input);
  const described = describable(cols, rows);
  // The branch gives way before the folder does: the folder is the answer to
  // where am I, and the branch is only what the folder has checked out.
  const fixed = width(project) + width(folder) + 2 * widthOf([sep()]);
  const branchRoom = Math.min(24, inner(cols) - 1 - fixed);
  // Under eight columns a branch name is a guess, so it is left out.
  const where: Seg[] = branchRoom >= 8
    ? [seg(project, theme.text), sep(), seg(cut(branch, branchRoom), theme.text), sep(), seg(folder, theme.text)]
    : [seg(project, theme.text), sep(), seg(folder, theme.text)];
  return [
    blank(cols),
    pageRow(
      cols,
      [sp(1), seg(greeting(now), theme.ink, {bold: true})],
      [seg(dateOf(now), theme.dim), sep(), seg(clock(now), theme.dim)],
    ),
    pageRow(cols, [sp(1), ...where]),
    blank(cols),
    head(cols, 'NOW'),
    ...nowRows(input),
    blank(cols),
    head(cols, 'TODAY'),
    todayRow(input),
    blank(cols),
    head(cols, 'GO TO'),
    ...rows.map(go => goRow(cols, go, sel, described)),
  ];
}
