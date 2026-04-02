'use strict';
/* ═══════════════════════════════════════════════════════════════
   ui-timeline.js — Future timeline view, grouped by week/month.
═══════════════════════════════════════════════════════════════ */

function renderTimelineTab() {
  const sec = document.getElementById('sec-timeline');
  if (!sec || !sec.classList.contains('on')) return;
  renderTimeline();
}

function renderTimeline() {
  const el = document.getElementById('timeline-content');
  if (!el) return;

  const settings  = loadSettings();
  const groupBy   = AppState.timeline.groupBy;
  const today     = todayISO();

  // Collect non-archived, non-canceled active and future deadlines
  const deadlines = loadDeadlines()
    .map(d => enrichDeadline(d, settings))
    .filter(d => !['archived','canceled'].includes(d.status) && d.dueDate >= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  // Also include overdue items at top
  const overdue = loadDeadlines()
    .map(d => enrichDeadline(d, settings))
    .filter(d => d._isOverdue)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  if (!deadlines.length && !overdue.length) {
    el.innerHTML = emptyState('🗓️', 'No upcoming deadlines. Add one to start planning!');
    return;
  }

  let html = '';

  // Overdue section
  if (overdue.length) {
    html += `<div class="tl-section">
      <div class="tl-group-header overdue-header">
        <span class="tl-group-icon">⚠</span>
        <span>Overdue — ${overdue.length} item${overdue.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="tl-group-items">
        ${overdue.map(d => timelineCard(d, true)).join('')}
      </div>
    </div>`;
  }

  // Group remaining by week or month
  const groups = groupBy === 'week'
    ? groupDeadlinesByWeek(deadlines)
    : groupDeadlinesByMonth(deadlines);

  groups.forEach(g => {
    html += `<div class="tl-section">
      <div class="tl-group-header">
        <span class="tl-group-icon">📅</span>
        <span>${escapeHTML(g.label)}</span>
        <span class="tl-group-count">${g.items.length}</span>
      </div>
      <div class="tl-group-items">
        ${g.items.map(d => timelineCard(d, false)).join('')}
      </div>
    </div>`;
  });

  el.innerHTML = html;
}

// ─── Grouping Logic ──────────────────────────────────────────────
function groupDeadlinesByWeek(deadlines) {
  const groups = [];
  const seen   = new Map();

  deadlines.forEach(d => {
    const due  = parseLocalDate(d.dueDate);
    if (!due) return;
    // Week starts on the same day as the dueDate's Monday
    const monday = new Date(due);
    const dayOfWeek = monday.getDay();
    monday.setDate(monday.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    const key = _toIsoDate(monday);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);

    if (!seen.has(key)) {
      const label = isCurrentWeek(monday)
        ? 'This Week'
        : isNextWeek(monday)
          ? 'Next Week'
          : `${formatDateShort(_toIsoDate(monday))} – ${formatDateShort(_toIsoDate(sunday))}`;
      seen.set(key, { label, items: [] });
      groups.push(seen.get(key));
    }
    seen.get(key).items.push(d);
  });

  return groups;
}

function groupDeadlinesByMonth(deadlines) {
  const groups = [];
  const seen   = new Map();
  const today  = new Date();

  deadlines.forEach(d => {
    const due = parseLocalDate(d.dueDate);
    if (!due) return;
    const key = `${due.getFullYear()}-${due.getMonth()}`;
    if (!seen.has(key)) {
      let label;
      if (due.getFullYear() === today.getFullYear() && due.getMonth() === today.getMonth()) {
        label = 'This Month';
      } else if (due.getFullYear() === today.getFullYear() && due.getMonth() === today.getMonth() + 1) {
        label = 'Next Month';
      } else {
        label = `${MONTH_NAMES[due.getMonth()]} ${due.getFullYear()}`;
      }
      seen.set(key, { label, items: [] });
      groups.push(seen.get(key));
    }
    seen.get(key).items.push(d);
  });

  return groups;
}

function isCurrentWeek(monday) {
  const today = new Date();
  const curMonday = new Date(today);
  const dow = today.getDay();
  curMonday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  return _toIsoDate(monday) === _toIsoDate(curMonday);
}

function isNextWeek(monday) {
  const nextMonday = new Date();
  const dow = nextMonday.getDay();
  nextMonday.setDate(nextMonday.getDate() - (dow === 0 ? 6 : dow - 1) + 7);
  return _toIsoDate(monday) === _toIsoDate(nextMonday);
}

// ─── Timeline Card ───────────────────────────────────────────────
function timelineCard(d, isOverdueSection) {
  const color    = d._urgencyColor;
  const daysLabel = formatRelativeDeadline(d._daysLeft);
  const prog     = d._progress;

  return `<div class="tl-card" data-id="${escapeHTML(d.id)}" style="border-left:3px solid ${color}">
    <div class="tl-card-main">
      <div class="tl-card-header">
        ${healthDot(d._healthStatus)}
        <span class="tl-card-title">${escapeHTML(d.title)}</span>
        <div class="tl-card-badges">
          ${priorityBadge(d.priority)}
          ${riskBadgeHtml(d._riskLevel)}
        </div>
      </div>
      <div class="tl-card-meta">
        <span class="meta-cat">${escapeHTML(d.category || '')}</span>
        <span class="tl-due-date" style="color:${color}">${formatDate(d.dueDate)}${d.dueTime ? ' · ' + formatTime(d.dueTime) : ''}</span>
        <span class="tl-relative" style="color:${isOverdueSection ? 'var(--red)' : color}">${daysLabel}</span>
      </div>
      <div class="progress-wrap" style="margin-top:4px">
        <div class="progress-bar" style="width:${prog}%;background:${color}"></div>
      </div>
    </div>
    <div class="tl-card-actions">
      <button class="icon-btn sm" data-action="view"     data-id="${escapeHTML(d.id)}" title="View">↗</button>
      <button class="icon-btn sm" data-action="edit"     data-id="${escapeHTML(d.id)}" title="Edit">✎</button>
      <button class="icon-btn sm" data-action="complete" data-id="${escapeHTML(d.id)}" title="Complete">✓</button>
    </div>
  </div>`;
}
