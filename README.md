# sidecar-pane

A viewer pane that sits beside the Claude Code CLI. Working name.

Right now it has a file tree and a file preview. Live awareness of what Claude is editing, diffs and formatted markdown are next. See [PLAN.md](PLAN.md).

```
 sidecar  ~/Desktop/Personal Projects/sidecar-pane
 FILES
 ▾ src
   ▸ core
   ▸ ui
     cli.tsx
────────────────────────────────────────────────────
 src/cli.tsx  1-11 of 29
  1  #!/usr/bin/env node
  2  import fs from 'node:fs';
────────────────────────────────────────────────────
 ↑↓ move   → open   ← close   tab preview   q quit
```

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

| Key | Files | Preview |
|---|---|---|
| `↑` `↓` or `k` `j` | move | scroll |
| `→` or `Enter` | open folder, or go to the preview | |
| `←` | close folder, or go to parent | back to files |
| `space` / `b` | | page down / up |
| `g` / `G` | | top / bottom |
| `Tab` | switch side | switch side |
| `q` | quit | quit |

## Layout

- `src/core` reads folders and files. It knows nothing about the screen.
- `src/ui` draws with Ink. It knows nothing about the file system beyond what `core` hands it.
- `scripts/smoke.tsx` drives the app with fake key presses and prints a frame: `npx tsx scripts/smoke.tsx`.
