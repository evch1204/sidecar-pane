import fs from 'node:fs';

export type FileView =
  | {kind: 'text'; lines: string[]}
  | {kind: 'notice'; message: string};

const MAX_BYTES = 300_000;

// Read a file for preview. Never throws: anything unreadable becomes a notice.
export function readFileView(filePath: string): FileView {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return {kind: 'notice', message: 'This file no longer exists.'};
  }

  if (stat.size > MAX_BYTES) {
    return {kind: 'notice', message: `Too large to preview (${Math.round(stat.size / 1024)} KB).`};
  }

  let buffer: Buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch {
    return {kind: 'notice', message: 'Could not read this file.'};
  }

  // A zero byte in the first chunk is the usual sign of a binary file.
  if (buffer.subarray(0, 8000).includes(0)) {
    return {kind: 'notice', message: 'Binary file. Nothing to preview.'};
  }

  const lines = buffer.toString('utf8').replace(/\r\n/g, '\n').replace(/\t/g, '  ').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return {kind: 'text', lines};
}
