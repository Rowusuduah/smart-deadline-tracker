'use strict';
/* ═══════════════════════════════════════════════════════════════
   deadlines.js — CRUD operations and filtering.
   All writes go through saveDeadlines() → localStorage.
═══════════════════════════════════════════════════════════════ */

// ─── Default Deadline Shape ──────────────────────────────────────
function defaultDeadline() {
  const s = loadSettings();
  return {
    id:             genId(),
    title:          '',
    description:    '',
    category:       s.defaultCategory || 'personal',
    tags:           [],
    dueDate:        addDays(todayISO(), 7),
    dueTime:        '',
    createdAt:      nowISO(),
    updatedAt:      nowISO(),
    completedAt:    null,
    status:         'not-started',
    priority:       s.defaultPriority || 'medium',
    progressPercent: 0,
    subtasks:       [],
    notes:          '',
    link:           '',
    reminders:      [],
    recurringRule:  { enabled: false, type: 'weekly', interval: 1, endDate: null },
    isArchived:     false,
    isPinned:       false,
    colorOverride:  null,
    goalId:         null,
    postponeCount:  0,
    originalDueDate: null,
  };
}

// ─── Validation ──────────────────────────────────────────────────
function validateDeadline(data) {
  const errors = [];
  if (!data.title || !data.title.trim()) errors.push('Title is required.');
  if (!data.dueDate) errors.push('Due date is required.');
  if (data.progressPercent != null) {
    const p = safeNum(data.progressPercent, 0);
    if (p < 0 || p > 100) errors.push('Progress must be between 0 and 100.');
  }
  return errors;
}

// ─── Create ──────────────────────────────────────────────────────
function createDeadline(data) {
  const deadline = { ...defaultDeadline(), ...sanitizeDeadlineInput(data) };
  deadline.id        = genId();
  deadline.createdAt = nowISO();
  deadline.updatedAt = nowISO();

  const errors = validateDeadline(deadline);
  if (errors.length) throw new Error(errors.join('\n'));

  const deadlines = loadDeadlines();
  deadlines.push(deadline);
  saveDeadlines(deadlines);
  return deadline;
}

// ─── Read ────────────────────────────────────────────────────────
function getDeadlineById(id) {
  const s = loadSettings();
  const d = loadDeadlines().find(d => d.id === id);
  return d ? enrichDeadline(d, s) : null;
}

function getAllDeadlines(includeArchived = false) {
  const s = loadSettings();
  return loadDeadlines()
    .filter(d => includeArchived || (!d.isArchived && d.status !== 'archived'))
    .map(d => enrichDeadline(d, s));
}

// ─── Update ──────────────────────────────────────────────────────
function updateDeadline(id, data) {
  const deadlines = loadDeadlines();
  const idx = deadlines.findIndex(d => d.id === id);
  if (idx === -1) throw new Error('Deadline not found: ' + id);
  const updated = { ...deadlines[idx], ...sanitizeDeadlineInput(data), updatedAt: nowISO() };
  const errors = validateDeadline(updated);
  if (errors.length) throw new Error(errors.join('\n'));
  deadlines[idx] = updated;
  saveDeadlines(deadlines);
  return enrichDeadline(updated, loadSettings());
}

// ─── Delete ──────────────────────────────────────────────────────
function deleteDeadline(id) {
  const deadlines = loadDeadlines();
  const filtered = deadlines.filter(d => d.id !== id);
  if (filtered.length === deadlines.length) return false;
  saveDeadlines(filtered);
  return true;
}

// ─── Bulk Delete ─────────────────────────────────────────────────
function bulkDeleteDeadlines(ids) {
  const idSet = new Set(ids);
  saveDeadlines(loadDeadlines().filter(d => !idSet.has(d.id)));
}

// ─── Duplicate ───────────────────────────────────────────────────
function duplicateDeadline(id) {
  const deadlines = loadDeadlines();
  const original  = deadlines.find(d => d.id === id);
  if (!original) return null;
  const copy = {
    ...original,
    id:             genId(),
    title:          original.title + ' (copy)',
    status:         'not-started',
    progressPercent: 0,
    completedAt:    null,
    createdAt:      nowISO(),
    updatedAt:      nowISO(),
    subtasks:       (original.subtasks || []).map(s => ({ ...s, id: genId(), done: false })),
    reminders:      [],
    postponeCount:  0,
    originalDueDate: null,
    isPinned:       false,
  };
  deadlines.push(copy);
  saveDeadlines(deadlines);
  return copy;
}

// ─── Status Changes ──────────────────────────────────────────────
function markComplete(id) {
  return updateDeadline(id, {
    status:         'completed',
    progressPercent: 100,
    completedAt:    nowISO(),
  });
}

function markOverdue(id) {
  return updateDeadline(id, { status: 'overdue' });
}

function archiveDeadline(id) {
  return updateDeadline(id, { status: 'archived', isArchived: true });
}

function restoreDeadline(id) {
  const d = loadDeadlines().find(dl => dl.id === id);
  if (!d) return null;
  return updateDeadline(id, {
    status:     'not-started',
    isArchived: false,
  });
}

function postponeDeadline(id, newDueDate) {
  const deadlines = loadDeadlines();
  const d = deadlines.find(dl => dl.id === id);
  if (!d) return null;
  return updateDeadline(id, {
    dueDate:         newDueDate,
    originalDueDate: d.originalDueDate || d.dueDate,
    postponeCount:   (d.postponeCount || 0) + 1,
    status:          d.status === 'overdue' ? 'in-progress' : d.status,
  });
}

// ─── Bulk Status Changes ─────────────────────────────────────────
function bulkMarkComplete(ids) {
  ids.forEach(id => {
    try { markComplete(id); } catch (e) { console.error('[deadlines] bulk op failed:', e); }
  });
}

function bulkArchive(ids) {
  ids.forEach(id => {
    try { archiveDeadline(id); } catch (e) { console.error('[deadlines] bulk op failed:', e); }
  });
}

// ─── Filtering ───────────────────────────────────────────────────
function filterDeadlines(enrichedList, filters) {
  let list = [...enrichedList];
  const f = filters || {};

  // Search (title, description, tags)
  if (f.search && f.search.trim()) {
    const q = f.search.trim().toLowerCase();
    list = list.filter(d =>
      (d.title || '').toLowerCase().includes(q) ||
      (d.description || '').toLowerCase().includes(q) ||
      (d.tags || []).some(t => t.toLowerCase().includes(q))
    );
  }

  // Category
  if (f.category) {
    list = list.filter(d => d.category === f.category);
  }

  // Status
  if (f.status) {
    if (f.status === 'active') {
      list = list.filter(d => !['completed','archived','canceled'].includes(d.status));
    } else if (f.status === 'overdue') {
      list = list.filter(d => d._isOverdue);
    } else {
      list = list.filter(d => d.status === f.status);
    }
  } else {
    // Default: hide archived and canceled
    if (!f.showArchived) {
      list = list.filter(d => !d.isArchived && d.status !== 'canceled');
    }
  }

  // Priority
  if (f.priority) {
    list = list.filter(d => d.priority === f.priority);
  }

  return list;
}

// ─── Input Sanitization ──────────────────────────────────────────
function sanitizeDeadlineInput(data) {
  const out = { ...data };
  if (out.title)          out.title          = String(out.title).trim().slice(0, 200);
  if (out.description)    out.description    = String(out.description).trim().slice(0, 2000);
  if (out.notes)          out.notes          = String(out.notes).trim().slice(0, 5000);
  if (out.link)           out.link           = String(out.link).trim().slice(0, 500);
  if (out.progressPercent != null) out.progressPercent = clamp(Math.round(safeNum(out.progressPercent, 0)), 0, 100);
  if (out.postponeCount  != null) out.postponeCount  = Math.max(0, safeNum(out.postponeCount, 0));
  if (!Array.isArray(out.tags)) out.tags = [];
  if (!Array.isArray(out.subtasks)) out.subtasks = [];
  // Subtask sanitization
  out.subtasks = out.subtasks.map(s => ({
    id:     s.id || genId(),
    title:  String(s.title || '').trim().slice(0, 200),
    done:   !!s.done,
    weight: Math.max(0, safeNum(s.weight, 1)),
  })).filter(s => s.title);
  return out;
}

// ─── Auto-overdue Scan ───────────────────────────────────────────
// Call on app load to auto-flag newly overdue items
function scanAndFlagOverdue() {
  const deadlines = loadDeadlines();
  let changed = false;
  deadlines.forEach(d => {
    if (['completed','canceled','archived','overdue'].includes(d.status)) return;
    const daysLeft = daysFromToday(d.dueDate);
    if (daysLeft < 0) {
      d.status = 'overdue';
      d.updatedAt = nowISO();
      changed = true;
    }
  });
  if (changed) saveDeadlines(deadlines);
}

// ─── Recurring Deadline Generation ───────────────────────────────
function generateNextRecurrence(deadline) {
  const rule = deadline.recurringRule;
  if (!rule || !rule.enabled) return null;
  let nextDate = deadline.dueDate;
  switch (rule.type) {
    case 'daily':   nextDate = addDays(deadline.dueDate, safeNum(rule.interval, 1)); break;
    case 'weekly':  nextDate = addDays(deadline.dueDate, 7  * safeNum(rule.interval, 1)); break;
    case 'monthly': {
      const d = parseLocalDate(deadline.dueDate);
      if (!d) return null;
      d.setMonth(d.getMonth() + safeNum(rule.interval, 1));
      nextDate = _toIsoDate(d);
      break;
    }
    case 'yearly': {
      const d = parseLocalDate(deadline.dueDate);
      if (!d) return null;
      d.setFullYear(d.getFullYear() + safeNum(rule.interval, 1));
      nextDate = _toIsoDate(d);
      break;
    }
    default: return null;
  }
  if (rule.endDate && nextDate > rule.endDate) return null;
  return {
    ...deadline,
    id:             genId(),
    dueDate:        nextDate,
    status:         'not-started',
    progressPercent: 0,
    completedAt:    null,
    createdAt:      nowISO(),
    updatedAt:      nowISO(),
    subtasks:       (deadline.subtasks || []).map(s => ({ ...s, id: genId(), done: false })),
    postponeCount:  0,
    originalDueDate: null,
  };
}

// When a recurring deadline is completed, spawn the next occurrence
function completeAndRecur(id) {
  const deadlines = loadDeadlines();
  const d = deadlines.find(dl => dl.id === id);
  if (!d) return;
  const idx = deadlines.indexOf(d);
  deadlines[idx] = {
    ...d,
    status:         'completed',
    progressPercent: 100,
    completedAt:    nowISO(),
    updatedAt:      nowISO(),
  };
  const next = generateNextRecurrence(d);
  if (next) deadlines.push(next);
  saveDeadlines(deadlines);
}
