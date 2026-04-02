'use strict';
/* ═══════════════════════════════════════════════════════════════
   utils.js — Pure utilities: DOM helpers, date math, formatting.
   No side effects. No DOM access. Safe to call from any module.
═══════════════════════════════════════════════════════════════ */

// ─── String / DOM Safety ─────────────────────────────────────────
function escapeHTML(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── ID Generation ───────────────────────────────────────────────
function genId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ─── Date Primitives ─────────────────────────────────────────────

// Serialize a Date to 'YYYY-MM-DD' in local time
function _toIsoDate(d) {
  const y  = d.getFullYear();
  const m  = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// Today as 'YYYY-MM-DD' in local time
function todayISO() { return _toIsoDate(new Date()); }

// Now as ISO datetime string
function nowISO() { return new Date().toISOString(); }

// Parse 'YYYY-MM-DD' as local midnight (avoids UTC-offset bugs)
function parseLocalDate(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const parts = iso.split('-').map(Number);
  if (parts.length < 3 || parts.some(isNaN)) return null;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return isNaN(d.getTime()) ? null : d;
}

// Parse a deadline's due date+time as a local Date.
// If no time provided, treats 23:59:59 as the deadline moment.
function parseDueDateTime(dateISO, timeHHMM) {
  if (!dateISO) return null;
  const parts = dateISO.split('-').map(Number);
  if (parts.length < 3 || parts.some(isNaN)) return null;
  if (timeHHMM && /^\d{2}:\d{2}$/.test(timeHHMM)) {
    const [h, m] = timeHHMM.split(':').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2], h, m, 0, 0);
  }
  return new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999);
}

// Add n calendar days to an ISO date string
function addDays(isoDateStr, n) {
  const d = parseLocalDate(isoDateStr);
  if (!d) return isoDateStr;
  d.setDate(d.getDate() + n);
  return _toIsoDate(d);
}

// Subtract n calendar days from an ISO date string
function subtractDays(isoDateStr, n) { return addDays(isoDateStr, -n); }

// ─── Countdown / Diff Calculations ───────────────────────────────

// Milliseconds until deadline (positive = future, negative = past/overdue)
function msUntilDeadline(deadline) {
  const due = parseDueDateTime(deadline.dueDate, deadline.dueTime);
  if (!due) return 0;
  return due.getTime() - Date.now();
}

// Calendar days from today to dueDate (positive = future, negative = overdue)
// Uses local midnight-to-midnight comparison so no time-of-day ambiguity
function daysFromToday(dueDateISO) {
  if (!dueDateISO) return 0;
  const due   = parseLocalDate(dueDateISO);
  const today = parseLocalDate(todayISO());
  if (!due || !today) return 0;
  return Math.round((due.getTime() - today.getTime()) / 86400000);
}

// Count Mon–Fri workdays strictly after today up to and including dueDate
// Returns 0 if dueDate is today or in the past
function workdaysFromToday(dueDateISO) {
  if (!dueDateISO) return 0;
  const today = parseLocalDate(todayISO());
  const due   = parseLocalDate(dueDateISO);
  if (!due || !today || due <= today) return 0;
  let count = 0;
  const cur  = new Date(today);
  cur.setDate(cur.getDate() + 1);
  while (cur <= due) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// ─── Formatting ──────────────────────────────────────────────────

// Format a countdown duration from milliseconds
function formatCountdown(ms) {
  const abs      = Math.abs(ms);
  const totalSec = Math.floor(abs / 1000);
  const days     = Math.floor(totalSec / 86400);
  const hours    = Math.floor((totalSec % 86400) / 3600);
  const mins     = Math.floor((totalSec % 3600) / 60);
  const secs     = totalSec % 60;
  if (days > 0)  return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
  if (mins > 0)  return `${mins}m ${secs}s`;
  return `${secs}s`;
}

// Human-relative label for a deadline (e.g. "In 3 days", "2 days overdue")
function formatRelativeDeadline(daysLeft) {
  if (daysLeft > 0) {
    if (daysLeft === 1) return 'Tomorrow';
    if (daysLeft <= 7)  return `In ${daysLeft} days`;
    if (daysLeft <= 14) return 'Next week';
    if (daysLeft <= 30) return 'This month';
    return `In ${daysLeft} days`;
  }
  if (daysLeft === 0) return 'Due today';
  const abs = Math.abs(daysLeft);
  if (abs === 1) return '1 day overdue';
  return `${abs} days overdue`;
}

// 'Jan 15, 2025'
function formatDate(iso) {
  const d = parseLocalDate(iso);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// 'Jan 15'
function formatDateShort(iso) {
  const d = parseLocalDate(iso);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// 'Monday, Jan 15'
function formatDateFull(iso) {
  const d = parseLocalDate(iso);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

// '2:30 PM'
function formatTime(timeHHMM) {
  if (!timeHHMM || !/^\d{2}:\d{2}$/.test(timeHHMM)) return '';
  const [h, m] = timeHHMM.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour   = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

// '2.5h' → '2h 30m',  '0.75h' → '45m'
function formatHours(h) {
  if (h == null || isNaN(h) || h < 0) return '—';
  if (h === 0) return '0h';
  const hours = Math.floor(h);
  const mins  = Math.round((h - hours) * 60);
  if (hours === 0) return `${mins}m`;
  if (mins === 0)  return `${hours}h`;
  return `${hours}h ${mins}m`;
}

// Round a number to at most `decimals` places
function round(n, decimals = 1) {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

// Clamp a value
function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

// ─── Debounce ────────────────────────────────────────────────────
function debounce(fn, ms) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

// ─── File Download ───────────────────────────────────────────────
function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// CSV-safe field wrapping
function csvField(v) {
  const s = String(v == null ? '' : v).replace(/"/g, '""');
  return `"${s}"`;
}

// ─── Calendar Helpers ────────────────────────────────────────────
const MONTH_NAMES  = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];
const MONTH_SHORT  = ['Jan','Feb','Mar','Apr','May','Jun',
                      'Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_ABBR     = ['Su','Mo','Tu','We','Th','Fr','Sa'];

function getDaysInMonth(year, month) { // month 0-indexed
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year, month) { // 0 = Sunday
  return new Date(year, month, 1).getDay();
}

// ─── Misc ────────────────────────────────────────────────────────
function safeNum(v, fallback = 0) {
  const n = Number(v);
  return isFinite(n) ? n : fallback;
}

function safePercent(progress) {
  return clamp(Math.round(safeNum(progress)), 0, 100);
}

// Truncate a string to maxLen characters with ellipsis
function truncate(s, maxLen = 60) {
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}

// ─── URL Safety ─────────────────────────────────────────────────
function isSafeUrl(url) {
  try {
    const u = new URL(url, window.location.origin);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

// ─── Color Validation ───────────────────────────────────────────
function isValidColor(c) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
}
function safeColor(c, fallback) {
  return isValidColor(c) ? c : (fallback || '#888888');
}
