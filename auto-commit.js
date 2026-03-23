#!/usr/bin/env node
/**
 * auto-commit.js
 * Watches the project for file changes and automatically commits + pushes to GitHub.
 *
 * Usage:
 *   node auto-commit.js
 *
 * Stop with Ctrl+C.
 */

const { execSync, exec } = require('child_process');
const fs   = require('fs');
const path = require('path');

// ─── Config ──────────────────────────────────────────────────────
const DEBOUNCE_MS   = 3000;   // wait 3s after last change before committing
const WATCH_DIRS    = ['css', 'js'];
const WATCH_FILES   = ['index.html', 'manifest.json', 'sw.js', 'README.md'];
const IGNORE_NAMES  = new Set(['.git', 'node_modules', 'auto-commit.js', '.gitignore']);
// ─────────────────────────────────────────────────────────────────

const ROOT = __dirname;
let debounceTimer = null;
let pendingChanges = new Set();

function timestamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function log(msg) {
  console.log(`[${timestamp()}] ${msg}`);
}

function hasChanges() {
  try {
    const out = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf8' });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

function commitAndPush() {
  if (!hasChanges()) {
    pendingChanges.clear();
    return;
  }

  const changedFiles = [...pendingChanges].slice(0, 5).join(', ');
  const extra        = pendingChanges.size > 5 ? ` (+${pendingChanges.size - 5} more)` : '';
  const message      = `auto: update ${changedFiles}${extra} [${new Date().toISOString().slice(0,16).replace('T',' ')}]`;

  try {
    execSync('git add -A', { cwd: ROOT });
    execSync(`git commit -m "${message.replace(/"/g, "'")}"`, { cwd: ROOT });
    log(`Committed: ${message}`);
  } catch (err) {
    log(`Commit failed: ${err.message.split('\n')[0]}`);
    pendingChanges.clear();
    return;
  }

  exec('git push', { cwd: ROOT }, (err, stdout, stderr) => {
    if (err) {
      log(`Push failed: ${stderr.trim().split('\n')[0]}`);
    } else {
      log('Pushed to GitHub.');
    }
  });

  pendingChanges.clear();
}

function onChange(filename) {
  if (!filename || IGNORE_NAMES.has(filename)) return;
  pendingChanges.add(filename);
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(commitAndPush, DEBOUNCE_MS);
  log(`Change detected: ${filename} — committing in ${DEBOUNCE_MS / 1000}s…`);
}

// Watch directories recursively
WATCH_DIRS.forEach(dir => {
  const fullPath = path.join(ROOT, dir);
  if (!fs.existsSync(fullPath)) return;
  fs.watch(fullPath, { recursive: true }, (_, filename) => onChange(filename || dir));
  log(`Watching: ${dir}/`);
});

// Watch root-level files
WATCH_FILES.forEach(file => {
  const fullPath = path.join(ROOT, file);
  if (!fs.existsSync(fullPath)) return;
  fs.watch(fullPath, (_, filename) => onChange(filename || file));
  log(`Watching: ${file}`);
});

log('Auto-commit started. Edit files and saves will commit + push automatically.');
log('Press Ctrl+C to stop.\n');
