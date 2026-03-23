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
  renderDashboardUrgentPanel(stats);
  renderDashboardAtRisk(stats);
  renderDashboardWorkload(stats, settings);
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
  const color     = d._urgencyColor;
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
    ${d.estimatedHours > 0 ? progressBar(d._progress, color) : ''}
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

// ─── Workload Panel ──────────────────────────────────────────────
function renderDashboardWorkload(stats, settings) {
  const el = document.getElementById('dash-workload');
  if (!el) return;

  const wph         = safeNum(settings.workHoursPerDay, 6);
  const todayLoad   = stats.workloadToday;
  const weekLoad    = stats.workloadWeek;
  const todayPct    = Math.min(100, Math.round((todayLoad / wph) * 100));
  const weekHours   = wph * 5;
  const weekPct     = Math.min(100, Math.round((weekLoad / weekHours) * 100));
  const todayColor  = todayPct >= 100 ? 'var(--red)' : todayPct >= 75 ? 'var(--orange)' : 'var(--green)';
  const weekColor   = weekPct  >= 100 ? 'var(--red)' : weekPct  >= 75 ? 'var(--orange)' : 'var(--blue)';

  el.innerHTML = `
    <div class="workload-row">
      <div class="workload-label">Today</div>
      <div class="workload-bar-wrap">
        <div class="workload-bar" style="width:${todayPct}%;background:${todayColor}"></div>
      </div>
      <div class="workload-val" style="color:${todayColor}">${formatHours(todayLoad)}</div>
    </div>
    <div class="workload-row" style="margin-top:10px">
      <div class="workload-label">This Week</div>
      <div class="workload-bar-wrap">
        <div class="workload-bar" style="width:${weekPct}%;background:${weekColor}"></div>
      </div>
      <div class="workload-val" style="color:${weekColor}">${formatHours(weekLoad)}</div>
    </div>
    ${todayPct >= 100
      ? '<p class="workload-warning">⚠ Today is overloaded — consider deferring a task.</p>'
      : ''}
  `;
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
    const pct   = Math.round((count / total) * 100);
    return `<div class="cat-row">
      <span class="cat-dot" style="background:${cat.color}"></span>
      <span class="cat-name">${escapeHTML(cat.name)}</span>
      <div class="cat-bar-wrap">
        <div class="cat-bar" style="width:${pct}%;background:${cat.color}44;border-right:2px solid ${cat.color}"></div>
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
      const color = d._urgencyColor;
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
