'use strict';
/* ═══════════════════════════════════════════════════════════════
   ui-list.js — Renders the All Deadlines tab (list, filter, sort,
   search, bulk actions, compact/detailed modes).
═══════════════════════════════════════════════════════════════ */

function renderListTab() {
  const sec = document.getElementById('sec-deadlines');
  if (!sec || !sec.classList.contains('on')) return;
  renderListItems();
}

function renderListItems() {
  const el = document.getElementById('deadlines-list');
  if (!el) return;

  const settings  = loadSettings();
  const f         = AppState.list;
  const rawList   = loadDeadlines().map(d => enrichDeadline(d, settings));
  const filtered  = filterDeadlines(rawList, {
    search:       f.search,
    category:     f.category,
    status:       f.status,
    priority:     f.priority,
    showArchived: f.showArchived,
  });
  const sorted = sortDeadlines(filtered, f.sort);

  if (!sorted.length) {
    el.innerHTML = emptyState('📋', f.search ? 'No deadlines match your search.' : 'No deadlines yet. Add one above!');
    return;
  }

  // Group by: overdue → today → upcoming
  const overdue    = sorted.filter(d => d._isOverdue);
  const today      = sorted.filter(d => !d._isOverdue && d.dueDate === todayISO() && d.status !== 'completed');
  const upcoming   = sorted.filter(d => !d._isOverdue && d.dueDate !== todayISO() && d.status !== 'completed');
  const completed  = sorted.filter(d => d.status === 'completed');
  const archived   = sorted.filter(d => d.isArchived || d.status === 'archived');

  let html = '';
  if (overdue.length)   html += groupSection('Overdue', overdue, f.viewMode);
  if (today.length)     html += groupSection('Due Today', today, f.viewMode);
  if (upcoming.length)  html += groupSection('Upcoming', upcoming, f.viewMode);
  if (completed.length) html += groupSection('Completed', completed, f.viewMode);
  if (archived.length && f.showArchived) html += groupSection('Archived', archived, f.viewMode);

  el.innerHTML = html;

  // Restore selection visual
  f.selected.forEach(id => {
    const row = el.querySelector(`[data-id="${id}"]`);
    if (row) row.classList.add('selected');
  });
}

function groupSection(title, items, viewMode) {
  const rows = items.map(d => viewMode === 'detailed' ? detailedRow(d) : compactRow(d)).join('');
  return `<div class="list-group">
    <div class="list-group-header">${escapeHTML(title)} <span class="list-group-count">${items.length}</span></div>
    ${rows}
  </div>`;
}

// ─── Compact Row ─────────────────────────────────────────────────
function compactRow(d) {
  const color   = d._urgencyColor;
  const checked = AppState.list.selected.has(d.id);
  return `<div class="list-row compact ${checked ? 'selected' : ''}" data-id="${escapeHTML(d.id)}">
    <input type="checkbox" class="row-check" data-id="${escapeHTML(d.id)}" ${checked ? 'checked' : ''} aria-label="Select ${escapeHTML(d.title)}">
    <span class="row-dot" style="background:${color}"></span>
    <div class="row-main">
      <span class="row-title ${d.status === 'completed' ? 'strikethrough' : ''}">${escapeHTML(truncate(d.title, 60))}</span>
      <div class="row-meta">
        <span class="meta-cat">${escapeHTML(d.category || '')}</span>
        ${priorityBadge(d.priority)}
        ${statusBadge(d.status, d._isOverdue)}
      </div>
    </div>
    <div class="row-right">
      <span class="row-due ${d._isOverdue ? 'text-red' : ''}" title="${formatDate(d.dueDate)}">
        ${d._isOverdue
          ? `${Math.abs(d._daysLeft)}d ago`
          : d._daysLeft === 0 ? 'Today'
          : d._daysLeft === 1 ? 'Tomorrow'
          : `${d._daysLeft}d`}
      </span>
      <div class="row-actions">
        <button class="icon-btn sm" data-action="view"     data-id="${escapeHTML(d.id)}" title="View">↗</button>
        <button class="icon-btn sm" data-action="edit"     data-id="${escapeHTML(d.id)}" title="Edit">✎</button>
        <button class="icon-btn sm" data-action="complete" data-id="${escapeHTML(d.id)}" title="Complete" ${d.status === 'completed' ? 'disabled' : ''}>✓</button>
        <button class="icon-btn sm" data-action="delete"   data-id="${escapeHTML(d.id)}" title="Delete">✕</button>
      </div>
    </div>
  </div>`;
}

// ─── Detailed Row ────────────────────────────────────────────────
function detailedRow(d) {
  const color   = d._urgencyColor;
  const checked = AppState.list.selected.has(d.id);
  const prog    = d._progress;
  return `<div class="list-row detailed ${checked ? 'selected' : ''}" data-id="${escapeHTML(d.id)}" style="border-left:3px solid ${color}">
    <div class="detailed-top">
      <input type="checkbox" class="row-check" data-id="${escapeHTML(d.id)}" ${checked ? 'checked' : ''} aria-label="Select ${escapeHTML(d.title)}">
      <div class="detailed-main">
        <div class="detailed-title-row">
          ${healthDot(d._healthStatus)}
          <span class="row-title ${d.status === 'completed' ? 'strikethrough' : ''}">${escapeHTML(d.title)}</span>
          ${d.isPinned ? '<span class="pin-icon">📌</span>' : ''}
        </div>
        <div class="row-meta" style="margin-top:4px">
          <span class="meta-cat">${escapeHTML(d.category || '')}</span>
          ${priorityBadge(d.priority)}
          ${statusBadge(d.status, d._isOverdue)}
          ${riskBadgeHtml(d._riskLevel)}
          ${(d.tags || []).slice(0, 3).map(t => `<span class="tag-chip">#${escapeHTML(t)}</span>`).join('')}
        </div>
        ${d.description ? `<p class="detailed-desc">${escapeHTML(truncate(d.description, 120))}</p>` : ''}
      </div>
      <div class="detailed-right">
        <div class="detailed-due ${d._isOverdue ? 'text-red' : ''}">${formatDate(d.dueDate)}</div>
        ${d.dueTime ? `<div class="detailed-time">${formatTime(d.dueTime)}</div>` : ''}
        <div class="detailed-relative">${formatRelativeDeadline(d._daysLeft)}</div>
      </div>
    </div>
    <div class="progress-wrap" style="margin:4px 0">
      <div class="progress-bar" style="width:${prog}%;background:${color}"></div>
    </div>
    <div class="detailed-actions">
      <button class="btn btn-ghost btn-sm" data-action="view"      data-id="${escapeHTML(d.id)}">View</button>
      <button class="btn btn-ghost btn-sm" data-action="edit"      data-id="${escapeHTML(d.id)}">Edit</button>
      <button class="btn btn-ghost btn-sm" data-action="duplicate" data-id="${escapeHTML(d.id)}">Duplicate</button>
      ${d.status !== 'completed'
        ? `<button class="btn btn-ghost btn-sm" data-action="complete" data-id="${escapeHTML(d.id)}">Complete</button>`
        : ''}
      <button class="btn btn-ghost btn-sm" data-action="archive"   data-id="${escapeHTML(d.id)}">Archive</button>
      <button class="btn btn-ghost btn-sm text-red" data-action="delete" data-id="${escapeHTML(d.id)}">Delete</button>
    </div>
  </div>`;
}

// ─── Bulk Action Bar ─────────────────────────────────────────────
function renderBulkBar() {
  const el = document.getElementById('bulk-bar');
  if (!el) return;
  const count = AppState.list.selected.size;
  if (count === 0) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  const countEl = el.querySelector('#bulk-count');
  if (countEl) countEl.textContent = `${count} selected`;
}

// ─── Filter Badges ───────────────────────────────────────────────
function renderActiveFilters() {
  const el = document.getElementById('active-filters');
  if (!el) return;
  const f = AppState.list;
  const badges = [];
  if (f.category) badges.push(`<span class="filter-chip" data-clear="category">Category: ${escapeHTML(f.category)} ×</span>`);
  if (f.status)   badges.push(`<span class="filter-chip" data-clear="status">Status: ${escapeHTML(f.status)} ×</span>`);
  if (f.priority) badges.push(`<span class="filter-chip" data-clear="priority">Priority: ${escapeHTML(f.priority)} ×</span>`);
  if (f.showArchived) badges.push(`<span class="filter-chip" data-clear="showArchived">Showing archived ×</span>`);
  el.innerHTML = badges.join('');
}

// ─── Badge Helpers ───────────────────────────────────────────────
function priorityBadge(priority) {
  const map = {
    critical: '#f87171',
    high:     '#fb923c',
    medium:   '#fbbf24',
    low:      '#6b7280',
  };
  const color = map[priority] || 'var(--muted)';
  return `<span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}44">${escapeHTML(priority || 'medium')}</span>`;
}

function statusBadge(status, isOverdue) {
  if (isOverdue) return `<span class="badge badge-red">Overdue</span>`;
  const map = {
    'not-started': ['var(--muted)', '#3f3f4e'],
    'planned':     ['var(--blue)', '#1e3a5f'],
    'in-progress': ['var(--teal)', '#0f3535'],
    'at-risk':     ['var(--gold)', '#3f3000'],
    'overdue':     ['var(--red)', '#3f0000'],
    'completed':   ['var(--green)', '#0a2f0a'],
    'paused':      ['var(--muted)', '#2a2a3a'],
    'canceled':    ['#6b7280', '#222'],
  };
  const [fg, bg] = map[status] || ['var(--muted)', 'transparent'];
  return `<span class="badge" style="color:${fg};background:${bg}">${escapeHTML(status || 'not-started')}</span>`;
}
