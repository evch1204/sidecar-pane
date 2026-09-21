// Drives the app with fake key presses and fake mouse reports, prints a few
// frames, and checks the things that have broken before. A failed check says
// what it expected and the run exits non-zero.
//   npx tsx scripts/smoke.tsx [folder] [--cols 40] [--rows 16]
// Colour is turned on so a check can find the cursor's own background in a
// frame, and stripped again before anything is printed: what you see is the
// layout, not the palette. Ink and the app are imported after that switch,
// because chalk decides once, when it is loaded.
process.env.FORCE_COLOR = '3';

import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {fileURLToPath} from 'node:url';

const {render} = await import('ink');
const {App} = await import('../src/ui/App');
const {theme} = await import('../src/ui/theme');

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name: string, fallback: number): number => {
  const at = argv.findIndex(arg => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (at < 0) return fallback;
  return Number(argv[at]!.includes('=') ? argv[at]!.split('=')[1] : argv[at + 1]) || fallback;
};

// `--cols 40` drives a narrow pane, which is where the chrome has to give way;
// `--rows 16` drives a short one, where everything is longer than the window.
const COLS = flag('cols', 72);
const ROWS = flag('rows', 40);
const taken = new Set(['--cols', '--rows']);
const folder = argv.find((arg, i) => !arg.startsWith('--') && !(i > 0 && taken.has(argv[i - 1]!)));
const target = folder ? path.resolve(folder) : repo;

const DOWN = '\u001B[B';
const UP = '\u001B[A';
const ESC = '\u001B';
const ENTER = '\r';

// A left click at a column and row, and a wheel notch, as the terminal reports them.
const click = (col: number, row: number) => `\u001B[<0;${col + 1};${row + 1}M`;
const wheelDown = (col: number, row: number) => `\u001B[<65;${col + 1};${row + 1}M`;
const wheelUp = (col: number, row: number) => `\u001B[<64;${col + 1};${row + 1}M`;

// The chrome above the stream: the bar, the tabs, the pills, the blanks a tall
// pane adds, and the reader's own header row.
const roomy = ROWS >= 28;
const tabsRow = roomy ? 2 : 1;
const streamTop = (head = 0) => (roomy ? 5 : 3) + (head ? (roomy ? head + 1 : head) : 0);
const height = (head = 0) => Math.max(3, ROWS - streamTop(head) - (roomy ? 2 : 1));

const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
// The background every row under the cursor is painted with.
const CURSOR_BG = `\u001B[48;2;${rgb(theme.surface2).join(';')}m`;
const plain = (text: string) => text.replace(/\u001B\[[0-9;]*m/g, '');
// The line number in a row's gutter, or 0 when the row has none. A diff row
// puts its sign where a file row has its second space.
const lineNo = (row: string): number => Number(/^[\s│▎]*(\d+) {2}/.exec(row)?.[1] ?? 0);
const diffNo = (row: string): number => Number(/^[\s│▎]*(\d+) [+−] /.exec(row)?.[1] ?? 0);
// Markdown spells a sentence the same way formatted and as written, once the
// markers it swallows are gone.
const bare = (row: string): string => row.replace(/[*`_[\]|#>]/g, '').replace(/\s+/g, ' ').trim();

let failed = 0;
const check = (ok: boolean, what: string) => {
  if (ok) return;
  failed++;
  console.error(`  FAILED: ${what}`);
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// One rendered pane, driven by keys and read back from its last frame.
function pane(root: string) {
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => stdin,
    ref: () => stdin,
    unref: () => stdin,
  });

  const frames: string[] = [];
  const stdout = Object.assign(new PassThrough(), {columns: COLS, rows: ROWS, isTTY: true});
  stdout.on('data', chunk => frames.push(String(chunk)));

  const app = render(<App root={root} interactive />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    exitOnCtrlC: false,
  });

  const frame = () => frames.at(-1) ?? '';
  const press = async (...keys: string[]) => {
    for (const key of keys) {
      stdin.write(key);
      await wait(60);
    }
  };

  const show = async (label: string) => {
    await wait(400);
    console.log(`\n=== ${label}\n${plain(frame())}`);
  };

  // The rows of the stream only: the tabs and the pills carry the cursor's
  // background too, and they are chrome.
  const stream = (head = 0) => frame().split('\n').slice(streamTop(head), streamTop(head) + height(head));
  const text = (head = 0) => stream(head).map(plain);
  const cursorRows = (head = 0) => stream(head).filter(row => row.includes(CURSOR_BG)).map(plain);
  const cursorRow = (head = 0) => cursorRows(head)[0] ?? '';
  const cursorAt = (head = 0) => stream(head).findIndex(row => row.includes(CURSOR_BG));

  // The line numbers a numbered view is showing. Only the gutter counts: the
  // left line, the change bar and spaces are all that may come before one.
  const numbers = (head = 0) => text(head).map(lineNo).filter(Boolean);

  const quit = async () => {
    stdin.write('q');
    await app.waitUntilExit();
  };

  // Step down until the cursor is on the row that says `what`.
  const onto = async (what: string, head = 0) => {
    for (let n = 0; n < 60; n++) {
      if (cursorRow(head).includes(what)) return true;
      await press(DOWN);
    }

    check(false, `the cursor should have reached the row for ${what}`);
    return false;
  };

  return {press, show, frame, text, cursorRow, cursorRows, cursorAt, numbers, onto, quit};
}

// ---- the repo itself -------------------------------------------------------

const {press, show, text, cursorRow, cursorRows, cursorAt, numbers, onto, quit} = pane(target);

await wait(1800); // first git, transcript and snapshot read
await show('changes: the bar, the tabs, the pills and the stream');

await press(DOWN, DOWN, ENTER);
await show('changes: a row of the open turn, entered');

await press('m');
await show('the View menu, open over a dimmed pane');

await press(ESC, 'v');
await show('changes: grouped by file');

await press('v');
await wait(600);
await press(ENTER);
await wait(600);
await show('changes: everything since the last commit, first file opened in place');

await press(']', ENTER);
await show('changes: jumped to a hunk and folded it');

await press(wheelDown(20, streamTop() + 2), wheelDown(20, streamTop() + 2));
await show('changes: wheel scrolled the stream, cursor left alone');

await press(click(16, tabsRow));
await wait(300);
await press(DOWN, DOWN, ENTER, DOWN, DOWN, ENTER, DOWN, DOWN, ENTER);
await wait(500);
await show('files: a folder opened, then a file peeked in place');

// ---- the peek's last row grows the peek, in place --------------------------

await press(ESC, ESC);
await wait(300);
const long = 'package-lock.json';
const moreCount = () => {
  const row = text().find(line => /⋯ \d+ more line/.test(line));
  return row ? Number(/⋯ (\d+) more line/.exec(row)![1]) : 0;
};

if (await onto(long)) {
  await press(ENTER);
  await wait(500);
  await show(`files: ${long} peeked, and the row that shows more of it`);

  // One step down from the file's own row is that last row, whatever the peek
  // is showing: nothing in between can hold the cursor.
  await press(DOWN);
  check(cursorRow().includes('more line'), `the cursor should land on the "more lines" row, not on "${cursorRow().trim()}"`);
  check(cursorRows().length === 1, `exactly one row should carry the cursor background, not ${cursorRows().length}`);
  const offered = moreCount();
  const deepest = Math.max(0, ...numbers());
  check(offered > 80, `the peek of a long file should offer more lines, not ${offered}`);

  await press(ENTER);
  await wait(400);
  await show('files: the same peek, grown by one press of the "more lines" row');
  check(moreCount() === offered - 40, `"more lines" should have dropped by 40 from ${offered}, and it says ${moreCount()}`);
  check(Math.max(0, ...numbers()) >= deepest + 30, `the peek should be showing about 40 more lines than the ${deepest} it stopped at`);
  check(text().some(row => row.includes(long)), `the tree row for ${long} should still be on screen`);
  check(cursorRows().length === 1, `exactly one row should carry the cursor background, not ${cursorRows().length}`);

  await press(ENTER);
  await wait(400);
  check(moreCount() === offered - 80, `a second press should drop "more lines" to ${offered - 80}, and it says ${moreCount()}`);
}

// ---- the reader: the wheel, the scrollbar, and the cursor ------------------

await press('o');
await wait(600);
await show(`files: o read the whole of ${long}`);
const first = numbers(1)[0] ?? 0;
check(first === 1, `the reader should open on line 1, not on line ${first}`);

const notch = streamTop(1) + 2;
await press(...Array.from({length: 5}, () => wheelDown(10, notch)));
const wheeled = numbers(1)[0] ?? 0;
const top = text(1)[0];
check(Math.abs(wheeled - first - 15) <= 3, `five wheel notches should move about fifteen lines, and it moved ${wheeled - first}`);
await show('files: the reader, five wheel notches down');
await wait(900);
check(text(1)[0] === top, 'the page should still be where the wheel left it after 900 ms');
await wait(2600);
check(text(1)[0] === top, 'the page should still be where the wheel left it after a git read');

await press(...Array.from({length: 5}, () => wheelUp(10, notch)));
check((numbers(1)[0] ?? 0) === first, `wheeling back up should return to line ${first}, not line ${numbers(1)[0]}`);

await press(click(COLS - 1, streamTop(1) + height(1) - 2));
const jumped = numbers(1)[0] ?? 0;
check(jumped > first + 10, `a click low in the scrollbar should jump the page, and it went to line ${jumped}`);
await show('files: the reader, jumped by a click in the scrollbar column');

await press(DOWN);
await wait(200);
check(cursorRows(1).length === 1, 'the cursor row should be back on screen after ↓');

// ---- markdown keeps its place through the raw toggle ----------------------
// A formatted row covers a range of source lines, so the two shapes only line
// up through that range. Falling back to the nearest row index turned line
// 248 of the plan into a paragraph from around line 125, which is why the
// check is against the file on disk and not just against itself.

await press(ESC);
await wait(300);
const plan = path.join(target, 'PLAN.md');
if (fs.existsSync(plan) && (await onto('PLAN.md'))) {
  const doc = fs.readFileSync(plan, 'utf8').split('\n');
  await press(ENTER);
  await wait(400);
  await press('o');
  await wait(700);
  await show('files: PLAN.md in the reader, formatted');

  // Far enough in that the two shapes have drifted apart, and on the first
  // row of a plain paragraph, which both of them spell the same way. A row
  // with a marker in it is no use: one shape swallows the marker.
  // Two spaces in a row mean columns, and a table cell is cut to its column.
  const prose = (row: string) => /^[A-Za-z][^*`_|#>[\]•○✓↪]{19,}/.test(row.trim()) && !/ {2}/.test(row.trim());
  await press(' ', ' ', ' ', ' ');
  let words = '';
  for (let page = 0; page < 6 && !words; page++) {
    const rows = text(1);
    const here = cursorAt(1);
    const want = rows.findIndex((row, i) => i > 0 && (rows[i - 1] ?? '').trim() === '' && prose(row));
    if (want < 0 || here < 0) {
      await press(' ');
      continue;
    }

    // The row is on screen, so stepping onto it moves nothing else.
    await press(...Array.from({length: Math.abs(want - here)}, () => (want > here ? DOWN : UP)));
    const row = text(1)[cursorAt(1)] ?? '';
    if (prose(row)) words = bare(row).slice(0, 20);
    else await press(' ');
  }

  check(words !== '', 'the cursor should have reached the first line of a plain paragraph');
  if (words) {
    await press('r');
    await wait(400);
    await show(`files: PLAN.md as written, the cursor still on "${words}"`);
    const was = lineNo(cursorRow(1));
    check(bare(cursorRow(1)).includes(words), `r should keep the cursor on "${words}", and it is on "${cursorRow(1).trim()}"`);
    check(bare(doc[was - 1] ?? '').includes(words), `line ${was} of the file should be the one that says "${words}", and it says "${doc[was - 1]}"`);
    await press('r');
    await wait(400);
    await press('r');
    await wait(400);
    check(lineNo(cursorRow(1)) === was, `r twice should come back to source line ${was}, and it landed on ${lineNo(cursorRow(1))}`);
  }
}

await press('m');
await show("the View menu in Files: only this view's options");

await press(ESC, ESC, '3');
await show('agents: every subagent, under the prompt that started it');

await press(DOWN, ENTER);
await show('agents: one agent opened');

await press('4');
await wait(1200);
await show('usage: the Agents tab is hidden again unless something runs');

await press('M', DOWN);
await show('the mouse turned off: the footer keeps saying so');
await press('M');
await quit();

// ---- a file with several changed places ------------------------------------
// `]` jumps the peek to the next change. Git is read every few seconds, and
// that read used to undo the jump a moment after it landed, so this waits one
// out and looks again.

const stage = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-smoke-')));
const project = path.join(stage, 'demo');
fs.mkdirSync(project, {recursive: true});
process.env.SIDECAR_HOME = path.join(stage, 'sidecar');
process.env.SIDECAR_CLAUDE_HOME = path.join(stage, 'claude');

const body = Array.from({length: 300}, (_, i) => `line ${i + 1} of a long, dull file`);
const write = () => fs.writeFileSync(path.join(project, 'long.txt'), body.join('\n') + '\n');
const git = (...args: string[]) => execFileSync('git', ['-C', project, ...args], {stdio: 'ignore'});
write();
git('init', '-q');
git('add', '-A');
git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'first');
for (const n of [40, 120, 250]) body[n - 1] = `line ${n} changed by Claude`;
write();

const b = pane(project);
await wait(1800);
await b.press('2');
await wait(600);
if (await b.onto('long.txt')) {
  await b.press(ENTER);
  await wait(900);
  await b.show('files: a file with three changed places, peeked at the first');
  const strip = () => b.text().find(row => /lines \d+–\d+/.test(row))?.trim() ?? '';
  const opened = strip();
  check(/lines 3[0-9]–/.test(opened), `the peek should open on the first change, and it says "${opened}"`);

  await b.press(']');
  await wait(400);
  const jumped = strip();
  check(jumped !== '' && jumped !== opened, `] should jump the peek to the next change, and it still says "${jumped}"`);
  await b.show('files: ] jumped the peek to the second changed place');
  await wait(3500);
  check(strip() === jumped, `the peek should still say "${jumped}" after a git read, and it says "${strip()}"`);
  await b.show('files: the same place, three and a half seconds later');
}

// ---- o on a line of a diff opens the reader on that line ------------------
// The reader asks for the line three rows down and the scroll anchor puts it
// there. It used to be guessed from the line number, which knows nothing
// about the rows above the file.

await b.press('1', 'v', 'v');
await wait(700);
let wanted = 0;
for (let n = 0; n < 40 && !wanted; n++) {
  const row = b.cursorRow();
  wanted = diffNo(row);
  // A closed file row or a folded hunk opens; anything else steps on.
  if (!wanted) await b.press(row.trimStart().startsWith('▸') ? ENTER : DOWN);
}

check(wanted > 0, 'the cursor should have reached a changed line of the diff');
if (wanted) {
  await b.press('o');
  await wait(700);
  await b.show(`changes: o opened the reader on line ${wanted}`);
  const where = b.text(1).findIndex(row => lineNo(row) === wanted);
  check(b.cursorRows(1).length === 1, `exactly one row should carry the cursor background, not ${b.cursorRows(1).length}`);
  check(lineNo(b.cursorRow(1)) === wanted, `the reader should open on line ${wanted}, not on line ${lineNo(b.cursorRow(1))}`);
  check(where === 3, `line ${wanted} should sit three rows down the stream, not ${where}`);
}

await b.quit();
fs.rmSync(stage, {recursive: true, force: true});

if (failed) {
  console.error(`\n${failed} check${failed === 1 ? '' : 's'} failed at ${COLS}x${ROWS}.`);
  process.exit(1);
}

console.log(`\nAll checks passed at ${COLS}x${ROWS}.`);
