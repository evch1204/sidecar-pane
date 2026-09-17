# Sidecar: project plan

## 1. What this is

Sidecar is a **viewer** that sits beside the Claude Code CLI and shows what Claude is doing to your project while it happens.

You keep typing to Claude on the left. On the right you see your files, which ones Claude just touched, what changed, and a readable preview of any file. You never have to ask "what did you change?" or run `git status` to find out.

It has four views:

| View | What it answers |
|---|---|
| **Changes** | What changed this turn, and this session, and which prompt caused it? |
| **Files** | What is in this project, which files changed, and what does this one look like? |
| **Agents** | When Claude hands work to subagents, who is doing what right now? |
| **Usage** | How much of the 5 hour and weekly allowance is gone, and where did the tokens go? |

Plus a menu bar that says which of you the pane is waiting on, and **Home**, the page the pane opens on: where you are, what is happening now, what today has been, and where each key goes (see "Home, the opening, the panel").

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
Claude Code ──writes──▶ ~/.claude/projects/<project>/<chat>.jsonl   (live)
            ──asks───▶ attention.mjs ──▶ ~/.sidecar/<project>/attention.json

Sidecar pane ──reads────▶ the transcripts    (chat, prompts, tools, agents)
             ──reads────▶ attention.json     (is it waiting on you)
             ──reads────▶ the project folder (tree, file contents)
             ──runs─────▶ git                (status, diff, shadow-repo diff per turn)
             ──snapshots▶ ~/.sidecar/<project>/shadow.git  on prompt start and stop
```

| Part | Job | Rules |
|---|---|---|
| `src/core` | Files, tree, git, diff parsing, markdown to styled lines, event reading. | Knows nothing about the screen. Has unit tests. |
| `src/ui` | Draws the screen, handles keys and mouse. | Knows nothing about the file system except what `core` hands it. The only part to rewrite if the toolkit changes. |
| `src/launch` | Detects the terminal and opens or closes the split. | One small file per terminal. |
| `hooks/` | Two scripts, both optional and neither installed for you: `attention.mjs` writes down a permission prompt, `statusline.mjs` saves the usage numbers. | No dependencies. Print nothing (hook output can land in Claude's context). Marked `async` so Claude never waits. Exit 0 even when Sidecar is not running. |
| `.claude-plugin`, `skills/` | Packaging so `/sidecar` and the hooks install in one step. | |

**No background server.** Claude Code writes files, the pane reads them. Nothing to start, nothing to die, no ports.

**Per-turn diffs** come from a hidden git repo kept outside the project. Already tested on this machine: a snapshot took 139 ms, caught a change made through a shell command, and left the project's own `.git` untouched. This also makes it work in folders that are not git repos.

**Tokens:** none. Hooks and the pane run locally. The only token cost is typing `/sidecar`, which is one small turn; the auto-open option avoids even that.

## Progress

- Done: Day 1 skeleton, the Files view, tabs, the mouse, and provenance from
  Claude Code's own session files.
- Done: the one-stream redesign (see "One stream" below). Every view is one
  scrolling list. Nothing is shown "down there" in a second half any more.
- Done: Agents and Usage views, a menu bar, formatted markdown in the reader.
- Done: sidecar records when it was watching, so a turn is only called
  measured when it really was, and a turn it was not open for is filled in
  from the project's own commits (see "Where the history comes from").
- Done: the left line replaces the card, and a toggled row keeps its place
  under the pointer.
- Done: Usage rebuilt — honest numbers, a big reading per section, and the
  window estimated from transcripts when no feed is installed.
- Done: Agents as a tree with real parent ids, folding for a crowd, and a tab
  that only appears when there are subagents.
- Done: the chrome — two menus, pills under the tabs, each end of the bar its
  own button, a footer that puts the hints before the branch name, and a
  scrollbar that doubles as a minimap.
- Done: Version 4 of the look — a past turn is one row with its size as five
  cells and where it stands in git, an open turn groups its files by folder,
  agents are named and charted the way Claude Code prints them, lanes on a
  clock in the Agents view, and worktrees as a map and a scope (see
  "Worktrees").
- Done: one rule for every row that opens. A chevron in front of it, and the
  footer names the verb Enter will use on the row under the cursor (see "One
  stream").
- Done: a worktree is where an agent worked, not a block of the stream. The
  agent's own row says which folder and how far it has got (see "Worktrees").
- Done: the bar says which of five things is true — agents running, the tool
  Claude is inside, a question waiting on you, your turn, idle — and the pane
  opens on a card with its own name on it instead of an empty stream (see "The
  bar and the first frame").
- Done: follow mode, on by default. While a turn runs the pane opens the file
  it has just written; anything you press or click inside a stream pauses it,
  going to another view, folder or menu does not, and `f` hands it back.
- Done: one hook, and only one. Claude Code asking to allow a tool call is the
  one thing the transcript never records, so `hooks/attention.mjs` writes it
  down and the pane reads `● asking you` off it (see "Where the history comes
  from"). It is not installed for you: `npm run connect` does that.
- Done: Version 5, direction A. The pane opens on Home after a three second
  opening that is the first read itself; a side panel down the left lists the
  views and the folders, open, folded or gone by the pane's width; every
  folder of the repository is a workspace `w` steps to, headed by its
  journey; a branch that merged here is a landing row in the stream; and one
  set of state words names where a folder has got to everywhere it is named
  (see "Home, the opening, the panel").
- Not yet: launchers for anything but Windows Terminal.
- Design canvas: https://claude.ai/artifact/B8wcGJHEqSzm1Ubncr2M9s, and the
  same thing as files in `design/`. Page 3 of it is captured from the running
  pane, so it is never out of date by more than one `design/capture.tsx` run.

## One stream

The first build had a list on top and whatever you selected underneath. It
worked and it read like a terminal tool: your eyes went up to choose and down
to read. The redesign borrows from the owner's own web app (deepdotspace,
create mode), where a turn is a block and a diff opens under the row you
clicked.

This is the real thing, printed by `npx tsx scripts/smoke-history.tsx --cols
62 --rows 34` over a fake day: a turn running with an agent in a worktree of
its own, and four past turns under it.

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

Decisions, and why:

- **One list per view.** A view builds lines. The screen draws them, the cursor
  indexes them, a click maps onto them. There is one array, so the three cannot
  disagree. `src/ui/cells.ts` is that model; nothing else draws.
- **A turn is a block, and your prompt is its title.** Not a summary: the words
  you typed are the reason the files moved. The newest turn starts open.
- **A past turn is one row.** It used to be two, and the second one was a dim
  sentence of facts you could not compare across turns. Now the row is your
  prompt, cut in the same column on every row, and then a fixed right side:
  how many files, how big it was, where it stands in git, the time. A list of
  twenty turns reads down its columns.
- **Numbers as shapes.** A size is five cells — `▄▄▄▄▄` — lit by the lines the
  turn changed: one cell under ten, two under fifty, three under a hundred and
  fifty, four under five hundred, five above. The red part is the share that
  was removed, and a turn that removed anything keeps at least one red cell
  and one green, so neither side is ever rounded away. This is on purpose
  imprecise: "small, medium, big, huge" is what a glance wants, and the exact
  `+114 −12` is one row further in, on the file it belongs to. Chips do the
  same for the open turn: a figure on a little ground reads as a badge, and
  `+310` in green on green is a number you can find without reading the row.
- **Files by folder.** A turn's files are grouped under the first two segments
  of their path — `src/ui/views/changes.ts` is `src/ui` — biggest folder
  first, each file named relative to its folder. Eight file rows all starting
  `src/ui/views/` were eight rows of the same eleven characters.
- **Where it landed.** Above the files, one bar split by folder and a legend
  that names the parts with their share. Only drawn when there are two or
  more folders, because one folder is already the heading under it. It answers
  "did this turn touch the thing I care about?" before you read a single path.
- **The day's skyline.** A day heads the stream with its name, the chat's
  title, the turn count and how long the day ran, and under that one column
  pair per turn in time order, its height the same size rule. Where the big
  turns of the day were is a shape, and each pair is a click that goes to
  that turn.
- **Things open where they are.** A file's diff opens under its row, a file's
  contents under its name in the tree, an agent's steps under the agent. Esc or
  ← walks back up to the row that owns what you are in. So a peek's last row
  grows the peek in place under a label that says what it will show, and `o`
  stays the one way to swap the page for the whole file.
- **The rows that own what you are reading stay pinned** at the top while a
  long diff scrolls under them, so "which file, which turn" is never lost.
- **A left line, not a card.** The first build drew a card: a fill with
  half-block edge rows and quadrant corners. Two things were wrong with it.
  The edge row above the header meant opening a turn pushed its own header
  down a line, so the next click missed the row you had just aimed at. And the
  four corners read as a glitch rather than as an edge. Now column 1 carries
  the turn's own mark — the chevron every opening row carries, `▸` closed and
  `▾` open, or the spinner while it runs, because what Claude is doing matters
  more than the fact that the block is open — and a `│` on every row under it,
  blank rows included. Same columns, no edge rows, nothing moves, and the line
  of a running turn is the one accent on screen.
- **One rule for a row that opens.** A row that opens or closes in place
  starts with a chevron just left of its words: `▸` closed, `▾` open, column 1
  for a block and column 4 for a row inside one, `dim`, `accent` under the
  cursor, the folder's hue in the wider scope. A pill sets state. An underlined
  word or a bar segment goes somewhere. Everything else is text, and a click on
  text walks up to the nearest chevron above it. Before this, a turn was a
  filled or hollow dot, an agent was a tree joint, a file in a turn was its
  status letter and a hunk drew its own arrows: four shapes for one thing, and
  none of them said what pressing Enter would do.

  So the footer says it in words. A line carries a `hint` — set by the view
  that built it, because only that view knows — and the first thing the footer
  says is `enter <hint>`: `open`, `close`, `diff`, `close diff`, `steps`,
  `agent`, `fold`, `unfold`, `jump`, `all files`, `all commits`, `peek`, or
  `40 more lines`. `esc back` comes second, and only on a row that is inside
  something. `w worktree` left the footer with it: the key, the `View` menu and
  the scope pill all say that already, and those columns are worth more to the
  row under the cursor.
- **An open turn carries the whole prompt.** A closed turn cuts it to one row,
  which is what makes the stream a list; an open one wraps it over as many rows
  as it takes, and Enter on any of those rows closes the turn. You asked for
  the work, so the words that asked for it are worth the room. It also took
  away the one row in the view where Enter did something other than what the
  row was for: the old `more` toggle showed the rest of the prompt, and the
  turn only closed on the second press.
- **A toggled row keeps its place on screen.** A click or Enter remembers the
  row's id and the screen row it was on, and after the lines are rebuilt the
  scroll is set so that id is still there. Without it, opening a long diff
  slid the row out from under the pointer, so a second click landed on
  whatever had moved into its place.
- **A running turn says less.** The conversation is on screen right beside the
  pane, so while Claude works the card is the prompt, one status line, the
  files so far and the step in progress. What Claude said, and how long it
  thought, appear when the turn is over and the pane becomes history.
- **A markdown file reads as a page.** A plan or a readme is read, not
  scanned, so the reader lays one out as a sheet of paper: a `surface` fill
  with margins, a title over a heavy rule, sections over thin ones, wrapped
  prose, hanging bullets, real tables and code in a well. The words as they
  were typed are never more than one click away, on the `Source` pill beside
  it, and every row on the page remembers which source lines it came from, so
  the two shapes hold the same place in the file.
- **Changed lines wrap, unchanged lines truncate.** A long line used to hide
  the edit past the right edge. The edit is the point, so it is never cut.
  This replaced sideways scrolling.
- **Unified, never split. No raw `@@`. Tints, not red and green text. Word
  marks only when two lines are at least 30% alike.** Unchanged from the first
  build, for the same reasons: columns are scarce and syntax colour matters.
- **Every tool call is one folded row.** In auto mode a turn is sixty shell
  commands. The list is there when you want it and one line when you do not.
- **Where a turn stands in git.** Every turn, watched or not, gets the commits
  whose time falls inside its window, and those commits are the receipt: one
  row each at the end of the block — `◆ 2fa351d  Fill a turn nobody watched`,
  or `✓ bffa4d9  merged into improve-pane-layout-polish` for a merge — and one
  chip on the open turn saying where it all got to. A past turn carries the
  same news as a mark in its right side: `✓` merged, `◆3` three commits and
  not merged yet, nothing at all for a turn that never left the working tree.

  The rule, exactly:

  | Chip | When |
  |---|---|
  | `✓ merged` | the newest of its commits is an ancestor of the default branch (`origin/HEAD`, else `main`, else `master`) and HEAD is **not** that branch. Sitting on the trunk itself, merged can only mean pushed, so it is measured against the branch the trunk tracks |
  | `◆ committed` | it has commits, and they have not arrived there — including on a trunk with no upstream, where there is nothing to arrive at |
  | `● uncommitted` | no commits, and a file it changed is dirty in git right now |
  | nothing | no commits and nothing dirty: a turn that only read, or whose work is long gone |

  What it cannot know: which of a turn's commits was "the" commit (it names
  them all), whether a squash or a rebase carried the work in under another
  sha (a rewritten commit is not an ancestor of anything, so it reads
  `committed` for good), and which branch a merge brought in — the name on the
  merge row is the branch it landed **on**, which is the branch the pane is
  sitting on, because that is whose history the commits were read from.
- **Three groupings, one key (`v`):** by turn, by file (which prompts touched
  this file?), and everything since the last commit.
- **A menu bar, not a legend.** Everything a key can do is also in a menu, and
  the right end of the bar holds what you glance at: usage and whether Claude
  is working, each its own button. Tabs stay, because switching view should be
  one click.
- **Two menus, and the second one is about where you are.** `Sidecar` and
  `View`. `View` lists the four views and then, under a rule, only the options
  of the view you are in, so nothing on it is ever dead. A "Group" menu that
  belonged to one view had no business sitting on the bar in the other three.
- **State is a row of pills, not a dim sentence.** Under the tabs, `By turn ·
  By file · Uncommitted` for Changes and `All · Changed N` for Files: each one
  says what is showing and sets it in one click. A filter that is on is a pill
  too, and clicking it clears it. A narrow pane keeps only the lit pill and
  cycles through the rest on a click. The right end of that row is the scope
  pill, `in jiaolong ▾`, in a repository that has more than one folder; it
  replaces the `N uncommitted` count there, and at forty columns it gives way
  to the grouping pills, which say what the list itself is. With a workspace
  picked it names that folder instead, lit and with no `▾`, and a click on it
  goes back to your own.
- **No restore, and no hover in the stream.** Sidecar is a viewer; and hover
  needs a mouse report per cell crossed. The one exception is the folded side
  panel, which asks for those reports only while it is folded and only to
  peek open (see "Home, the opening, the panel").

An open turn, from the same run, with every kind of row in it — the wrapped
prompt, the chips, the folder bar, three agents, and the files:

```
 ▾  document greet and get a few agents to check it    14:15
 │  over
 │  ▐2 files▌ ▐+11▌  1m 30s                  ▐● uncommitted▌
 │  ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
 │  ■ root 73%   ■ src 27%
 │
 │  ⠧ 3 agents  ·  1 running  ·  1 done  ·  1 st… 43k tokens
 │  ▸ ■ Check the README wording  ▐Explore▌  ✓     18s   18k
 │  ▸ ■ Rewrite the example                  ●     12s   12k
 │  ▸ ■ Polish the greeting  ▐Opus 4.5▌      ⠧ 28m 09s   12k
 │       ⎿  Bash  Typecheck the greeting
 │
 │  root
 │   ▸ M  README.md   ■■ ⚠ two agents     ▄▄▄▄▄     +8
```

Two other looks were drawn and not chosen, and are kept on the canvas: a
painted "workbench" with a timeline spine, and parallel agents as git-graph
lanes. The lanes cost ten columns and the owner found per-file "who is working
here" marks too much. What survived from them is the menu bar and the Agents
view.

## Agents

Does Claude tell sidecar about its subagents? Not directly, and it does not
need to. Claude Code writes every subagent to disk beside the chat that
started it, live, and that is all sidecar reads:

```
~/.claude/projects/<project>/<chat>/subagents/agent-<id>.jsonl      what it did
~/.claude/projects/<project>/<chat>/subagents/agent-<id>.meta.json  who started it
```

The meta file holds the kind of agent, the few words Claude gave the job, how
deep it is (an agent started by an agent is depth 2) and the id of the tool
call that started it. That id appears in the main chat, inside a turn, which is
how an agent is tied to the prompt it was working for. Checked on this machine
against three real runs.

| Shown | Where it comes from | How good |
|---|---|---|
| Kind, task, model, steps, tokens, report | the agent's own transcript | Exact |
| Running, done or stopped | the task notification the chat writes when an agent ends (`<task-id>`, `<status>`), or the last reply ending its turn | Exact, including an agent the user stopped; only a run with no notification yet falls back to a quiet timer, and that guess is labelled as one |
| Who started whom | the child's meta names the tool call; the parent's steps carry that call's id | Exact when both files are there, otherwise the shallower agent that was running when it started |
| Files an agent wrote | its own Edit and Write calls | A hint: a shell command can write without naming a file |
| Files an agent wrote **in a worktree of its own** | that folder's own git | Exact, and it does not depend on the agent naming anything |
| Lines changed per agent | nothing | Not available. Snapshots are per turn, so an agent's row shows the turn's counts for that file |

An overlap (two agents wrote the same file) is flagged on the file's row.
Workflows and background agents are the same files on disk.

Decisions, and why:

- **An agent is its job, not a label.** It used to be `A1`, `A2`, `A3`, and the
  label was dead weight: nobody thinks "what is A2 doing". An agent is the few
  words Claude gave it — `Write the WezTerm launcher` — with a `■` in front in
  its own hue. The hue comes from the order it started inside its turn, so the
  same agent is the same colour in its row, on the files it wrote and in its
  lane. The same squares mark the files: two of them on one file row, plus
  `⚠ two agents`, is the one thing a list of agents cannot say.
- **A chip only for what is not the default.** A `general-purpose` agent on the
  chat's own model says nothing worth two columns, so it gets no chip; a kind
  Claude chose (`Explore`) or a model that differs (`Opus 4.5`) does.
- **The turn is the root and the agents hang under it** on the same left line,
  under a head row that counts them: `⠹ 3 agents · 2 running · 1 done` with the
  tokens on the right. The count comes first because it is the thing you are
  looking for. Under a running agent hangs `⎿ Bash  npx tsc --noEmit`; under a
  finished one, the calls and the files it left behind.
- **An agent row is a row that opens, not a branch of a tree.** It reads `▸ ■
  task`, with the chevron every opening row has. The `├─` and `└─` joints are
  gone: they said where an agent sat in a tree that is one level deep almost
  every time, they cost the two columns the chevron and the square now use, and
  they could not carry a chevron as well. Nesting is an indent with the parent's
  `│` beside it, the way the Files tree draws what is inside a folder, and
  everything that hangs under an agent starts where its task does. The model it
  ran on is the first fact to go when an open row is too narrow to hold them
  all: what it was and how much it did are why the row is there.
- **An agent that worked somewhere else says so in one row.** Under its own
  row, a fact row: `in agent-docs   1 file ▄▄▄▄▄` on the left, and on the
  right the folder's state word, said the one way every list of folders says
  it — `⠧ Opus 4.5 · 12m` while it runs, `✓ merged 11:56`, `removed`, `not
  recorded`, `↑1 · not merged`, `2 uncommitted`, or `clean` (see "The state
  words"). One thing, because the first one that applies is the whole truth
  about that folder. The Agents view's folder rows say the same words. At 40
  columns the count gives way and `↑1 · not merged` is `not merged`. Once the
  folder is merged, removed or never recorded there is nothing left to count,
  so the left side is `in agent-docs` alone rather than a count of nothing.
- **Opening such an agent lists that folder's own files**, read from its git,
  as text rather than as rows that open: the diff for them is over there and
  nothing here could open it. The old `wrote …` line looked those files up in
  this turn's changes, where a file written in another folder was never going
  to be found.
- **Quiet is not the same as stopped.** An agent that is inside a tool call, or
  waiting on a child agent, writes nothing to its own transcript while it is
  plainly alive. The notification answers it outright, so the timers only cover
  a run Claude Code was quit in the middle of: five quiet minutes with no call
  open, twelve minutes inside a call (a guess, bounded by Claude Code's
  10 minute Bash timeout), and no limit at all while the open call is the one
  that started a child agent — that agent lives as long as its child does.
- **A crowd folds.** More than eight agents in a turn and the finished ones
  become one row you can open. In the Changes view more than three become one
  row, because the whole story belongs to this view.
- **The tab only exists when there is something on it:** an agent running, or
  an agent that belongs to the chat this pane is following. It never vanishes
  while you are looking at it, and `3` always opens it.

### The Agents view: lanes on a clock

The Changes view answers "what did this turn do". The Agents view answers
"who was working, when, and where", and that is a chart, not a list.

```
 ⠴  hand the guide to an agent in its own worktree     14:35
 │  1 agent  ·  7m
 │
 │                        14:35      14:38     14:41
 │  in agent-a7b1                             ✓ merged 14:45
 │  ▸ ■ Write the guide   ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄ ✓  6m 36s

 ▾  document greet and get a few agents to check it…   14:15
 │  3 agents  ·  at most 2 at once  ·  29m
 │
 │                        14:16      14:30     14:45
 │  in demo   the folder you are in
 │  ▸ ■ Check the README… ▄                        ✓     18s
 │  ▸ ■ Rewrite the exam… ▄                        ● stopped
 │  ▸ ■ Polish the greet…  ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄ ⠴ 28m 28s
 │      ⎿  Bash  Typecheck the greeting          2 tool uses
```

- **One clock a turn.** Every agent of a turn is a bar on the same 26 cell
  axis, its start and end mapped onto the span the turn's agents cover, and a
  running one stretches that span to now. Four short bars at the left and one
  long bar after them is "it thought, then it worked". Three bars in a column
  is work that really happened at once — and `at most 3 at once` says so in
  words, because three bars in a column and three bars in a row look more
  alike than they should.
- **The bar's colour is what the agent did**: its own hue when it wrote files,
  dim when it only read, accent while it runs, faint when it was stopped.
- **Grouped by the folder it worked in**, with a heading per group: `in
  jiaolong`, or `in agent-a764` for a worktree, or `in three worktrees` when
  Claude gave each of three agents one of its own. The heading carries the
  state of that folder on the right — `✓ 3 merged`, `read only` — which is the
  other thing a list of rows cannot show: whose changes are in your folder and
  whose are not.
- **Exact, and guessed.** The bars are exact: every agent's transcript carries
  the time of its first and last line, and the notification says when it
  ended. What it wrote is a hint, as everywhere: Edit and Write calls name
  their file, a shell command does not. Below 56 columns there is no room for
  a lane, so the rows fall back to the branch form of the Changes view.

## Worktrees

Claude Code gives a background agent a git worktree of its own: the same
repository checked out into another folder, on its own branch, so several
agents can edit the same files at once without meeting. The pane's folder is
one of those folders too.

That broke the pane's one promise. An agent would work for twenty minutes and
the pane showed nothing: no files changed here, because nothing changed here.
Then the branch was merged and forty files appeared at once, with no turn to
hang them on.

- **How they are found.** `git worktree list --porcelain` from the pane's
  folder gives every folder, its branch and its head. Which agent is in which
  comes from the agent's own meta file (`worktreePath`, `worktreeBranch`) and,
  for an agent without one, from the `cwd` every transcript line carries.
  `src/core/worktrees.ts` answers two questions per folder: how far it has
  gone (dirty, `↑N` ahead) and whether it has arrived here (merged, and when).
- **A worktree is where an agent worked, never a block of the stream.** It
  shows in three places and no more:

  | Where | When |
  |---|---|
  | one fact row under the agent's own row, inside the turn that started it | always, in either scope |
  | the Workspaces list: in the side panel, or at the head of the stream | the panel whenever it is on screen; the head of the stream whenever it is not, in either scope, once the repository has two folders to list |
  | a folder chip on a turn's title, and the folder's hue on its chevron | the wider scope only, and only on a turn that was typed in another folder |

  The WORKTREES map that used to head the wider scope is that list now. It
  lists every folder on disk and a gone one only on the day it landed here:
  a folder removed last week, merged or not, is history the stream already
  carries, and listed it pushed the folders somebody is working in off the
  bottom of the panel. A merged branch arrives as a fourth thing that is not
  a place at all: a landing row, which is its own news (see "Home, the
  opening, the panel").

  It used to be four places, and one of them was a block: the worktree got a
  stream block of its own, repeating the twenty minutes the agent's row already
  carried, with a `you ·` in front of every chip to say which of the folders was
  yours. The block is gone, and so is that caption and the chip on this folder's
  own turns. The fact row under the agent says where it worked and how far that
  has got, in one row, and that is the whole of it.
- **Scope: mine, one folder, or all.** `mine` is the pane's folder plus every
  worktree an agent of its chats is working in, or worked in today. A picked
  workspace is one folder and nothing else: its own turns, its agents, its
  tree and its git. `all` is every worktree of the repository. `w` steps
  through them in the list's order — yours, each other folder, all of them,
  yours again — and the scope pill widens or comes back. One folder and all
  of them are never both true. The wider scope adds exactly one thing to the
  same stream — the chip and hue on a turn from another folder. The day's head
  counts every turn of the day across its chats, a divider names the chat each
  run of turns belongs to, and the turn that starts open is still this
  folder's own newest, not the newest by the clock.
- **`all` really does widen the data.** A chat is keyed by the folder it was
  typed in, so a chat that ran in another worktree has a transcript directory
  of its own that is invisible from here. In `all`, `src/core/folders.ts`
  reads each folder's transcripts, subagents and git the same way the pane
  reads its own, and the turns are interleaved by time and tagged with their
  folder. There are no snapshots there — sidecar only ever watched the folder
  it runs in — so those turns are filled in from that folder's own commits.
- **Remembered heads.** A merged agent worktree is usually deleted the moment
  it lands, which is exactly when you want to know it landed. So while the
  pane runs it writes each worktree's head into
  `~/.sidecar/<project>/worktrees.json`. A head we remember that its parent
  can now reach reads `✓ merged HH:MM` even after the folder is gone, **as
  long as it ever had a commit of its own**. Reachable is not the same as
  merged: a folder checked out at an old commit and never committed in is
  reachable too, and calling it merged put a landing in the stream for work
  that never happened. So the pane writes down, the first time it sees a
  folder, the head it was at (`born`), how many commits it was ahead then
  (`bornAhead`) and where it had left its parent (`bornBase`). A folder still
  at its first head with nothing ahead then is fresh, and a fresh folder is
  never merged; everything else its parent can reach is, a fast-forward
  included. The time is the merge commit's own when there is one. A
  fast-forward has none, and the next commit on the parent is somebody
  else's, so its time is when this pane first saw it merged — written once,
  beside the head — or, for a merge that happened while the pane was closed,
  its own last commit's. What it brought is measured from where it left its
  parent, never from the merge base, which after a merge is its own head, and
  the commits are counted there too. The trunk is asked about by its sha, not
  its name, because it moves without the pane's own head moving whenever the
  pane sits on a branch. One that is gone and never arrived reads `removed`.
  **If the pane was not running when it
  existed, nothing wrote its head down**, and then the row says `not
  recorded`: the branch and the folder are both gone and there is nothing left
  to measure.
- **Cost.** A folder somebody is working in is read every poll, like the rest
  of the pane; an idle one every thirty seconds. Per folder that is a `git
  status`, a `rev-list --count` and a `diff --numstat`, all cached by its head
  and its status text, so a folder nothing moved in costs nothing. Only `all`
  reads other folders' transcripts, and at most eight folders.

The Workspaces list with no panel on screen and one folder picked, printed by
`npx tsx scripts/smoke.tsx` over this repository on the day Version 5 was
built: the list, the picked folder's name, its journey, and where its work
stands.

```
  By turn  ·  By file  ·  Uncommitted      in worktree-agent-a0f86dd2…

 WORKSPACES                                              1 active of 7
   ⠏ worktree-pane-ide-uiux                     agent · 18 uncommitted
 ▎ ○ worktree-agent-a0f86dd29bd76af16                   ✓ merged 14:20
   ○ worktree-agent-a6ffe834c553b62ce                   ✓ merged 14:19
   ○ worktree-agent-a96ec96af866df087                   ✓ merged 14:26
   ○ clarify-worktree-display                                    clean
   ○ improve-pane-layout-polish                                  clean
   ○ main                                                        clean

  in agent-a0f86dd29bd76af16
  ●━━━━━━━━━━━━━●━━━━━━━━━━━━━●━━━━━━━━━━━━━●
  started 14:13 committed     merged 14:20  removed
  everything it did is in worktree-pane-ide-uiux now
```

## Usage

Three sections in one order — **Session, This week, This chat** — each answering
one question, and each on its own panel. Pace lives inside Session, because how
hard the window is being worked is the same question as what is left of it.

- **A panel, not a card.** This is the one view in the pane that paints a
  background: a title strip on `surface2`, the body on `surface`, covering
  columns 1 to `cols - 2` on every row, with the text two columns in from each
  side. Full cells only — no half-block edges and no corners, which is what the
  owner disliked about the old cards. The panel earns its keep twice: it gives
  the section a right edge, so a value can be right-aligned against something
  instead of against air, and it gives a meter ground, so the part that is still
  free can go quiet (`theme.track`) instead of reading as a second solid bar.
  One row with no background separates panels.
- **No padding rows.** A panel is its title strip and then its rows, with
  nothing between them and nothing at the bottom. The page was empty and grey
  when every section held blank surface; the fix was to take the air out and put
  the colour back, not to add sections.
- **One meter grammar.** Name on the left, the figure in bold on the right with
  the quiet word that says what it is a share of (`23% used`, `59% of tokens`),
  then the meter, then at most one dim note. A limit's meter is the thin line
  (`━━━───`, half a cell of precision with `╸`); Session's own is the thick `▄`
  under its big number. `meterTone` colours both: `accent` while there is room,
  `warn` from three quarters, `del` from nine tenths. The big digits take the
  same tone, so the number and its bar always say the same thing.
- **The big number is proportional.** Three screen rows of half blocks; a glyph
  is as wide as it needs to be, so `.` costs one pixel and `%` gets five.
  Rather than being cut off it gives way in steps: full size, then the `~` as
  ordinary text so the digits keep their size, then half size. `used` follows it
  on the third row, and `resets in 1h 52m` / `at 00:40` sit right-aligned
  against the first two; only when no size leaves room for those do they drop
  under the meter as notes.
- **Pace, inside Session.** Ten past half hours, three rows tall, a `▁` floor
  under an idle one, `accent` on the half hour we are in. A bar is two columns
  with one of air beside it at every width, so the chart keeps its shape in a 40
  column pane. With a feed, two more bars in `warn` carry the current pace (the
  mean of the last two half hours that had tokens) forward, and the legend
  `■ used  ■ projected` names them. Those two are the first thing to go when the
  pane is narrow, and the legend goes with them.
- **The outlook sentence is arithmetic, not a feeling.** `paceOutlook` in
  `src/core/usage.ts`: the window is five hours and the reading says when it
  resets, so the start is known; `rate = used / elapsed`, and what is left of
  the window goes at that rate. Over 100% it says "you reach the limit around
  HH:MM, N minutes before it resets" in `warn`; under it, "you end the window at
  about N%" in `dim`. Under ten minutes elapsed, nothing spent, or a stale
  reading and there is no sentence at all.

Two sources, and the view keeps them apart.

- **Tokens** are counted from the transcripts: every reply carries its own
  count and the model that wrote it. Pace, share by model and the context
  window need no setup, and cover every project, subagents included.
- **One reply is several lines.** Claude Code writes a reply's usage more than
  once and only the last line carries the final `output_tokens`. Keeping the
  first undercounted every reply, so replies are held by message id and each
  count grows to the largest one seen.
- **"This week" is a claim only a feed can make.** With one, the feed's 7 day
  window is a real week with a real reset, so the panel is titled "This week".
  Without one it is a rolling seven days counted from the transcripts, titled
  "Last 7 days" with the count on the strip, and it loses the one row it cannot
  know: the `All models` limit.
- **Limits** (how much of the 5 hour and weekly allowance is used) are only
  ever handed to a status line script. `hooks/statusline.mjs` saves what it is
  given to `~/.sidecar/usage.json`. There is exactly **one** `statusLine` slot
  in `~/.claude/settings.json` — not a list like `hooks` — so the script cannot
  sit beside anything. It has to *be* the command, and `npm run connect` makes
  it one: a timestamped backup of `settings.json`, then the whole previous
  `statusLine` object into `~/.sidecar/statusline-chain.json`, then ours in the
  slot. The script runs whatever was chained with the same stdin and prints
  exactly what it printed, **including nothing** — a tool that only forwards the
  payload to its own app still shows no status line. `npm run disconnect` puts
  the old object straight back. It is never installed without the owner running
  the command, and a tool that rewrites the slot on launch will take it back,
  which reads as `feed quiet` rather than a wrong number.
- **Without a feed, nothing is a percentage.** The session number becomes the
  window's own new tokens, estimated from the transcripts and written `~209k`,
  and the same estimate is what the menu bar shows.
- **There is no per-model limit** in what Claude Code exposes. So the model row
  under the week's limit is the chat's own model (or whichever spent most)
  against the week's **tokens**, and the figure reads `59% of tokens`, never
  `% used`. It gets no reset note, because it has no reset.
- **"By model" is the stacked bar and its legend.** One bar the width of the
  panel, a slice a model, largest remainder so the slices add up exactly and a
  model with tokens always shows; then `■ Name NN%` chips, three across a wide
  panel and two across a narrow one. A share that rounds to nothing reads
  `<1%`, never `0%`; a model that spent nothing is dropped.
- **A model's colour is its own.** `modelColours` in `theme.ts` — `link`,
  `string`, `keyword` and two hues that mean nothing else, a teal and a pink —
  keeps clear of `accent`, `warn`, `add` and `del`, which all have jobs. Hues
  are handed out in **name order, not rank**, so a model keeps the same colour
  in its own line, in the bar and in the legend, and keeps it when the shares
  move.
- **No per-agent breakdown.** One line — `Subagents 70%  ·  4.5M of 6.4M  ·
  main thread 1.9M` — is the whole story, and a list of agents belongs to the
  Agents view. The `· main thread` half goes when it will not fit, then the
  counts; the share never does.

## Where the history comes from

Claude Code already writes everything needed, and writes it live. This was
checked on this machine, not assumed.

| Question | Where the answer is | How good |
|---|---|---|
| Which chat, which prompt, what Claude did about it | `~/.claude/projects/<project>/<session>.jsonl` | Exact, and it goes back through every past chat |
| Which lines a turn changed | a snapshot of the project taken either side of the turn | Exact, from the moment sidecar first runs |
| Which lines a turn sidecar was *not* open for changed | the project's own commits, matched to the turn by time | Exact lines; the turn they belong to is matched, and the row says so |
| What differs from the last commit | git | Exact |
| Whether Claude Code is waiting for you to allow a tool call | nowhere in the transcript: the one hook there is writes it down | Exact while the note still matches the transcript |

Five things follow from that.

**One hook, for the one thing the transcript never records.** The transcript is
flushed message by message: opening the file and reading the bytes appended
since last time tells you the chat, the prompt, the tool running right now and
when the turn ended. Day 4's status line and Day 6's turn list both fall out of
it, and the six-event `hook.mjs` plan was never built.

The exception is the permission prompt. It lives in the CLI, and answering it
either way makes it gone: nothing about it is written down, and a turn parked
on one appends nothing at all, so from the outside it looks exactly like a turn
thinking. `hooks/attention.mjs` writes it down. The event is
`PermissionRequest`, not `Notification`, because `PermissionRequest` carries
`transcript_path` and `tool_use_id` — which chat, and which call — and
`Notification` carries only a message to show. The note is
`{at, tool, toolUseId, sessionId, transcriptPath, transcriptSize}`, written to
`~/.sidecar/<project>/attention.json` through a `.tmp` and a rename, so the
pane never reads half of one.

**Nothing ever deletes the note.** A hook that fires when the prompt goes up
cannot fire again when you answer it, so the file on disk only ever means "a
prompt was raised here once". Whether it is still true is read back out of the
transcript, every poll, by `src/core/attention.ts`: the call named in the note
has no result yet, and the chat is still inside that turn. Where the call's
record has not been flushed yet — the hook can beat it — the fallback is the
transcript still being the size the hook wrote down, because answering, either
way, appends a line. `bypassPermissions` never raises a prompt, so the hook
never fires and the pane says nothing, which is right.

The hook obeys the rules every hook in this repo obeys, and they are the reason
it is safe to install: it prints nothing on any path, because a hook that says
nothing has made no decision and the prompt you are looking at is untouched; it
has no dependencies; it runs `async` with a five second timeout, so Claude never
waits for it; and it exits 0 on every path, including bad stdin and an
unwritable folder. It is never installed for you. `npm run connect` appends it
to `hooks.PermissionRequest` in `~/.claude/settings.json` — appends, because
hooks are a list, so the owner's Orca hook and the toast are untouched — and
`npm run disconnect` removes only the entries that run `attention.mjs`, by name
rather than by path, so a copy connected from another checkout comes out too. If
`hooks` is not the shape Claude Code documents, connect stops and says so rather
than guess.

**Never guess a file from a command.** The first attempt read paths out of
shell commands and confidently attributed `Object.assign` and `frames.push`.
In auto mode Claude edits through the shell, so there are no `Edit` records to
lean on either. The only honest answer is to look at the project before and
after: a bare git repo in `~/.sidecar/<project>/shadow.git` with the project as
its work tree. Measured on this Mac: 89 ms cold, 57 ms warm, and the project's
own `.git` is never touched.

**Say which one you are looking at.** A file nothing recorded is still in the
turn's list, marked `not recorded` with no counts, per file rather than per
turn. Nothing pretends to a precision it does not have.

**Know when you were looking.** Snapshots are only written when something
changed, so an hour with sidecar open and nothing happening used to look the
same as an hour with it closed, and an old turn could borrow the nearest
snapshots from hours away. Sidecar now records the stretches it was running
(`watched.json`), and a turn is only measured when one stretch covers it from
start to end.

**A turn nobody watched is filled in from the commits.** Open the pane an hour
late and the session's own work used to read `not recorded`, and opening a file
said it matched the last commit — which was true, and useless. The project's
git history has those lines. So a turn with no snapshots either side of it is
matched to commits by time: a commit belongs to the turn with the latest start
at or before the commit's committer time, across every chat of this project, so
a turn's window runs from its own start to the start of the next turn wherever
that was typed. The turn's diff is then the parent of its first commit up to
its last, on HEAD's first-parent history, and its status line says `from 3
commits` or `from commit 8476629`.

This squares with "Never guess a file from a command": nothing here is a guess
about lines. Git counted them. The only thing matched is which turn a commit
belongs to, which is why the row names the commits it used and why a turn the
pane *did* watch keeps its snapshot diff and ignores commits entirely. Cost is
one `git rev-parse HEAD` per poll while HEAD is unchanged, and the log is
bounded by the oldest turn still missing. Outside a git repo nothing changes.

## The bar and the first frame

The right end of the bar is the one thing you glance at without moving your
eyes off the conversation, so it has to say the true thing and not a category.
It used to say `working` or `idle`, which is two of the five things that can be
true. Now it reads the transcript the same way you do, and takes the first of
these that applies:

| Word | When | How it looks |
|---|---|---|
| `⠧ reading` | the pane has not finished its own first read | accent spinner, `dim` word |
| `⠧ 1 agent` | any agent is running | accent spinner, `ink`; the count is the news, and the turn they belong to is working by definition |
| `● asking you` | the newest turn has an unanswered `AskUserQuestion` or `ExitPlanMode`, or the permission hook's note is still live | `warn` dot and word |
| `⠧ Bash 4m` | the turn is running: the tool it is inside, cut to eight columns, and how long the turn has been going | accent spinner, `ink` |
| `● your turn` | the newest turn ended, and it ended today | `ink` dot, `text` word |
| `● idle` | nothing of today to say, or no chat at all | `faint` dot, `dim` word |

`asking you` is keyed on the question and never on the turn running, because a
turn parked on a permission prompt appends nothing: those are two different
facts and only one of them is about you. Ended is read out of the transcript
now — `stop_reason: end_turn`, or a reply cut off with the interrupt line right
after it — rather than from a quiet timer, which called a finished reply
running for two minutes and a slow tool call finished after two. The timer is
left only as the bound on a call that never came back, and inside an open call
it is twelve minutes, past Claude Code's own ten minute Bash timeout.

A spinner says something is happening and never says for how long, so the same
question is answered one row in as well: the running turn's step row and a
running agent's say `6m quiet` in `warn` once the silence passes five minutes,
and the turn's step row says `waiting for you` outright while the hook's note
is live. The Changes tab carries a `warn` dot for that while you are looking at
another view, because it is the one thing worth pulling you out of one.

**The first frame is a card, not an empty stream.** The pane starts before it
has read anything, and what it drew then was the chrome with one dim sentence
under it. Now the stream's place is taken whole, a third of the way down, by
one card: the pane's name in the pixel font (`bigDigits`, with A–Z added to the
digit map), the folder and the branch, and a readout of what the read has
found. The chrome above it and the footer below it never move, so nothing jumps
when the real rows arrive. The pills wait until there is something for them to
be showing.

The readout is honest about how far it has got. Before the transcripts are in,
one `readdir` is all it can afford, so the row says `reading 58 chats…`; once
`readSessions` and `readAgents` have returned it says `3 chats   41 turns   12
agents`; while the commits are still being measured a spinner row under it says
so. Files keeps its tree and its reader through all of this — those are worth
looking at whether or not anything was ever typed here — and so does every
grouping but By turn, which is the only one the chats themselves are the
content of.

The same card is the empty state, with its last row settled. A folder is only
called empty once the read is over; before that it is a folder nothing has
looked in yet.

```
 ◆ Sidecar  View                                      ● idle

  Changes   Files   Usage
  By turn  ·  By file  ·  Uncommitted




   ██▀▀▀▀  ▀▀██▀▀  ██▀▀▄▄  ██▀▀▀▀  ██▀▀▀▀  ▄▄▀▀▄▄  ██▀▀██
   ▀▀▀▀██    ██    ██  ██  ██▀▀    ██      ██▀▀██  ██▀▀▄▄
   ▀▀▀▀▀▀  ▀▀▀▀▀▀  ▀▀▀▀    ▀▀▀▀▀▀  ▀▀▀▀▀▀  ▀▀  ▀▀  ▀▀  ▀▀

   nothing  ·  master
   no chats yet  ·  start Claude Code in this folder
```

The wordmark is centred rather than indented: at 62 columns it is 54 wide, and
a fixed indent would have pushed its last letter off the edge. Scale 2 while it
fits, scale 1 below that, which is 27 columns and leaves a 40 column pane room
for the readout.

**And there is no other idle screen.** The card is only ever in the way of
nothing. At rest the content is the content, and an attract screen would be a
thing to dismiss. Home is not one: it is a view with live facts on it, the
same ones the bar and the stream say, and `h` goes back to it (see "Home, the
opening, the panel"). With the opening on, the card is typed in and then
pushed off by Home; this card is what `--no-opening` draws instead, and it
is still the empty state of a By turn stream with no chats.

## Home, the opening, the panel

Version 5 gave the pane a front door. Before it, the pane opened on the
stream, which answers "what changed" before you have asked "where am I".

### Home

Home is a view, `h` from anywhere, and the `◆` at the left of the bar, the
way a site's logo goes to its front page. It says four things in the order
they are asked on coming back to a terminal: where you are, what is
happening now, what today has been, and where each key goes. This is the real
thing, printed by `npx tsx scripts/home-demo.tsx` over the afternoon the
boards were drawn with:

```
  Good afternoon                        Tue 23 Sep  ·  14:45
  sidecar-pane  ·  improve-pane-layout  ·  jiaolong

  NOW
  ⠹  Claude is on your turn                           47m in
     i think option 3 is exactly what i want. and when it o…
  ⠹  2 agents in folders of their own         not merged yet
  ✓  1 branch landed here today                        13:20

  TODAY
  11 turns   ▂▁█▁▁▃▆▅▆▅▂   +4,180 −1,630   5h 40m

  GO TO
 ▎ 1  Changes     what each turn did                 3 files
   2  Files       the tree, changed files first    3 changed
   3  Agents      who is doing what, and where   ⠹ 2 running
   4  Usage       how much of the day is left   58% · 1h 52m
   w  Workspaces  every folder of the repo          3 active
   m  Menu        every key, in one place
```

- **A view, not a splash.** The rule against an attract screen stands: a page
  you have to dismiss is in the way. Home carries live facts and nothing else
  — every one of them is something the bar or a view already says, worked out
  by `homeFacts` in `src/core/home.ts` with the same questions in the same
  order as the status at the right of the bar — so it is worth coming back
  to, and `h` is how. It is always about the pane's own folder: picking a
  workspace leaves Home, and Home never shows a picked one.
- **GO TO rows are the only rows the cursor stops on.** Each one does what
  its key does, Enter or a click, and carries that view's news on the right.
  A description is cut to what its row leaves it, so an 80 column pane with
  the panel open still has them; under eight columns a cut one says nothing,
  and then they all go together, so the column never reads as a few half
  sentences and a few gaps.
- **The bar says what Home says.** Its status is drawn from the same
  `homeFacts`, and the footer on Home and in Usage always names the pane's
  own folder: only Changes, Files and Agents are ever about a picked one.
- **No tab row on Home.** There is nothing to group, and the GO TO rows are
  the tabs. The footer says `enter go  h home  ↑↓ move  m menu  q quit`.

### The opening

About three seconds, and only while the first read runs. Every number in it
is real: the chats counted by one `readdir`, then the transcripts, then the
commits, and at the end today's own pluses and minuses.

1. For 400 ms a caret blinks where the name will start.
2. The name is added the way a diff adds lines: six rows of a block font, one
   row every 130 ms, each typed across in 120 ms in the add colours with a
   `+` two columns out, then settled into the wordmark's gradient.
3. At 1250 ms the readout and the folder line appear: `reading 58 chats…`
   with the spinner, then `3 chats   41 turns   12 agents`.
4. At 1310 ms the bar appears and fills with the read's real progress: 15%
   for having started, 55% once the transcripts are in, all of it once the
   commits are measured. It walks to each target at one bar per 700 ms and
   never jumps, so a fast read still fills over 700 ms and a slow one fills
   as slowly as it really is.
5. Full, it flips a cell every 18 ms into git's own stat bar — the share of
   today's lines that were added, in pluses, the rest in minuses — and then
   the totals, `+4,180 −1,630`, appear beside it. A day with no lines says
   `no changes today` instead.
6. The finished card holds for a second, and Home pushes it down and off one
   row every 26 ms, with a caret where the next row goes in.

Any key or click skips it and does nothing else, bar `q`, which still quits:
a key that did something as well would do it to a page you have not seen.
Skipped, it goes straight to Home, not to a card: Home's NOW row says
`reading…` and its TODAY row `reading…` until the read is over, so skipping
early is safe. `--no-opening`, or `SIDECAR_NO_OPENING=1` (or `true`) for
good, does the same from the start; `0`, `false` or an empty value leave it
on. `cli.tsx` is the one place that reads the variable, and App trusts the
prop it is handed. `--snapshot` and anything that is not a terminal never
play it. The card itself is left for a folder Claude Code has never been run
in, drawn in the opening's own order: the readout, the bar's row, and where
you are. The pointer does not peek the panel open while it plays.
`src/ui/opening.ts` is a function of the time since the opening started and
of what the read has found, with no state and no timer, so any moment of it
can be printed: `npx tsx scripts/opening-demo.tsx`.

### The side panel

The views and the folders down the left of the pane, each with its key, the
way an IDE's primary panel is the legend and the status at once. It pushes
the content over rather than covering it; the bar keeps the whole width.

| Pane width | Panel |
|---|---|
| 80 columns and up | open, 22 columns: each view with its key and its figure, the Workspaces list, `w` and `m` |
| 64 to 79 | folded to a 9 column strip: each view's glyph, its key, and a spinner where something runs |
| under 64 | none, and the tab row is back |

Open and folded, printed by `npx tsx scripts/panel-demo.tsx`:

```
 «  fold          b  │        »      │
 h  Home             │        ◆  h   │
▎1  Changes        3 │       ▎+− 1   │
 2  Files            │        ≡  2   │
 3  Agents       ⠹ 2 │        ■  3 ⠹ │
 4  Usage        58% │        ▄▆ 4   │
                     │               │
 WORKSPACES     3/5  │        ⎇  w 3 │
▎⠹ improve-pane-la…  │
 ⠹ usage-round-thr…  │
 ⠹ markdown-page-v…  │
 ○ commit-backed-t…  │
 ○ main              │
   all folders       │
                     │
 w  next workspace   │
 m  menu             │
```

- **Its figures are Home's.** Changes carries the uncommitted files, as
  Home's Changes row does; Files carries none, because its figure would be
  the same number again; Agents carries the agents running, with a spinner;
  Usage the five hour window's percent. `3/5` is the folders somebody is
  working in over the folders listed, the same `active` Home and the list
  count.

- **`b` folds and unfolds it**, and the choice is kept per project in
  `~/.sidecar/<project>/ui.json`. Only a choice is written: a width the pane
  picked for itself is worked out again next time. An open panel at 64 to 79
  columns is honoured, because it still leaves the content 42. Under 64 there
  is no panel whatever was chosen, and `b` says the pane is too narrow.
  `SIDECAR_PANEL=off|open|folded` wins over both, which is how the smoke
  scripts pin the old layout — but nothing, that included, leaves the
  content under 40 columns: a panel that would is not drawn.
- **The folded strip peeks open** under a pointer that rests on it for 150
  ms, the way Claude Desktop's collapsed sidebar does, drawn over the content
  so nothing under it moves, and folds again once the pointer has been off
  the open panel for 150 ms. That needs the terminal's `1003` motion reports,
  one per cell crossed, so they are asked for only while the panel is folded
  and the mouse is on, and a report only ever arms a timer: the pane redraws
  once, when the timer fires. `b` is the way to keep it open.
- **No letters-only fold.** A strip of bare keys would say nothing the footer
  and the menu do not. The glyph is the view's own colours (`+−` for
  Changes, the meter's two bars for Usage), and the one figure kept is the
  one worth a column, a running agent's spinner.
- A click anywhere on a panel row does what it says; the headings and blanks
  do nothing. The panel is worked with the mouse and its keys: the cursor
  stays in the content.

### Workspaces and focus

Every folder of the repository is a workspace. Picking one — a click on its
row in the panel or the list, or `w` — scopes Changes, Files and Agents to
that folder: its own turns, the agents that worked in it, its own tree and
its own git. `w` steps through them in the list's order, yours first and
the main checkout last, then all of them at once, then back to yours; in a
repository with one folder it says there is nothing else to show. A picked
folder and all of them are never both true, and with all of them in view no
row carries the `▎` that marks the one you are in. A row is named by its
branch, or its folder's name when nothing is checked out — never by an
agent's task, which is a sentence, changes with every agent sent there, and
is no name anybody types. The pills row names the picked folder, cut to the
room it has, and a click on the name comes back; so does Esc on any row that
is not inside something open. Picking a folder closes the diffs that were
open, because each was read from the folder that was picked then. A fresh
stream starts its cursor on the newest turn, under the list: the list is a
way to go somewhere else, and the turn is what you came for.

A folder is **active** when somebody is working in it — its state word is
`working`, the pane's own folder while its turn runs included — and that is
the one meaning the word has, in the panel's `3/5`, the list's `3 active of
5` and Home's Workspaces row. Home's `not merged yet` is a different count:
folders other than yours whose work has not arrived, working, ahead or
dirty.

A picked folder's stream is headed by its **journey**, the four stops of a
folder's way from started to removed:

```
  ●━━━━━━━━━━━━━●─────────────○─────────────○
  started 14:13 2 commits     not merged    folder kept
```

A stop it has reached is lit in the folder's hue, and so is the line between
two lit stops; the current stop's label is bold. The same line hangs under an
agent's fact row inside an open agent block. Under 56 columns the nodes say
it alone.

### Landing rows

A merge is the moment another folder's work arrives in this one, and it used
to arrive with no row of its own: forty files turned up under whichever turn
happened to be next. Now a branch that merged into the pane's folder is a row
among that day's turns, at the time it landed, in the add colour, that opens
to show what it brought — who worked there, how many commits, how long, and
its files as text, because their diff lives in that folder's git. It is a
landing only if the pane's own head can reach it: a branch merged into the
trunk while the pane sits in a feature worktree has landed somewhere else,
and is not news here. The commits it shows are counted when it merged, from
where it left its parent; its `ahead` is nought by then and says nothing.

```
 ▸  ✓ merged  commit-backed turns      7 files ▄▄▄▄▄     13:20
```

### The state words

Every place that names where a folder has got to — the panel, the list, an
agent's fact row, Home — names it with the same word, the first of these that
is true (`stateWord` in `src/core/worktrees.ts`):

| Word | When |
|---|---|
| `working` | an agent is running in it, or it is the pane's folder and its turn is running |
| `merged` | the folder it answers to can reach its head, and it ever had a commit of its own (a fast-forward counts) |
| `removed` | the folder is gone and its work never arrived |
| `not recorded` | the folder is gone and nothing wrote its head down |
| `ahead` | it has commits its parent does not |
| `dirty` | it has uncommitted files |
| `clean` | none of those |

## Mouse

Ink has no mouse support, so the pane turns on the terminal's own reporting
(`1000` press and release, `1002` motion while held, `1006` for the SGR form,
and `1003` motion with no button, only while the side panel is folded)
and parses the escape sequences itself. Ink's input parser already hands each
report to `useInput` on its own with the escape stripped, so nothing has to be
hijacked: `src/ui/mouse.ts` is one regular expression.

Every line carries what a click on it does, so a row is a button.

| Where | Click | Wheel | Drag |
|---|---|---|---|
| The `◆` at the left of the bar | go Home | | |
| A menu title | open or close that menu | | |
| The usage meters | go to Usage | | |
| The status word — `⠧ Bash 4m`, `● asking you`, `● your turn`, `● idle` | go to Changes | | |
| A tab | switch view | | |
| A GO TO row on Home | what its key does | | |
| A row of the side panel | its view, its folder, `all folders`, fold or unfold (`b`), next workspace (`w`), the menu | | |
| The folded side panel, with the pointer resting on it | peek it open over the content | | |
| A pill | show that grouping, or clear that filter | | |
| `in <folder> ▾` at the right of the pills | widen the Changes view to every worktree, or back to this folder | | |
| `in <folder>` with a workspace picked | back to your own folder | | |
| A folder in the Workspaces list | pick that workspace | scroll | |
| A column of the day's skyline | jump to that turn | | |
| Any row with a chevron — a turn, a landing, a file, an agent, `N steps`, `N more files` | open or close it in place | scroll | |
| A hunk header | fold or unfold | scroll | |
| A gap | open it | scroll | |
| A diff line | move the cursor; double-click opens the file there | scroll | |
| A file in the tree | peek it in place; click again to close | scroll | |
| The last row of a peek | show forty more lines of it, or, when a change is still below, jump there as `]` does | scroll | |
| `‹ Files` in the reader | back to the tree | | |
| `Page` / `Source` in the reader | read a markdown file as a page, or as it is written | | |
| The last column | jump there | scroll | drag the thumb |

The last column is also a minimap: the thumb is a background, and the change
marks are spread over the whole track by where their row falls in the list, so
a mark and the thumb can share a cell instead of hiding each other. A click on
a row that has nothing to open walks up to the nearest row that does — the
nearest chevron above it — and nothing a click cannot reach keeps a click zone:
a menu title, a tab or a meter that had to be cut at a narrow width loses its
zone with its text. A click while the opening plays skips it and does
nothing else.

**Anything you do to a stream with the mouse pauses follow mode**, the same as
a key press, because the page is yours the moment you reach for it. Going
somewhere does not: `1`–`4`, `h`, `w`, `b`, `m`, `?`, `q`, anything on Home,
and a click or Enter that changes the view, the folder, the scope, the
grouping or a filter, or opens a menu, leaves it following. `f` hands it back. The
footer says which it is: `f following` in `accent` while it is on, `f follow`
in `dim` while it is not — where there is room for it. It is one of the last
hints, so a row with a long verb and something to go back out to pushes it off
a 62 column footer.

**One key that is not a click.** `y` on a line of a diff, or of a file in the
reader, puts `src/ui/App.tsx:1123` on the clipboard, through the terminal's own
OSC 52 escape, and the footer says `copied src/ui/App.tsx:1123`. That is the
whole of it: no file is written, no command is run, and what lands there is a
place rather than the code — the only shape of "take this with you" a viewer is
allowed to have. It is one function, so it comes out again in one commit if the
terminal it has to go through will not carry it.

## 4. The build, day by day

Claude writes the code. You decide direction and design. Each day ends with something you can run. Stop after any day and you still have a working tool.

### Day 1: skeleton (done)

File tree, plain preview with line numbers, keyboard control, Windows Terminal split launcher, smoke test that presses fake keys.

### Day 2: make it look good

1. ~~Toolkit check.~~ **Decided: Ink stays.** Its input parser already splits SGR mouse reports into their own events, so the mouse costs one regular expression instead of a new toolkit, and OpenTUI's pre-1.0 risk buys nothing.
2. Syntax colours for code.
3. ~~Markdown formatted: headings, bold, italics, lists, quotes, code blocks, tables, links.~~
4. ~~Three heading styles to choose from, shown side by side in the pane.~~ **Done, and there was nothing to choose between:** a markdown file is a page — a lit sheet with margins, a title over a heavy rule, sections over thin ones, wrapped prose, real tables and boxed code — with `Page` and `Source` pills in the reader's head row.

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

1. ~~`hook.mjs` and the hook config for `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Notification`, `Stop`, `SessionEnd`.~~ **Done, and it took one hook, not six:** the transcript already carries everything those five would have said. The sixth, the permission prompt, is the one thing it never records, so `hooks/attention.mjs` writes that down and nothing else. `npm run connect` appends it to `hooks.PermissionRequest` beside your Orca and toast hooks without touching them.
2. ~~Status line: `● working`, `● idle`, `● needs you` (permission prompts).~~ **Done, and it says more than three things:** `⠧ reading`, `⠧ N agents`, `● asking you`, `⠧ Bash 4m`, `● your turn`, `● idle` (see "The bar and the first frame").
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
3. ~~Follow mode: the pane jumps to whatever Claude just edited. Any key press pauses it; a key turns it back on.~~ **Done, and on by default.** Each poll the pane compares the running turn's known files with the last poll's, and a file that was not there before gets its diff opened, the one before it closed — one followed diff at a time — and the cursor moved onto it three rows down the page. It compares the snapshot's list, not the Edit calls, so a file a shell command changed without naming it counts. Any key, click or wheel inside a stream pauses it, while going to another view, folder or menu does not (see "Mouse"); `f` hands it back; when the turn ends the last diff it opened stays open.
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

1. **Risk flags.** Local rules that mark removed test assertions, newly skipped tests, new dependencies, edits to `.env` or CI files.
2. **Check lights.** `✓ typecheck passed` on a turn, read off the tool results it already has.
3. **"Before this turn"** in the reader: the same file as it was when the prompt was sent.
4. **Log view.** Tail a dev-server log file in the pane. Viewer only: Sidecar does not start the server.
5. **Wrapper mode (option B).** Only if the split still feels wrong after living with it.

**Never**, whatever else gets built:

- **Revert** a file or a turn. It was first on this list, and it is the one thing that would make the pane an editor. Claude edits, you look; `/rewind` and git are where undo lives.
- **Line comments that reach Claude.** Typing a note on a line and having a `UserPromptSubmit` hook carry it into your next prompt makes the pane an input to the conversation, which is the CLI's job. `y` is the viewer-only form of the same wish: it puts the place — `src/ui/App.tsx:1123` — on your clipboard, and you decide what to say about it.

## 6. Rules that protect the project

- Viewer only. No editing, no file operations, no running commands.
- Hooks stay silent and fast, and never block Claude.
- `core` and `ui` stay separate.
- Every feature must answer: does this help me see what Claude is doing? If not, it does not go in.
- Windows Terminal is the first-class target because that is what you use. Other terminals are best effort.
- Before each commit: `npm run typecheck`, `npx tsx scripts/smoke.tsx` and
  `npx tsx scripts/smoke-history.tsx`, each at `--cols 40 --rows 16` as well as
  at its own width. The two scripts drive the real pane — one over this repo,
  one over a whole fake day in a temp folder — and every frame in this file was
  printed by one of them. If it is not in a frame, it is not built.

## 7. Open questions

| Question | Decide by |
|---|---|
| ~~Ink or OpenTUI~~ | Decided: Ink, with mouse reporting parsed by hand. |
| The name on the bar and on the first frame: **Tower**, **Glass**, **Deck**, or keep **Sidecar**. It is one string, `NAME` in `src/ui/splash.ts`, and the wordmark is drawn from it, so changing it is one line | Whenever you like. The build ships `Sidecar` |
| Final name (`sidecar` is taken on npm; `sidecar-pane` is free) | Day 7, before going public |
| ~~Tree on top, or side by side when wide~~ | Decided: on top, in both views. Columns are the scarce resource in a split. |
| Should auto-open be on by default | Day 4 |
