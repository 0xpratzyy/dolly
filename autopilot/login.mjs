#!/usr/bin/env node
// Save a signed-in session for Dolly, made by YOU. Opens a normal Chromium window on <url>; you log in by hand (type your own
// password, pass 2FA, whatever the site needs), then close the window or press Enter here. Playwright writes the session to a local
// file (default autopilot/.auth/state.json, mode 600, git-ignored). Dolly never types a password and never reads your browser's
// own cookie store: this file only contains what THIS window received.
//
//   node autopilot/login.mjs <url> [--out autopilot/.auth/state.json]
//   node autopilot/narrate.mjs --voice memo.m4a --url <url> --storage autopilot/.auth/state.json
// The file is a login for that product: keep it private, delete it when you are done.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith('--'));
const oi = argv.indexOf('--out');
const out = path.resolve(oi >= 0 ? argv[oi + 1] : path.join(here, '.auth/state.json'));
const autoClose = argv.indexOf('--auto-close-ms'); // for tests only
if (!url) { console.error('usage: node autopilot/login.mjs <url> [--out file.json]'); process.exit(1); }
fs.mkdirSync(path.dirname(out), {recursive: true});

const browser = await chromium.launch({headless: false, args: ['--window-size=1280,860']});
const ctx = await browser.newContext({viewport: null});
const page = await ctx.newPage();
await page.goto(url, {waitUntil: 'domcontentloaded'}).catch((e) => console.error('could not open the page:', e.message));
console.log(`A window is open on ${url}.\nLog in there yourself. When you are signed in, close that window (or press Enter here).`);

let done = false;
const finish = async () => {
  if (done) return;
  done = true;
  try {
    await ctx.storageState({path: out});
    fs.chmodSync(out, 0o600);
    console.log(`saved ${out} (private, git-ignored). Use it with:  --storage ${out}`);
  } catch (e) { console.error('could not save the session:', e.message); process.exitCode = 1; }
  await browser.close().catch(() => {});
  process.exit(process.exitCode ?? 0);
};
page.on('close', () => setTimeout(() => finish(), 200));
browser.on('disconnected', () => { if (!done) { console.error('the window closed before the session could be saved; run it again'); process.exit(1); } });
const rl = readline.createInterface({input: process.stdin});
rl.on('line', finish);
if (autoClose >= 0) setTimeout(finish, Number(argv[autoClose + 1]));
