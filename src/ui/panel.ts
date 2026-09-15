import type {StateWord} from '../core/worktrees';
import {cut, fit, seg, sp, spinner, type Act, type Seg, type View, type Zone} from './cells';
import {glyph, theme} from './theme';

// The side panel: the views and the folders of the repository down the left
// of the pane, each with the key that opens it, the way an IDE's primary panel
// is the legend and the status at once. It pushes the content over rather than
// covering it. Wide panes have it open, middling ones have it folded to a
// glyph, a key and a mark per view, and narrow ones do without and get the
// tab row back.
//
// Nothing here reads anything or holds any state: App hands in the counts and
// the folders, and gets back rows it lays beside the content rows.

export type PanelMode = 'open' | 'folded' | 'off';

export const PANEL_OPEN = 22; // 21 columns and the rule
export const PANEL_FOLDED = 9; // 8 and the rule

// The environment wins, because scripts pin the layout with it. After that a
// choice you made is kept wherever it still leaves the content room, and the
// width decides the rest. An open panel at 64 columns still leaves 42 for the
// content, which is enough to read by, so a pref of `open` is honoured there;
// under 64 there is not, whatever was chosen.
export function panelMode(cols: number, pref: 'open' | 'folded' | undefined, env: string | undefined): PanelMode {
  if (env === 'off' || env === 'open' || env === 'folded') return env;
  if (cols >= 80) return pref ?? 'open';
  if (cols >= 64) return pref ?? 'folded';
  return 'off';
}

export const panelWidth = (mode: PanelMode): number => (mode === 'open' ? PANEL_OPEN : mode === 'folded' ? PANEL_FOLDED : 0);

export type PanelInput = {
  mode: 'open' | 'folded';
  // The rows below the bar, footer included.
  rows: number;
  view: View;
  frame: number;
  now: number;
  counts: {changes: number; files: number; agents: number; agentsLive: boolean; usage: string | null; workspaces: number};
  // Whether the Agents tab exists right now.
  agentsTab: boolean;
  // Every folder of the repository; a null path is the pane's own.
  workspaces: {path: string | null; label: string; hue: string; state: StateWord; live: boolean}[];
  focus: string | null;
  scope: 'mine' | 'all';
  // The panel's own cursor, when the panel has the keyboard.
  cursor: string | null;
};

export type PanelRow = {segs: Seg[]; zones: Zone[]; id?: string; act?: Act};

// How a row gives way in a short pane: blank rows go first, then the two key
// reminders, then `all folders`, and only then the folders themselves.
type Drop = 'blank' | 'keys' | 'all' | 'folder' | 'keep';
type Item = {row: PanelRow; drop: Drop};

const DROP_ORDER: Drop[] = ['blank', 'keys', 'all', 'folder'];

// A state that has nothing left to do reads as a hollow ring; one with work
// still in it keeps its folder's hue.
const SETTLED: ReadonlySet<StateWord> = new Set(['merged', 'clean', 'removed', 'not recorded']);

const VIEWS: {view: View; key: string; label: string}[] = [
  {view: 'home', key: 'h', label: 'Home'},
  {view: 'changes', key: '1', label: 'Changes'},
  {view: 'files', key: '2', label: 'Files'},
  {view: 'agents', key: '3', label: 'Agents'},
  {view: 'usage', key: '4', label: 'Usage'},
];

// Each view's glyph in the folded strip, in the colours it carries everywhere
// else: the diff's two for Changes, an agent's square, the meter's two bars.
const FOLDED: Record<View, Seg[]> = {
  home: [seg(glyph.diamond, theme.accent), sp(1)],
  changes: [seg(glyph.plus, theme.add), seg(glyph.minus, theme.del)],
  files: [seg(glyph.list, theme.dim), sp(1)],
  agents: [seg(glyph.square, theme.text), sp(1)],
  usage: [seg(glyph.miniMeter[0], theme.accent), seg(glyph.miniMeter[1], theme.faint)],
};

// The id a folder's row goes by. The pane's own has no path, and a word that
// can never be a path stands in for it.
const wsId = (path: string | null): string => `panel:ws:${path ?? '~here'}`;

// What `w` does from where you are: the pane's own folder, then each other
// folder in the order they are listed, then all of them at once, then round.
// App asks the same question for the key, so the row and the key never
// disagree about where it goes next.
export function nextWorkspace(paths: (string | null)[], focus: string | null, scope: 'mine' | 'all'): Act {
  if (scope === 'all') return {type: 'focus', path: null};
  const order = [null, ...paths.filter((path): path is string => path !== null)];
  const next = order.indexOf(focus) + 1;
  return next < order.length ? {type: 'focus', path: order[next]!} : {type: 'scope', scope: 'all'};
}

const nextOf = (input: PanelInput): Act => nextWorkspace(input.workspaces.map(ws => ws.path), input.focus, input.scope);

// The views' own figures: what there is behind each key, at a glance.
function badge(input: PanelInput, view: View): Seg[] {
  const {counts} = input;
  switch (view) {
    case 'changes':
      return counts.changes ? [seg(String(counts.changes), theme.dim)] : [];
    case 'files':
      return counts.files ? [seg(String(counts.files), theme.dim)] : [];
    case 'agents':
      if (counts.agentsLive) return [seg(`${spinner(input.frame)} ${counts.agents}`, theme.accent)];
      // A hidden tab still has its row here, so the key is still learnt; the
      // mark says there is nothing behind it yet.
      if (!input.agentsTab) return [seg(glyph.minus, theme.faint)];
      return counts.agents ? [seg(String(counts.agents), theme.dim)] : [];
    case 'usage':
      return counts.usage ? [seg(counts.usage, theme.dim)] : [];
    default:
      return [];
  }
}

export function panelRows(input: PanelInput): PanelRow[] {
  const inner = panelWidth(input.mode) - 1;
  const several = input.workspaces.length >= 2;

  // Every row is the same shape: `inner` columns of content and the rule. A
  // row that does something does it from any column of it, so a click that
  // lands in the gap between a label and its figure still counts.
  const row = (left: Seg[], right: Seg[], more: {id?: string; act?: Act; lit?: boolean} = {}): PanelRow => {
    const {id, act, lit} = more;
    const bg = lit || (id !== undefined && id === input.cursor) ? theme.surface2 : undefined;
    return {
      segs: [...fit(left, right, inner, bg), seg(glyph.spine, theme.faint)],
      zones: act ? [{from: 0, to: inner + 1, act}] : [],
      ...(id ? {id} : {}),
      ...(act ? {act} : {}),
    };
  };

  const item = (r: PanelRow, drop: Drop): Item => ({row: r, drop});
  const blank = (): Item => item(row([], []), 'blank');
  // Column 0 carries the one mark that says "this is where you are".
  const mark = (on: boolean): Seg => (on ? seg(glyph.bar, theme.accent) : sp(1));
  const key = (text: string, on: boolean): Seg => seg(text, on ? theme.ink : theme.text, {bold: true});

  const items: Item[] = [];

  if (input.mode === 'open') {
    items.push(
      item(
        row([sp(1), seg(glyph.fold, theme.dim), sp(2), seg('fold', theme.dim)], [seg('b', theme.text), sp(2)], {
          id: 'panel:toggle',
          act: {type: 'panel', to: 'folded'},
        }),
        'keep',
      ),
    );

    for (const {view, key: k, label} of VIEWS) {
      const on = view === input.view;
      items.push(
        item(
          row(
            [mark(on), key(k, on), sp(2), seg(label, on ? theme.ink : theme.text, {bold: on})],
            [...badge(input, view), sp(1)],
            {id: `panel:view:${view}`, act: {type: 'view', view}, lit: on},
          ),
          'keep',
        ),
      );
    }

    if (several) {
      items.push(blank());
      const head = [seg(`${input.counts.workspaces}/${input.workspaces.length}`, theme.dim), sp(2)];
      items.push(item(row([sp(1), seg('WORKSPACES', theme.faint, {bold: true})], head), 'keep'));
      for (const ws of input.workspaces) {
        // Scope all and a picked folder are never both true, so with every
        // folder shown no one folder is marked as the one you are in.
        const picked = input.scope === 'mine' && ws.path === input.focus;
        const state =
          ws.live || ws.state === 'working'
            ? seg(spinner(input.frame), theme.accent)
            : SETTLED.has(ws.state)
              ? seg(glyph.ring, theme.faint)
              : seg(glyph.dot, ws.hue);
        const name = seg(cut(ws.label, 16), picked ? theme.ink : ws.hue, {bold: picked});
        items.push(item(row([mark(picked), state, sp(1), name], [], {id: wsId(ws.path), act: {type: 'focus', path: ws.path}}), 'folder'));
      }

      const all = input.scope === 'all';
      items.push(
        item(
          row([mark(all), sp(2), seg('all folders', all ? theme.ink : theme.dim, {bold: all})], [], {
            id: 'panel:all',
            act: {type: 'scope', scope: 'all'},
          }),
          'all',
        ),
      );
    }

    items.push(blank());
    // With one folder there is nothing for `w` to step through.
    if (several) {
      items.push(
        item(row([sp(1), seg('w', theme.text), sp(2), seg('next workspace', theme.dim)], [], {id: 'panel:next', act: nextOf(input)}), 'keys'),
      );
    }

    items.push(item(row([sp(1), seg('m', theme.text), sp(2), seg('menu', theme.dim)], [], {id: 'panel:menu', act: {type: 'menu', menu: 1}}), 'keys'));
  } else {
    items.push(item(row([sp(1), seg(glyph.unfold, theme.dim)], [], {id: 'panel:toggle', act: {type: 'panel', to: 'open'}}), 'keep'));

    for (const {view, key: k} of VIEWS) {
      const on = view === input.view;
      // Folded, a view keeps only its live mark: the counts need the room the
      // labels had, and a running agent is the one figure worth a column.
      const live = view === 'agents' && input.counts.agentsLive ? [seg(spinner(input.frame), theme.accent)] : [];
      items.push(
        item(
          row([mark(on), ...FOLDED[view], sp(1), key(k, on)], [...live, sp(1)], {
            id: `panel:view:${view}`,
            act: {type: 'view', view},
            lit: on,
          }),
          'keep',
        ),
      );
    }

    if (several) {
      items.push(blank());
      items.push(
        item(
          row([sp(1), seg(glyph.gitBranch, theme.text), sp(2), key('w', false)], [seg(String(input.counts.workspaces), theme.accent), sp(1)], {
            id: 'panel:next',
            act: nextOf(input),
          }),
          'keys',
        ),
      );
    }
  }

  // A short pane gives up rows in the order they matter least, and within a
  // kind from the bottom up, so the top of the panel never moves.
  for (const drop of DROP_ORDER) {
    while (items.length > input.rows) {
      const at = items.map(it => it.drop).lastIndexOf(drop);
      if (at < 0) break;
      items.splice(at, 1);
    }
  }

  const out = items.slice(0, Math.max(0, input.rows)).map(it => it.row);
  while (out.length < input.rows) out.push(row([], []));
  return out;
}

