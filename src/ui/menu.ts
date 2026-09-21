import {fit, seg, sp, widthOf, type Group, type Line, type Seg, type View, type Zone} from './cells';
import {glyph, theme} from './theme';

// The top row is a real menu bar: the app's name, its menus, and on the right
// the things you glance at, usage and whether Claude is working. Everything a
// key can do is also in a menu, so nothing has to be memorised.

export type Command =
  | {do: 'view'; view: View}
  | {do: 'group'; group: Group}
  | {do: 'chat'}
  | {do: 'whitespace'}
  | {do: 'changedOnly'}
  | {do: 'foldAll'}
  | {do: 'mouse'}
  | {do: 'quit'};

export type Item = {label: string; key: string; checked?: boolean; command: Command} | 'rule';
export type Menu = {title: string; items: Item[]};

export type MenuState = {view: View; group: Group; hideSpace: boolean; changedOnly: boolean; mouse: boolean; agents: number};

export function menus(state: MenuState): Menu[] {
  return [
    {
      title: 'Sidecar',
      items: [
        {label: 'Mouse', key: 'M', checked: state.mouse, command: {do: 'mouse'}},
        'rule',
        {label: 'Quit', key: 'q', command: {do: 'quit'}},
      ],
    },
    {
      title: 'View',
      items: [
        {label: 'Changes', key: '1', checked: state.view === 'changes', command: {do: 'view', view: 'changes'}},
        {label: 'Files', key: '2', checked: state.view === 'files', command: {do: 'view', view: 'files'}},
        {label: 'Agents', key: '3', checked: state.view === 'agents', command: {do: 'view', view: 'agents'}},
        {label: 'Usage', key: '4', checked: state.view === 'usage', command: {do: 'view', view: 'usage'}},
      ],
    },
    {
      title: 'Group',
      items: [
        {label: 'By turn', key: 'v', checked: state.group === 'turn', command: {do: 'group', group: 'turn'}},
        {label: 'By file', key: '', checked: state.group === 'file', command: {do: 'group', group: 'file'}},
        {label: 'All changes', key: '', checked: state.group === 'flat', command: {do: 'group', group: 'flat'}},
        'rule',
        {label: 'Next chat', key: 's', command: {do: 'chat'}},
        {label: 'Hide whitespace', key: 'w', checked: state.hideSpace, command: {do: 'whitespace'}},
        {label: 'Fold every hunk', key: 'z', command: {do: 'foldAll'}},
        {label: 'Changed files only', key: 'c', checked: state.changedOnly, command: {do: 'changedOnly'}},
      ],
    },
  ];
}

export type Bar = {line: Line; starts: number[]};

export function menuBar(cols: number, list: Menu[], open: number | null, right: Seg[]): Bar {
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

  const rightZone: Zone = {from: cols - widthOf(right) - 1, to: cols, act: {type: 'view', view: 'usage'}};
  return {line: {segs: fit(left, [...right, sp(1)], cols, bg), zones: [...zones, rightZone]}, starts};
}

export const MENU_WIDTH = 28;

// The open menu, as lines to lay over the screen from row 1.
export function menuBox(menu: Menu, index: number, cursor: number): Line[] {
  const bg = theme.menu;
  const out: Line[] = [];
  menu.items.forEach((item, i) => {
    if (item === 'rule') {
      out.push({segs: fit([sp(1), seg(glyph.rule.repeat(MENU_WIDTH - 2), theme.faint)], [], MENU_WIDTH, bg)});
      return;
    }

    const on = i === cursor;
    const ink = on ? theme.menuInk : theme.ink;
    out.push({
      segs: fit([sp(1), seg(item.checked ? glyph.check : ' ', on ? theme.menuInk : theme.accent), sp(1), seg(item.label, ink)], [seg(item.key, on ? theme.menuInk : theme.dim), sp(2)], MENU_WIDTH, on ? theme.accent : bg),
      act: {type: 'item', menu: index, item: i},
    });
  });
  out.push({segs: [seg(glyph.cornerBL + glyph.upper.repeat(MENU_WIDTH - 2) + glyph.cornerBR, bg)]});
  return out;
}

const TABS: {view: View; label: string}[] = [
  {view: 'changes', label: 'Changes'},
  {view: 'files', label: 'Files'},
  {view: 'agents', label: 'Agents'},
  {view: 'usage', label: 'Usage'},
];

// The view you are in is a lit tab. The rest are just words.
export function tabRow(cols: number, view: View, badge: Partial<Record<View, number>>, right: Seg[]): Line {
  const left: Seg[] = [sp(1)];
  const zones: Zone[] = [];
  for (const tab of TABS) {
    const from = widthOf(left);
    const on = tab.view === view;
    const n = badge[tab.view];
    const bg = on ? theme.surface2 : undefined;
    left.push(seg(` ${tab.label}`, on ? theme.ink : theme.dim, {bold: on, bg}));
    if (n) left.push(seg(` ${n}`, on ? theme.accent : theme.faint, {bold: on, bg}));
    left.push(sp(1, bg));
    zones.push({from, to: widthOf(left), act: {type: 'view', view: tab.view}});
    left.push(sp(1));
  }

  // The tabs always win. The note on the right gives way, a piece at a time.
  let note = right;
  while (note.length && widthOf(left) + widthOf(note) + 2 > cols) note = note.slice(0, -1);
  while (note.length && !note[note.length - 1]!.text.trim().replace(/·/g, '')) note = note.slice(0, -1);
  return {segs: fit(left, [...note, sp(1)], cols), zones};
}

export function footer(cols: number, hints: [string, string][], notice: string, right: string): Line {
  if (notice) return {segs: fit([sp(1), seg(notice, theme.warn)], [], cols)};
  const left: Seg[] = [sp(1)];
  for (const [key, label] of hints) {
    const next = [...(left.length > 1 ? [sp(2)] : []), seg(key, theme.text), seg(` ${label}`, theme.faint)];
    // Hints are added while they fit, so a narrow pane keeps the ones that matter.
    if (widthOf(left) + widthOf(next) > cols - right.length - 3) break;
    left.push(...next);
  }

  return {segs: fit(left, [seg(right, theme.faint), sp(1)], cols)};
}
