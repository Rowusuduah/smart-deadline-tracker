'use strict';
/* ═══════════════════════════════════════════════════════════════
   ui-dashboard.js — Renders the Dashboard tab.
═══════════════════════════════════════════════════════════════ */

function renderDashboard() {
  const sec = document.getElementById('sec-dashboard');
  if (!sec || !sec.classList.contains('on')) return;

  const settings = loadSettings();
  const deadlines = loadDeadlines();
  const stats = getDashboardStats(deadlines, settings);

  renderDashboardKPIs(stats);
  renderDashboardChainage(deadlines, settings);
  renderDashboardUrgentPanel(stats);
  renderDashboardAtRisk(stats);
  renderDashboardCategoryLoad(stats);
  renderDashboardDueToday(stats);
}

// ─── KPI Strip ───────────────────────────────────────────────────
function renderDashboardKPIs(stats) {
  const el = document.getElementById('dash-kpis');
  if (!el) return;
  el.innerHTML = [
    kpiCard('Active',    stats.totalActive,   '',        stats.totalActive === 0 ? 'var(--muted)' : 'var(--text)'),
    kpiCard('Overdue',   stats.overdueCount,  'need attention', stats.overdueCount > 0 ? 'var(--red)' : 'var(--text)'),
    kpiCard('Due Today', stats.dueTodayCount, 'items',   stats.dueTodayCount > 0 ? 'var(--orange)' : 'var(--text)'),
    kpiCard('This Week', stats.dueWeekCount,  'upcoming','var(--text)'),
    kpiCard('At Risk',   stats.atRiskCount,   '',        stats.atRiskCount > 0 ? 'var(--gold)' : 'var(--text)'),
    kpiCard('Completed', stats.completedCount,'total',   'var(--green)'),
  ].join('');
}

function kpiCard(label, value, sub, color) {
  return `<div class="kpi">
    <div class="kpi-label">${escapeHTML(label)}</div>
    <div class="kpi-value" style="color:${color}">${value}</div>
    ${sub ? `<div class="kpi-sub">${escapeHTML(sub)}</div>` : ''}
  </div>`;
}

// ─── Chainage strip ──────────────────────────────────────────────
// The next 30 days drawn like a surveyed centreline: today is station 0 and
// every open deadline is staked at its due date, so crowded weeks show up
// at a glance. Stakes share "lanes" (stake heights) so their flags never overlap.
const CHAINAGE_DAYS = 30;
const CHAINAGE_MAX_LANES = 6;

function renderDashboardChainage(deadlines, settings) {
  const el = document.getElementById('dash-chainage');
  if (!el) return;
  const today = todayISO();
  const open = deadlines
    .filter(d => !d.isArchived && !['archived', 'canceled', 'completed'].includes(d.status))
    .map(d => enrichDeadline(d, settings));
  const overdue  = open.filter(d => d._isOverdue);
  const later    = open.filter(d => d._daysLeft > CHAINAGE_DAYS);
  const upcoming = open
    .filter(d => d._daysLeft >= 0 && d._daysLeft <= CHAINAGE_DAYS)
    .sort((a, b) => a._daysLeft - b._daysLeft || b._urgencyScore - a._urgencyScore);

  // Pack flags into lanes by the pixels they actually cover: a flag runs right
  // of its stake, or left of it when it would run off the end of the line.
  const width = Math.max(240, (el.clientWidth || 640) - 16);
  const flagW = width < 520 ? 136 : 162;
  const lanes = [];                        // lanes[i] = occupied [start, end] px intervals
  const stakes = upcoming.map(d => {
    const x = (d._daysLeft / CHAINAGE_DAYS) * width;
    const flip = x + flagW > width;
    const span = flip ? [x - flagW, x] : [x, x + flagW];
    const fits = lane => lane.every(([a, b]) => span[1] + 6 <= a || span[0] >= b + 6);
    let lane = lanes.findIndex(fits);
    if (lane === -1 && lanes.length < CHAINAGE_MAX_LANES) { lanes.push([]); lane = lanes.length - 1; }
    if (lane === -1) lane = lanes.reduce((best, l, i) => (l.length < lanes[best].length ? i : best), 0);
    lanes[lane].push(span);
    return { d, lane, flip };
  });

  const ticks = Array.from({ length: CHAINAGE_DAYS + 1 }, (_, day) =>
    `<span class="ch-tick${day % 7 === 0 ? ' major' : ''}" style="left:${(day / CHAINAGE_DAYS) * 100}%"></span>`).join('');
  const scale = [0, 7, 14, 21, 28].map(day =>
    `<span class="ch-mark" style="left:${(day / CHAINAGE_DAYS) * 100}%">${day === 0 ? 'Today' : escapeHTML(formatDateShort(addDays(today, day)))}</span>`).join('');

  const flags = stakes.map(({ d, lane, flip }) => {
    const pct = (d._daysLeft / CHAINAGE_DAYS) * 100;
    // Same urgency bands as the Top Urgent cards; a critical risk always reads as "act now".
    const band = d._riskLevel === 'critical' || d._daysLeft <= 3 ? 'critical' : (d._daysLeft <= 7 ? 'warning' : 'safe');
    const when = formatRelativeDeadline(d._daysLeft);
    return `<button type="button" class="ch-stake risk-${band}${flip ? ' flip' : ''}"
        style="left:${pct}%;--lane:${lane}" data-action="view" data-id="${escapeHTML(d.id)}"
        aria-label="${escapeHTML(d.title)}, due ${escapeHTML(formatDateShort(d.dueDate))} (${escapeHTML(when)})">
      <span class="ch-flag"><b>${escapeHTML(truncate(d.title, 26))}</b><small>${escapeHTML(when)}</small></span>
    </button>`;
  }).join('');

  const notes = [];
  if (overdue.length) notes.push(`<button type="button" class="ch-note overdue" data-action="switch-tab" data-tab="tab-deadlines">${overdue.length} overdue behind today</button>`);
  if (later.length) notes.push(`<span class="ch-note">${later.length} more beyond ${CHAINAGE_DAYS} days</span>`);
  if (!upcoming.length) notes.unshift(`<span class="ch-note">Nothing due in the next ${CHAINAGE_DAYS} days.</span>`);

  el.innerHTML = `<div class="ch-field" style="--lanes:${Math.max(1, lanes.length)}">${flags}</div>
    <div class="ch-line" aria-hidden="true">${ticks}<span class="ch-today"></span></div>
    <div class="ch-scale" aria-hidden="true">${scale}</div>
    ${notes.length ? `<div class="ch-notes">${notes.join('')}</div>` : ''}`;
}

// Stake lanes depend on the strip's width, so re-plot after the viewport settles.
window.addEventListener('resize', debounce(() => {
  const sec = document.getElementById('sec-dashboard');
  if (sec && sec.classList.contains('on')) renderDashboardChainage(loadDeadlines(), loadSettings());
}, 250));

// ─── Top Urgent Panel ────────────────────────────────────────────
function renderDashboardUrgentPanel(stats) {
  const el = document.getElementById('dash-urgent');
  if (!el) return;

  if (!stats.topUrgent.length) {
    el.innerHTML = emptyState('🎉', 'Nothing urgent right now. Great job!');
    return;
  }

  el.innerHTML = stats.topUrgent.map(d => urgentCard(d)).join('');
}

function urgentCard(d) {
  const color     = safeColor(d._urgencyColor);
  const daysLabel = formatRelativeDeadline(d._daysLeft);
  const riskBadge = riskBadgeHtml(d._riskLevel);
  const health    = healthDot(d._healthStatus);
  const catLabel  = escapeHTML(d.category || 'personal');
  const startMsg  = startStatusMessage(d._startStatus);

  return `<div class="deadline-card" data-id="${escapeHTML(d.id)}" style="border-left:3px solid ${color}">
    <div class="dc-header">
      <div class="dc-title-row">
        ${health}
        <span class="dc-title" title="${escapeHTML(d.title)}">${escapeHTML(truncate(d.title, 55))}</span>
        ${d.isPinned ? '<span class="pin-icon" title="Pinned">📌</span>' : ''}
      </div>
      <div class="dc-meta">
        <span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}44">${escapeHTML(daysLabel)}</span>
        ${riskBadge}
        <span class="cat-badge">${catLabel}</span>
      </div>
    </div>
    ${progressBar(d._progress, color)}
    <div class="dc-footer">
      <span class="start-msg ${d._startStatus}">${escapeHTML(startMsg)}</span>
      <div class="dc-actions">
        <button class="icon-btn" data-action="view"   data-id="${escapeHTML(d.id)}" title="View details">↗</button>
        <button class="icon-btn" data-action="complete" data-id="${escapeHTML(d.id)}" title="Mark complete">✓</button>
      </div>
    </div>
  </div>`;
}

// ─── At-Risk Panel ───────────────────────────────────────────────
function renderDashboardAtRisk(stats) {
  const el = document.getElementById('dash-at-risk');
  if (!el) return;

  if (!stats.atRisk.length) {
    el.innerHTML = `<p class="text-muted" style="font-size:.85rem;padding:8px 0">No at-risk items. Keep it up!</p>`;
    return;
  }

  el.innerHTML = `<div class="risk-list">` +
    stats.atRisk.slice(0, 6).map(d => {
      const color = d._urgencyColor;
      const risk  = d._riskLevel;
      return `<div class="risk-row" data-id="${escapeHTML(d.id)}">
        <span class="risk-dot risk-${risk}"></span>
        <span class="risk-title">${escapeHTML(truncate(d.title, 40))}</span>
        <span class="risk-due">${formatDateShort(d.dueDate)}</span>
        <span class="risk-badge risk-badge-${risk}">${risk}</span>
      </div>`;
    }).join('') + '</div>';
}

// ─── Category Distribution ───────────────────────────────────────
function renderDashboardCategoryLoad(stats) {
  const el = document.getElementById('dash-cat-load');
  if (!el) return;
  const dist  = stats.categoryDistribution;
  const total = Object.values(dist).reduce((a, b) => a + b, 0);
  if (total === 0) { el.innerHTML = ''; return; }

  const cats     = loadCategories();
  const sorted   = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 8);

  el.innerHTML = sorted.map(([catId, count]) => {
    const cat   = cats.find(c => c.id === catId) || { name: catId, color: 'var(--muted)' };
    const catColor = safeColor(cat.color, 'var(--muted)');
    const pct   = Math.round((count / total) * 100);
    return `<div class="cat-row">
      <span class="cat-dot" style="background:${catColor}"></span>
      <span class="cat-name">${escapeHTML(cat.name)}</span>
      <div class="cat-bar-wrap">
        <div class="cat-bar" style="width:${pct}%;background:${catColor}44;border-right:2px solid ${catColor}"></div>
      </div>
      <span class="cat-count">${count}</span>
    </div>`;
  }).join('');
}

// ─── Due Today List ──────────────────────────────────────────────
function renderDashboardDueToday(stats) {
  const el = document.getElementById('dash-due-today');
  if (!el) return;
  const list = [...stats.dueToday, ...stats.overdue].slice(0, 8);
  if (!list.length) {
    el.innerHTML = `<p class="text-muted" style="font-size:.85rem;padding:8px 0">Nothing due today. You're ahead!</p>`;
    return;
  }
  el.innerHTML = `<div class="due-today-list">` +
    list.map(d => {
      const color = safeColor(d._urgencyColor);
      return `<div class="due-row" data-id="${escapeHTML(d.id)}">
        <span class="due-dot" style="background:${color}"></span>
        <div class="due-info">
          <span class="due-title">${escapeHTML(truncate(d.title, 42))}</span>
          <span class="due-cat text-muted">${escapeHTML(d.category || '')}</span>
        </div>
        <div class="due-right">
          ${d._isOverdue
            ? `<span class="badge badge-red">Overdue</span>`
            : `<span style="font-size:11px;color:var(--orange)">Due today</span>`}
          <button class="icon-btn sm" data-action="complete" data-id="${escapeHTML(d.id)}" title="Mark done">✓</button>
        </div>
      </div>`;
    }).join('') + '</div>';
}

// ─── Shared Helpers ──────────────────────────────────────────────
function progressBar(pct, color) {
  return `<div class="progress-wrap" style="margin:6px 0 4px">
    <div class="progress-bar" style="width:${pct}%;background:${color || 'var(--green)'}"></div>
  </div>
  <div style="font-size:10px;color:var(--muted);text-align:right">${pct}% complete</div>`;
}

function riskBadgeHtml(riskLevel) {
  if (riskLevel === 'safe') return '';
  const map = { warning: '#fbbf24', critical: '#f87171' };
  const color = map[riskLevel] || 'var(--muted)';
  return `<span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}44">${riskLevel}</span>`;
}

function healthDot(healthStatus) {
  const colors = {
    'on-track': 'var(--green)',
    'at-risk':  'var(--gold)',
    'critical': 'var(--red)',
    'overdue':  'var(--red)',
    'completed':'var(--muted)',
  };
  return `<span class="health-dot" style="background:${colors[healthStatus] || 'var(--muted)'}" title="${healthStatus}"></span>`;
}

function startStatusMessage(status) {
  switch (status) {
    case 'behind':     return '⚠ Already behind — start immediately';
    case 'start-today':return '▶ Start today to stay on track';
    case 'start-soon': return '⏱ Start within 2 days';
    case 'safe':       return '✓ Safe to plan ahead';
    case 'completed':  return '✓ Completed';
    default:           return '';
  }
}

function emptyState(icon, message) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><p>${escapeHTML(message)}</p></div>`;
}
