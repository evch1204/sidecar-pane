// Drives the app with fake key presses and fake mouse reports, prints a few
// frames, and checks the things that have broken before. A failed check says
// what it expected and the run exits non-zero.
//   npx tsx scripts/smoke.tsx [folder] [--cols 40] [--rows 16]
// Colour is turned on so a check can find the cursor's own background in a
// frame, and stripped again before anything is printed: what you see is the
// layout, not the palette. Ink and the app are imported after that switch,
// because chalk decides once, when it is loaded.
process.env.FORCE_COLOR = '3';
// The checks below were written against a pane with no opening and no side
// panel, and they still run against one. The opening and the panel have
// checks of their own at the end, which put these back the way they need.
// The opening is App's `opening` prop, which cli.tsx sets from the flag and
// the environment; this script renders App itself, so it passes it.
process.env.SIDECAR_PANEL = 'off';

import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {fileURLToPath} from 'node:url';

const {render} = await import('ink');
const {App} = await import('../src/ui/App');
const {theme} = await import('../src/ui/theme');
const {OPENING, openingCard, tPushStart} = await import('../src/ui/opening');

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
// The one rule for a row that opens or closes in place: a chevron first, after
// whatever left line or tree guide comes before it.
const opensInPlace = (row: string): boolean => /^[\s│]*[▸▾] /.test(row);
// The word the footer puts after `enter`: what the row under the cursor does.
const verbOf = (row: string): string => /^\s*enter (.+?)(?: {2,}|$)/.exec(row)?.[1] ?? '';
// Markdown spells a sentence the same way formatted and as written, once the
// markers it swallows are gone.
const bare = (row: string): string => row.replace(/[*`_[\]|#>]/g, '').replace(/\s+/g, ' ').trim();
// Which of the reader's two pills is lit. The lit one is drawn on the same
// background as the cursor, and it is the only word on the head row that is,
// besides the way back to the tree.
const litPill = (row: string): string => {
  for (const part of row.split(CURSOR_BG).slice(1)) {
    const word = plain(part).trim().split(/\s{2,}/)[0] ?? '';
    if (word === 'Page' || word === 'Source') return word;
  }

  return '';
};

let failed = 0;
const check = (ok: boolean, what: string) => {
  if (ok) return;
  failed++;
  console.error(`  FAILED: ${what}`);
};

// Checks that cannot run against this folder: they are counted, and said once
// why, rather than passed.
let skipped = 0;
const said = new Set<string>();
const skip = (n: number, why: string) => {
  skipped += n;
  if (said.has(why)) return;
  said.add(why);
  console.log(`skipped: ${why}`);
};
const NO_CHATS = 'this folder has no chats, so the stream checks did not run';
const ONE_FOLDER = 'this repository has one folder, so the workspace checks did not run';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Every frame any pane printed, for the checks that are about all of them.
const seen: {shot: string; cols: number}[] = [];

// One rendered pane, driven by keys and read back from its last frame. The
// size is the one the flags asked for unless a check needs one of its own.
function pane(root: string, size: {cols: number; rows: number} = {cols: COLS, rows: ROWS}) {
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => stdin,
    ref: () => stdin,
    unref: () => stdin,
  });

  const frames: string[] = [];
  const stdout = Object.assign(new PassThrough(), {columns: size.cols, rows: size.rows, isTTY: true});
  stdout.on('data', chunk => frames.push(String(chunk)));

  const app = render(<App root={root} interactive opening={false} />, {
    stdin: stdin as unknown as NodeJS.ReadStream,
    stdout: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    exitOnCtrlC: false,
  });

  // A write with no row break in it is an escape the pane sent the terminal
  // (motion reporting on or off, the clipboard), not a frame.
  const frame = () => frames.filter(chunk => chunk.includes('\n')).at(-1) ?? '';
  const press = async (...keys: string[]) => {
    for (const key of keys) {
      stdin.write(key);
      await wait(60);
    }
  };

  const show = async (label: string) => {
    await wait(400);
    const shot = plain(frame());
    seen.push({shot, cols: size.cols});
    console.log(`\n=== ${label}\n${shot}`);
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

  // Every frame this pane has written, oldest first. The first one is drawn
  // before anything has been read, and it is gone again in a few hundred
  // milliseconds, so it can only be looked at afterwards.
  const shots = () => frames.map(plain).filter(shot => shot.includes('\n'));
  // The footer says what Enter will do on the row under the cursor.
  const foot = () => [...frame().split('\n')].map(plain).reverse().find(row => row.trim()) ?? '';
  // Everything the pane has written to the terminal, escapes and all: the
  // clipboard goes out through one of them and never appears in a frame.
  const raw = () => frames.join('');

  return {press, show, frame, foot, raw, shots, text, cursorRow, cursorRows, cursorAt, numbers, onto, quit};
}

// ---- the repo itself -------------------------------------------------------

const {press, show, frame, text, cursorRow, cursorRows, cursorAt, numbers, onto, quit} = pane(target);

// Every row of the frame that carries the cursor's background, the chrome
// included: Home has no tabs or pills to share it with.
const litRows = (shot: string) => shot.split('\n').filter(row => row.includes(CURSOR_BG)).map(plain);

await wait(1800); // first git, transcript and snapshot read
await show('home: where you are, what is happening, what today has been, where each key goes');

// ---- a: the pane opens on Home -----------------------------------------------
{
  const shot = plain(frame());
  check(shot.includes('GO TO'), 'the first frame should be Home, with its GO TO rows');
  const lit = litRows(frame());
  check(lit.length === 1 && /1 {2}Changes/.test(lit[0] ?? ''), `the cursor should start on "1  Changes", and it is on "${lit[0]?.trim()}"`);
  check(!shot.split('\n').slice(0, 4).some(row => /Changes {3}Files/.test(row)), 'Home should have no tab row');
}

// The folders git lists that are still on disk.
const onDisk = execFileSync('git', ['-C', target, 'worktree', 'list', '--porcelain'], {encoding: 'utf8'})
  .split('\n')
  .filter(line => line.startsWith('worktree '))
  .filter(line => fs.existsSync(line.slice(9).trim())).length;

// The pane reads the worktrees on a poll of its own. Home's `w  Workspaces`
// row, and its count, only appear once it has read more than one folder, so
// that row is what is waited for before anything counts or steps through them.
const homeHasFolders = () => /\bw {2}Workspaces\b.*\d+ active/.test(plain(frame()));
const waitForFolders = async (): Promise<boolean> => {
  for (let n = 0; n < 40 && !homeHasFolders(); n++) await wait(125);
  return homeHasFolders();
};
if (onDisk > 1) check(await waitForFolders(), `this repository has ${onDisk} folders, and Home's "w  Workspaces" row never showed a count, so the pane never read them`);

await press('1');
await wait(400);
// The first frames are the card while the chats are read; after that the
// card stays only where Claude Code has never been run.
const readingCard = () => /reading/.test(plain(frame())) && !plain(frame()).includes('no chats yet');
for (let n = 0; n < 30 && readingCard(); n++) await wait(100);
await show('changes: the bar, the tabs, the pills and the stream');
// Every check about the stream needs turns in it. A folder with none shows
// the card instead, and those checks are skipped there, not passed.
const hasChats = !plain(frame()).includes('no chats yet');

// The Workspaces list heads the stream whenever there is no panel and the
// repository has more than one folder. The cursor starts under it, on the
// newest thing in the stream.
const listAt = () => text().findIndex(row => row.trim().startsWith('WORKSPACES'));
const listRows = (): number => {
  const rows = text();
  const at = listAt();
  if (at < 0) return 0;
  const end = rows.findIndex((row, i) => i > at && !row.trim());
  return (end < 0 ? rows.length : end) - at - 1;
};
// The row the cursor is on, by where it is and what it says: under the list,
// and a row of the stream itself (a turn, or a branch that landed), never one
// of the folders. A short pane has already scrolled the list away to show it.
if (!hasChats) skip(4, NO_CHATS);
else {
  const at = listAt();
  const n = listRows();
  const lit = cursorAt();
  check(lit >= 0 && lit > (at < 0 ? -1 : at + n), `the cursor should start under the Workspaces list (rows ${at}..${at + n}), and it is on row ${lit}, "${cursorRow().trim()}"`);
  check(/^ [▾▸⠀-⣿] /.test(cursorRow()) || cursorRow().includes('merged'), `the cursor should start on the newest turn or landing, and it is on "${cursorRow().trim()}"`);

  // Every folder git lists that is still on disk is a row of the list, so a
  // repository with more than one and no list is a failure. The list is
  // counted from the top of the stream: `g` goes to its first row, and a
  // notch of the wheel brings its head row back in.
  await press('g', wheelUp(20, streamTop() + 2));
  await wait(200);
  if (onDisk < 2) skip(1, ONE_FOLDER);
  else {
    const listed = listRows();
    check(listed >= onDisk, `this repository has ${onDisk} folders, so the Workspaces list should have at least ${onDisk} rows, and it has ${listed}`);
  }

  // A branch that landed after the newest turn began sits above it.
  const turnHead = () => /^ [▾⠀-⣿] /.test(cursorRow());
  for (let n = 0; n < 40 && !turnHead(); n++) await press(DOWN);
  check(turnHead(), `the cursor should be on the newest turn, and it is on "${cursorRow().trim()}"`);

  await press(DOWN, DOWN, ENTER);
  await show('changes: a row of the open turn, entered');
}

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
// Every row of the tree opens something: a folder in place, a file into a peek
// under it. So every row of it starts with a chevron.
const tree = text().filter(row => row.trim());
const notTree = tree.find(row => !opensInPlace(row));
check(tree.length > 2 && !notTree, `every row of the tree should start with a chevron, and "${notTree?.trim()}" does not`);

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
  await show('files: PLAN.md as a page');

  // ---- the two pills, and what each of them shows -------------------------
  // The page is the default for markdown, and the pill says so. The columns of
  // the pills come from the frame, never from a guess about where they landed.
  const headAt = () => frame().split('\n').findIndex(row => plain(row).includes('‹ Files'));
  const headRow = () => frame().split('\n')[headAt()] ?? '';
  check(litPill(headRow()) === 'Page', `the Page pill should be lit, and the head row reads "${plain(headRow()).trim()}"`);
  check(text(1).some(row => row.includes('━')), 'the rule under the title should be on screen in Page view');
  check(numbers(1).length <= 2, `a page has no line numbers, and it showed ${numbers(1).length}`);

  await press('r');
  await wait(400);
  await show('files: PLAN.md as written, line numbers and the Source pill');
  check(litPill(headRow()) === 'Source', `r should light the Source pill, and the head row reads "${plain(headRow()).trim()}"`);
  // Counted from the file's first row: a file a turn changed today has a
  // "Changed by" block above it, and on a short pane that block is most of
  // the window.
  const source = text(1).slice(Math.max(0, text(1).findIndex(row => lineNo(row) > 0)));
  // A blank line has its number and nothing after it.
  const numbered = source.filter(row => /^[\s│▎]*\d+(?: |$)/.test(row)).length;
  check(numbered > source.length / 2, `Source should number its lines, and it numbered ${numbered} of ${source.length} rows`);

  await press(click(plain(headRow()).indexOf(' Page ') + 1, headAt()));
  await wait(400);
  await show('files: the Page pill clicked, and the page is back');
  check(litPill(headRow()) === 'Page', 'clicking the Page pill should bring the page back');
  check(text(1).some(row => row.includes('━')), 'the title rule should be back on screen');

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

// ---- b: h goes Home from anywhere -------------------------------------------
await press('1', 'h');
await wait(300);
check(plain(frame()).includes('GO TO'), '`h` from Changes should go Home');
// Never `w` blind: Home says how many folders there are once they are read.
const folders = onDisk > 1 && (await waitForFolders());
if (onDisk > 1 && !folders) check(false, `Home's "w  Workspaces" row never showed a count, so \`w\` was not pressed`);
await press('1');
await wait(300);

// ---- d: w picks the next workspace -------------------------------------------
// The pills row's right end says which folder the stream is about. Before `w`
// that is this folder's scope pill; after it, the folder `w` picked, which is
// also the one the Workspaces list marks. A folder with no chats has the
// card where the list would be, so there only the pills row is checked.
if (onDisk < 2) skip(7, ONE_FOLDER);
else if (folders) {
  const pillsRow = () => plain(frame()).split('\n').find(row => row.includes('By turn')) ?? '';
  const nameOf = (row: string) => /\bin (.+?)\s*▾?\s*$/.exec(row)?.[1]?.trim() ?? '';
  // A narrow pane gives the pills row's right end up to the grouping pills,
  // and then the list's own mark is the one that says which folder it is.
  // By turn, where the list is, and from the top of the stream.
  const byTurn = () => plain(frame().split('\n').find(row => plain(row).includes('By turn'))?.split(CURSOR_BG)[1] ?? '').trim().startsWith('By turn');
  for (let n = 0; n < 3 && !byTurn(); n++) await press('v');
  await press(...Array.from({length: 12}, () => UP));
  await wait(300);
  // With the panel off, the list at the head of the stream has every folder
  // in it before one of them is stepped to.
  if (hasChats) {
    for (let n = 0; n < 40 && listRows() < 2; n++) await wait(125);
    check(listRows() >= 2, `the Workspaces list should show at least two folders before \`w\`, and it shows ${listRows()}`);
  }

  const before = nameOf(pillsRow());
  // The picked row's name: its left side only. The mark before it spins and
  // the sentence after it carries an elapsed time, and neither is the row.
  const markedRow = () => /^ ▎ \S (.+?)(?: {2,}|$)/.exec(text().find(row => row.startsWith(' ▎')) ?? '')?.[1]?.trim() ?? '';
  const markedBefore = markedRow();
  await press('w');
  await wait(1200);
  await show('changes: w picked the next workspace');
  const after = nameOf(pillsRow());
  const marked = markedRow();
  if (hasChats) check(marked !== '' && marked !== markedBefore, `w should mark the next folder in the Workspaces list, and it marks "${marked.trim()}"`);
  if (before) {
    check(after !== '' && after !== before, `w should pick another folder, and the pills row still reads "in ${after}"`);
    check(!/^all \d+ worktrees/.test(after), `w from this folder should pick the next folder before every folder at once, and the pills row reads "in ${after}"`);
    check(!pillsRow().includes('▾'), 'a picked folder is named, not offered as a scope to widen');
    // Both name the folder by its branch, each cut to its own room.
    const stem = (name: string) => name.replace(/…$/, '');
    const shorter = Math.min(stem(after).length, stem(marked).length);
    if (hasChats) check(shorter > 0 && stem(after).slice(0, shorter) === stem(marked).slice(0, shorter), `the Workspaces list should mark "${after}", and it marks "${marked.trim()}"`);
  }
  await press('h');
  await wait(300);
  check(plain(frame()).includes('Good ') && !plain(frame()).includes(`in ${after}`), 'Home should never be about a picked folder');
  if (hasChats) {
    await press('1', UP, UP, UP, UP, UP, UP, UP, UP, UP, UP, ESC);
    await wait(400);
    check(nameOf(pillsRow()) === before && markedRow() === markedBefore, `esc at the top of a picked folder should go back to "${before || markedBefore}", and it reads "${nameOf(pillsRow()) || markedRow()}"`);
  } else skip(before ? 3 : 4, NO_CHATS);
}

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
// Uncommitted is one row a file, and each of them opens its diff in place.
const flat = b.text().filter(row => row.trim());
const notFlat = flat.find(row => !opensInPlace(row));
check(flat.length > 0 && !notFlat, `every row of Uncommitted should start with a chevron, and "${notFlat?.trim()}" does not`);

// And says so in the footer, in the word for what Enter does there.
if (await b.onto('long.txt')) {
  check(verbOf(b.foot()) === 'diff', `a file row should offer its diff, and the footer reads "${b.foot().trim()}"`);
}

let wanted = 0;
for (let n = 0; n < 40 && !wanted; n++) {
  const row = b.cursorRow();
  wanted = diffNo(row);
  // A closed file row or a folded hunk opens; anything else steps on. A file
  // row is a chevron in the flat grouping and a bold status letter in the
  // other two, so either shape counts — but only while it is still closed,
  // or Enter would shut again what the press before it opened.
  const head = row.trimStart();
  const opens = head.startsWith('▸') || (/^[AMDR?]\s/.test(head) && !/\d+ hunks?/.test(head));
  if (!wanted) await b.press(opens ? ENTER : DOWN);
}

await b.show('changes: the file opened, and its hunks open under it');
// A hunk folds where it is, so its header is a chevron too, open side up.
check(b.text().some(row => /^ │\s+▾ /.test(row)), 'an open hunk should be headed by an open chevron');

if (!wanted) await b.show('changes: the cursor never reached a line of the diff');
check(wanted > 0, 'the cursor should have reached a changed line of the diff');
if (wanted) {
  // `y` puts the place, not the code, on the clipboard, through the escape
  // the terminal reads. Nothing about it shows in a frame but the notice.
  await b.press('y');
  await wait(300);
  check(b.raw().includes('\u001B]52;c;'), 'y should write the clipboard escape to the terminal');
  check(plain(b.frame()).includes(`copied long.txt:${wanted}`), `and the footer should say what it copied, and it reads "${b.foot().trim()}"`);

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

// ---- C: the first frame, and a folder nothing has ever been typed in -------
// The card stands in for the stream twice: on the way in, while the chats are
// being read, and for good where there are none. The first of those is over in
// a moment, so it is read back out of the frames the pane has already written
// rather than off the screen.

{
  const quiet = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-quiet-')));
  const project = path.join(quiet, 'nothing');
  fs.mkdirSync(project, {recursive: true});
  execFileSync('git', ['-C', project, 'init', '-q'], {stdio: 'ignore'});
  // A home of its own, so the folder has no chats whatever the machine running
  // this has.
  process.env.SIDECAR_HOME = path.join(quiet, 'sidecar');
  process.env.SIDECAR_CLAUDE_HOME = path.join(quiet, 'claude');

  // Three rows of blocks with nothing else on them: the name, in the block
  // font and its shadow edge, or in the pixel font where the pane is narrow.
  const wordmark = (shot: string): boolean => {
    const rows = shot.split('\n').map(row => row.trim());
    const big = (row = '') => row.length > 6 && /^[█▀▄╗╔╝╚║═ ]+$/.test(row);
    return rows.some((_, i) => big(rows[i]) && big(rows[i + 1]) && big(rows[i + 2]));
  };

  // With the opening skipped the first frame is Home, and Home's own rows say
  // the read is still going: the card is only the empty stream's.
  const c = pane(project);
  const first = c.shots()[0] ?? '';
  check(first.includes('GO TO') && !wordmark(first), 'the first frame should be Home, not the card');
  check(/reading…/.test(first), `the first frame should say it is reading, and it says "${first.split('\n').find(row => row.includes('NOW'))?.trim()}"`);
  check(!first.includes('By turn'), 'the first frame should have no pills yet');

  await wait(1800);
  // The pane opens on Home; the card is the empty state of the stream.
  await c.press('1');
  await wait(300);
  await c.show('a folder Claude Code has never been run in');
  const rest = plain(c.frame());
  check(wordmark(rest), 'a folder with no chats should show the wordmark');
  check(rest.includes('no chats yet'), 'a folder with no chats should say so');
  check(rest.includes('By turn'), 'the pills should be back once the read is done');
  await c.quit();
  fs.rmSync(quiet, {recursive: true, force: true});
}

// ---- c and e: the side panel, by the width of the pane -----------------------
// A home of its own, so `b` writes its choice somewhere that is thrown away
// rather than into the owner's own preferences.
{
  const away = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-panel-')));
  process.env.SIDECAR_HOME = path.join(away, 'sidecar');
  delete process.env.SIDECAR_PANEL;

  // Where a row's content starts: the column of `GO TO` on Home, less the
  // two a page row keeps before its text.
  const contentAt = (shot: string) => (plain(shot).split('\n').find(row => row.includes('GO TO')) ?? '').indexOf('GO TO') - 2;
  const rowsOf = (shot: string) => plain(shot).split('\n');

  // A fresh home means a first snapshot of the whole repository, so Home is
  // waited for rather than a fixed time.
  const home = async (shot: () => string) => {
    for (let n = 0; n < 40 && !plain(shot()).includes('GO TO'); n++) await wait(250);
  };

  const p = pane(target, {cols: 72, rows: 40});
  await home(p.frame);
  await p.show('72 columns: the panel folded to a strip');
  check(rowsOf(p.frame())[1]?.[1] === '»', `at 72 columns the panel should be folded, with » in row 1 column 1, and row 1 reads "${rowsOf(p.frame())[1]}"`);
  check(contentAt(p.frame()) === 9, `beside the folded panel the content should start 9 columns in, and it starts ${contentAt(p.frame())}`);

  // The folded strip peeks open under a pointer resting on it, and folds
  // again once the pointer is away. A pointer crossing the strip is a report
  // per cell, and none of them may redraw the pane on its own.
  const move = (col: number, row: number) => `\u001B[<35;${col + 1};${row + 1}M`;
  const drawn = p.shots().length;
  await p.press(...Array.from({length: 12}, (_, i) => move(1 + (i % 6), 3 + (i % 5))));
  await wait(400);
  const peeked = rowsOf(p.frame());
  check(peeked[1]?.includes('«') === true && peeked[2]?.includes('Home') === true, `resting on the folded panel should peek it open, and rows 1 and 2 read "${peeked[1]}" and "${peeked[2]}"`);
  check(p.shots().length - drawn <= 3, `twelve motion reports should redraw the pane once, and it drew ${p.shots().length - drawn} frames`);
  await p.press(move(40, 5));
  await wait(400);
  check(rowsOf(p.frame())[1]?.[1] === '»', 'moving off the panel should fold it again');

  await p.press('b');
  await wait(400);
  await p.show('72 columns: b opened the panel');
  const opened = rowsOf(p.frame());
  check(opened[1]?.includes('«') === true && opened[2]?.includes('Home') === true, `b should open the panel, and rows 1 and 2 read "${opened[1]}" and "${opened[2]}"`);
  check(contentAt(p.frame()) === 22, `beside the open panel the content should start 22 columns in, and it starts ${contentAt(p.frame())}`);

  // A click on the panel's own row goes where it says, whatever column of it.
  const changesRow = opened.findIndex(row => /^.1 {2}Changes/.test(row));
  await p.press(click(14, changesRow));
  await wait(400);
  check(rowsOf(p.frame()).some(row => row.includes('By turn')), 'a click on the panel\'s Changes row should open Changes');
  check(!rowsOf(p.frame()).some(row => /Changes {3}Files {3}/.test(row)), 'with the panel on, the tab row is not drawn');
  await p.quit();

  const n = pane(target, {cols: 40, rows: 40});
  await home(n.frame);
  check(contentAt(n.frame()) === 0, `at 40 columns there should be no panel, and the content starts ${contentAt(n.frame())} columns in`);
  await n.press('1');
  await wait(400);
  await n.show('40 columns: no panel, and the tab row is back');
  check(rowsOf(n.frame()).slice(1, 4).some(row => row.includes('Changes') && row.includes('Files')), 'at 40 columns the tab row should be back');
  await n.quit();

  process.env.SIDECAR_PANEL = 'off';
  fs.rmSync(away, {recursive: true, force: true});
}

// ---- f: the opening, drawn at three moments -----------------------------------
// Pure, so it is called directly: the card before anything, once the name is
// in, and once it is finished and has held. The stat bar is git's own: the
// share of today's lines that were added, in pluses.
{
  const cols = 62;
  const today = {added: 4180, removed: 1630};
  const input = {
    cols, height: 30, folder: 'jiaolong', branch: 'improve-pane-layout', chats: 3,
    counts: {chats: 3, turns: 41, agents: 12}, loaded: true, today, frame: 0, countsAt: 900, loadedAt: 1400,
  };
  const end = tPushStart({...input, t: 0}) ?? 0;
  check(end > OPENING.HOLD, `the card should hold before Home arrives, and it would push at ${end} ms`);
  for (const t of [0, 1300, end]) {
    const rows = openingCard({...input, t}).map(line => plain(line.segs.map(s => s.text).join('')));
    const wrong = rows.find(row => [...row].length !== cols - 1);
    check(!wrong, `every row of the opening at ${t} ms should be ${cols - 1} wide, and one is ${[...(wrong ?? '')].length}`);
    if (t !== end) continue;
    const bar = rows.map(row => /[+−]{10,}/.exec(row)?.[0] ?? '').find(Boolean) ?? '';
    const want = Math.round((40 * today.added) / (today.added + today.removed));
    check(bar.length === 40 && [...bar].filter(ch => ch === '+').length === want, `the stat bar should be 40 cells with ${want} pluses, and it reads "${bar}"`);
  }
}

// ---- what must be true of every frame --------------------------------------
// A row wider than the pane wraps in a real terminal and pushes the rest of
// the frame down, so nothing below it is where it says it is.
const overflowed = seen.filter(({shot, cols}) => shot.split('\n').some(row => [...row].length > cols));
check(overflowed.length === 0, `no row should be wider than the pane, and ${overflowed.length} frames have one`);
// The scope has a key, a menu item and a pill of its own; the footer's columns
// belong to the row under the cursor.
const lastRow = (shot: string) => [...shot.split('\n')].reverse().find(row => row.trim()) ?? '';
const scoped = seen.filter(({shot}) => lastRow(shot).includes('w worktree')).length;
check(scoped === 0, `no footer should spend a hint on the scope key, and ${scoped} frames do`);

if (failed) {
  console.error(`\n${failed} check${failed === 1 ? '' : 's'} failed at ${COLS}x${ROWS}.`);
  process.exit(1);
}

console.log(`\nAll checks passed at ${COLS}x${ROWS}${skipped ? `, and ${skipped} were skipped` : ''}.`);
