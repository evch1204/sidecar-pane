import fs from 'node:fs';
import path from 'node:path';

export type TreeNode = {
  name: string;
  path: string;
  isDir: boolean;
  depth: number;
};

// Folders that are never worth browsing. Day 5 replaces this with .gitignore rules.
const IGNORE = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
  '.venv',
  '__pycache__',
]);

function listDir(dir: string): Omit<TreeNode, 'depth'>[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, {withFileTypes: true});
  } catch {
    return [];
  }

  return entries
    .filter(entry => !IGNORE.has(entry.name))
    .map(entry => ({
      name: entry.name,
      path: path.join(dir, entry.name),
      isDir: entry.isDirectory(),
    }))
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
}

// The tree as the flat list of rows currently on screen: folders first,
// children only for folders in `expanded`.
export function visibleNodes(root: string, expanded: ReadonlySet<string>): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (dir: string, depth: number) => {
    for (const entry of listDir(dir)) {
      out.push({...entry, depth});
      if (entry.isDir && expanded.has(entry.path)) walk(entry.path, depth + 1);
    }
  };

  walk(root, 0);
  return out;
}
