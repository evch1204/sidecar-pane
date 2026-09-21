// Scrollbar arithmetic. The renderer and the mouse both read these, so a drag
// on the thumb lands where the thumb was drawn.

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

// Keep `cursor` on screen with as little movement as possible.
export function follow(scroll: number, cursor: number, height: number, total: number): number {
  const most = Math.max(0, total - height);
  if (cursor < scroll) return Math.min(most, cursor);
  if (cursor >= scroll + height) return Math.min(most, cursor - height + 1);
  return Math.min(most, Math.max(0, scroll));
}
