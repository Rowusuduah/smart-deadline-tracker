'use strict';
/* ═══════════════════════════════════════════════════════════════
   ui-analytics.js — Analytics tab: trends, charts, insights.
   Uses inline SVG bar charts (no external libraries).
═══════════════════════════════════════════════════════════════ */

function renderAnalyticsTab() {
  const sec = document.getElementById('sec-analytics');
  if (!sec || !sec.classList.contains('on')) return;
  renderAnalytics();
}

function renderAnalytics() {
  const settings  = loadSettings();
  const deadlines = loadDeadlines();
  const period    = parseInt(AppState.analytics.period, 10) || 30;

  renderAnalyticsKPIs(deadlines, settings);
  renderCompletionTrendChart(deadlines, period);
  renderCategoryAnalysis(deadlines, settings);
  renderProcrastinationInsights(deadlines);
}

// ─── Analytics KPIs ─────────────────────────────────────────────
function renderAnalyticsKPIs(deadlines, settings) {
  const el = document.getElementById('analytics-kpis');
  if (!el) return;

  const completed  = deadlines.filter(d => d.status === 'completed');
  const total      = deadlines.filter(d => d.status !== 'archived');
  const onTime     = completed.filter(d => d.completedAt && d.dueDate && d.completedAt.slice(0,10) <= d.dueDate);
  const late       = completed.filter(d => d.completedAt && d.dueDate && d.completedAt.slice(0,10) > d.dueDate);
  const onTimeRate = completed.length > 0 ? Math.round((onTime.length / completed.length) * 100) : null;

  // Average delay for late completions (days between completedAt and dueDate)
  let avgDelay = null;
  if (late.length > 0) {
    const totalDelay = late.reduce((sum, d) => {
      const completedDate = parseLocalDate(d.completedAt.slice(0, 10));
      const dueDate       = parseLocalDate(d.dueDate);
      if (completedDate && dueDate) {
        return sum + Math.max(0, Math.round((completedDate.getTime() - dueDate.getTime()) / 86400000));
      }
      return sum;
    }, 0);
    avgDelay = round(totalDelay / late.length, 1);
  }

  // Postponement count
  const totalPostpones = deadlines.reduce((sum, d) => sum + safeNum(d.postponeCount, 0), 0);

  el.innerHTML = [
    kpiCard('Completed', completed.length, 'all time', 'var(--green)'),
    kpiCard('On Time', onTimeRate !== null ? `${onTimeRate}%` : '—', `${onTime.length} on time`, onTimeRate >= 80 ? 'var(--green)' : onTimeRate >= 60 ? 'var(--gold)' : 'var(--red)'),
    kpiCard('Late', late.length, 'completions', late.length > 0 ? 'var(--red)' : 'var(--muted)'),
    kpiCard('Avg Delay', avgDelay !== null ? `${avgDelay}d` : '—', 'when late', 'var(--orange)'),
    kpiCard('Postponed', totalPostpones, 'total pushbacks', totalPostpones > 0 ? 'var(--gold)' : 'var(--muted)'),
    kpiCard('Total', total.length, 'ever added', 'var(--text)'),
  ].join('');
}

// ─── Completion Trend Chart ──────────────────────────────────────
function renderCompletionTrendChart(deadlines, period) {
  const el = document.getElementById('analytics-trend-chart');
  if (!el) return;

  const trend = getCompletionTrend(deadlines, period);
  const maxVal = Math.max(1, ...trend.map(t => Math.max(t.completed, t.added)));

  // Show last 14 bars if period=30 to avoid crowding
  const display = period > 14 ? trend.filter((_, i) => i % 2 === 1) : trend;

  const barW = Math.floor(280 / Math.max(display.length, 1));
  const chartH = 80;

  const bars = display.map((t, i) => {
    const cH  = Math.round((t.completed / maxVal) * chartH);
    const aH  = Math.round((t.added / maxVal) * chartH);
    const x   = i * (barW + 2);
    return `
      <rect x="${x}" y="${chartH - aH}"   width="${barW - 2}" height="${aH}"  fill="var(--blue)"  opacity="0.5" rx="2"><title>${t.date}: ${t.added} added</title></rect>
      <rect x="${x}" y="${chartH - cH}"   width="${barW - 2}" height="${cH}"  fill="var(--green)" opacity="0.9" rx="2"><title>${t.date}: ${t.completed} completed</title></rect>
    `;
  }).join('');

  const svgW = display.length * (barW + 2);
  el.innerHTML = `
    <div class="chart-wrap">
      <svg width="${svgW}" height="${chartH}" viewBox="0 0 ${svgW} ${chartH}" style="overflow:visible">
        ${bars}
      </svg>
      <div class="chart-legend">
        <span><span style="display:inline-block;width:10px;height:10px;background:var(--green);border-radius:2px;margin-right:4px"></span>Completed</span>
        <span style="margin-left:12px"><span style="display:inline-block;width:10px;height:10px;background:var(--blue);opacity:.7;border-radius:2px;margin-right:4px"></span>Added</span>
      </div>
      <p style="font-size:.8rem;color:var(--muted);margin-top:4px">Last ${period} days</p>
    </div>
  `;
}

// ─── Category Analysis ───────────────────────────────────────────
function renderCategoryAnalysis(deadlines, settings) {
  const el = document.getElementById('analytics-categories');
  if (!el) return;

  const cats   = loadCategories();
  const catMap = {};
  deadlines.forEach(d => {
    if (['archived','canceled'].includes(d.status)) return;
    const cat = d.category || 'personal';
    if (!catMap[cat]) catMap[cat] = { total: 0, completed: 0, overdue: 0, active: 0 };
    catMap[cat].total++;
    if (d.status === 'completed') catMap[cat].completed++;
    else {
      catMap[cat].active++;
      const enriched = enrichDeadline(d, settings);
      if (enriched._isOverdue) catMap[cat].overdue++;
    }
  });

  const sorted = Object.entries(catMap).sort((a, b) => b[1].total - a[1].total);
  if (!sorted.length) { el.innerHTML = '<p class="text-muted">No data yet.</p>'; return; }

  el.innerHTML = `<table class="analytics-table">
    <thead><tr>
      <th>Category</th><th>Total</th><th>Active</th><th>Completed</th><th>Overdue</th>
    </tr></thead>
    <tbody>
      ${sorted.map(([catId, data]) => {
        const cat = cats.find(c => c.id === catId) || { name: catId, color: 'var(--muted)' };
        return `<tr>
          <td><span class="cat-dot" style="background:${safeColor(cat.color, 'var(--muted)')}"></span> ${escapeHTML(cat.name)}</td>
          <td>${data.total}</td>
          <td>${data.active}</td>
          <td style="color:var(--green)">${data.completed}</td>
          <td style="color:${data.overdue > 0 ? 'var(--red)' : 'var(--muted)'}">${data.overdue}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

// ─── Procrastination Insights ────────────────────────────────────
function renderProcrastinationInsights(deadlines) {
  const el = document.getElementById('analytics-procrastination');
  if (!el) return;

  const insights = getProcrastinationInsights(deadlines);
  const rows = [];

  rows.push(insightRow('Average Postponements per Item',
    insights.avgPostponeCount !== null ? `${insights.avgPostponeCount}` : '—',
    insights.avgPostponeCount >= 2 ? 'red' : insights.avgPostponeCount >= 1 ? 'gold' : 'green',
    insights.avgPostponeCount >= 2 ? 'High delay tendency detected' : 'Good discipline'
  ));

  rows.push(insightRow('Overdue Rate',
    insights.overdueRate !== null ? `${insights.overdueRate}%` : '—',
    insights.overdueRate > 30 ? 'red' : insights.overdueRate > 15 ? 'gold' : 'green',
    insights.overdueRate > 30 ? 'Many deadlines are completed late' : 'Within acceptable range'
  ));

  // Most overdue category
  const catOverdue = insights.catOverdue;
  const catTotal   = insights.catTotal;
  let worstCat = null;
  let worstRate = 0;
  Object.entries(catOverdue).forEach(([cat, count]) => {
    const total = catTotal[cat] || 1;
    const rate  = count / total;
    if (rate > worstRate && total >= 2) { worstRate = rate; worstCat = cat; }
  });
  if (worstCat) {
    rows.push(insightRow('Most Neglected Category', escapeHTML(worstCat),
      worstRate > 0.5 ? 'red' : 'gold',
      `${Math.round(worstRate * 100)}% of items overdue or late`
    ));
  }

  el.innerHTML = rows.length
    ? `<div class="insights-list">${rows.join('')}</div>`
    : '<p class="text-muted">Complete more deadlines to see insights.</p>';
}

function insightRow(label, value, color, sub) {
  const colorVar = color === 'red' ? 'var(--red)' : color === 'gold' ? 'var(--gold)' : 'var(--green)';
  return `<div class="insight-row">
    <div class="insight-label">${escapeHTML(label)}</div>
    <div>
      <span class="insight-value" style="color:${colorVar}">${value}</span>
      <span class="insight-sub"> — ${escapeHTML(sub)}</span>
    </div>
  </div>`;
}

