import {clip, fit, RIGHT_PAD, seg, sp, widthOf, type Act, type Group, type Line, type Seg, type View, type Zone} from './cells';
import {NAME} from './splash';
import {glyph, theme} from './theme';

// The chrome: the menu bar on top, the tabs, the pills that say what state the
// view you are in is in, and the footer. Everything a key can do is also in a
// menu, so nothing has to be memorised, and every menu title, tab, pill and
// meter is a click zone at the columns it was really drawn at.

export type Command =
  | {do: 'view'; view: View}
  | {do: 'group'; group: Group}
  | {do: 'chat'; to?: string | null}
  // How much of the repository the Changes view covers: this folder, or every
  // worktree of it.
  | {do: 'scope'; to?: 'mine' | 'all'}
  | {do: 'whitespace'}
  | {do: 'changedOnly'; on?: boolean}
  | {do: 'raw'}
  | {do: 'foldAll'}
  | {do: 'follow'}
  | {do: 'mouse'}
  | {do: 'quit'};

// A row the cursor can stop on, a dim heading it skips, or a rule.
export type Action = {label: string; key: string; checked?: boolean; command: Command};
export type Item = Action | {head: string; key?: string} | 'rule';
export type Menu = {title: string; items: Item[]};

export const isAction = (item: Item): item is Action => item !== 'rule' && !('head' in item);

export type MenuState = {
  view: View;
  group: Group;
  hideSpace: boolean;
  changedOnly: boolean;
  // The chat the Changes view is filtered to, by name, or null for all of them.
  chat: string | null;
  // How many folders this repository has, and how many of them the stream is
  // covering. One folder and there is nothing to switch, so no item is shown.
  folders: number;
  scope: 'mine' | 'all';
  // The cursor is inside a diff, so folding every hunk means something.
  inDiff: boolean;
  // A markdown file is open in the reader, so it can be read as written.
  markdown: boolean;
  raw: boolean;
  // The pane is opening the files of the running turn as they are touched.
  follow: boolean;
  mouse: boolean;
};

// Two menus only. `View` is the four views and then, under a rule, the options
// of the view you are in: an option you cannot use here is not shown at all.
export function menus(state: MenuState): Menu[] {
  const items: Item[] = [
    {label: 'Changes', key: '1', checked: state.view === 'changes', command: {do: 'view', view: 'changes'}},
    {label: 'Files', key: '2', checked: state.view === 'files', command: {do: 'view', view: 'files'}},
    {label: 'Agents', key: '3', checked: state.view === 'agents', command: {do: 'view', view: 'agents'}},
    {label: 'Usage', key: '4', checked: state.view === 'usage', command: {do: 'view', view: 'usage'}},
  ];

  const options: Item[] =
    state.view === 'changes'
      ? [
          // The key sits on the heading: one press walks through the three.
          {head: 'Group', key: 'v'},
          {label: 'By turn', key: '', checked: state.group === 'turn', command: {do: 'group', group: 'turn'}},
          {label: 'By file', key: '', checked: state.group === 'file', command: {do: 'group', group: 'file'}},
          {label: 'Since the last commit', key: '', checked: state.group === 'flat', command: {do: 'group', group: 'flat'}},
          {label: state.chat ? `Chat: ${state.chat}` : 'Chat: all', key: 's', checked: Boolean(state.chat), command: {do: 'chat'}},
          // Only a repository with more than one folder has anything to widen
          // to, and then `w` is worth more here than it is on whitespace.
          ...(state.folders > 1
            ? [{label: state.scope === 'all' ? 'Worktrees: all' : 'Worktrees: mine', key: 'w', checked: state.scope === 'all', command: {do: 'scope'}} as Item]
            : []),
          {label: 'Hide whitespace', key: 'W', checked: state.hideSpace, command: {do: 'whitespace'}},
          ...(state.inDiff ? [{label: 'Fold every hunk', key: 'z', command: {do: 'foldAll'}} as Item] : []),
        ]
      : state.view === 'files'
        ? [
            {head: 'Files'},
            {label: 'Changed files only', key: 'c', checked: state.changedOnly, command: {do: 'changedOnly'}},
            ...(state.markdown ? [{label: 'Page view', key: 'r', checked: !state.raw, command: {do: 'raw'}} as Item] : []),
          ]
        : [];

  return [
    {
      title: NAME,
      items: [
        {label: 'Follow', key: 'f', checked: state.follow, command: {do: 'follow'}},
        {label: 'Mouse', key: 'M', checked: state.mouse, command: {do: 'mouse'}},
        'rule',
        {label: 'Quit', key: 'q', command: {do: 'quit'}},
      ],
    },
    {title: 'View', items: options.length ? [...items, 'rule', ...options] : items},
  ];
}

export type Bar = {line: Line; starts: number[]};

// The right end of the bar is two things you glance at, and each is its own
// button: the meters go to Usage, whether Claude is working goes to Changes.
// The menus always survive, so the right side gives way first, and a zone is
// only kept over text that was really drawn.
export function menuBar(cols: number, list: Menu[], open: number | null, right: {meters: Seg[]; status: Seg[]}): Bar {
  const bg = theme.surface;
  const left: Seg[] = [sp(1), seg(glyph.diamond, theme.accent)];
  const zones: Zone[] = [];
  const starts: number[] = [];
  list.forEach((menu, i) => {
    const from = widthOf(left);
    starts.push(from);
    const on = open === i;
    left.push(seg(` ${menu.title} `, on ? theme.menuInk : i === 0 ? theme.ink : theme.text, {bold: i === 0, bg: on ? theme.accent : bg}));
    zones.push({from, to: widthOf(left), act: {type: 'menu', menu: i}});
  });

  const gap = 3;
  const both = right.meters.length ? [...right.meters, sp(gap), ...right.status] : right.status;
  const room = cols - 1 - RIGHT_PAD - widthOf(left);
  const shown = widthOf(both) <= room ? both : widthOf(right.status) <= room ? right.status : [];
  const from = cols - 1 - RIGHT_PAD - widthOf(shown);
  const split = shown === both ? from + widthOf(right.meters) : from;
  const rightZones: Zone[] = shown.length
    ? [
        ...(shown === both ? [{from, to: split, act: {type: 'view', view: 'usage'} as Act}] : []),
        {from: split, to: cols, act: {type: 'view', view: 'changes'}},
      ]
    : [];

  // Laid out rather than fitted: `fit` gives the left side a column of air
  // when the right one fills the row, and here that column comes off a menu
  // title. The menus are the one thing on the bar that may never move, and a
  // title already carries a space of its own on each side.
  const air = Math.max(0, from - widthOf(left));
  return {
    line: {
      segs: [...clip(left, from), sp(air), ...shown, sp(1 + RIGHT_PAD)].map(s => ({...s, bg: s.bg ?? bg})),
      zones: [...zones.filter(z => z.to <= from), ...rightZones],
    },
    starts,
  };
}

// The dropdown, wide enough for the longest label, with one blank column
// either side so the row it covers never touches its text.
export const MENU_WIDTH = 30;

// The open menu, as lines to lay over the screen from row 1. A plain filled
// panel: no border, no corners, one blank column either side of the text.
export function menuBox(menu: Menu, index: number, cursor: number): Line[] {
  const bg = theme.menu;
  const out: Line[] = [];
  menu.items.forEach((item, i) => {
    if (item === 'rule') {
      out.push({segs: fit([sp(2), seg(glyph.rule.repeat(MENU_WIDTH - 5), theme.faint)], [], MENU_WIDTH, bg)});
      return;
    }

    if (!isAction(item)) {
      out.push({segs: fit([sp(2), seg(item.head, theme.dim)], [seg(item.key ?? '', theme.dim), sp(3)], MENU_WIDTH, bg)});
      return;
    }

    const on = i === cursor;
    const ink = on ? theme.menuInk : theme.ink;
    out.push({
      segs: fit(
        [sp(2), seg(item.checked ? glyph.check : ' ', on ? theme.menuInk : theme.accent), sp(1), seg(item.label, ink)],
        [seg(item.key, on ? theme.menuInk : theme.dim), sp(3)],
        MENU_WIDTH,
        on ? theme.accent : bg,
      ),
      act: {type: 'item', menu: index, item: i},
    });
  });
  // The panel ends in a row of its own colour. A half-block edge would put a
  // band of glyphs across whatever text is underneath.
  out.push({segs: [sp(MENU_WIDTH, bg)]});
  return out;
}

const TABS: {view: View; label: string}[] = [
  {view: 'changes', label: 'Changes'},
  {view: 'files', label: 'Files'},
  {view: 'agents', label: 'Agents'},
  {view: 'usage', label: 'Usage'},
];

// The view you are in is a lit tab. The rest are just words. A tab with
// nothing behind it is hidden, but never the one you are looking at: a tab
// must not vanish under the hand that is about to click it.
export function tabRow(cols: number, view: View, badges: Partial<Record<View, Seg[]>> = {}, hidden: Partial<Record<View, boolean>> = {}): Line {
  const shown = TABS.filter(tab => !hidden[tab.view] || tab.view === view);
  const draw = (gap: number): Line => {
    const left: Seg[] = [sp(1)];
    const zones: Zone[] = [];
    for (const tab of shown) {
      const from = widthOf(left);
      const on = tab.view === view;
      const bg = on ? theme.surface2 : undefined;
      left.push(seg(` ${tab.label}`, on ? theme.ink : theme.dim, {bold: on, bg}));
      const badge = badges[tab.view] ?? [];
      if (badge.length) left.push(sp(1, bg), ...badge.map(s => ({...s, bg: s.bg ?? bg})));
      left.push(sp(1, bg));
      zones.push({from, to: widthOf(left), act: {type: 'view', view: tab.view}});
      left.push(sp(gap));
    }

    // A tab that had to be cut keeps no zone: a click must never land on a
    // word that is not there.
    const room = cols - 1 - RIGHT_PAD;
    return {segs: fit(left, [sp(1 + RIGHT_PAD)], cols), zones: zones.filter(zone => zone.to <= room)};
  };

  // A narrow pane loses the space between the tabs before it loses a tab.
  const wide = draw(1);
  return (wide.zones ?? []).length === shown.length ? wide : draw(0);
}

// One state of the view, as a button. `on` is the state you are in.
export type Pill = {label: string; on: boolean; act: Act; tone?: string; clear?: boolean};

// Under the tabs: what the view is showing, as pills you can click, and one
// fact at the right end — a dim count, or the scope pill, which is a button of
// its own. A narrow pane keeps only the pill that is lit and cycles through the
// rest on a click.
export function pillRow(cols: number, pills: Pill[], note: Seg[] = [], noteAct?: Act): Line {
  const draw = (shown: Pill[], acts: Act[], right: Seg[]): Line => {
    const left: Seg[] = [sp(1)];
    const zones: Zone[] = [];
    shown.forEach((pill, i) => {
      if (i) left.push(seg(` ${glyph.sep} `, theme.faint));
      const from = widthOf(left);
      const bg = pill.on ? theme.surface2 : undefined;
      left.push(seg(` ${pill.label}`, pill.on ? (pill.tone ?? theme.ink) : theme.dim, {bg, bold: pill.on}));
      if (pill.clear) left.push(seg(` ${glyph.cross}`, theme.dim, {bg}));
      left.push(sp(1, bg));
      zones.push({from, to: widthOf(left), act: acts[i]!});
    });

    // The note is right-aligned, so its own columns are known: the pane's
    // width less the pad it leaves clear of the scrollbar.
    const end = cols - 1 - RIGHT_PAD;
    if (right.length && noteAct) zones.push({from: end - widthOf(right), to: end, act: noteAct});
    return {segs: fit(left, [...right, sp(1 + RIGHT_PAD)], cols), zones};
  };

  // Measured, not guessed: a pill whose text had to be clipped would leave a
  // click zone over words that are not there any more.
  const roomFor = (right: Seg[]) => cols - 2 - RIGHT_PAD - widthOf(right) - (right.length ? 2 : 0);
  const wide = pills.reduce((n, pill, i) => n + (i ? 3 : 0) + pill.label.length + 2 + (pill.clear ? 2 : 0), 0);
  const acts = pills.map(pill => pill.act);
  if (wide <= roomFor(note)) return draw(pills, acts, note);
  // The grouping pills win: they say what this list is, and the fact on the
  // right is reachable from the menu either way.
  if (wide <= roomFor([])) return draw(pills, acts, []);

  // No room: only the state you are in is drawn, and a click steps to the next.
  const cycle = pills.filter(pill => !pill.clear);
  const lit = pills.filter(pill => pill.on);
  const next = (pill: Pill): Act => {
    const i = cycle.indexOf(pill);
    return i < 0 ? pill.act : cycle[(i + 1) % cycle.length]!.act;
  };

  return draw(lit, lit.map(next), []);
}

// A key, what it does, and the colour of those words when they are more than a
// reminder — follow mode says it is on by lighting its own label.
export type Hint = [key: string, label: string, tone?: string];

export function footer(
  cols: number,
  hints: Hint[],
  notice: {text: string; warn?: boolean} | null,
  where: {project: string; branch: string | null},
  mouseOff: boolean,
): Line {
  // The mouse being off is a state, not a message: it stays on screen until it
  // is turned back on.
  const off: Seg[] = mouseOff ? [seg(`mouse off  ${glyph.sep}  M`, theme.warn)] : [];
  if (notice) return {segs: fit([sp(1), seg(notice.text, notice.warn ? theme.warn : theme.text)], [...off, sp(1 + RIGHT_PAD)], cols)};

  const rightOf = (label: string): Seg[] => [
    ...(label ? [seg(label, theme.faint)] : []),
    ...(label && off.length ? [sp(2)] : []),
    ...off,
    sp(1 + RIGHT_PAD),
  ];

  // The hints matter more than knowing which project this is: the label is cut
  // back to the branch, and then dropped, before the three hints that carry
  // the row are. The hints after those take whatever room is left.
  const must = hints.slice(0, 3);
  const all = must.reduce((n, [key, label], i) => n + (i ? 2 : 0) + key.length + 1 + label.length, 0);
  const labels = [where.branch ? `${where.project} ${glyph.bullet} ${where.branch}` : where.project, where.branch ?? '', ''];
  const label = labels.find(text => 1 + all + 2 + widthOf(rightOf(text)) <= cols) ?? '';
  const right = rightOf(label);

  const left: Seg[] = [sp(1)];
  for (const [key, text, tone] of hints) {
    const next = [...(left.length > 1 ? [sp(2)] : []), seg(key, theme.text), seg(` ${text}`, tone ?? theme.dim)];
    if (widthOf(left) + widthOf(next) + widthOf(right) + 1 > cols) break;
    left.push(...next);
  }

  return {segs: fit(left, right, cols)};
}
