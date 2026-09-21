#!/usr/bin/env node
// Claude Code hands its status line script the only copy of the plan limits:
// how much of the 5 hour and weekly allowance is used, and when each resets.
// This script keeps that for the pane, then prints a one-line status.
//
// It is NOT installed for you. To turn it on, add this to ~/.claude/settings.json
// (beside your hooks, which it does not touch):
//
//   "statusLine": {"type": "command", "command": "node /path/to/sidecar-pane/hooks/statusline.mjs"}
//
// There is only one statusLine slot, so if something else already owns it, name
// that command in ~/.sidecar/statusline-chain.json and both keep working:
//
//   {"command": "node C:/path/to/other-statusline.mjs"}
//
// The same stdin goes to it and its output is printed as the status line, so
// the pane gets the limits and the bar looks exactly as it did before.
//
// No dependencies. Never fails: a status line that throws shows nothing.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = () => process.env.SIDECAR_HOME || path.join(os.homedir(), '.sidecar');

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
    // A chain to this very script would loop for ever.
    return command && !command.includes('statusline.mjs') ? command : '';
  } catch {
    return '';
  }
}

// Hand the same stdin to that command and print what it prints instead.
function relay(command, input, fallback) {
  let child;
  try {
    child = spawn(command, {shell: true, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true});
  } catch {
    return fallback();
  }

  let out = '';
  let done = false;
  const finish = text => {
    if (done) return;
    done = true;
    process.stdout.write(text);
  };

  const timer = setTimeout(() => {
    try {
      child.kill();
    } catch {
      // Already gone.
    }

    finish(out || fallback());
  }, 3000);
  timer.unref?.();

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => (out += chunk));
  child.on('error', () => {
    clearTimeout(timer);
    finish(fallback());
  });
  child.on('close', () => {
    clearTimeout(timer);
    // A chain that printed nothing is a chain that failed.
    finish(out || fallback());
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
