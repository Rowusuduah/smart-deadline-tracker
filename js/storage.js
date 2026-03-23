'use strict';
/* ═══════════════════════════════════════════════════════════════
   storage.js — All localStorage I/O, export/import, and backup.
   Every save triggers queueDriveSync() (defined in app.js).
═══════════════════════════════════════════════════════════════ */

// ─── Keys ────────────────────────────────────────────────────────
const STORAGE_KEYS = {
  DEADLINES:  'sdt_deadlines',
  SETTINGS:   'sdt_settings',
  CATEGORIES: 'sdt_categories',
  GOALS:      'sdt_goals',
  THEME:      'sdt_theme',
};

const BACKUP_KEYS = Object.values(STORAGE_KEYS);

// ─── Default Data ────────────────────────────────────────────────
const DEFAULT_CATEGORIES = [
  { id: 'school',       name: 'School',       color: '#60a5fa', icon: '📚' },
  { id: 'work',         name: 'Work',         color: '#4ade80', icon: '💼' },
  { id: 'personal',     name: 'Personal',     color: '#a78bfa', icon: '👤' },
  { id: 'exams',        name: 'Exams',        color: '#f87171', icon: '📝' },
  { id: 'applications', name: 'Applications', color: '#fb923c', icon: '📋' },
  { id: 'projects',     name: 'Projects',     color: '#2dd4bf', icon: '🔨' },
  { id: 'bills',        name: 'Bills',        color: '#fbbf24', icon: '💳' },
  { id: 'finance',      name: 'Finance',      color: '#34d399', icon: '💰' },
  { id: 'health',       name: 'Health',       color: '#f472b6', icon: '❤️' },
  { id: 'meetings',     name: 'Meetings',     color: '#94a3b8', icon: '📅' },
  { id: 'travel',       name: 'Travel',       color: '#38bdf8', icon: '✈️' },
  { id: 'family',       name: 'Family',       color: '#fb7185', icon: '🏠' },
  { id: 'admin',        name: 'Admin',        color: '#a1a1aa', icon: '🗂️' },
  { id: 'subscriptions',name: 'Subscriptions',color: '#c084fc', icon: '🔄' },
];

const DEFAULT_SETTINGS = {
  theme:                'dark',
  dateFormat:           'MMM DD YYYY',
  workHoursPerDay:      6,
  includeWeekends:      false,
  bufferDays:           1,
  defaultCategory:      'personal',
  defaultPriority:      'medium',
  defaultEstimatedHours: 2,
  colorMode:            'urgency',   // 'urgency' | 'category'
  showCompletedDays:    7,            // show completed items for N days
  notificationsEnabled: false,
  firstDayOfWeek:       0,            // 0=Sunday, 1=Monday
};

// ─── Generic localStorage helpers ────────────────────────────────
function _load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw);
  } catch { return fallback; }
}

function _save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    if (typeof queueDriveSync === 'function') queueDriveSync();
  } catch (e) {
    console.error('[storage] Save failed:', key, e);
  }
}

// ─── Deadlines ───────────────────────────────────────────────────
function loadDeadlines()    { return _load(STORAGE_KEYS.DEADLINES, []); }
function saveDeadlines(arr) { _save(STORAGE_KEYS.DEADLINES, arr); }

// ─── Settings ────────────────────────────────────────────────────
function loadSettings() {
  const stored = _load(STORAGE_KEYS.SETTINGS, {});
  return { ...DEFAULT_SETTINGS, ...stored };
}
function saveSettings(obj) { _save(STORAGE_KEYS.SETTINGS, obj); }

// ─── Categories ──────────────────────────────────────────────────
function loadCategories() {
  const stored = _load(STORAGE_KEYS.CATEGORIES, null);
  if (!stored || !stored.length) return JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
  return stored;
}
function saveCategories(arr) { _save(STORAGE_KEYS.CATEGORIES, arr); }

// ─── Goals ───────────────────────────────────────────────────────
function loadGoals()    { return _load(STORAGE_KEYS.GOALS, []); }
function saveGoals(arr) { _save(STORAGE_KEYS.GOALS, arr); }

// ─── Export / Import ─────────────────────────────────────────────
function exportJSON() {
  const data = {};
  BACKUP_KEYS.forEach(k => {
    const v = localStorage.getItem(k);
    if (v !== null) data[k] = v;
  });
  const payload = JSON.stringify({ _version: 2, _app: 'SmartDeadlineTracker', _exported: new Date().toISOString(), data }, null, 2);
  downloadFile(payload, `DeadlineTracker_Backup_${todayISO()}.json`, 'application/json');
}

function importJSON(file, onSuccess) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed.data || typeof parsed.data !== 'object') throw new Error('Invalid backup format — missing data object.');
      const valid = Object.keys(parsed.data).filter(k => BACKUP_KEYS.includes(k));
      if (!valid.length) throw new Error('No recognisable data found in this file.');
      const exportedDate = parsed._exported ? new Date(parsed._exported).toLocaleString() : 'unknown date';
      if (!confirm(`Restore backup from ${exportedDate}?\n\nThis will replace all current data on this device.`)) return;
      valid.forEach(k => localStorage.setItem(k, parsed.data[k]));
      if (typeof onSuccess === 'function') onSuccess();
    } catch (err) {
      alert('Import failed: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function exportCSV() {
  const deadlines = loadDeadlines();
  if (!deadlines.length) { alert('No deadlines to export.'); return; }
  const headers = ['Title','Category','Status','Priority','Due Date','Due Time',
                   'Estimated Hours','Progress %','Notes','Tags','Created'];
  const rows = deadlines.map(d => [
    csvField(d.title),
    csvField(d.category),
    csvField(d.status),
    csvField(d.priority),
    csvField(d.dueDate),
    csvField(d.dueTime || ''),
    csvField(d.estimatedHours || 0),
    csvField(d.progressPercent || 0),
    csvField(d.notes || ''),
    csvField((d.tags || []).join(', ')),
    csvField(d.createdAt ? d.createdAt.slice(0, 10) : ''),
  ].join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  downloadFile(csv, `DeadlineTracker_Export_${todayISO()}.csv`, 'text/csv');
}

function resetAllData() {
  if (!confirm('This will permanently delete ALL deadlines, settings, and data.\n\nThis cannot be undone. Are you sure?')) return false;
  if (!confirm('Final confirmation: delete everything?')) return false;
  BACKUP_KEYS.forEach(k => localStorage.removeItem(k));
  return true;
}
