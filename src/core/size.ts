// How big a change is, in five cells. Lines, not files: a one line fix and a
// rewrite are the two ends of this scale, and the steps are wide because what
// is being read is "small, medium, big", not a number.
//
// It lives in core rather than beside the cells that draw it because Home's
// facts need the same answer, and core may not reach into the UI. One copy, so
// a turn is never "medium" on one screen and "big" on the next.
export const SIZE_CELLS = 5;

export function sizeLit(total: number): number {
  if (total <= 0) return 0;
  if (total < 10) return 1;
  if (total < 50) return 2;
  if (total < 150) return 3;
  if (total < 500) return 4;
  return SIZE_CELLS;
}
