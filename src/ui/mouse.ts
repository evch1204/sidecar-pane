// Ink has no mouse support, so the pane turns on the terminal's own mouse
// reporting and reads the escape sequences itself.
//
// 1000 reports presses and releases, 1002 adds motion while a button is held
// (which is what makes dragging work), and 1006 asks for the SGR form, which
// is the only one that survives past column 95.
//
// Ink's input parser hands each sequence to `useInput` on its own, with the
// leading escape already stripped, so parsing is a single regular expression.

export const MOUSE_ON = '\u001B[?1000h\u001B[?1002h\u001B[?1006h';
export const MOUSE_OFF = '\u001B[?1006l\u001B[?1002l\u001B[?1000l';

export type MouseKind = 'down' | 'up' | 'drag' | 'wheel';

export type MouseEvent = {
  kind: MouseKind;
  button: 'left' | 'middle' | 'right';
  // -1 for a wheel turn up, 1 for down, 0 otherwise.
  wheel: -1 | 0 | 1;
  // Zero-based, matching the rows and columns the pane draws.
  x: number;
  y: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
};

const SGR = /^\[<(\d+);(\d+);(\d+)([Mm])$/;

export function parseMouse(input: string): MouseEvent | null {
  const match = SGR.exec(input);
  if (!match) return null;

  const code = Number(match[1]);
  const x = Number(match[2]) - 1;
  const y = Number(match[3]) - 1;
  const released = match[4] === 'm';

  const wheel = (code & 64) !== 0;
  const moving = (code & 32) !== 0;
  const button = code & 3;

  return {
    kind: wheel ? 'wheel' : released ? 'up' : moving ? 'drag' : 'down',
    button: button === 1 ? 'middle' : button === 2 ? 'right' : 'left',
    wheel: wheel ? (button === 1 ? 1 : -1) : 0,
    x,
    y,
    shift: (code & 4) !== 0,
    alt: (code & 8) !== 0,
    ctrl: (code & 16) !== 0,
  };
}

// Two clicks in the same spot within this long count as a double click.
export const DOUBLE_CLICK_MS = 400;
