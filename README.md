# sidecar-pane

A viewer pane that sits beside the Claude Code CLI. Working name.

Two views, a mouse, and no editing. **Files** is a tree with a preview under
it. **Changes** is every file that differs from the last commit, with a diff
under it. Live awareness of what Claude is editing and formatted markdown are
next. See [PLAN.md](PLAN.md).

```
 sidecar   Files   Changes 3                  sidecar-pane • main
──────────────────────────────────────────────────────────────────
 M src/core/git.ts                                        +5 −2
 M src/ui/App.tsx                                         +3 −1
─ src/core/git.ts ───────────────────────── hunk 1/2  1-21 of 40 ─
     ▾ type Change                                   5–11  +3 −1
   5   export type Change = {
   6     status: 'A' | 'M' | 'D';
▎  7 -   added: number | null;
▎  7 +   added: number;
▎  8 +   removed: number;
   9   };
       ⋯  38 unchanged lines
     ▾ loadGit()                                    50–59  +2 −1
──────────────────────────────────────────────────────────────────
 ↑↓ line  n/N hunk  ]/[ file  enter fold  esc back  q quit
```

Changed lines are a background tint rather than red and green text, so syntax
colours survive; the exact words that changed get a stronger tint. Hunk
headers name what they contain and fold. Unchanged runs collapse and open in
place.

## Run it

Needs Node 22 or later.

```sh
npm install
npm start -- "C:\path\to\a\project"
```

In Windows Terminal, this opens it as a split on the right of the pane you are in:

```sh
npm run pane -- "C:\path\to\a\project"
```

## Keys

Everywhere: `1` Files, `2` Changes, `Tab` switch half, `m` mouse on or off,
`q` quit.

| Key | Files view | Changes view |
|---|---|---|
| `↑` `↓` or `k` `j` | move, or scroll the preview | change file, or move down the diff |
| `→` or `Enter` | open a folder, or go to the preview | go to the diff; on a hunk header, fold it; on a gap, open it |
| `←` or `Esc` | close a folder, or go to the parent | back to the file list |
| `space` / `b` | page down / up | page down / up |
| `g` / `G` | top / bottom | first / last |
| `n` / `N` | | next / previous hunk, carrying on into the next file |
| `]` / `[` | | next / previous file |
| `z` | | fold or unfold every hunk |
| `w` | | hide changes that are only whitespace |
| `h` `l` `0` | | scroll long lines sideways |
| `o` | | open this file in the Files view |
| `c` | changed files only | |

## Mouse

Click a tab to switch view, a row to select it, a hunk header to fold it, a
gap to open it. The wheel scrolls whichever half is under the pointer. Drag
the rule between the halves to resize them, or a scrollbar to scroll.

Mouse reporting stops the terminal doing its own text selection. **Shift and
drag** still selects in Windows Terminal, iTerm2, kitty, WezTerm and
Alacritty. `m` turns reporting off entirely if yours does not. If clicks land
a row off in some terminal, run with `--mouse-debug` to see what it reports.

## Layout

- `src/core` reads folders and files. It knows nothing about the screen.
- `src/ui` draws with Ink. It knows nothing about the file system beyond what `core` hands it.
- `scripts/smoke.tsx` drives the app with fake key presses and fake mouse reports, then prints frames: `npx tsx scripts/smoke.tsx`.
