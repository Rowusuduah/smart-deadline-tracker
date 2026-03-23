'use strict';
/* ═══════════════════════════════════════════════════════════════
   ui-settings.js — Settings tab rendering and form handling.
═══════════════════════════════════════════════════════════════ */

function renderSettingsTab() {
  const sec = document.getElementById('sec-settings');
  if (!sec || !sec.classList.contains('on')) return;
  populateSettingsForm();
  renderCategoryManager();
}

// ─── Settings Form ───────────────────────────────────────────────
function populateSettingsForm() {
  const s = loadSettings();
  setVal('set-work-hours',    s.workHoursPerDay);
  setVal('set-buffer-days',   s.bufferDays);
  setVal('set-def-category',  s.defaultCategory);
  setVal('set-def-priority',  s.defaultPriority);
  setVal('set-def-est-hours', s.defaultEstimatedHours);
  setVal('set-color-mode',    s.colorMode);
  setVal('set-completed-days',s.showCompletedDays);
  setCheck('set-include-weekends', s.includeWeekends);
}

function setVal(id, v) {
  const el = document.getElementById(id);
  if (el) el.value = v ?? '';
}

function setCheck(id, v) {
  const el = document.getElementById(id);
  if (el) el.checked = !!v;
}

function saveSettingsForm() {
  const s = loadSettings();
  s.workHoursPerDay       = clamp(safeNum(getVal('set-work-hours'), 6), 1, 24);
  s.bufferDays            = clamp(safeNum(getVal('set-buffer-days'), 1), 0, 14);
  s.defaultCategory       = getVal('set-def-category') || 'personal';
  s.defaultPriority       = getVal('set-def-priority') || 'medium';
  s.defaultEstimatedHours = clamp(safeNum(getVal('set-def-est-hours'), 2), 0, 1000);
  s.colorMode             = getVal('set-color-mode') || 'urgency';
  s.showCompletedDays     = clamp(safeNum(getVal('set-completed-days'), 7), 0, 365);
  s.includeWeekends       = getCheck('set-include-weekends');
  saveSettings(s);
  showToast('Settings saved!', 'success');
}

function getVal(id) {
  return (document.getElementById(id) || {}).value || '';
}

function getCheck(id) {
  return !!(document.getElementById(id) || {}).checked;
}

// ─── Category Manager ────────────────────────────────────────────
function renderCategoryManager() {
  const el = document.getElementById('cat-manager-list');
  if (!el) return;
  const cats = loadCategories();
  if (!cats.length) {
    el.innerHTML = '<p class="text-muted">No categories yet.</p>';
    return;
  }
  el.innerHTML = cats.map(c => `
    <div class="cat-manager-row" data-cat-id="${escapeHTML(c.id)}">
      <span class="cat-dot" style="background:${c.color};width:14px;height:14px;border-radius:50%;display:inline-block"></span>
      <span class="cat-manager-icon">${c.icon || ''}</span>
      <span class="cat-manager-name">${escapeHTML(c.name)}</span>
      <input type="color" class="cat-color-picker" value="${c.color}" data-cat-id="${escapeHTML(c.id)}" title="Pick color" aria-label="Color for ${escapeHTML(c.name)}">
      <button class="icon-btn sm text-red" data-action="delete-cat" data-cat-id="${escapeHTML(c.id)}" title="Delete category"
        ${c.id === 'personal' || c.id === 'work' ? 'disabled title="Default categories cannot be deleted"' : ''}>✕</button>
    </div>
  `).join('');
}

function addCategory(name, color, icon) {
  if (!name || !name.trim()) return;
  const cats = loadCategories();
  const id   = name.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  if (cats.find(c => c.id === id)) {
    showToast('Category already exists.', 'error'); return;
  }
  cats.push({ id, name: name.trim(), color: color || '#6b7280', icon: icon || '📌' });
  saveCategories(cats);
  renderCategoryManager();
  showToast('Category added!', 'success');
}

function deleteCategory(id) {
  if (['personal','work'].includes(id)) {
    showToast('Default categories cannot be deleted.', 'error'); return;
  }
  if (!confirm('Delete this category? Deadlines in this category will be reassigned to "Personal".')) return;
  const cats = loadCategories().filter(c => c.id !== id);
  saveCategories(cats);
  // Reassign deadlines
  const dls = loadDeadlines().map(d => d.category === id ? { ...d, category: 'personal' } : d);
  saveDeadlines(dls);
  renderCategoryManager();
  showToast('Category deleted.', 'success');
}

function updateCategoryColor(catId, color) {
  const cats = loadCategories().map(c => c.id === catId ? { ...c, color } : c);
  saveCategories(cats);
}

// ─── Data Management ─────────────────────────────────────────────
function handleExportJSON() { exportJSON(); }
function handleExportCSV()  { exportCSV(); }

function handleImportJSON(file) {
  importJSON(file, () => {
    initTheme();
    renderAll();
    showToast('Data imported successfully!', 'success');
  });
}

function handleResetAll() {
  if (resetAllData()) {
    renderAll();
    showToast('All data has been reset.', 'success');
  }
}

// ─── Populate category selects across the UI ────────────────────
function populateCategorySelects() {
  const cats = loadCategories();
  const selects = document.querySelectorAll('.category-select');
  selects.forEach(sel => {
    const current = sel.value;
    sel.innerHTML = `<option value="">All Categories</option>` +
      cats.map(c => `<option value="${escapeHTML(c.id)}" ${current === c.id ? 'selected' : ''}>${escapeHTML(c.icon || '')} ${escapeHTML(c.name)}</option>`).join('');
    if (current) sel.value = current;
  });
}
