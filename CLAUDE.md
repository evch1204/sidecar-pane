# sidecar-pane

A viewer pane that runs in a terminal split beside the Claude Code CLI. `PLAN.md` is the spec: read it before starting work, and update it when a decision is made.

## Working with the owner

- Claude writes the code. The owner decides direction and design. Do not hand work back.
- Explain in short, simple sentences. Show the running result rather than describing files.
- Give blunt opinions. Check what already exists before proposing a feature.

## Rules

- Viewer only: no editing, no file operations, no running commands for the user.
- `src/core` never imports from `src/ui` or Ink. `src/ui` never touches the file system directly.
- Hook scripts print nothing, have no dependencies, run `async`, and exit 0 even when the pane is not running.
- Never overwrite the owner's existing hooks in `~/.claude/settings.json` (Orca and a BurntToast toast). Add alongside them.
- All colours and glyphs come from `src/ui/theme.ts`.

## Environment

- Windows 11, Windows Terminal, Node 24, Bun 1.3, git. No Python, no `gh`. Write helper scripts in Node.
- The repo is published through GitHub Desktop and stays private for now.

## Checks before a commit

```sh
npm run typecheck
npx tsx scripts/smoke.tsx
```
