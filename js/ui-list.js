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
    const hasOpenList = rawList.some(d => !d.isArchived && d.status !== 'archived');
    el.innerHTML = hasOpenList
      ? `<div class="list-empty"><div class="list-empty-mark" aria-hidden="true">⌕</div><h2>Nothing matches these filters</h2><p>Try another search or show all deadlines.</p><button type="button" class="btn btn-ghost" id="list-clear-filters">Show all deadlines</button></div>`
      : rawList.length
        ? `<div class="list-empty"><div class="list-empty-mark" aria-hidden="true">✓</div><h2>No open deadlines</h2><p>Your previous work is still here if you need it.</p><button type="button" class="btn btn-ghost" id="list-show-archived-btn">See archived deadlines</button><button type="button" class="btn btn-green" id="list-empty-add">Add a deadline</button></div>`
        : `<div class="list-empty"><div class="list-empty-mark" aria-hidden="true">✓</div><h2>A clear place to begin</h2><p>Add your first deadline with a name and due date. You can plan the rest later.</p><button type="button" class="btn btn-green" id="list-empty-add">Add a deadline</button></div>`;
    return;
  }

  // Closed work belongs in one group, regardless of its old due date.
  const closed     = sorted.filter(d => d.isArchived || ['archived', 'canceled'].includes(d.status));
  const live       = sorted.filter(d => !d.isArchived && !['archived', 'canceled'].includes(d.status));
  const overdue    = live.filter(d => d._isOverdue);
  const today      = live.filter(d => !d._isOverdue && d.dueDate === todayISO() && d.status !== 'completed');
  const upcoming   = live.filter(d => !d._isOverdue && d.dueDate !== todayISO() && d.status !== 'completed');
  const completed  = live.filter(d => d.status === 'completed');

  let html = '';
  if (overdue.length)   html += groupSection('Overdue', overdue, f.viewMode);
  if (today.length)     html += groupSection('Due Today', today, f.viewMode);
  if (upcoming.length)  html += groupSection('Upcoming', upcoming, f.viewMode);
  if (completed.length) html += groupSection('Completed', completed, f.viewMode);
  if (closed.length && f.showArchived) html += groupSection('Archived or canceled', closed, f.viewMode);

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
  const color   = safeColor(d._urgencyColor);
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
  const color   = safeColor(d._urgencyColor);
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
  if (f.category) badges.push(`<button type="button" class="filter-chip" data-clear="category" aria-label="Clear category filter">Category: ${escapeHTML(f.category)} ×</button>`);
  if (f.status)   badges.push(`<button type="button" class="filter-chip" data-clear="status" aria-label="Clear status filter">Status: ${escapeHTML(f.status)} ×</button>`);
  if (f.priority) badges.push(`<button type="button" class="filter-chip" data-clear="priority" aria-label="Clear priority filter">Priority: ${escapeHTML(f.priority)} ×</button>`);
  if (f.showArchived) badges.push(`<button type="button" class="filter-chip" data-clear="showArchived" aria-label="Hide archived deadlines">Showing archived ×</button>`);
  el.innerHTML = badges.join('');
}

// ─── Badge Helpers ───────────────────────────────────────────────
// Priority and status badges take their colours from the theme (styles.css
// .prio-* / .st-*), so they stay readable in light and dark mode.
function priorityBadge(priority) {
  const p = ['critical', 'high', 'medium', 'low'].includes(priority) ? priority : 'medium';
  return `<span class="badge prio prio-${p}">${escapeHTML(priority || 'medium')}</span>`;
}

function statusBadge(status, isOverdue) {
  if (isOverdue) return `<span class="badge badge-red">Overdue</span>`;
  const known = ['not-started', 'planned', 'in-progress', 'at-risk', 'overdue', 'completed', 'paused', 'canceled'];
  const s = known.includes(status) ? status : 'not-started';
  return `<span class="badge st st-${s}">${escapeHTML(status || 'not-started')}</span>`;
}
