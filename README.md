# sidecar-pane

A viewer pane that sits beside the Claude Code CLI. Working name.

Two views, a mouse, and no editing. **Files** is a tree with a preview under
it. **Changes** shows every prompt you sent, what Claude did about it, and the
lines that changed as a result. Formatted markdown is next. See
[PLAN.md](PLAN.md).

```
 sidecar   Files   Changes 2  • by file            sidecar-pane • main
──────────────────────────────────────────────────────────────────────
 M README.md                                             1 turn  +8
 M src/greet.ts                                      2 turns  +3 −2
    15:38  now write the readme for it                           +1
    15:28  make greet friendlier and say hi instead        +2 −2
─ src/greet.ts • 2 turns ─────────────────── hunk 1/2  1-13 of 13 ─
  ── 15:38  now write the readme for it ──────────────────── +1 ──
     ▾ lines 1–4                                                 +1
   1   export function greet(name: string, punctuation = "!") {
▎  2 +   // Greets someone by name.
   3     return `hi there ${name}${punctuation}`;
  ── 15:28  make greet friendlier and say hi instead ──── +2 −2 ──
▎  1 - export function greet(name: string) {
▎  1 + export function greet(name: string, punctuation = "!") {
──────────────────────────────────────────────────────────────────
 ↑↓ move  enter open  → diff  v group  s chat  q quit
```

Every hunk says which prompt wrote it. `v` regroups the list by turn, by file,
or flat. Changed lines are a background tint rather than red and green text,
so syntax colours survive; the exact words that changed get a stronger tint.
Hunk headers name what they contain and fold. Unchanged runs collapse and open
in place.

The prompts, the chats and the steps come from Claude Code's own session files,
so past chats show up with no setup. The line counts come from snapshots
sidecar takes while it runs, so turns from before you first opened it say
`not recorded` rather than guessing.

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
| `v` | | group by turn, by file, or flat |
| `s` | | one chat at a time, or all of them |
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
- `scripts/smoke-history.tsx` builds a whole fake chat — transcript and snapshots — in a temp folder and prints the Changes view reading it. It is the only way to see measured, per-turn diffs without living through a session: `npx tsx scripts/smoke-history.tsx`.
