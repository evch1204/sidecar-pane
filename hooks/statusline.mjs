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
// No dependencies. Never fails: a status line that throws shows nothing.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  let data = {};
  try {
    data = JSON.parse(input);
  } catch {
    // Print nothing useful rather than crash.
  }

  try {
    // Nothing worth keeping: leave the last good reading alone.
    if (!data.rate_limits && !data.context_window) throw new Error('empty');
    const home = process.env.SIDECAR_HOME || path.join(os.homedir(), '.sidecar');
    fs.mkdirSync(home, {recursive: true});
    const keep = {at: Date.now(), model: data.model, rate_limits: data.rate_limits, context_window: data.context_window};
    const file = path.join(home, 'usage.json');
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(keep));
    fs.renameSync(`${file}.tmp`, file);
  } catch {
    // The pane just says the feed is missing.
  }

  const parts = [data.model?.display_name];
  const five = data.rate_limits?.five_hour?.used_percentage;
  const week = data.rate_limits?.seven_day?.used_percentage;
  const context = data.context_window?.used_percentage;
  if (Number.isFinite(five)) parts.push(`5h ${Math.round(five)}%`);
  if (Number.isFinite(week)) parts.push(`wk ${Math.round(week)}%`);
  if (Number.isFinite(context)) parts.push(`ctx ${Math.round(context)}%`);
  process.stdout.write(parts.filter(Boolean).join('  '));
});
