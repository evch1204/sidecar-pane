import {
  bigDigits, bigWidth, cut, pageRow, plural, RIGHT_PAD, seg, sep, sp, widthOf, type Line, type Seg,
} from './cells';
import {theme} from './theme';
import {spinner} from './views/changes';

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

// The wordmark is as wide as the pane lets it be, and the card hangs off its
// left edge.
const scaleFor = (cols: number): number => (bigWidth(NAME.toUpperCase(), 2) <= cols - 6 ? 2 : 1);

export function splashLines(cols: number, at: Splash): Line[] {
  const word = NAME.toUpperCase();
  const scale = scaleFor(cols);
  // The content of a page row, and where the wordmark sits in it. Centred, not
  // indented: at 62 columns the wordmark is 54 wide and a fixed indent would
  // push its last letter off the edge.
  const room = cols - 2 - RIGHT_PAD;
  const left = Math.max(0, Math.floor((room - bigWidth(word, scale)) / 2));
  const inner = room - left;
  const row = (segs: Seg[]): Line => pageRow(cols, [sp(left), ...segs]);

  const where: Seg[] = [
    seg(at.folder, theme.text),
    ...(at.branch ? [sep(), seg(cut(at.branch, BRANCH_MAX), theme.text)] : []),
  ];

  return [
    ...bigDigits(word, theme.accent, {scale, word: true}).map(row),
    row([]),
    row(where),
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
