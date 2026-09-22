#!/usr/bin/env node
// Claude Code is waiting for you to allow a tool call. Nothing about that
// reaches the transcript — the prompt lives in the CLI and is gone when you
// answer — so it is the one thing the pane cannot read for itself. This hook
// writes it down.
//
// It is NOT installed for you. `npm run connect` adds it to the
// PermissionRequest hooks in ~/.claude/settings.json beside whatever is
// already there, and `npm run disconnect` takes only ours back out.
//
// What it writes, to <SIDECAR_HOME or ~/.sidecar>/<slug>/attention.json:
//
//   {at, tool, toolUseId, sessionId, transcriptPath, transcriptSize}
//
// The size is the point. Answering the prompt, either way, appends to the
// transcript, so a file whose recorded size is no longer the real one is a
// prompt you have already dealt with. Nothing here ever deletes the file; the
// pane decides what it still means (src/core/attention.ts).
//
// It prints nothing, on any path: a hook that says nothing has made no
// decision, so the prompt you are looking at is untouched. It has no
// dependencies, runs async with a 5 second timeout, and exits 0 always.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The same slug the pane's own store uses, so both name the folder the same
// way: the absolute path with every separator turned into a dash.
const dirFor = cwd => {
  const slug = path.resolve(cwd).replace(/[\\/:.]/g, '-');
  return path.join(process.env.SIDECAR_HOME || path.join(os.homedir(), '.sidecar'), slug);
};

function note(data) {
  const cwd = typeof data.cwd === 'string' && data.cwd ? data.cwd : process.cwd();
  const transcriptPath = typeof data.transcript_path === 'string' ? data.transcript_path : '';
  let transcriptSize = 0;
  try {
    transcriptSize = fs.statSync(transcriptPath).size;
  } catch {
    // No transcript to measure: the pane then has only the file's presence.
  }

  const dir = dirFor(cwd);
  fs.mkdirSync(dir, {recursive: true});
  const file = path.join(dir, 'attention.json');
  const saved = {
    at: Date.now(),
    tool: typeof data.tool_name === 'string' ? data.tool_name : '',
    toolUseId: typeof data.tool_use_id === 'string' ? data.tool_use_id : '',
    sessionId: typeof data.session_id === 'string' ? data.session_id : '',
    transcriptPath,
    transcriptSize,
  };
  // Written whole or not at all: the pane may read it mid-write. The scratch
  // name carries this process's id, because two Claude Code sessions in one
  // folder can raise a prompt at the same moment and one fixed name would let
  // them write over each other's half-written file.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(saved));
  fs.renameSync(tmp, file);
}

let input = '';
process.exitCode = 0;
process.stdin.setEncoding('utf8');
process.stdin.on('error', () => process.exit(0));
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    if (data && typeof data === 'object') note(data);
  } catch {
    // Bad stdin, or a folder we cannot write: the pane simply says nothing.
  }

  process.exit(0);
});

// Whatever happens, this hook is silent and out of the way.
process.on('uncaughtException', () => process.exit(0));
process.on('unhandledRejection', () => process.exit(0));
