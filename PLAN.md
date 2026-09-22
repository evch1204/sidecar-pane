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

Plus a menu bar that says whether Claude is working or idle.

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
- Not yet: launchers for anything but Windows Terminal, follow mode, a
  "waiting for you" state (the transcripts do not say when Claude is blocked on
  a permission prompt).
- Design canvas: https://claude.ai/artifact/B8wcGJHEqSzm1Ubncr2M9s, and the
  same thing as files in `design/`. Page 3 of it is captured from the running
  pane, so it is never out of date by more than one `design/capture.tsx` run.

## One stream

The first build had a list on top and whatever you selected underneath. It
worked and it read like a terminal tool: your eyes went up to choose and down
to read. The redesign borrows from the owner's own web app (deepdotspace,
create mode), where a turn is a block and a diff opens under the row you
clicked.

```
 ◆ Sidecar  View        5h ▄▄▄▄▄▄ 58%  1h 52m · wk 23%   ● idle

  Changes   Files   Agents   Usage
  By turn  ·  By file  ·  Uncommitted           in jiaolong ▾

 TODAY   Layout polish, usage and agents   11 turns  ·  5h 40m
         ▄▄ ▄▄ ▄▄ ▄▄ ▄▄ ▄▄ ▄▄ ▄▄ ▄▄ ▄▄ ▄▄        +4,180 −1,630

 ●  i think option 3 is exactly what i want. and when i… 13:05
 │  ▐8 files▌ ▐+310▌ ▐−76▌  14m · 1 agent        ▐✓ merged▌
 │  ▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄▄
 │  ■ src/core 58%   ■ src/ui 31%   ■ docs 11%
 │
 │  src/core
 │   M  turns.ts                          ▄▄▄▄▄   +114   −12
 │   M  git.ts                            ▄▄▄▄▄    +96
 │  src/ui
 │   M  views/changes.ts                  ▄▄▄▄▄    +17    −5
 │  docs
 │   A  scratch-notes.md   not recorded   ▄▄▄▄▄
 │
 │  ▸ 40 steps   Read 14  Edit 11  Bash 9           1 agent
 │  ✦ Turns the pane did not watch now read their files
 │    from the commits made before your next prompt. more
 │
 │  ◆ 2fa351d  Fill a turn nobody watched from commits  13:19
 │  ✓ bffa4d9  merged into improve-pane-layout-polish   13:20

 ●  wait im not sure about the new…   no file changes   12:58
 ●  so i currently dont see any cha… 4 files ▄▄▄▄▄ ✓    12:41
 ●  sorry i forgot to pull from mai… 20 files ▄▄▄▄▄ ◆3   11:21
 ●  try running orchestrating agent…         4 agents   11:14
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
  the turn's own mark (`▾`, `▸`, or the spinner while it runs) and a `│` on
  every row under it, blank rows included. Same columns, no edge rows, nothing
  moves, and the line of a running turn is the one accent on screen.
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
  to the grouping pills, which say what the list itself is.
- **No restore, no hover.** Sidecar is a viewer; and hover needs a mouse report
  per cell crossed.

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
| Lines changed per agent | nothing | Not available. Snapshots are per turn, so an agent's row shows the turn's counts for that file |

An overlap (two agents wrote the same file) is flagged on the file's row.
Waiting on a permission prompt is not recorded anywhere, so the pane cannot
show it. Workflows and background agents are the same files on disk.

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
- **The turn is the root and the agents are branches** off the same left line,
  with `├─` and `└─`, under a head row that counts them: `⠹ 3 agents · 2
  running · 1 done` with the tokens on the right. The count comes first
  because it is the thing you are looking for. Under a running agent hangs
  `⎿ Bash  npx tsc --noEmit` and how many calls it has made; under a finished
  one, the calls and the files it left behind.
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
 ●  i think right now there is overall needs to have a…  11:21
 │  9 agents  ·  at most 3 at once  ·  1h 18m
 │
 │                        11:21       12:00      12:39
 │  in jiaolong   the folder you are in              read only
 │  Audit Usage view      ▄                          ✓  2m 39s
 │  Audit Agents view     ▄                          ● stopped
 │  Phase 1 · left line        ▄▄▄▄▄▄                ✓ 18m 02s
 │
 │  in three worktrees   one agent in each          ✓ 3 merged
 │  Phase 2a · Usage                  ▄▄▄▄           ✓ 12m 50s
 │  Phase 2b · Agents                 ▄▄▄▄▄▄         ✓ 18m 35s
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
- **Scope: mine or all.** `mine` is the pane's folder plus every worktree an
  agent of its chats is working in, or worked in today. `all` is every
  worktree of the repository. `w`, or the scope pill, switches. With more than
  one folder in scope the WORKTREES map heads the stream — one row a folder,
  filled node for active, `↑N`, and what it is doing — every block's title
  carries its folder's chip, and a worktree an agent is working in is a block
  of its own, saying the truth on its right: `not in your folder until it is
  merged`.
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
  `~/.sidecar/<project>/worktrees.json`. A head we remember that is now an
  ancestor of this folder's head reads `✓ merged HH:MM` — the time of the
  commit that brought it in — even after the folder is gone. One that is gone
  and never arrived reads `removed`. **If the pane was not running when it
  existed, nothing wrote its head down**, and then the row says `not
  recorded`: the branch and the folder are both gone and there is nothing left
  to measure.
- **Cost.** A folder somebody is working in is read every poll, like the rest
  of the pane; an idle one every thirty seconds. Per folder that is a `git
  status`, a `rev-list --count` and a `diff --numstat`, all cached by its head
  and its status text, so a folder nothing moved in costs nothing. Only `all`
  reads other folders' transcripts, and at most eight folders.

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

Four things follow from that.

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

## Mouse

Ink has no mouse support, so the pane turns on the terminal's own reporting
(`1000` press and release, `1002` motion while held, `1006` for the SGR form)
and parses the escape sequences itself. Ink's input parser already hands each
report to `useInput` on its own with the escape stripped, so nothing has to be
hijacked: `src/ui/mouse.ts` is one regular expression.

Every line carries what a click on it does, so a row is a button.

| Where | Click | Wheel | Drag |
|---|---|---|---|
| A menu title | open or close that menu | | |
| The usage meters | go to Usage | | |
| `working` / `idle` | go to Changes | | |
| A tab | switch view | | |
| A pill | show that grouping, or clear that filter | | |
| `in <folder> ▾` at the right of the pills | widen the Changes view to every worktree, or back to this folder (`w`) | | |
| A column of the day's skyline | jump to that turn | | |
| The WORKTREES header | fold or unfold the map | | |
| A turn, a file, an agent, "more", Steps | open or close it in place | scroll | |
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
a row that has nothing to open walks up to the nearest row that does, and
nothing a click cannot reach keeps a click zone: a menu title, a tab or a
meter that had to be cut at a narrow width loses its zone with its text.

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
