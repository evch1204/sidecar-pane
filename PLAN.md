# Sidecar: project plan

## 1. What this is

Sidecar is a **viewer** that sits beside the Claude Code CLI and shows what Claude is doing to your project while it happens.

You keep typing to Claude on the left. On the right you see your files, which ones Claude just touched, what changed, and a readable preview of any file. You never have to ask "what did you change?" or run `git status` to find out.

It has three views:

| View | What it answers |
|---|---|
| **Files** | What is in this project, and which files did Claude just touch? |
| **Changes** | What changed this turn, and this session? Red and green. |
| **Preview** | What does this file look like? Code in colour, markdown formatted. |

Plus one status line: is Claude working, idle, or waiting for you.

### What it is not

- Not an editor. You look, Claude edits.
- Not a terminal. It runs no commands for you.
- Not a replacement for the Claude CLI. It sits next to it.
- Not a git client. No staging, commits or branches.

### Design goal

The pane and the Claude CLI should look like one terminal. No box around the pane, no floating-window look. Same glyphs as the CLI (`●`, `⎿`, `▸`), dim grey for secondary text, one warm accent.

### Why these features (from your own usage)

Counts from 58 of your past sessions:

- 24% of your prompts involve git. `git log` and `git diff` are among Claude's most-run commands. The Changes view answers those without a prompt.
- 18% of your prompts are corrections. Seeing a change the moment it lands lets you stop a bad turn early instead of after it finishes.
- You review diffs in GitHub Desktop after the fact. This brings that review next to the conversation.

## 2. How the pane attaches to the terminal

There are four ways a tool like this can exist. This is the decision that shapes everything else.

| Option | How it works | Good | Bad |
|---|---|---|---|
| **A. Split pane** (chosen) | Sidecar is its own program. The terminal app splits the window and runs it on the right. | Simple and safe. If Sidecar crashes, Claude is untouched. How VeroDiff, Plan Viewer and diffai work. | Needs a terminal that can split. Each terminal has its own split command. |
| B. Wrapper | Sidecar starts first and runs Claude *inside* itself, drawing Claude on the left and the pane on the right. How tmux works. | Works in every terminal on every OS. Truly one screen. | Very hard. It must re-draw everything Claude draws, pass through every key and mouse event, and survive Claude's fullscreen mode. Bugs here break your Claude session. |
| C. Inside an editor | A VS Code extension panel. How Pixel Agents works: it draws a small web page inside VS Code and reads Claude's session log files. | Real fonts, images, smooth scrolling. | Only works for people running Claude inside VS Code. You use a plain terminal. |
| D. Inside Claude itself | How the built-in `/diff` works. Claude Code draws it as part of its own screen. | Best possible fit. | Only Anthropic can do this. Plugins cannot draw inside Claude's screen. |

**Decision: A now.** It is the standard approach because it is robust. B is the only way to get a true single-screen feel, but it is roughly ten times the work and the failure mode is a broken Claude session. Revisit B only after Day 7, and only if the split still feels wrong.

### Which terminals can split

| Terminal | OS | Split command | Status |
|---|---|---|---|
| Windows Terminal | Windows | `wt -w 0 split-pane -V` | Working (Day 1) |
| tmux | Mac, Linux, WSL | `tmux split-window -h` | Day 3 |
| WezTerm | All | `wezterm cli split-pane --right` | Day 3 |
| iTerm2 | Mac | AppleScript: split vertically | Day 3, needs a Mac to test |
| kitty | Mac, Linux | `kitty @ launch --location=vsplit` | Day 3, needs remote control turned on |
| Terminal.app, VS Code terminal, others | | none | Fallback: print the command to run in a second window |

So **yes, it can work on a MacBook**: the app is plain Node and runs anywhere. Only the "open a split for me" step differs per terminal. Mac launchers are written on Day 3 but stay marked untested until someone runs them on a Mac.

### Pane behaviour to fix (known from Day 1)

- Pressing `q` leaves an empty shell behind. Cause: the launcher starts the pane with `cmd /k` (keep open). Fix: `cmd /c`, so the split closes when Sidecar quits.
- The pane should close by itself when the Claude session ends (`SessionEnd` hook).
- `/sidecar` should toggle: open if closed, close if open.
- One pane per Claude session, keyed by project folder, so two sessions never mix.

## 3. Architecture

```
Claude Code ──hooks──▶ hook.mjs ──append──▶ ~/.sidecar/<project>/events.jsonl
                          │
                          └── on prompt start / stop ──▶ snapshot into ~/.sidecar/<project>/shadow.git

Sidecar pane ──watches──▶ events.jsonl      (what is Claude doing right now)
             ──reads────▶ the project folder (tree, file contents)
             ──runs─────▶ git                (status, diff, shadow-repo diff per turn)
```

| Part | Job | Rules |
|---|---|---|
| `src/core` | Files, tree, git, diff parsing, markdown to styled lines, event reading. | Knows nothing about the screen. Has unit tests. |
| `src/ui` | Draws the screen, handles keys and mouse. | Knows nothing about the file system except what `core` hands it. The only part to rewrite if the toolkit changes. |
| `src/launch` | Detects the terminal and opens or closes the split. | One small file per terminal. |
| `hooks/hook.mjs` | Runs when Claude fires an event. Appends one line, maybe takes a snapshot, exits. | No dependencies. Prints nothing (hook output can land in Claude's context). Marked `async` so Claude never waits. Exits 0 even when Sidecar is not running. |
| `.claude-plugin`, `skills/` | Packaging so `/sidecar` and the hooks install in one step. | |

**No background server.** The hook writes a file, the pane watches the file. Nothing to start, nothing to die, no ports.

**Per-turn diffs** come from a hidden git repo kept outside the project. Already tested on this machine: a snapshot took 139 ms, caught a change made through a shell command, and left the project's own `.git` untouched. This also makes it work in folders that are not git repos.

**Tokens:** none. Hooks and the pane run locally. The only token cost is typing `/sidecar`, which is one small turn; the auto-open option avoids even that.

## Progress

- Done: Day 1 skeleton.
- Done: Files view from the design mockup: indent guides, change badges, folder counts, "changed only" filter, the focused half grows, coloured code, green bar beside changed lines, pane closes on `q`.
- Done: tabs, and the Changes view (see "The Changes view" below).
- Done: mouse. Click, wheel, drag the divider, drag a scrollbar.
- Done: provenance. The Changes view groups by chat, day and prompt, and says
  which turn wrote which hunk. Day 4 and Day 6 turned out to need no hooks at
  all (see "Where the history comes from").
- Badges currently mean "different from the last commit". "Changed this session" arrives with snapshots on Day 6.
- Not yet: formatted markdown, Docs view, status, follow, launchers for anything but Windows Terminal.
- Design mockup: https://claude.ai/artifact/8RPeQxwrBW5zBrefY6UK75

## The Changes view

Both views now share one skeleton, so moving between them costs nothing:

```
 sidecar   Files   Changes 3                  sidecar-pane • main   tab bar
──────────────────────────────────────────────────────────────────
 M src/core/git.ts                                        +5 −2    a list
 M src/ui/App.tsx                                         +3 −1
─ src/core/git.ts ───────────────────────── hunk 1/2  1-21 of 40 ─ divider
     ▾ type Change                                   5–11  +3 −1    a body
   5   export type Change = {
▎  7 -   added: number | null;
▎  7 +   added: number;
       ⋯  38 unchanged lines
──────────────────────────────────────────────────────────────────
 ↑↓ line  n/N hunk  ]/[ file  enter fold  q quit                   hints
```

Grouped three ways, one key (`v`) apart:

- **by turn** (the default) — chat, then day, then the prompt you typed, then
  the files that prompt changed. Selecting the turn puts your own words, the
  steps Claude took and what measurably changed in the body.
- **by file** — the other question: this file looks wrong, which prompts
  touched it? Its diff comes back banded, one band per turn.
- **all changes** — everything since the last commit, the flat list.

Decisions, and why:

- **Your prompt is the row label.** Not a summary of it, not a generated title:
  the words you typed are the reason the files moved.
- **No restore.** The version-history view this borrows from has one. Sidecar
  is a viewer; Claude edits.
- **Unified, never split.** The pane is usually 50 to 70 columns. Two gutters and two code columns would leave under 30 columns a side, which is worse than one column with word-level marks.
- **The list is a strip on top, not a sidebar.** Columns are scarce in a split, rows are not. This also settles the old "side by side when wide" question: on top, always, in both views.
- **The rule between the halves doubles as the header** for the half below it, and is the handle you drag to resize. That buys back a row: chrome is five rows, not six.
- **Changed lines are a background tint, not red and green text.** Foreground colouring destroys syntax colour and makes the eye read the sign column on every row. A tint reads as a shape, and the `+`/`-` column and the bar keep it working without colour.
- **Word-level marks** use the same two hues pushed harder, so the exact edit stands out inside an already-coloured line. Only for delete and add runs of equal length whose lines are at least 30% alike; anything else is a rewrite, and marking all of it is noise.
- **No raw `@@ -12,7 +12,9 @@`.** Hunk headers say what they contain (`loadGit()`, `type Change`) and fold. When git's context does not name anything, the header falls back to a line range.
- **Unchanged runs collapse** to "⋯ 38 unchanged lines" and open in place, read from the file rather than from another call to git. Gaps of four lines or fewer are filled in at load: they cost as much room as the lines they hide.
- **No hover.** It needs any-motion tracking, which sends a report per cell crossed, and it would only light up rows that already have a cursor.

## Where the history comes from

Claude Code already writes everything needed, and writes it live. This was
checked on this machine, not assumed.

| Question | Where the answer is | How good |
|---|---|---|
| Which chat, which prompt, what Claude did about it | `~/.claude/projects/<project>/<session>.jsonl` | Exact, and it goes back through every past chat |
| Which lines a turn changed | a snapshot of the project taken either side of the turn | Exact, from the moment sidecar first runs |
| What differs from the last commit | git | Exact |

Three things follow from that.

**No hooks.** The transcript is flushed message by message: opening the file
and reading the bytes appended since last time tells you the chat, the prompt,
the tool running right now and when the turn ended. Day 4's status line and
Day 6's turn list both fall out of it. The `hook.mjs` plan stays unbuilt until
something actually needs it.

**Never guess a file from a command.** The first attempt read paths out of
shell commands and confidently attributed `Object.assign` and `frames.push`.
In auto mode Claude edits through the shell, so there are no `Edit` records to
lean on either. The only honest answer is to look at the project before and
after: a bare git repo in `~/.sidecar/<project>/shadow.git` with the project as
its work tree. Measured on this Mac: 89 ms cold, 57 ms warm, and the project's
own `.git` is never touched.

**Say which one you are looking at.** A turn from before sidecar ever ran shows
its prompt and its steps, and its files are marked `not recorded` with no
counts. Nothing pretends to a precision it does not have.

## Mouse

Ink has no mouse support, so the pane turns on the terminal's own reporting
(`1000` press and release, `1002` motion while held, `1006` for the SGR form)
and parses the escape sequences itself. Ink's input parser already hands each
report to `useInput` on its own with the escape stripped, so nothing has to be
hijacked: `src/ui/mouse.ts` is one regular expression.

| Where | Click | Wheel | Drag |
|---|---|---|---|
| A tab | switch view | | |
| A list row | select it; a folder opens | scroll the list | |
| The divider | focus the half below; double-click resets the split | scroll the body | resize the split |
| A hunk header | fold or unfold | scroll | |
| A gap | open it | scroll | |
| A diff line | move the cursor; double-click opens it in Files | scroll | |
| A scrollbar | jump there | scroll | drag the thumb |

Turning mouse reporting on stops the terminal doing its own text selection.
Shift and drag still selects in Windows Terminal, iTerm2, kitty, WezTerm and
Alacritty; `m` turns reporting off entirely for terminals that do not.
`--mouse-debug` prints each report and the region it hit in the footer, which
is how you check a new terminal counts rows the way the pane does.

## 4. The build, day by day

Claude writes the code. You decide direction and design. Each day ends with something you can run. Stop after any day and you still have a working tool.

### Day 1: skeleton (done)

File tree, plain preview with line numbers, keyboard control, Windows Terminal split launcher, smoke test that presses fake keys.

### Day 2: make it look good

1. ~~Toolkit check.~~ **Decided: Ink stays.** Its input parser already splits SGR mouse reports into their own events, so the mouse costs one regular expression instead of a new toolkit, and OpenTUI's pre-1.0 risk buys nothing.
2. Syntax colours for code.
3. Markdown formatted: headings, bold, italics, lists, quotes, code blocks, tables, links.
4. Three heading styles to choose from, shown side by side in the pane.

- **You decide:** toolkit, and the markdown look.
- **Done when:** opening `PLAN.md` in the pane reads like a document.
- **Risk:** terminals have one font size. Headings must work through colour, weight and spacing alone.

### Day 3: attach properly

1. `src/launch` with detection for Windows Terminal, tmux, WezTerm, iTerm2, kitty, and the fallback message.
2. Pane closes on `q`. Remembered pane width.
3. A `sidecar` command (`sidecar`, `sidecar open`, `sidecar close`).
4. Plugin skeleton and the `/sidecar` skill that toggles the pane.

- **Done when:** in any project, typing `/sidecar` in Claude opens the pane, and typing it again closes it.
- **Risk:** Mac launchers cannot be tested from this machine.

### Day 4: make it aware of Claude

1. `hook.mjs` and the hook config for `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Notification`, `Stop`, `SessionEnd`. Added next to your existing Orca and toast hooks without touching them.
2. Status line: `● working`, `● idle`, `● needs you` (permission prompts).
3. Files light up in the tree the moment Claude touches them, then fade to a quieter "touched this session" mark.
4. Optional auto-open when a Claude session starts. Auto-close when it ends.

- **You decide:** what "lit up" looks like (colour, glyph, how long it lasts).
- **Done when:** you ask Claude to edit a file and its row lights up without you touching the pane.
- **Risk:** hooks must be silent and fast. Test that a broken or missing Sidecar never slows Claude.

### Day 5: changes

1. `+12 −3` badges on changed files, and a count on folders that contain changes.
2. Changes view: list of changed files, red and green diff below, like the concept mockup.
3. Word-level highlights inside changed lines.
4. `.gitignore` rules replace the hard-coded ignore list.
5. Clear message in folders that are not git repos (full support arrives on Day 6).

- **Done when:** after a Claude turn you can see what changed without typing anything.

### Day 6: turns and follow mode

1. ~~Shadow snapshots on prompt start and on stop.~~ Done, driven by the
   transcript rather than by hooks.
2. ~~Turn list: each prompt you sent, with its own diff and counts.~~ Done.
3. Follow mode: the pane jumps to whatever Claude just edited. Any key press pauses it; a key turns it back on.
4. Works in folders without git.

- **Done when:** you can leave the pane alone for a whole session and it always shows the right thing.
- **Risk:** snapshot speed in big projects. Must respect `.gitignore` and skip `node_modules`; measure on `tolife1`.

### Day 7: feel, polish, decision

1. Mouse: click to select, wheel to scroll, click a view name to switch.
2. Narrow layout for small panes. Clean behaviour on resize.
3. Option to use the terminal's own 16 colours so the pane follows any theme. A colour-blind-safe diff palette.
4. Every empty state and error state looked at once.
5. README with a short GIF. Mac test checklist for whoever tries it first.

- **You decide:** keep the repo private or make it public.

## 5. After Day 7 (only if you still want more)

In rough order of value:

1. **Revert** a file or a whole turn back to its turn-start snapshot. Covers shell-command and subagent changes, which the built-in `/rewind` does not restore.
2. **Line comments that reach Claude.** Press a key on a line, type a note. A `UserPromptSubmit` hook prints queued notes so they join your next prompt.
3. **Risk flags.** Local rules that mark removed test assertions, newly skipped tests, new dependencies, edits to `.env` or CI files.
4. **Log view.** Tail a dev-server log file in the pane. Viewer only: Sidecar does not start the server.
5. **Wrapper mode (option B).** Only if the split still feels wrong after living with it.

## 6. Rules that protect the project

- Viewer only. No editing, no file operations, no running commands.
- Hooks stay silent and fast, and never block Claude.
- `core` and `ui` stay separate.
- Every feature must answer: does this help me see what Claude is doing? If not, it does not go in.
- Windows Terminal is the first-class target because that is what you use. Other terminals are best effort.
- Before each commit: `npm run typecheck` and `npx tsx scripts/smoke.tsx`.

## 7. Open questions

| Question | Decide by |
|---|---|
| ~~Ink or OpenTUI~~ | Decided: Ink, with mouse reporting parsed by hand. |
| Final name (`sidecar` is taken on npm; `sidecar-pane` is free) | Day 7, before going public |
| ~~Tree on top, or side by side when wide~~ | Decided: on top, in both views. Columns are the scarce resource in a split. |
| Should auto-open be on by default | Day 4 |
