'use strict';
/* ═══════════════════════════════════════════════════════════════
   app.js — Orchestration: tab system, modal, events, init.
   Depends on: utils, storage, calculations, state, deadlines,
               and all ui-*.js modules.
═══════════════════════════════════════════════════════════════ */

// ─── Global Error Handlers ──────────────────────────────────────────
window.onerror = (msg, src, line, col, err) => {
  console.error('[SDT] Uncaught error:', msg, 'at', src, line, col, err);
};
window.addEventListener('unhandledrejection', e => {
  console.error('[SDT] Unhandled rejection:', e.reason);
});

// ─── Auth ─────────────────────────────────────────────────────────
const AUTH_KEY      = 'sdt_auth';
// SHA-256 of the password — never store the plain password
const PASS_HASH     = 'c62ededa6c50ed85cb4308545bd027bf6c72141f82e6c54e8a2dc89651ac82e0';

async function hashPassword(password) {
  const msgBuffer  = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function isAuthenticated() {
  return localStorage.getItem(AUTH_KEY) === '1';
}

function setAuthenticated(value) {
  if (value) localStorage.setItem(AUTH_KEY, '1');
  else localStorage.removeItem(AUTH_KEY);
}

function showApp() {
  const gate = document.getElementById('login-gate');
  if (gate) gate.classList.add('hidden');
}

function showLoginGate(errorMsg) {
  const gate = document.getElementById('login-gate');
  if (gate) gate.classList.remove('hidden');
  const input = document.getElementById('login-password');
  if (input) { input.value = ''; input.focus(); }
  if (errorMsg) {
    const err = document.getElementById('login-error');
    if (err) err.textContent = errorMsg;
  }
}

function lockApp() {
  setAuthenticated(false);
  showLoginGate();
}

// ─── Idle Session Timeout ───────────────────────────────────────
let _lastActivity = Date.now();
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function resetIdleTimer() { _lastActivity = Date.now(); }

['mousemove', 'keydown', 'click', 'touchstart'].forEach(evt => {
  document.addEventListener(evt, resetIdleTimer, { passive: true });
});

setInterval(() => {
  if (isAuthenticated() && Date.now() - _lastActivity > IDLE_TIMEOUT_MS) {
    clearInterval(_countdownTimer);
    setAuthenticated(false);
    location.reload();
  }
}, 60000);

// Rate-limiting (sessionStorage so it resets when the tab closes)
let _loginAttempts     = parseInt(sessionStorage.getItem('sdt_login_attempts') || '0', 10);
let _loginLockoutUntil = parseInt(sessionStorage.getItem('sdt_login_lockout') || '0', 10);
const LOGIN_MAX_ATTEMPTS  = 5;
const LOGIN_BASE_DELAY_MS = 1000;

async function handleLogin(e) {
  e.preventDefault();
  const input    = document.getElementById('login-password');
  const errorEl  = document.getElementById('login-error');
  const btn      = document.getElementById('login-btn');
  const password = (input?.value || '').trim();

  if (!password) {
    if (errorEl) errorEl.textContent = 'Please enter your password.';
    return;
  }

  // Rate-limit check
  const now = Date.now();
  if (_loginLockoutUntil && now < _loginLockoutUntil) {
    const secs = Math.ceil((_loginLockoutUntil - now) / 1000);
    if (errorEl) errorEl.textContent = `Too many attempts. Try again in ${secs}s.`;
    return;
  }

  btn.textContent = 'Checking…';
  btn.disabled    = true;

  const hash = await hashPassword(password);

  if (hash === PASS_HASH) {
    _loginAttempts = 0;
    sessionStorage.removeItem('sdt_login_attempts');
    sessionStorage.removeItem('sdt_login_lockout');
    setAuthenticated(true);
    if (errorEl) errorEl.textContent = '';
    showApp();
    initApp();
  } else {
    _loginAttempts++;
    sessionStorage.setItem('sdt_login_attempts', String(_loginAttempts));
    if (_loginAttempts >= LOGIN_MAX_ATTEMPTS) {
      const delay = Math.min(LOGIN_BASE_DELAY_MS * Math.pow(2, _loginAttempts - LOGIN_MAX_ATTEMPTS), 60000);
      _loginLockoutUntil = now + delay;
      sessionStorage.setItem('sdt_login_lockout', String(_loginLockoutUntil));
      if (errorEl) errorEl.textContent = `Too many attempts. Locked for ${Math.ceil(delay / 1000)}s.`;
    } else {
      if (errorEl) errorEl.textContent = 'Incorrect password. Try again.';
    }
    if (input) { input.value = ''; input.focus(); }
  }

  btn.textContent = 'Unlock';
  btn.disabled    = false;
}

function bindAuthEvents() {
  document.getElementById('login-form')?.addEventListener('submit', handleLogin);

  // Show/hide password toggle
  document.getElementById('login-eye')?.addEventListener('click', () => {
    const input = document.getElementById('login-password');
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
    input.focus();
  });

  // Lock button in nav
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    if (confirm('Lock the app?')) lockApp();
  });
}

const APP_NAME           = 'Smart Deadline Tracker';
const GDRIVE_CLIENT_ID   = '';  // TODO: paste your Google Cloud OAuth Client ID
const GDRIVE_SCOPE       = 'https://www.googleapis.com/auth/drive.file';
const GDRIVE_FILENAME    = 'SmartDeadlineTracker_Backup.json';
const KEY_GDRIVE_FILE    = 'sdt_gdrive_file_id';
const KEY_GDRIVE_CONNECTED = 'sdt_gdrive_ok';

let _gTokenClient   = null;
let _gAccessToken   = null;
let _gPendingOp     = null;
let _gIsAutoSync    = false;
let _driveSyncTimer = null;

// ─── Google Drive Sync ───────────────────────────────────────────
function initGDrive() {
  if (!GDRIVE_CLIENT_ID || typeof google === 'undefined' || !google.accounts?.oauth2) return;
  if (_gTokenClient) return;
  _gTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GDRIVE_CLIENT_ID, scope: GDRIVE_SCOPE,
    callback: resp => {
      if (resp.error) { if (!_gIsAutoSync) alert('Google sign-in failed: ' + resp.error); _gIsAutoSync = false; _gPendingOp = null; return; }
      _gAccessToken = resp.access_token; _gIsAutoSync = false;
      if (_gPendingOp) { const op = _gPendingOp; _gPendingOp = null; op(); }
    },
  });
}
function gWithToken(op) {
  if (!GDRIVE_CLIENT_ID) { alert('Google Drive is not configured. Add your Client ID to app.js.'); return; }
  if (typeof google === 'undefined' || !google.accounts?.oauth2) { alert('Google library not loaded — check internet connection.'); return; }
  if (!_gTokenClient) initGDrive();
  if (_gAccessToken) { op(); } else { _gPendingOp = op; _gTokenClient.requestAccessToken({ prompt: '' }); }
}
async function _gFetch(url, options = {}) {
  const resp = await fetch(url, { ...options, headers: { Authorization: `Bearer ${_gAccessToken}`, ...(options.headers || {}) } });
  if (resp.status === 401) { _gAccessToken = null; throw { _gStatus: 401 }; }
  return resp;
}
async function _gFindFile() {
  const q = encodeURIComponent(`name='${GDRIVE_FILENAME}' and trashed=false`);
  const resp = await _gFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id)`);
  const data = await resp.json();
  return data.files?.[0]?.id || null;
}
async function _gCreateFile(content) {
  const meta = { name: GDRIVE_FILENAME, mimeType: 'application/json' };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file',     new Blob([content],             { type: 'application/json' }));
  const resp = await _gFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', body: form });
  const data = await resp.json();
  if (!data.id) throw new Error('Drive create failed: ' + JSON.stringify(data));
  return data.id;
}
async function _gUpdateFile(fileId, content) {
  const resp = await _gFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: content });
  if (!resp.ok) { const text = await resp.text(); throw new Error(`Drive update failed (${resp.status}): ${text}`); }
}
function _gSetStatus(msg, isError) {
  const el = document.getElementById('gdrive-status');
  if (el) { el.textContent = msg; el.style.color = isError ? 'var(--red)' : 'var(--muted)'; }
}
let _saveToDriveRetries = 0;
function saveToDrive() {
  gWithToken(async () => {
    try {
      _gSetStatus('Saving…');
      const data = {}; BACKUP_KEYS.forEach(k => { const v = localStorage.getItem(k); if (v !== null) data[k] = v; });
      const json = JSON.stringify({ _version: 2, _app: APP_NAME, _exported: nowISO(), data }, null, 2);
      let fileId = localStorage.getItem(KEY_GDRIVE_FILE);
      if (!fileId) { fileId = await _gFindFile(); if (fileId) localStorage.setItem(KEY_GDRIVE_FILE, fileId); }
      if (fileId) { await _gUpdateFile(fileId, json); } else { fileId = await _gCreateFile(json); localStorage.setItem(KEY_GDRIVE_FILE, fileId); }
      localStorage.setItem(KEY_GDRIVE_CONNECTED, '1');
      _gSetStatus(`Saved ${new Date().toLocaleTimeString()}`);
      _saveToDriveRetries = 0;
    } catch (err) {
      if (err._gStatus === 401 && _saveToDriveRetries < 1) { _saveToDriveRetries++; saveToDrive(); return; }
      _saveToDriveRetries = 0;
      _gSetStatus('Save failed', true); console.error('[Drive]', err); alert('Save to Drive failed.');
    }
  });
}
function _getLocalDataDate() {
  try {
    const deadlines = JSON.parse(localStorage.getItem('sdt_deadlines') || '[]');
    const dates = deadlines.map(d => d.updatedAt || d.createdAt).filter(Boolean).sort();
    return dates.length ? dates[dates.length - 1].slice(0, 10) : null;
  } catch { return null; }
}
let _loadFromDriveRetries = 0;
function loadFromDrive() {
  gWithToken(async () => {
    try {
      _gSetStatus('Loading…');
      let fileId = localStorage.getItem(KEY_GDRIVE_FILE);
      if (!fileId) { fileId = await _gFindFile(); if (!fileId) { _gSetStatus(''); alert('No backup found.'); return; } localStorage.setItem(KEY_GDRIVE_FILE, fileId); }
      const resp   = await _gFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
      const parsed = await resp.json();
      if (!parsed.data || typeof parsed.data !== 'object') throw new Error('Invalid backup');
      const valid = Object.keys(parsed.data).filter(k => BACKUP_KEYS.includes(k));
      if (!valid.length) throw new Error('No data');
      _validateRestoreData(valid, parsed);
      const localDate = _getLocalDataDate();
      const driveDate = parsed._exported ? parsed._exported.slice(0, 10) : '';
      const newerWarning = (localDate && driveDate && localDate > driveDate)
        ? `\n\n⚠️ WARNING: Your local data (${localDate}) is NEWER than the Drive backup (${driveDate}). Loading will overwrite your recent changes!`
        : '';
      if (!confirm(`Load backup from Drive?${newerWarning}\n\nThis will replace all current data.`)) { _gSetStatus(''); return; }
      _saveLocalSafetyBackup();
      valid.forEach(k => localStorage.setItem(k, parsed.data[k]));
      localStorage.setItem(KEY_GDRIVE_CONNECTED, '1');
      initTheme(); renderAll(); _gSetStatus(`Loaded ${parsed._exported || ''}`);
      _loadFromDriveRetries = 0;
    } catch (err) {
      if (err._gStatus === 401 && _loadFromDriveRetries < 1) { _loadFromDriveRetries++; loadFromDrive(); return; }
      _loadFromDriveRetries = 0;
      _gSetStatus('Load failed', true); alert('Load from Drive failed.');
    }
  });
}
function _silentTokenRefresh() {
  return new Promise(resolve => {
    if (!_gTokenClient) { resolve(false); return; }
    const prevCb = _gTokenClient.callback;
    _gTokenClient.callback = resp => {
      _gTokenClient.callback = prevCb;
      if (resp.error) { resolve(false); return; }
      _gAccessToken = resp.access_token;
      resolve(true);
    };
    _gTokenClient.requestAccessToken({ prompt: '' });
  });
}

let _autoSaveRetrying = false;
function queueDriveSync() {
  if (!localStorage.getItem(KEY_GDRIVE_CONNECTED)) return;
  clearTimeout(_driveSyncTimer);
  _driveSyncTimer = setTimeout(async () => {
    if (!_gAccessToken) {
      if (!_gTokenClient) initGDrive();
      if (_gTokenClient) {
        const ok = await _silentTokenRefresh();
        if (!ok) { _gSetStatus('Drive disconnected', true); return; }
      } else { return; }
    }
    try {
      const data = {}; BACKUP_KEYS.forEach(k => { const v = localStorage.getItem(k); if (v !== null) data[k] = v; });
      const json = JSON.stringify({ _version: 2, _app: APP_NAME, _exported: nowISO(), data }, null, 2);
      let fileId = localStorage.getItem(KEY_GDRIVE_FILE);
      if (!fileId) { fileId = await _gFindFile(); if (fileId) localStorage.setItem(KEY_GDRIVE_FILE, fileId); }
      if (fileId) { await _gUpdateFile(fileId, json); } else { fileId = await _gCreateFile(json); localStorage.setItem(KEY_GDRIVE_FILE, fileId); }
      _gSetStatus(`Auto-saved ${new Date().toLocaleTimeString()}`);
      _autoSaveRetrying = false;
    } catch (err) {
      if (err._gStatus === 401 && !_autoSaveRetrying) {
        _gAccessToken = null;
        _autoSaveRetrying = true;
        const ok = await _silentTokenRefresh();
        if (ok) { queueDriveSync(); return; }
        _gSetStatus('Drive disconnected', true);
      }
      _autoSaveRetrying = false;
    }
  }, 3000);
}

// ─── Tab System ──────────────────────────────────────────────────
const TABS = [
  { tabId: 'tab-dashboard', secId: 'sec-dashboard' },
  { tabId: 'tab-deadlines', secId: 'sec-deadlines' },
  { tabId: 'tab-calendar',  secId: 'sec-calendar'  },
  { tabId: 'tab-timeline',  secId: 'sec-timeline'  },
  { tabId: 'tab-focus',     secId: 'sec-focus'     },
  { tabId: 'tab-analytics', secId: 'sec-analytics' },
  { tabId: 'tab-settings',  secId: 'sec-settings'  },
];

function switchTab(targetTabId) {
  TABS.forEach(({ tabId, secId }) => {
    const tab = document.getElementById(tabId);
    const sec = document.getElementById(secId);
    if (!tab || !sec) return;
    const active = tabId === targetTabId;
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    tab.setAttribute('tabindex', active ? '0' : '-1');
    sec.classList.toggle('on', active);
  });
  AppState.activeTab = targetTabId;
  if (targetTabId === 'tab-dashboard') renderDashboard();
  if (targetTabId === 'tab-deadlines') { populateCategorySelects(); renderListTab(); renderActiveFilters(); }
  if (targetTabId === 'tab-calendar')  { populateCategorySelects(); renderCalendarTab(); }
  if (targetTabId === 'tab-timeline')  renderTimelineTab();
  if (targetTabId === 'tab-focus')     renderFocusTab();
  if (targetTabId === 'tab-analytics') renderAnalyticsTab();
  if (targetTabId === 'tab-settings')  { renderSettingsTab(); populateCategorySelects(); }
}

function renderAll() {
  refreshCountdownCache();
  populateCategorySelects();
  const activeTab = AppState.activeTab || 'tab-dashboard';
  TABS.forEach(({ tabId, secId }) => {
    const tab = document.getElementById(tabId);
    const sec = document.getElementById(secId);
    if (!tab || !sec) return;
    const active = tabId === activeTab;
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    tab.setAttribute('tabindex', active ? '0' : '-1');
    sec.classList.toggle('on', active);
  });
  if (activeTab === 'tab-dashboard') renderDashboard();
  if (activeTab === 'tab-deadlines') renderListTab();
  if (activeTab === 'tab-calendar')  renderCalendarTab();
  if (activeTab === 'tab-timeline')  renderTimelineTab();
  if (activeTab === 'tab-focus')     renderFocusTab();
  if (activeTab === 'tab-analytics') renderAnalyticsTab();
  if (activeTab === 'tab-settings')  renderSettingsTab();
}

// ─── Theme ───────────────────────────────────────────────────────
function initTheme() {
  const s = loadSettings();
  const stored = localStorage.getItem(STORAGE_KEYS.THEME);
  const theme  = stored || s.theme || 'dark';
  document.body.classList.toggle('light', theme === 'light');
  updateThemeBtn();
}
function updateThemeBtn() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const isLight = document.body.classList.contains('light');
  btn.textContent = isLight ? '🌙' : '☀️';
  btn.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
}
function toggleTheme() {
  document.body.classList.toggle('light');
  const theme = document.body.classList.contains('light') ? 'light' : 'dark';
  try { localStorage.setItem(STORAGE_KEYS.THEME, theme); } catch {}
  const s = loadSettings(); s.theme = theme; saveSettings(s);
  updateThemeBtn();
}

// ─── Toast Notifications ─────────────────────────────────────────
function showToast(message, type = 'info', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.setAttribute('role', 'alert');
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
  }, duration);
}

// ─── Modal (Add / Edit Deadline) ─────────────────────────────────
function openModal(id = null) {
  AppState.editId   = id;
  AppState.modalOpen = true;
  const modal = document.getElementById('deadline-modal');
  if (!modal) return;
  buildModalForm(id);
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  modal.querySelector('#modal-title-input')?.focus();
}

function closeModal() {
  AppState.editId   = null;
  AppState.modalOpen = false;
  const modal = document.getElementById('deadline-modal');
  if (modal) { modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true'); }
}

function buildModalForm(id) {
  const cats      = loadCategories();
  const settings  = loadSettings();
  const deadline  = id ? loadDeadlines().find(d => d.id === id) : null;
  const def       = defaultDeadline();
  const d         = deadline || def;
  const isEditing = !!id;

  const catOptions = cats.map(c =>
    `<option value="${escapeHTML(c.id)}" ${d.category === c.id ? 'selected' : ''}>${escapeHTML(c.icon || '')} ${escapeHTML(c.name)}</option>`
  ).join('');

  const statusOptions = ['not-started','planned','in-progress','at-risk','paused','completed','canceled']
    .map(s => `<option value="${s}" ${d.status === s ? 'selected' : ''}>${s}</option>`).join('');

  const priorityOptions = ['critical','high','medium','low']
    .map(p => `<option value="${p}" ${d.priority === p ? 'selected' : ''}>${p}</option>`).join('');

  const subtasksHtml = (d.subtasks || []).map((s, i) => subtaskRowHtml(s, i)).join('');

  document.getElementById('modal-form-body').innerHTML = `
    <div class="form-grid">
      <div class="form-group" style="grid-column:1/-1">
        <label for="modal-title-input">Title *</label>
        <input type="text" id="modal-title-input" value="${escapeHTML(d.title)}" placeholder="e.g. Submit lab report" maxlength="200" required>
      </div>
      <div class="form-group" style="grid-column:1/-1">
        <label for="modal-desc">Description</label>
        <textarea id="modal-desc" rows="2" maxlength="2000" placeholder="Optional notes...">${escapeHTML(d.description || '')}</textarea>
      </div>
      <div class="form-group">
        <label for="modal-due-date">Due Date *</label>
        <input type="date" id="modal-due-date" value="${escapeHTML(d.dueDate || '')}" required>
      </div>
      <div class="form-group">
        <label for="modal-due-time">Due Time</label>
        <input type="time" id="modal-due-time" value="${escapeHTML(d.dueTime || '')}">
      </div>
      <div class="form-group">
        <label for="modal-category">Category</label>
        <select id="modal-category">${catOptions}</select>
      </div>
      <div class="form-group">
        <label for="modal-priority">Priority</label>
        <select id="modal-priority">${priorityOptions}</select>
      </div>
      <div class="form-group">
        <label for="modal-status">Status</label>
        <select id="modal-status">${statusOptions}</select>
      </div>
      <div class="form-group">
        <label for="modal-progress">Progress % (manual)</label>
        <input type="range" id="modal-progress" min="0" max="100" step="5" value="${d.progressPercent ?? 0}">
        <span id="modal-progress-val" style="font-size:11px;color:var(--muted)">${d.progressPercent ?? 0}%</span>
      </div>
      <div class="form-group">
        <label for="modal-tags">Tags (comma separated)</label>
        <input type="text" id="modal-tags" value="${escapeHTML((d.tags || []).join(', '))}" placeholder="urgent, thesis, chapter1">
      </div>
      <div class="form-group">
        <label for="modal-link">Link</label>
        <input type="url" id="modal-link" value="${escapeHTML(d.link || '')}" placeholder="https://...">
      </div>
    </div>

    <div class="form-section-title" style="margin-top:16px">Subtasks</div>
    <div id="modal-subtasks">${subtasksHtml}</div>
    <button type="button" class="btn btn-ghost btn-sm" id="modal-add-subtask" style="margin-top:6px">+ Add Subtask</button>

    <div class="form-section-title" style="margin-top:16px">Notes</div>
    <textarea id="modal-notes" rows="3" maxlength="5000" placeholder="Additional notes, links, context...">${escapeHTML(d.notes || '')}</textarea>

    <div class="form-section-title" style="margin-top:16px">Recurrence</div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr">
      <div class="form-group">
        <label for="modal-recur-enabled" style="flex-direction:row;gap:8px;align-items:center">
          <input type="checkbox" id="modal-recur-enabled" ${(d.recurringRule && d.recurringRule.enabled) ? 'checked' : ''}>
          Enable Recurrence
        </label>
      </div>
      <div class="form-group">
        <label for="modal-recur-type">Type</label>
        <select id="modal-recur-type">
          ${['daily','weekly','monthly','yearly'].map(t =>
            `<option value="${t}" ${d.recurringRule?.type === t ? 'selected' : ''}>${t}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-group">
        <label for="modal-recur-interval">Every N</label>
        <input type="number" id="modal-recur-interval" min="1" max="52" value="${d.recurringRule?.interval || 1}">
      </div>
    </div>

    <div class="form-section-title" style="margin-top:16px">Advanced</div>
    <div class="form-grid">
      <div class="form-group">
        <label for="modal-color-override">Color Override</label>
        <input type="color" id="modal-color-override" value="${d.colorOverride || '#4ade80'}">
      </div>
      <div class="form-group">
        <label for="modal-pinned" style="flex-direction:row;gap:8px;align-items:center">
          <input type="checkbox" id="modal-pinned" ${d.isPinned ? 'checked' : ''}>
          Pin this deadline
        </label>
      </div>
    </div>
  `;

  // Wire up progress slider (replaces removed inline oninput handler)
  const progressSlider = document.getElementById('modal-progress');
  const progressVal    = document.getElementById('modal-progress-val');
  if (progressSlider && progressVal) {
    progressSlider.addEventListener('input', () => {
      progressVal.textContent = progressSlider.value + '%';
    });
  }

  const title = document.getElementById('modal-heading');
  if (title) title.textContent = isEditing ? 'Edit Deadline' : 'Add Deadline';
  const saveBtn = document.getElementById('modal-save-btn');
  if (saveBtn) saveBtn.textContent = isEditing ? 'Save Changes' : 'Add Deadline';
}

function subtaskRowHtml(s, i) {
  return `<div class="subtask-row" data-idx="${i}">
    <input type="checkbox" class="subtask-done" ${s.done ? 'checked' : ''} aria-label="Subtask done">
    <input type="text" class="subtask-title" value="${escapeHTML(s.title)}" placeholder="Subtask name" maxlength="200">
    <input type="number" class="subtask-weight" value="${s.weight || 1}" min="0.1" max="100" step="0.5" title="Weight" style="width:56px" aria-label="Weight">
    <button type="button" class="icon-btn sm text-red" data-action="remove-subtask">✕</button>
  </div>`;
}

function addSubtaskRow() {
  const container = document.getElementById('modal-subtasks');
  if (!container) return;
  const idx = container.querySelectorAll('.subtask-row').length;
  const div = document.createElement('div');
  div.innerHTML = subtaskRowHtml({ id: genId(), title: '', done: false, weight: 1 }, idx);
  container.appendChild(div.firstElementChild);
  container.querySelector(`.subtask-row:last-child .subtask-title`)?.focus();
}

function collectSubtasks() {
  const rows = document.querySelectorAll('#modal-subtasks .subtask-row');
  const result = [];
  rows.forEach(row => {
    const title  = (row.querySelector('.subtask-title')?.value || '').trim();
    const done   = !!row.querySelector('.subtask-done')?.checked;
    const weight = safeNum(row.querySelector('.subtask-weight')?.value, 1);
    if (title) result.push({ id: genId(), title, done, weight });
  });
  return result;
}

function saveModalForm() {
  const title  = (document.getElementById('modal-title-input')?.value || '').trim();
  const dueDate = document.getElementById('modal-due-date')?.value || '';
  if (!title)   { showToast('Title is required.', 'error'); return; }
  if (!dueDate) { showToast('Due date is required.', 'error'); return; }

  const tags = (document.getElementById('modal-tags')?.value || '')
    .split(',').map(t => t.trim()).filter(Boolean);

  const colorOv  = document.getElementById('modal-color-override')?.value || null;
  const recurEnabled = !!document.getElementById('modal-recur-enabled')?.checked;

  const data = {
    title,
    description:    document.getElementById('modal-desc')?.value || '',
    dueDate,
    dueTime:        document.getElementById('modal-due-time')?.value || '',
    category:       document.getElementById('modal-category')?.value || 'personal',
    priority:       document.getElementById('modal-priority')?.value || 'medium',
    status:         document.getElementById('modal-status')?.value || 'not-started',
    progressPercent: safeNum(document.getElementById('modal-progress')?.value, 0),
    tags,
    link:           document.getElementById('modal-link')?.value || '',
    notes:          document.getElementById('modal-notes')?.value || '',
    subtasks:       collectSubtasks(),
    colorOverride:  colorOv === '#4ade80' ? null : colorOv,
    isPinned:       !!document.getElementById('modal-pinned')?.checked,
    recurringRule: {
      enabled:  recurEnabled,
      type:     document.getElementById('modal-recur-type')?.value || 'weekly',
      interval: safeNum(document.getElementById('modal-recur-interval')?.value, 1),
      endDate:  null,
    },
  };

  try {
    if (AppState.editId) {
      updateDeadline(AppState.editId, data);
      showToast('Deadline updated!', 'success');
    } else {
      createDeadline(data);
      showToast('Deadline added!', 'success');
    }
    closeModal();
    renderAll();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── Detail Panel ────────────────────────────────────────────────
function openDetailPanel(id) {
  AppState.detailId   = id;
  AppState.detailOpen = true;
  const panel   = document.getElementById('detail-panel');
  const overlay = document.getElementById('detail-overlay');
  if (!panel) return;
  renderDetailPanel(id);
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  if (overlay) { overlay.classList.add('open'); overlay.setAttribute('aria-hidden', 'false'); }
}

function closeDetailPanel() {
  AppState.detailId   = null;
  AppState.detailOpen = false;
  clearInterval(AppState.detailCountdownInterval);
  const panel   = document.getElementById('detail-panel');
  const overlay = document.getElementById('detail-overlay');
  if (panel)   { panel.classList.remove('open');   panel.setAttribute('aria-hidden', 'true'); }
  if (overlay) { overlay.classList.remove('open'); overlay.setAttribute('aria-hidden', 'true'); }
}

function renderDetailPanel(id) {
  const body = document.getElementById('detail-body');
  if (!body) return;
  const d = getDeadlineById(id);
  if (!d) { body.innerHTML = '<p class="text-muted">Deadline not found.</p>'; return; }

  const color    = safeColor(d._urgencyColor);
  const progress = d._progress;

  body.innerHTML = `
    <div class="detail-header" style="border-left:4px solid ${color}">
      <div class="detail-title-row">
        ${healthDot(d._healthStatus)}
        <h2 class="detail-title">${escapeHTML(d.title)}</h2>
        ${d.isPinned ? '<span title="Pinned">📌</span>' : ''}
      </div>
      <div class="detail-meta-row">
        ${statusBadge(d.status, d._isOverdue)}
        ${priorityBadge(d.priority)}
        ${riskBadgeHtml(d._riskLevel)}
        <span class="meta-cat">${escapeHTML(d.category || '')}</span>
      </div>
    </div>

    <div class="detail-countdown" id="detail-countdown-display" style="color:${color}">
      ${d.status === 'completed' ? '✓ Completed' : d._isOverdue
        ? `Overdue by ${formatCountdown(Math.abs(d._msRemaining))}`
        : `Due in ${formatCountdown(d._msRemaining)}`}
    </div>

    <div class="detail-section">
      <div class="detail-row"><span class="detail-lbl">Due Date</span><span>${formatDate(d.dueDate)}${d.dueTime ? ' · ' + formatTime(d.dueTime) : ''}</span></div>
      <div class="detail-row"><span class="detail-lbl">Days Left</span><span style="color:${color}">${formatRelativeDeadline(d._daysLeft)}</span></div>
      <div class="detail-row"><span class="detail-lbl">Start By</span><span style="color:${d._startStatus === 'behind' ? 'var(--red)' : d._startStatus === 'start-today' ? 'var(--orange)' : 'var(--green)'}">${formatDate(d._recStartDate)}</span></div>
    </div>

    <div class="detail-section">
      <div class="detail-lbl" style="margin-bottom:6px">Progress — ${progress}%</div>
      <div class="progress-wrap">
        <div class="progress-bar" style="width:${progress}%;background:${color}"></div>
      </div>
    </div>

    ${d.subtasks && d.subtasks.length > 0 ? `
    <div class="detail-section">
      <div class="detail-lbl" style="margin-bottom:8px">Subtasks (${d.subtasks.filter(s=>s.done).length}/${d.subtasks.length})</div>
      ${d.subtasks.map(s => `
        <div class="subtask-display ${s.done ? 'done' : ''}">
          <span class="subtask-check">${s.done ? '✓' : '○'}</span>
          <span>${escapeHTML(s.title)}</span>
        </div>`).join('')}
    </div>` : ''}

    ${d.description ? `
    <div class="detail-section">
      <div class="detail-lbl">Description</div>
      <p style="margin-top:6px;font-size:.88rem;line-height:1.6">${escapeHTML(d.description)}</p>
    </div>` : ''}

    ${d.notes ? `
    <div class="detail-section">
      <div class="detail-lbl">Notes</div>
      <p style="margin-top:6px;font-size:.85rem;color:var(--muted);line-height:1.6">${escapeHTML(d.notes)}</p>
    </div>` : ''}

    ${d.link && isSafeUrl(d.link) ? `
    <div class="detail-section">
      <div class="detail-lbl">Link</div>
      <a href="${escapeHTML(d.link)}" target="_blank" rel="noopener noreferrer" class="detail-link">${escapeHTML(truncate(d.link, 60))}</a>
    </div>` : ''}

    ${d.tags && d.tags.length ? `
    <div class="detail-section">
      <div class="detail-lbl">Tags</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">
        ${d.tags.map(t => `<span class="tag-chip">#${escapeHTML(t)}</span>`).join('')}
      </div>
    </div>` : ''}

    ${d.postponeCount > 0 ? `
    <div class="detail-section">
      <p class="text-gold" style="font-size:.82rem">Postponed ${d.postponeCount} time${d.postponeCount !== 1 ? 's' : ''} (originally due ${formatDate(d.originalDueDate || d.dueDate)})</p>
    </div>` : ''}

    <div class="detail-section">
      <div class="detail-lbl" style="margin-bottom:8px">Actions</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        <button class="btn btn-green btn-sm" data-action="edit"     data-id="${escapeHTML(d.id)}">Edit</button>
        ${d.status !== 'completed' ? `<button class="btn btn-ghost btn-sm" data-action="complete" data-id="${escapeHTML(d.id)}">Mark Complete</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-action="duplicate" data-id="${escapeHTML(d.id)}">Duplicate</button>
        <button class="btn btn-ghost btn-sm" data-action="postpone"  data-id="${escapeHTML(d.id)}">Postpone</button>
        <button class="btn btn-ghost btn-sm" data-action="archive"   data-id="${escapeHTML(d.id)}">Archive</button>
        <button class="btn btn-ghost btn-sm text-red" data-action="delete" data-id="${escapeHTML(d.id)}">Delete</button>
      </div>
    </div>

    <div class="detail-section text-muted" style="font-size:.78rem">
      Created ${new Date(d.createdAt).toLocaleString()}<br>
      ${d.completedAt ? `Completed ${new Date(d.completedAt).toLocaleString()}` : `Updated ${new Date(d.updatedAt).toLocaleString()}`}
    </div>
  `;

  // Start a live countdown update for this panel
  startDetailCountdown(d);
}

function startDetailCountdown(d) {
  clearInterval(AppState.detailCountdownInterval);
  if (['completed','canceled','archived'].includes(d.status)) return;
  const el = document.getElementById('detail-countdown-display');
  if (!el) return;
  AppState.detailCountdownInterval = setInterval(() => {
    if (!AppState.detailOpen) { clearInterval(AppState.detailCountdownInterval); return; }
    const ms    = msUntilDeadline(d);
    const color = calcUrgencyColor(d);
    el.style.color = color;
    el.textContent = ms < 0
      ? `Overdue by ${formatCountdown(Math.abs(ms))}`
      : `Due in ${formatCountdown(ms)}`;
  }, 1000);
}

// ─── Postpone Dialog ─────────────────────────────────────────────
function openPostponeDialog(id) {
  const d = getDeadlineById(id);
  if (!d) return;
  const newDate = prompt(`Postpone "${d.title}"\n\nEnter new due date (YYYY-MM-DD):`, addDays(d.dueDate, 3));
  if (!newDate) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) { showToast('Invalid date format. Use YYYY-MM-DD.', 'error'); return; }
  if (newDate <= d.dueDate) { showToast('New date must be after current due date.', 'error'); return; }
  try {
    postponeDeadline(id, newDate);
    showToast('Deadline postponed.', 'success');
    closeDetailPanel();
    renderAll();
  } catch (err) { showToast(err.message, 'error'); }
}

// ─── Countdown Ticker ────────────────────────────────────────────
let _countdownTimer = null;
let _countdownCache = null; // Map<id, deadline>

function refreshCountdownCache() {
  const deadlines = loadDeadlines();
  _countdownCache = new Map(deadlines.map(d => [d.id, d]));
}

function startCountdownTicker() {
  if (_countdownTimer) clearInterval(_countdownTimer);
  refreshCountdownCache();
  _countdownTimer = setInterval(() => {
    const els = document.querySelectorAll('[data-countdown-id]');
    if (!els.length) return;
    els.forEach(el => {
      const id = el.dataset.countdownId;
      const d  = _countdownCache?.get(id);
      if (!d) return;
      const ms = msUntilDeadline(d);
      el.textContent = ms < 0 ? `Overdue ${formatCountdown(Math.abs(ms))}` : formatCountdown(ms);
    });
  }, 1000);
}

// ─── Event Delegation ────────────────────────────────────────────
function handleAction(action, id, extra) {
  switch (action) {
    case 'view':      openDetailPanel(id); break;
    case 'edit':      closeDetailPanel(); openModal(id); break;
    case 'complete':
      if (!confirm('Mark this deadline as complete?')) return;
      try {
        const d = loadDeadlines().find(dl => dl.id === id);
        if (d && d.recurringRule && d.recurringRule.enabled) completeAndRecur(id);
        else markComplete(id);
        showToast('Marked complete!', 'success');
        closeDetailPanel(); renderAll();
      } catch (err) { showToast(err.message, 'error'); }
      break;
    case 'delete':
      if (!confirm('Delete this deadline? This cannot be undone.')) return;
      deleteDeadline(id);
      showToast('Deadline deleted.', 'success');
      closeDetailPanel(); renderAll();
      break;
    case 'duplicate':
      duplicateDeadline(id);
      showToast('Deadline duplicated.', 'success');
      renderAll();
      break;
    case 'archive':
      archiveDeadline(id);
      showToast('Deadline archived.', 'success');
      closeDetailPanel(); renderAll();
      break;
    case 'restore':
      restoreDeadline(id);
      showToast('Deadline restored.', 'success');
      renderAll();
      break;
    case 'postpone':
      openPostponeDialog(id);
      break;
    case 'quick-add':
      openModal(null);
      if (extra) {
        setTimeout(() => {
          const dateInput = document.getElementById('modal-due-date');
          if (dateInput) dateInput.value = extra;
        }, 50);
      }
      break;
  }
}

function bindEvents() {
  if (bindEvents._bound) return;
  bindEvents._bound = true;
  // Tab navigation — click
  const tablist = document.querySelector('[role="tablist"]');
  if (tablist && !tablist._delegated) {
    tablist._delegated = true;
    tablist.addEventListener('click', e => {
      const tab = e.target.closest('[role="tab"]');
      if (tab) switchTab(tab.id);
    });
    tablist.addEventListener('keydown', e => {
      const tabs = [...tablist.querySelectorAll('[role="tab"]')];
      const idx  = tabs.indexOf(document.activeElement);
      if (idx === -1) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); const n = tabs[(idx+1) % tabs.length]; n.focus(); switchTab(n.id); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); const n = tabs[(idx-1+tabs.length) % tabs.length]; n.focus(); switchTab(n.id); }
    });
  }

  // Theme toggle
  document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

  // Global add buttons
  document.getElementById('btn-add-deadline')?.addEventListener('click', () => openModal());
  document.getElementById('btn-add-deadline-list')?.addEventListener('click', () => openModal());

  // Modal
  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  document.getElementById('modal-cancel')?.addEventListener('click', closeModal);
  document.getElementById('modal-save-btn')?.addEventListener('click', saveModalForm);
  document.getElementById('deadline-modal')?.addEventListener('click', e => {
    if (e.target.id === 'deadline-modal') closeModal();
  });

  // Modal subtask add
  document.addEventListener('click', e => {
    if (e.target.id === 'modal-add-subtask') { addSubtaskRow(); return; }
    if (e.target.closest('[data-action="remove-subtask"]')) {
      e.target.closest('.subtask-row')?.remove(); return;
    }
  });

  // Detail panel
  document.getElementById('detail-close')?.addEventListener('click', closeDetailPanel);
  document.getElementById('detail-overlay')?.addEventListener('click', closeDetailPanel);

  // Escape key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (AppState.modalOpen)  { closeModal(); return; }
      if (AppState.detailOpen) { closeDetailPanel(); return; }
    }
  });

  // Global action delegation
  document.addEventListener('click', e => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.dataset.action;
    const id     = actionEl.dataset.id;
    const date   = actionEl.dataset.date;
    if (action === 'switch-tab') { const tab = actionEl.dataset.tab; if (tab) switchTab(tab); return; }
    if (action === 'quick-add') { handleAction('quick-add', null, date); return; }
    if (id) handleAction(action, id);
  });

  // List tab — search
  const searchInput = document.getElementById('list-search');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(e => {
      AppState.list.search = e.target.value;
      renderListItems();
    }, 200));
  }

  // List tab — filters
  document.getElementById('list-filter-category')?.addEventListener('change', e => {
    AppState.list.category = e.target.value; renderListItems(); renderActiveFilters();
  });
  document.getElementById('list-filter-status')?.addEventListener('change', e => {
    AppState.list.status = e.target.value; renderListItems(); renderActiveFilters();
  });
  document.getElementById('list-filter-priority')?.addEventListener('change', e => {
    AppState.list.priority = e.target.value; renderListItems(); renderActiveFilters();
  });
  document.getElementById('list-sort')?.addEventListener('change', e => {
    AppState.list.sort = e.target.value; renderListItems();
  });
  document.getElementById('list-view-mode')?.addEventListener('change', e => {
    AppState.list.viewMode = e.target.value; renderListItems();
  });
  document.getElementById('list-show-archived')?.addEventListener('change', e => {
    AppState.list.showArchived = e.target.checked; renderListItems(); renderActiveFilters();
  });

  // Active filter chips (clear filter)
  document.getElementById('active-filters')?.addEventListener('click', e => {
    const chip = e.target.closest('[data-clear]');
    if (!chip) return;
    const field = chip.dataset.clear;
    if (field === 'category') AppState.list.category = '';
    if (field === 'status')   AppState.list.status   = '';
    if (field === 'priority') AppState.list.priority = '';
    if (field === 'showArchived') AppState.list.showArchived = false;
    renderListItems(); renderActiveFilters();
  });

  // List bulk actions
  document.addEventListener('change', e => {
    if (e.target.classList.contains('row-check')) {
      const id = e.target.dataset.id;
      if (!id) return;
      if (e.target.checked) AppState.list.selected.add(id);
      else AppState.list.selected.delete(id);
      renderBulkBar();
    }
  });
  document.getElementById('bulk-select-all')?.addEventListener('click', () => {
    document.querySelectorAll('.row-check').forEach(cb => {
      cb.checked = true;
      AppState.list.selected.add(cb.dataset.id);
    });
    renderBulkBar();
  });
  document.getElementById('bulk-deselect')?.addEventListener('click', () => {
    AppState.list.selected.clear();
    document.querySelectorAll('.row-check').forEach(cb => cb.checked = false);
    renderBulkBar();
  });
  document.getElementById('bulk-complete')?.addEventListener('click', () => {
    if (!AppState.list.selected.size) return;
    if (!confirm(`Mark ${AppState.list.selected.size} items complete?`)) return;
    bulkMarkComplete([...AppState.list.selected]);
    AppState.list.selected.clear();
    showToast('Items marked complete.', 'success');
    renderAll();
  });
  document.getElementById('bulk-archive')?.addEventListener('click', () => {
    if (!AppState.list.selected.size) return;
    if (!confirm(`Archive ${AppState.list.selected.size} items?`)) return;
    bulkArchive([...AppState.list.selected]);
    AppState.list.selected.clear();
    showToast('Items archived.', 'success');
    renderAll();
  });
  document.getElementById('bulk-delete')?.addEventListener('click', () => {
    if (!AppState.list.selected.size) return;
    if (!confirm(`Delete ${AppState.list.selected.size} items? This cannot be undone.`)) return;
    bulkDeleteDeadlines([...AppState.list.selected]);
    AppState.list.selected.clear();
    showToast('Items deleted.', 'success');
    renderAll();
  });

  // Calendar nav
  document.getElementById('cal-prev')?.addEventListener('click', calPrevMonth);
  document.getElementById('cal-next')?.addEventListener('click', calNextMonth);
  document.getElementById('cal-today')?.addEventListener('click', calGoToday);
  document.getElementById('cal-grid')?.addEventListener('click', e => {
    const cell = e.target.closest('.cal-cell');
    if (cell && cell.dataset.date) renderCalendarDayPopup(cell.dataset.date);
    const item = e.target.closest('.cal-item');
    if (item && item.dataset.id) openDetailPanel(item.dataset.id);
  });
  document.getElementById('cal-popup-close')?.addEventListener('click', closeCalendarPopup);
  document.getElementById('cal-popup')?.addEventListener('click', e => {
    if (e.target.id === 'cal-popup') closeCalendarPopup();
    if (e.target.id === 'cal-popup-close') closeCalendarPopup();
  });

  // Timeline groupBy
  document.getElementById('timeline-group-by')?.addEventListener('change', e => {
    AppState.timeline.groupBy = e.target.value; renderTimelineTab();
  });

  // Analytics period
  document.getElementById('analytics-period')?.addEventListener('change', e => {
    AppState.analytics.period = e.target.value; renderAnalyticsTab();
  });

  // Settings form
  document.getElementById('settings-save-btn')?.addEventListener('click', saveSettingsForm);
  document.getElementById('btn-export-json')?.addEventListener('click', handleExportJSON);
  document.getElementById('btn-export-csv')?.addEventListener('click', handleExportCSV);
  document.getElementById('btn-import-json')?.addEventListener('change', e => {
    handleImportJSON(e.target.files[0]); e.target.value = '';
  });
  document.getElementById('btn-reset-all')?.addEventListener('click', handleResetAll);

  // Category manager
  document.getElementById('btn-add-cat')?.addEventListener('click', () => {
    const name  = document.getElementById('new-cat-name')?.value;
    const color = document.getElementById('new-cat-color')?.value || '#6b7280';
    const icon  = document.getElementById('new-cat-icon')?.value || '📌';
    addCategory(name, color, icon);
    if (document.getElementById('new-cat-name')) document.getElementById('new-cat-name').value = '';
  });
  document.getElementById('cat-manager-list')?.addEventListener('click', e => {
    const delBtn = e.target.closest('[data-action="delete-cat"]');
    if (delBtn) deleteCategory(delBtn.dataset.catId);
  });
  document.getElementById('cat-manager-list')?.addEventListener('change', e => {
    const picker = e.target.closest('.cat-color-picker');
    if (picker) { updateCategoryColor(picker.dataset.catId, picker.value); renderAll(); }
  });

  // Drive sync
  document.getElementById('btn-save-drive')?.addEventListener('click', saveToDrive);
  document.getElementById('btn-load-drive')?.addEventListener('click', loadFromDrive);
}

// ─── Init ─────────────────────────────────────────────────────────
// Called only after successful login
function initApp() {
  scanAndFlagOverdue();
  initTheme();
  populateCategorySelects();
  bindEvents();
  switchTab('tab-dashboard');
  startCountdownTicker();
  // Auto-sync Drive if previously connected
  if (localStorage.getItem(KEY_GDRIVE_CONNECTED)) {
    let _tryAutoAttempts = 0;
    function tryAuto() {
      if (typeof google === 'undefined' || !google.accounts?.oauth2) {
        if (++_tryAutoAttempts >= 20) { console.warn('[GDrive] Google lib not available after 20 attempts, giving up.'); return; }
        setTimeout(tryAuto, 500); return;
      }
      if (!_gTokenClient) initGDrive();
      _gIsAutoSync = true; _gPendingOp = () => {};
      _gTokenClient.requestAccessToken({ prompt: '' });
    }
    setTimeout(tryAuto, 800);
  }
}

// Entry point — always runs; checks auth first
function init() {
  bindAuthEvents();
  if (isAuthenticated()) {
    showApp();
    initApp();
  }
  // If not authenticated, login gate is already visible (default HTML state)
}

// ─── Cross-tab Sync ─────────────────────────────────────────────
window.addEventListener('storage', (e) => {
  if (e.key && e.key.startsWith('sdt_')) {
    refreshCountdownCache();
    renderAll();
  }
});

document.addEventListener('DOMContentLoaded', init);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('[sw] Registration failed:', err));
  });
}
