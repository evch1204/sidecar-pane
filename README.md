# sidecar-pane

A viewer pane that sits beside the Claude Code CLI. Working name.

Four views, a menu bar, a mouse, and no editing.

It opens on **Home**: where you are, what Claude is doing now, what today has
been, and where each key goes. `h` comes back to it from anywhere. Before Home,
a three second opening plays while the first read runs, and every number in it
is real; any key or click skips it, `--no-opening` skips it for one run and
`SIDECAR_NO_OPENING=1` for good. At 80 columns and up a side panel on the left
lists the views and the folders of the repository, `b` folds it, and `w` steps
through the folders.

- **Changes** is one stream. Every prompt you sent is a block on a left line:
  what Claude said about it, the files it changed, and the diff, which opens
  under its own row. A past turn is one row: its size as five cells, green and
  red, and `✓` when its commits are merged or `◆N` when they are only
  committed. The day has a skyline, one column a turn.
- **Files** is the tree. Enter peeks a file in place, starting at the first
  thing that changed. `o` reads the whole file; markdown is formatted.
- **Agents** shows the subagents Claude started, named as Claude named them,
  each on a lane of a shared clock and grouped by the folder it worked in;
  the same coloured square marks the files it wrote. An agent given a git
  worktree of its own carries one fact row saying which folder, how much is in
  it, and whether any of that has arrived here — `↑1 · not in demo yet`, `✓
  merged 11:56`, `removed`. `w` steps Changes, Files and Agents through the
  folders of the repository, one at a time and then all of them at once.
- **Usage** shows where the tokens went, and your 5 hour and weekly limits if
  you connect the status line script.

Every row that opens in place starts with a chevron — `▸` closed, `▾` open —
and the footer says what Enter will do to the row under the cursor. The right
end of the bar says which of you it is waiting on: `⠧ Bash 4m`, `● asking
you`, `● your turn`, `● idle`. Follow mode is on by default: while a turn runs
the pane opens the diff of the file it has just written, anything you press or
click pauses it, `f` hands it back. `y` on a diff line puts that place —
`src/ui/App.tsx:1123` — on your clipboard. Before the history is read, and in
a folder Claude Code has never been run in, the pane draws a card with its own
name on it instead of an empty list.

See [PLAN.md](PLAN.md) for why it is built this way, and [design/](design) for
the design canvas.

A real frame, printed by `npx tsx scripts/smoke-history.tsx --cols 62`:

```
 ◆ Sidecar  View  5h ▄▄▄▄▄▄ 58%  1h 52m · wk 23%   ⠇ 1 agent

  Changes   Files   Agents ⠇ 1   Usage
  By turn  ·  By file  ·  Uncommitted              in demo ▾

 TODAY   Make greet friendlier           5 turns  ·  46m 01s
         ▂▂ ▂▂ ▃▃ ▂▂ ▁▁                               +20 −3

 ⠇  hand the guide to an agent in its own worktree     14:35
 │  running 10m 00s
 │
 │  1 agent  ·  1 done                            12k tokens
 │  ▸ ■ Write the guide                      ✓  6m 36s   12k
 │      in agent-docs   1 file ▄▄▄▄▄    ↑1 · not in demo yet
 │
 │  ⠇ Read  Read what it wrote                       2 steps

 ▸  add a farewell as well, then…   2 files ▄▄▄▄▄ ◆2   14:25
 ▸  document greet and get a few…   2 files ▄▄▄▄▄      14:15
 ▸  make greet friendlier and say…  1 file  ▄▄▄▄▄      14:05
 ▸  mention the licence in the re…  2 files ▄▄▄▄▄ ✓    13:59

 enter close  3 agents  m menu  ↑↓ move demo • improve-greet
```

The prompts, the chats, the steps and the subagents come from Claude Code's own
session files, so past chats show up with no setup. The line counts come from
snapshots sidecar takes while it runs, so turns from before you first opened
it, or while it was closed, say `not recorded` rather than guessing. The one
thing the session files never record is Claude Code asking you to allow a tool
call, so that is the one hook there is: `npm run connect` adds it, beside your
own hooks, and `npm run disconnect` takes only ours back out.

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

## Real percentages

Tokens are counted from your transcripts and need nothing. Your 5 hour and
weekly limits are different: Claude Code hands those numbers to one thing only,
the single `statusLine` command in `~/.claude/settings.json`. So the pane can
only show real percentages if that command is ours.

One command connects it, and one puts it back:

```sh
npm run connect
npm run disconnect
```

`connect` copies `settings.json` to `settings.json.sidecar-backup-<time>` beside
it, then sets `statusLine` to `node "…/hooks/statusline.mjs"` and appends
`hooks/attention.mjs` to the `PermissionRequest` hooks. Hooks are a list, so
yours are appended to and never replaced. If a status line was
already there, the whole thing is saved to `~/.sidecar/statusline-chain.json`
first, and our script runs it with the same input and prints exactly what it
printed before — including nothing at all, if that is what it printed. So your
status line keeps working and the pane reads the limits on the way past. Run
`node scripts/connect.mjs status` to see where things stand.

One honest caveat: a tool that rewrites `statusLine` every time it launches will
quietly take the slot back. Orca appears to do this. You will notice because the
Usage view starts saying `feed quiet`; run `npm run connect` again.

Without the feed the Usage view estimates the window from your transcripts and
says that is what it is doing.

## Keys

Everywhere: `h` Home, `1` Changes, `2` Files, `3` Agents, `4` Usage, `w` next
workspace, `b` fold or unfold the side panel, `m` or `?` menu, `M` mouse on or
off, `q` quit. Everything below is also in the menus.

| Key | What it does |
|---|---|
| `↑` `↓` or `k` `j` | move through the stream, line by line inside a diff |
| `→` or `Enter` | open or close the row in place; on a hunk header, fold it; on a gap, open it; on a file in the tree, peek it |
| `←` or `Esc` | back up to the row that owns what you are in; close it; leave the reader |
| `space` / `PgUp` | page down / up |
| `g` / `G` | top / bottom |
| `]` / `[` | Changes: next / previous turn, file or hunk. Files: next / previous change |
| `v` | group by turn, by file, or everything uncommitted |
| `w` | the next folder of the repository, then all of them, then yours again |
| `s` | one chat at a time, or all of them |
| `z` | fold or unfold every hunk of this file |
| `W` | hide changes that are only whitespace |
| `o` | read the whole file: the one under the cursor, or the one this diff line belongs to |
| `c` | Files: changed files only |
| `r` | reader: a markdown file as a page, or as written |
| `f` | follow mode on or off; it pauses by itself the moment you touch anything |
| `y` | copy the place under the cursor — `src/ui/App.tsx:1123` — to the clipboard |

## Mouse

Every row with a chevron is a button: click a turn, a file, an agent or a hunk
header to open or close it in place, a gap to fill it in, a tab, a pill or a
menu to use it. The meters go to Usage and the status word goes to Changes.
Double click a diff line
to open the file there. The wheel scrolls, and the last column is both a
scrollbar you can drag and a minimap of where the changes are.

Mouse reporting stops the terminal doing its own text selection. **Shift and
drag** still selects in Windows Terminal, iTerm2, kitty, WezTerm and
Alacritty. `M` turns reporting off entirely if yours does not. If clicks land
a row off in some terminal, run with `--mouse-debug` to see what it reports.

## Layout

- `src/core` reads folders, files, git, Claude Code's transcripts, its subagents and token counts. It knows nothing about the screen.
- `src/ui` draws with Ink. It knows nothing about the file system beyond what `core` hands it. `cells.ts` is the row model everything is drawn from, `views/` builds the rows of each view, `App.tsx` holds the state, keys and mouse.
- `hooks/statusline.mjs` is the optional status line script that feeds the usage limits, `hooks/attention.mjs` writes down a permission prompt, and `scripts/connect.mjs` is the `npm run connect` / `npm run disconnect` pair that installs both and takes them out again.
- `scripts/smoke.tsx` drives the app against this repo with fake key presses and mouse reports, then prints frames: `npx tsx scripts/smoke.tsx`.
- `scripts/smoke-history.tsx` builds a whole fake chat in a temp folder (transcript, a subagent, a usage feed and snapshots) and prints every view reading it: `npx tsx scripts/smoke-history.tsx`.
- `design/` is the design canvas as files, and the script that captures the real pane into it.
