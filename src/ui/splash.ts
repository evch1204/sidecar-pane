import {
  bigDigits, bigWidth, cut, pageRow, plural, RIGHT_PAD, seg, sep, sp, spinner, widthOf, type Line, type Seg,
} from './cells';
import {theme} from './theme';
import {WORDMARK_COLS, wordmarkFits, wordmarkRows} from './wordmark';

// The card the pane draws before it has anything to show: on the first frame,
// while the chats are being read, and in a folder Claude Code has never been
// run in. It is one card and not two, because both are the same moment — the
// pane is here and the stream is not — and the second one is the first one
// with its last row settled.
//
// Nothing here reads anything. The folder, the branch and the counts are
// handed in by whoever knows them, the way every other row in the pane works.

// The pane's own name, in one place.
export const NAME = 'Sidecar';

// What the read found, once it has come back.
export type Counts = {chats: number; turns: number; agents: number};

export type Splash = {
  folder: string;
  branch: string;
  // What the transcripts said, or null while that read is still going.
  counts: Counts | null;
  // What one readdir said, for the row that has to say something before then.
  chats: number;
  // The commits are still being measured.
  reading: boolean;
  frame: number;
};

// A branch name can be a sentence. Past this the card would be about the
// branch rather than about where you are.
const BRANCH_MAX = 40;

// The block wordmark wherever a page row has room for it, and the pixel font
// at scale 1 (27 columns) below that. Centred, not indented: a fixed indent
// would push the last letter off the edge of a pane only just wide enough.
// The card hangs off the wordmark's left edge. The opening types these same
// rows in the same place, so a pane that skips it draws the name exactly where
// the opening would have left it.
export function nameRows(cols: number, tone: 'gradient' | 'add' = 'gradient'): {rows: Seg[][]; left: number} {
  const word = NAME.toUpperCase();
  const block = wordmarkFits(cols);
  const rows = block
    ? wordmarkRows(tone)
    : bigDigits(word, tone === 'add' ? theme.add : theme.accent, {scale: 1, word: true});
  const wide = block ? WORDMARK_COLS : bigWidth(word, 1);
  return {rows, left: Math.max(0, Math.floor((cols - 2 - RIGHT_PAD - wide) / 2))};
}

// Where the pane is: the folder, and the branch when there is one.
export const whereSegs = (folder: string, branch: string): Seg[] => [
  seg(folder, theme.text),
  ...(branch ? [sep(), seg(cut(branch, BRANCH_MAX), theme.text)] : []),
];

export function splashLines(cols: number, at: Splash): Line[] {
  const {rows: name, left} = nameRows(cols);
  const inner = cols - 2 - RIGHT_PAD - left;
  const row = (segs: Seg[]): Line => pageRow(cols, [sp(left), ...segs]);

  return [
    ...name.map(row),
    row([]),
    row(whereSegs(at.folder, at.branch)),
    ...state(at, inner).map(row),
    ...(at.reading ? [row([seg(spinner(at.frame), theme.accent), seg(' reading the commits', theme.dim)])] : []),
  ];
}

// The one row that says where the read has got to. Before it comes back all
// the card can honestly say is how many files it is about to open.
function state(at: Splash, inner: number): Seg[][] {
  const chats = at.counts?.chats ?? at.chats;
  if (at.counts && chats) {
    const {turns, agents} = at.counts;
    return [[seg(`${plural(chats, 'chat')}   ${plural(turns, 'turn')}   ${plural(agents, 'agent')}`, theme.text)]];
  }

  // A folder with no chats in it is only empty once the read is over: until
  // then it is a folder nothing has looked in yet.
  if (at.reading || !at.counts) return [[seg(chats ? `reading ${plural(chats, 'chat')}…` : 'reading…', theme.dim)]];

  // Nothing has ever run here. The card keeps its shape and its last row says
  // what to do, on one line where there is room for one and two where not.
  const empty = seg('no chats yet', theme.text);
  const start = seg('start Claude Code in this folder', theme.dim);
  const together = [empty, sep(), start];
  return widthOf(together) <= inner ? [together] : [[empty], [start]];
}
