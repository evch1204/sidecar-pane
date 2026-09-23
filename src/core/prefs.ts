import fs from 'node:fs';
import path from 'node:path';
import {storeDir} from './worktrees';

// What the pane remembers about how you like it, per project, beside
// everything else it remembers about that project. Only what you chose is
// written: a width the pane picked for itself is worked out again next time.

// Absent means nobody chose, and the pane decides by its width.
export type Prefs = {panel?: 'open' | 'folded'};

const file = (root: string): string => path.join(storeDir(root), 'ui.json');

// A missing or broken file is the same as a fresh project: nothing chosen yet.
export function readPrefs(root: string): Prefs {
  try {
    const raw = JSON.parse(fs.readFileSync(file(root), 'utf8')) as unknown;
    const panel = (raw as Prefs | null)?.panel;
    return panel === 'open' || panel === 'folded' ? {panel} : {};
  } catch {
    return {};
  }
}

// Written through a temporary file, so a pane that dies mid-write leaves the
// last good copy. Failing to write only costs the choice next time.
export function writePrefs(root: string, prefs: Prefs): void {
  try {
    const dir = storeDir(root);
    fs.mkdirSync(dir, {recursive: true});
    const to = file(root);
    const temp = `${to}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(prefs));
    fs.renameSync(temp, to);
  } catch {
    // Nothing here is worth an error in a viewer.
  }
}

// `SIDECAR_PANEL` wins over the file. Scripts set it to `off`, so a check
// written against the old layout still sees the old layout.
export function panelEnv(): 'off' | 'open' | 'folded' | undefined {
  const value = process.env.SIDECAR_PANEL;
  return value === 'off' || value === 'open' || value === 'folded' ? value : undefined;
}
