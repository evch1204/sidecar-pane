#!/usr/bin/env node
// Connect, or disconnect, the two things sidecar asks of Claude Code.
//
//   npm run connect      point Claude Code's status line at hooks/statusline.mjs
//                        and add hooks/attention.mjs to its permission prompts
//   npm run disconnect   put both back exactly as they were
//   node scripts/connect.mjs status
//
// Claude Code hands the "% of the 5 hour and weekly limit used" numbers to
// exactly one thing: the single `statusLine` command in ~/.claude/settings.json.
// So the pane can only show real percentages if our script is that command.
// There is one slot, so if something already owns it we write that whole
// `statusLine` object down in <SIDECAR_HOME>/statusline-chain.json first and our
// script runs it with the same input and prints its output. Both keep working.
//
// The permission prompt is the other half. Nothing records it — answer it and
// it is gone — so `hooks/attention.mjs` is added to `hooks.PermissionRequest`,
// beside whatever is already there. Hooks are a list, not a slot, so nothing
// has to be chained and nothing of yours is touched: connect adds our one
// entry, disconnect takes only that one back out.
//
// Nothing here is installed for you: one command does it, one undoes it, and a
// timestamped copy of settings.json is written before any change.
//
// No dependencies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Where Claude Code keeps settings.json. CLAUDE_CONFIG_DIR is its own variable,
// so honouring it here points us at the same file it reads.
const configDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const settingsFile = () => path.join(configDir(), 'settings.json');
const sidecarHome = () => process.env.SIDECAR_HOME || path.join(os.homedir(), '.sidecar');
const chainFile = () => path.join(sidecarHome(), 'statusline-chain.json');
const usageFile = () => path.join(sidecarHome(), 'usage.json');

// Forward slashes, always quoted: this repo can live under a path with spaces,
// and on Windows Claude Code runs the status line through Git Bash, where a
// backslash is an escape.
const slashes = text => text.replace(/\\/g, '/');
const script = name => slashes(path.resolve(fileURLToPath(import.meta.url), '..', '..', 'hooks', name));
const hookFile = () => script('statusline.mjs');
const ourCommand = () => `node "${hookFile()}"`;
const attentionCommand = () => `node "${script('attention.mjs')}"`;
const fold = text => (process.platform === 'win32' ? text.toLowerCase() : text);

// Ours is whatever runs our own script, however it was spelled.
function isOurs(line) {
  const command = typeof line?.command === 'string' ? slashes(line.command) : '';
  return command !== '' && fold(command).includes(fold(hookFile()));
}

// The PermissionRequest entry we add, and how ours is told from anyone else's.
// By name, not by path: a copy connected from another checkout of this repo is
// still ours, and leaving it behind would write the note twice.
const OURS = 'attention.mjs';
const attentionEntry = () => ({
  matcher: '*',
  hooks: [{type: 'command', command: attentionCommand(), async: true, timeout: 5}],
});

const isAttention = entry =>
  Array.isArray(entry?.hooks) &&
  entry.hooks.some(one => typeof one?.command === 'string' && slashes(one.command).includes(OURS));

const permissionHooks = data => data?.hooks?.PermissionRequest;
const hasAttention = data => (Array.isArray(permissionHooks(data)) ? permissionHooks(data).some(isAttention) : false);

// Never overwrite what is already there. If `hooks` is not the shape Claude
// Code documents, stop and say so rather than guess at what was meant.
function hookTrouble(data) {
  const hooks = data.hooks;
  if (hooks !== undefined && (!hooks || typeof hooks !== 'object' || Array.isArray(hooks))) return 'hooks is not an object';
  const list = permissionHooks(data);
  if (list !== undefined && !Array.isArray(list)) return 'hooks.PermissionRequest is not an array';
  return '';
}

// Added at the end of the list, so whatever ran first still runs first.
function addAttention(data) {
  data.hooks ??= {};
  data.hooks.PermissionRequest ??= [];
  data.hooks.PermissionRequest.push(attentionEntry());
}

// Only ours comes out, and only the empty shells we would have left behind.
function removeAttention(data) {
  const list = permissionHooks(data);
  if (!Array.isArray(list)) return;
  const kept = list.filter(entry => !isAttention(entry));
  if (kept.length) data.hooks.PermissionRequest = kept;
  else delete data.hooks.PermissionRequest;
  if (Object.keys(data.hooks).length === 0) delete data.hooks;
}

// A short name for whoever owns the slot now, for a message.
function ownerOf(line) {
  const command = typeof line?.command === 'string' ? line.command.trim() : '';
  if (!command) return 'something with no command';
  const known = /([\w.-]+)\.(cmd|bat|exe|sh|mjs|cjs|js|ps1|py)/i.exec(command);
  return known ? known[0] : `${command.slice(0, 48)}${command.length > 48 ? '…' : ''}`;
}

const say = text => process.stdout.write(`${text}\n`);

// Refuse loudly and change nothing.
function refuse(text) {
  say(text);
  process.exitCode = 1;
}

// settings.json as text, so its own line endings and last newline survive a
// write. Missing is not an error: connect may be the thing that creates it.
function readSettings() {
  const file = settingsFile();
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return {file, missing: true, data: {}, crlf: false, newline: true};
  }

  let data;
  try {
    data = JSON.parse(raw.replace(/^﻿/, ''));
  } catch (error) {
    return {file, broken: String(error.message)};
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) return {file, broken: 'it is not a JSON object'};
  return {file, data, crlf: raw.includes('\r\n'), newline: raw.endsWith('\n'), bom: raw.startsWith('﻿')};
}

// A timestamped copy beside it, before anything is written anywhere.
function backupSettings(state) {
  if (state.missing) return '';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${state.file}.sidecar-backup-${stamp}`;
  fs.copyFileSync(state.file, backup);
  return backup;
}

// Written back in the shape the file already had: 2 space JSON, its own line
// endings, its own last newline.
function writeSettings(state) {
  let text = JSON.stringify(state.data, null, 2);
  if (state.newline) text += '\n';
  if (state.crlf) text = text.replace(/\n/g, '\r\n');
  if (state.bom) text = `﻿${text}`;
  fs.mkdirSync(path.dirname(state.file), {recursive: true});
  fs.writeFileSync(state.file, text);
}

function readChain() {
  try {
    const raw = JSON.parse(fs.readFileSync(chainFile(), 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    return raw;
  } catch {
    return null;
  }
}

function writeChain(line) {
  fs.mkdirSync(sidecarHome(), {recursive: true});
  const chain = {command: typeof line?.command === 'string' ? line.command : '', previous: line};
  fs.writeFileSync(chainFile(), `${JSON.stringify(chain, null, 2)}\n`);
}

// The statusLine object the chain file remembers, if it remembers one.
function previousOf(chain) {
  if (chain?.previous && typeof chain.previous === 'object') return chain.previous;
  // A chain file written by hand, before connect existed: just a command.
  if (typeof chain?.command === 'string' && chain.command.trim()) return {type: 'command', command: chain.command};
  return null;
}

function ago(at) {
  const ms = Date.now() - at;
  if (ms < 0) return 'just now';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'less than a minute ago';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function connect() {
  const state = readSettings();
  if (state.broken) {
    refuse(`I did not change anything.\n\n${slashes(state.file)} is not valid JSON: ${state.broken}.\nFix the file and run npm run connect again.`);
    return;
  }

  const trouble = hookTrouble(state.data);
  if (trouble) {
    refuse(`I did not change anything.\n\nIn ${slashes(state.file)}, ${trouble}.\nFix it and run npm run connect again.`);
    return;
  }

  const had = state.data.statusLine;
  const feedDone = isOurs(had);
  const hookDone = hasAttention(state.data);
  const chain = readChain();
  const previous = previousOf(chain);

  if (feedDone && hookDone) {
    if (previous && !chain?.previous) {
      // An old, hand-written chain file: keep it, in the shape we now read.
      writeChain(previous);
      say(`Already connected. I tidied up ${slashes(chainFile())} so the old status line is remembered in full.`);
      return;
    }

    say('Already connected. Nothing to change.');
    if (previous) say(`Your previous status line (${ownerOf(previous)}) still runs, from ${slashes(chainFile())}.`);
    else say('Nothing is chained, so sidecar prints its own short line.');
    say('\nTo undo: npm run disconnect');
    return;
  }

  const chained = !feedDone && had && typeof had === 'object';
  const backup = backupSettings(state);
  if (chained) writeChain(had);
  if (!feedDone) state.data.statusLine = {type: 'command', command: ourCommand()};
  if (!hookDone) addAttention(state.data);
  writeSettings(state);

  say(feedDone
    ? 'Connected the permission prompts. The status line was already sidecar.\n'
    : 'Connected. The pane will show real percentages after Claude Code\'s next reply.\n');
  say(`  settings.json  ${slashes(state.file)}`);
  if (!feedDone) say(`  statusLine     ${ourCommand()}`);
  if (!hookDone) say(`  hook           PermissionRequest  ${attentionCommand()}`);
  if (backup) say(`  backup         ${slashes(path.basename(backup))} (beside it)`);
  else say('  backup         none needed, the file did not exist yet');
  if (chained) {
    say(`  chained        ${ownerOf(had)}, saved in full to ${slashes(chainFile())}`);
    say('\nYour old status line still runs and still prints exactly what it printed before.');
    say('Sidecar only reads the numbers on the way past.');
  } else if (!feedDone) {
    say('\nNothing was there before, so sidecar prints a short line of its own.');
  }

  if (!hookDone) say('\nThe hook is added beside your other permission hooks, not over them. It prints\nnothing, so it never answers a prompt: it only writes down that one was asked.');
  say('\nTo undo: npm run disconnect');
}

function disconnect() {
  const state = readSettings();
  if (state.broken) {
    refuse(`I did not change anything.\n\n${slashes(state.file)} is not valid JSON: ${state.broken}.\nFix the file and run npm run disconnect again.`);
    return;
  }

  const had = state.data.statusLine;
  const feedMine = isOurs(had);
  const hookMine = hasAttention(state.data);

  if (!feedMine && !hookMine) {
    if (!had) say('Not connected: there is no status line set, and no hook of ours. Nothing to change.');
    else {
      say(`Not connected: the status line belongs to ${ownerOf(had)} now, not sidecar, and there is no hook of ours. I did not change anything.`);
      say('Something may have rewritten it after you ran npm run connect.');
    }

    return;
  }

  const previous = feedMine ? previousOf(readChain()) : null;
  const backup = backupSettings(state);
  if (feedMine) {
    if (previous) state.data.statusLine = previous;
    else delete state.data.statusLine;
  }

  if (hookMine) removeAttention(state.data);
  writeSettings(state);

  let removed = false;
  if (feedMine) {
    try {
      fs.rmSync(chainFile());
      removed = true;
    } catch {
      // It was never written, or is already gone.
    }
  }

  say('Disconnected. The pane will say the feed is quiet from now on.\n');
  say(`  settings.json  ${slashes(state.file)}`);
  if (!feedMine) say(`  statusLine     left alone: it belongs to ${ownerOf(had) || 'nobody'} now, not sidecar`);
  else if (previous) say(`  statusLine     put back to ${ownerOf(previous)}`);
  else say('  statusLine     removed, as there was none before');
  if (hookMine) say('  hook           removed from PermissionRequest; your other hooks are untouched');
  if (removed) say(`  chain file     deleted: ${slashes(chainFile())}`);
  if (backup) say(`  backup         ${slashes(path.basename(backup))} (beside it)`);
  say(`\n${slashes(usageFile())} is left alone, so the last numbers are still there.`);
  say('To turn it back on: npm run connect');
}

function status() {
  const state = readSettings();
  say(`settings.json  ${slashes(state.file)}`);
  if (state.broken) {
    say(`  not valid JSON: ${state.broken}`);
  } else if (state.missing) {
    say('  does not exist yet');
  } else if (isOurs(state.data.statusLine)) {
    say('  feed connected: the status line is sidecar');
  } else if (state.data.statusLine) {
    say(`  feed not connected: the status line belongs to ${ownerOf(state.data.statusLine)}`);
  } else {
    say('  feed not connected: no status line is set');
  }

  if (!state.broken) {
    const trouble = hookTrouble(state.data);
    const others = Array.isArray(permissionHooks(state.data)) ? permissionHooks(state.data).filter(entry => !isAttention(entry)).length : 0;
    if (trouble) say(`  hook not read: ${trouble}`);
    else if (hasAttention(state.data)) say(`  hook connected: PermissionRequest${others ? `, beside ${others} other${others === 1 ? '' : 's'}` : ''}`);
    else say('  hook not connected: the pane cannot see a permission prompt');
  }

  const previous = previousOf(readChain());
  say(`\nchain file     ${slashes(chainFile())}`);
  if (previous) say(`  chained: ${ownerOf(previous)} runs first, and its output is the status line`);
  else say('  nothing chained');

  say(`\nusage.json     ${slashes(usageFile())}`);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(usageFile(), 'utf8'));
  } catch {
    say('  not written yet: the pane has no real percentages');
    return;
  }

  const at = Number(raw?.at) || 0;
  say(at ? `  last written ${ago(at)}` : '  written, but with no timestamp');
  say(raw?.rate_limits ? '  it has the 5 hour and weekly limits' : '  no limits in it: an API key, or no reply yet this session');
}

const what = (process.argv[2] || 'status').toLowerCase();
try {
  if (what === 'connect') connect();
  else if (what === 'disconnect') disconnect();
  else if (what === 'status') status();
  else refuse(`I do not know "${what}". Try: connect, disconnect or status.`);
} catch (error) {
  refuse(`Something went wrong and I stopped: ${error?.message || error}\nsettings.json is either untouched or restorable from the newest .sidecar-backup- copy beside it.`);
}
