# The design canvas, kept in the repo

The redesign lives on a Claude design canvas:
https://claude.ai/artifact/B8wcGJHEqSzm1Ubncr2M9s

That link is private to the owner's Claude account and opens on any device
signed in to it. This folder is the same thing as files, so it also travels
with the repo and can be rebuilt or republished from anywhere.

| Page | What it is |
|---|---|
| Version 1 · Cards | The first redesign. One stream, cards, diffs that open in place. Drawn by hand. |
| Version 2 · Workbench | The alternative look: painted background, timeline, agent lanes. Drawn by hand. Not chosen. |
| Version 3 · Built | What the pane really draws today. Not drawn: captured from the running app. |
| Version 4 · Proposal | The next look, drawn by hand and not built yet: sizes as shapes, files grouped by folder, the agents as the chart Claude Code prints, worktrees, and the bar in every state. |
| Version 5 · Two directions | The pane as an IDE side panel, two ways. A: a Workspaces list on top, the detail under it, a palette. B: a rail on the left edge that is also the key legend, and worktrees as lanes on a clock. Both add the journey line, the landing row and one word per worktree state. Drawn by hand; not decided. |

## What is here

- `project/` is exactly what is published: one `.dc.html` per artboard plus
  `canvas.json`, which says where each board sits. The canvas edits
  `canvas.json` itself, so it is kept by hand and never regenerated.
- `lib.mjs` lays a mockup out on a true 64 column grid and refuses to build a
  row that does not fit. `boards.mjs` and `kit.mjs` are Version 1, `v2.mjs` is
  Version 2, `v4.mjs` Version 4 and `v5.mjs` Version 5. `node design/v5.mjs
  --text` builds the Version 5 boards alone and prints them as text.
- `capture.tsx` runs the real pane against a staged project and saves what it
  printed into `frames/`. `v3.mjs` turns those frames into Version 3.
- `samples/` holds the source files the hand-drawn boards quote, as they were
  when the boards were drawn.

## Rebuild

```sh
FORCE_COLOR=3 npx tsx design/capture.tsx   # only after the UI changes
node design/build.mjs                      # add --text to print the layouts
```

Version 3 is the one to keep honest: when the UI changes, run both lines and
publish the `V3-*` boards again.
