// Every row of the pane is placed by arithmetic, and both the renderer and the
// mouse read from this one function. If they ever disagree, clicks land on the
// wrong thing, so there is deliberately only one set of numbers.

export type View = 'files' | 'changes';
export type Half = 'list' | 'body';

export type Layout = {
  cols: number;
  rows: number;
  tabs: number;
  topRule: number;
  listTop: number;
  listHeight: number;
  divider: number;
  bodyTop: number;
  bodyHeight: number;
  bottomRule: number;
  footer: number;
};

// Tab bar, rule, divider, rule, footer.
const CHROME = 5;
const MIN_HALF = 2;

export function computeLayout(
  cols: number,
  rows: number,
  listCount: number,
  focus: Half,
  override: number | null,
): Layout {
  const space = Math.max(MIN_HALF * 2, rows - CHROME);
  const most = space - MIN_HALF;

  // The focused half grows. A drag on the divider overrides that until it is
  // double-clicked back to automatic.
  const wanted =
    override ?? (focus === 'list' ? Math.max(4, Math.floor(space * 0.5)) : 5);
  const listHeight = Math.min(most, Math.max(MIN_HALF, Math.min(wanted, Math.max(listCount, MIN_HALF))));

  const listTop = 2;
  const divider = listTop + listHeight;
  const bodyTop = divider + 1;
  const bodyHeight = Math.max(MIN_HALF, rows - bodyTop - 2);

  return {
    cols,
    rows,
    tabs: 0,
    topRule: 1,
    listTop,
    listHeight,
    divider,
    bodyTop,
    bodyHeight,
    bottomRule: bodyTop + bodyHeight,
    footer: rows - 1,
  };
}

export type Region =
  | {region: 'tabs'; tab: View | null}
  | {region: 'list'; index: number}
  | {region: 'divider'}
  | {region: 'body'; index: number}
  | {region: 'scrollbar'; half: Half; index: number}
  | {region: 'other'};

// Where the tab words sit, so a click can land on one. Kept here rather than in
// the component for the same reason as the row maths.
export function tabStops(changedCount: number): {view: View; label: string; start: number; end: number}[] {
  const lead = ' sidecar   ';
  const files = 'Files';
  const changes = changedCount > 0 ? `Changes ${changedCount}` : 'Changes';
  const filesStart = lead.length;
  const changesStart = filesStart + files.length + 3;

  return [
    {view: 'files', label: files, start: filesStart, end: filesStart + files.length},
    {view: 'changes', label: changes, start: changesStart, end: changesStart + changes.length},
  ];
}

export function hitTest(layout: Layout, x: number, y: number, changedCount: number): Region {
  if (y === layout.tabs) {
    const stop = tabStops(changedCount).find(t => x >= t.start && x < t.end);
    return {region: 'tabs', tab: stop?.view ?? null};
  }

  if (y === layout.divider) return {region: 'divider'};

  const bar = layout.cols - 1;
  if (y >= layout.listTop && y < layout.listTop + layout.listHeight) {
    const index = y - layout.listTop;
    return x >= bar ? {region: 'scrollbar', half: 'list', index} : {region: 'list', index};
  }

  if (y >= layout.bodyTop && y < layout.bodyTop + layout.bodyHeight) {
    const index = y - layout.bodyTop;
    return x >= bar ? {region: 'scrollbar', half: 'body', index} : {region: 'body', index};
  }

  return {region: 'other'};
}

// Which rows of a track the scrollbar thumb covers. Returns null when
// everything already fits and no bar should be drawn.
export function thumb(total: number, height: number, scroll: number): {from: number; to: number} | null {
  if (total <= height || height < 2) return null;
  const size = Math.max(1, Math.round((height * height) / total));
  const span = Math.max(1, total - height);
  const from = Math.min(height - size, Math.round((scroll / span) * (height - size)));
  return {from, to: from + size};
}

// The scroll offset a click or drag at `row` of the track means.
export function scrollFromThumb(total: number, height: number, row: number): number {
  const size = Math.max(1, Math.round((height * height) / total));
  const travel = Math.max(1, height - size);
  const span = Math.max(0, total - height);
  return Math.max(0, Math.min(span, Math.round((row / travel) * span)));
}
