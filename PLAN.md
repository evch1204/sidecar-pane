# Build plan

Sidecar is a **viewer** that sits beside the Claude Code CLI. You look at things in it. Claude does the editing. It never replaces the terminal and it never becomes an editor.

The design goal: the pane and the Claude CLI should look like they belong in one terminal. No floating-window look. Same glyphs, same dim greys, one warm accent.

Each day ends with something you can run and see. Stop after any day and you still have a working tool.

## Day 1: skeleton, file tree, plain preview (done)

- Project set up with TypeScript and Ink (React for terminals).
- File tree with folders that open and close.
- Moving onto a file previews it, with line numbers and scrolling.
- `npm run pane` opens it in a split beside your terminal.
- Code lives in two halves: `src/core` knows about files, `src/ui` draws. Keep it that way.

**You learn:** how an Ink app is built, how keyboard input works, how to size a layout to the terminal.

## Day 2: make the preview worth looking at

- Start with a one-hour toolkit check: try mouse clicks and wheel scrolling in Ink. If it feels bad, try the same in OpenTUI (Bun is already installed). Decide once, then move on. Only `src/ui` would need rewriting.
- Syntax colours for code files.
- Markdown shown formatted: headings, bold, lists, code blocks, tables, links.

**Done when:** opening `PLAN.md` in the pane looks like a document, not like source.

**You learn:** how terminal colour works, and how to turn markdown into styled lines.

## Day 3: open it from inside Claude

- A `/sidecar` command that opens the split for the current project.
- Works in Windows Terminal first. Prints a clear fallback message elsewhere.
- Package the repo as a Claude Code plugin (`.claude-plugin/plugin.json`, `skills/`).

**Done when:** in any project, typing `/sidecar` in Claude opens the pane on the right.

**You learn:** how skills and plugins are put together.

## Day 4: make it aware of Claude

- Hooks (`UserPromptSubmit`, `PostToolUse`, `Stop`) append one line per event to a small events file. They print nothing and never block Claude.
- The pane watches that file.
- A file lights up in the tree the moment Claude touches it.
- The header shows `● working` while Claude runs and `● idle` when it stops.

**Done when:** you ask Claude to edit a file and watch its row light up without touching the pane.

**You learn:** hooks, for real.

## Day 5: changes and diffs

- `+12 −3` badges on changed files, from git.
- A changed file opens as a red and green diff, like the concept mockup.
- Replace the hard-coded ignore list with `.gitignore` rules.
- A clear message in folders that are not git repos.

**Done when:** after a Claude turn you can see what changed without typing anything.

## Day 6: follow mode and feel

- Follow mode: the pane jumps to whatever Claude just edited. Any key press pauses it.
- Mouse: click a row to select it, wheel to scroll.
- A narrow layout for small panes.
- Smooth behaviour when the terminal is resized.

**Done when:** you can leave the pane alone for a whole session and it always shows the right thing.

## Day 7: design pass and decision

- Go through every screen with the design goal in mind. Fix spacing, colour, empty states, error states.
- An option to use the terminal's own 16 colours, so it follows any theme.
- A colour-blind-safe diff palette.
- README with a short GIF.
- Decide: keep it private, or make the repo public.

## Rules to protect the project

- Viewer only. No editing, no file operations, no terminal inside the pane.
- Hooks stay silent and fast. Anything a hook prints can end up in Claude's context.
- If a feature does not help you see what Claude is doing, it does not go in.
