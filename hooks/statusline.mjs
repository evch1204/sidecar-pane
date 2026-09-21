#!/usr/bin/env node
// Claude Code hands its status line script the only copy of the plan limits:
// how much of the 5 hour and weekly allowance is used, and when each resets.
// This script keeps that for the pane, then prints a one-line status.
//
// It is NOT installed for you. `npm run connect` makes it the statusLine
// command in ~/.claude/settings.json, and `npm run disconnect` puts back what
// was there. Neither touches your hooks.
//
// There is only one statusLine slot, so if something already owned it, connect
// writes that whole statusLine object to ~/.sidecar/statusline-chain.json:
//
//   {"command": "…the old command…", "previous": {…the old statusLine…}}
//
// This script then runs it the way Claude Code would — through Git Bash on
// Windows, /bin/sh elsewhere, with the environment untouched — hands it the same
// stdin and prints exactly what it prints, nothing included. So the pane gets
// the limits and the status line looks exactly as it did before.
//
// No dependencies. Never fails: a status line that throws shows nothing.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const home = () => process.env.SIDECAR_HOME || path.join(os.homedir(), '.sidecar');
const self = fileURLToPath(import.meta.url).replace(/\\/g, '/');

// Keep the reading the pane lives on. Silent on failure: the pane just says
// the feed is missing.
function keep(data) {
  try {
    // Nothing worth keeping: leave the last good reading alone.
    if (!data.rate_limits && !data.context_window) return;
    const dir = home();
    fs.mkdirSync(dir, {recursive: true});
    const saved = {at: Date.now(), model: data.model, rate_limits: data.rate_limits, context_window: data.context_window};
    const file = path.join(dir, 'usage.json');
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(saved));
    fs.renameSync(`${file}.tmp`, file);
  } catch {
    // Not our line to print an error on.
  }
}

// Our own line, used when nothing is chained.
function ownLine(data) {
  const parts = [data.model?.display_name];
  const five = data.rate_limits?.five_hour?.used_percentage;
  const week = data.rate_limits?.seven_day?.used_percentage;
  const context = data.context_window?.used_percentage;
  if (Number.isFinite(five)) parts.push(`5h ${Math.round(five)}%`);
  if (Number.isFinite(week)) parts.push(`wk ${Math.round(week)}%`);
  if (Number.isFinite(context)) parts.push(`ctx ${Math.round(context)}%`);
  return parts.filter(Boolean).join('  ');
}

// The command that owned the slot before us, if it was written down.
function chained() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(home(), 'statusline-chain.json'), 'utf8'));
    const command = typeof raw?.command === 'string' ? raw.command.trim() : '';
    if (!command) return '';
    // A chain to this very script would loop for ever. Only this script,
    // though: other tools have files with names as close as
    // claude-statusline.cmd, and those are exactly what we are here to run.
    const fold = text => (process.platform === 'win32' ? text.toLowerCase() : text);
    return fold(command.replace(/\\/g, '/')).includes(fold(self)) ? '' : command;
  } catch {
    return '';
  }
}

// Where Git Bash might be. Claude Code runs status line commands through it on
// Windows, which is why a saved command can be POSIX sh text.
function gitBash() {
  const named = process.env.CLAUDE_CODE_GIT_BASH_PATH;
  const tried = [];
  if (named) tried.push(named);
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    // System32\bash.exe is the WSL launcher, where a C:/ path means nothing.
    if (/[\\/]sys(tem32|wow64)[\\/]?$/i.test(dir)) continue;
    tried.push(path.join(dir, 'bash.exe'));
  }

  for (const root of [process.env.ProgramFiles, process.env.ProgramW6432, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]) {
    if (root) tried.push(path.join(root, 'Git', 'bin', 'bash.exe'));
  }

  for (const file of tried) {
    try {
      if (fs.statSync(file).isFile()) return file;
    } catch {
      // Not there. Try the next one.
    }
  }

  return '';
}

// Run the saved command the way Claude Code would: it is shell text, not an
// argv, so a shell has to read it.
function shellFor(command) {
  if (process.platform !== 'win32') return {file: '/bin/sh', args: ['-c', command], options: {}};
  const bash = gitBash();
  if (bash) return {file: bash, args: ['-c', command], options: {}};
  // No bash anywhere: let the system shell try. A POSIX one-liner will fail
  // here, and a failure is what puts our own line back.
  return {file: command, args: [], options: {shell: true}};
}

// Hand the same stdin to that command and print what it prints instead.
function relay(command, input, fallback) {
  const {file, args, options} = shellFor(command);
  let child;
  try {
    // No `env`: the environment passes through untouched, because the chained
    // script may need variables of its own.
    child = spawn(file, args, {...options, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true});
  } catch {
    return process.stdout.write(fallback());
  }

  let out = '';
  let done = false;
  // `hard` leaves at once: a killed child can hold the loop open.
  const finish = (text, hard) => {
    if (done) return;
    done = true;
    if (text) process.stdout.write(text, () => hard && process.exit(0));
    else if (hard) process.exit(0);
  };

  const timer = setTimeout(() => {
    try {
      child.kill();
    } catch {
      // Already gone.
    }

    finish(out || fallback(), true);
  }, 3000);
  timer.unref?.();

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => (out += chunk));
  child.on('error', () => {
    clearTimeout(timer);
    finish(fallback());
  });
  child.on('close', code => {
    clearTimeout(timer);
    // A chain that exits 0 and prints nothing meant to print nothing: some
    // tools only forward the payload to their own app. Saying something of our
    // own would put a status line where the user has none.
    finish(code === 0 ? out : out || fallback());
  });
  try {
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  } catch {
    // It will print whatever it can without the input.
  }
}

let input = '';
process.exitCode = 0;
process.stdin.setEncoding('utf8');
process.stdin.on('error', () => {});
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  let data = {};
  try {
    data = JSON.parse(input);
  } catch {
    // Print nothing useful rather than crash.
  }

  keep(data);
  const fallback = () => ownLine(data);
  const command = chained();
  if (command) relay(command, input, fallback);
  else process.stdout.write(fallback());
});

// Whatever happens, a status line exits 0 and says nothing of its own.
process.on('uncaughtException', () => process.exit(0));
process.on('unhandledRejection', () => process.exit(0));
