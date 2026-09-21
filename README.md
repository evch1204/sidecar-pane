# sidecar-pane

A viewer pane that sits beside the Claude Code CLI. Working name.

Four views, a menu bar, a mouse, and no editing.

- **Changes** is one stream. Every prompt you sent is a block on a left line:
  what Claude said about it, the files it changed, and the diff, which opens
  under its own row.
- **Files** is the tree. Enter peeks a file in place, starting at the first
  thing that changed. `o` reads the whole file; markdown is formatted.
- **Agents** shows the subagents Claude started: for which prompt, doing what
  right now, and what they handed back.
- **Usage** shows where the tokens went, and your 5 hour and weekly limits if
  you connect the status line script.

See [PLAN.md](PLAN.md) for why it is built this way, and [design/](design) for
the design canvas.

```
 ◆ Sidecar  View        5h ▄▄▄▄▄▄ 58% · 1h 52m  wk 23%   ⠴ working

  Changes   Files   Agents ⠴ 2   Usage
  By turn  ·  By file  ·  All                      5 uncommitted

 Day 3 launchers                                            today
 ⠴ build the rest of the day 3 launchers in parallel.       19:31
 │ one agent per terminal: wezterm, iterm2, kitty
 │ running  ·  3 files  +18 −1  ·  3 agents  ·  3m 16s
 │
 │ ▸ Edited   src/launch/index.ts  A1 A2 ⚠               +2    −1
 │ ▸ Created  src/launch/kitty.ts  A3                    +8
 │ ▸ Created  src/launch/wezterm.ts  A1                  +8
 ├─ ✓ A1 Write the WezTerm launcher                 1m 45s   73k
 ├─ ⠴ A2 Try the AppleScript split                  3m 01s   98k
 │  │    Bash  osascript split.scpt
 └─ ⠴ A3 Write kitty.ts                             3m 01s   93k
 │ ⠴ Bash     Wait for the agents                        4 steps

 ▸ add a tmux launcher and wire it into the launcher list   19:00
   3 files  +12 −3  ·  3m 30s
```

The prompts, the chats, the steps and the subagents come from Claude Code's own
session files, so past chats show up with no setup. The line counts come from
snapshots sidecar takes while it runs, so turns from before you first opened
it, or while it was closed, say `not recorded` rather than guessing.

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

## Usage limits

Tokens are counted from your transcripts and need nothing. The 5 hour and
weekly limits are different: Claude Code only hands them to a status line
script. To see them, add this to `~/.claude/settings.json`:

```json
"statusLine": {"type": "command", "command": "node /path/to/sidecar-pane/hooks/statusline.mjs"}
```

It saves the numbers to `~/.sidecar/usage.json` for the pane. There is only
one status line slot, so if yours is already taken, name the old command in
`~/.sidecar/statusline-chain.json` and the script will run it with the same
input and print its output:

```json
{"command": "node C:/path/to/your/statusline.mjs"}
```

Without any of this the Usage view estimates the window from your transcripts
and says that is what it is doing.

## Keys

Everywhere: `1` Changes, `2` Files, `3` Agents, `4` Usage, `m` or `?` menu,
`M` mouse on or off, `q` quit. Everything below is also in the menus.

| Key | What it does |
|---|---|
| `↑` `↓` or `k` `j` | move through the stream, line by line inside a diff |
| `→` or `Enter` | open or close the row in place; on a hunk header, fold it; on a gap, open it; on a file in the tree, peek it |
| `←` or `Esc` | back up to the row that owns what you are in; close it; leave the reader |
| `space` / `b` | page down / up |
| `g` / `G` | top / bottom |
| `]` / `[` | Changes: next / previous turn, file or hunk. Files: next / previous change |
| `v` | group by turn, by file, or everything since the last commit |
| `s` | one chat at a time, or all of them |
| `z` | fold or unfold every hunk of this file |
| `w` | hide changes that are only whitespace |
| `o` | read the whole file: the one under the cursor, or the one this diff line belongs to |
| `c` | Files: changed files only |
| `r` | reader: markdown formatted or as written |

## Mouse

Every row is a button: click a turn, a file, an agent or a hunk header to open
or close it in place, a gap to fill it in, a tab, a pill or a menu to use it.
The meters go to Usage and `working` goes to Changes. Double click a diff line
to open the file there. The wheel scrolls, and the last column is both a
scrollbar you can drag and a minimap of where the changes are.

Mouse reporting stops the terminal doing its own text selection. **Shift and
drag** still selects in Windows Terminal, iTerm2, kitty, WezTerm and
Alacritty. `M` turns reporting off entirely if yours does not. If clicks land
a row off in some terminal, run with `--mouse-debug` to see what it reports.

## Layout

- `src/core` reads folders, files, git, Claude Code's transcripts, its subagents and token counts. It knows nothing about the screen.
- `src/ui` draws with Ink. It knows nothing about the file system beyond what `core` hands it. `cells.ts` is the row model everything is drawn from, `views/` builds the rows of each view, `App.tsx` holds the state, keys and mouse.
- `hooks/statusline.mjs` is the optional status line script that feeds the usage limits.
- `scripts/smoke.tsx` drives the app against this repo with fake key presses and mouse reports, then prints frames: `npx tsx scripts/smoke.tsx`.
- `scripts/smoke-history.tsx` builds a whole fake chat in a temp folder (transcript, a subagent, a usage feed and snapshots) and prints every view reading it: `npx tsx scripts/smoke-history.tsx`.
- `design/` is the design canvas as files, and the script that captures the real pane into it.
