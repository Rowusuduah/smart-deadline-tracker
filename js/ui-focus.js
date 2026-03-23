'use strict';
/* ═══════════════════════════════════════════════════════════════
   ui-focus.js — Focus Mode: top items to work on right now.
═══════════════════════════════════════════════════════════════ */

function renderFocusTab() {
  const sec = document.getElementById('sec-focus');
  if (!sec || !sec.classList.contains('on')) return;
  renderFocusMode();
}

function renderFocusMode() {
  const settings  = loadSettings();
  const allRaw    = loadDeadlines();
  const all       = allRaw
    .filter(d => !['completed','canceled','archived'].includes(d.status))
    .map(d => enrichDeadline(d, settings));

  renderFocusTop3(all, settings);
  renderFocusWorkloadBar(all, settings);
  renderFocusNudge(all, settings);
  renderFocusRecovery(all, settings);
}

// ─── Top 3 Action Items ──────────────────────────────────────────
function renderFocusTop3(items, settings) {
  const el = document.getElementById('focus-top3');
  if (!el) return;

  const sorted = sortDeadlines(items, 'urgency');

  if (!sorted.length) {
    el.innerHTML = emptyState('🎉', 'Nothing urgent right now. Enjoy the calm!');
    return;
  }

  el.innerHTML = sorted.slice(0, 3).map((d, i) => focusCard(d, i + 1, settings)).join('');
}

function focusCard(d, rank, settings) {
  const color      = d._urgencyColor;
  const daysLabel  = formatRelativeDeadline(d._daysLeft);
  const startMsg   = startStatusMessage(d._startStatus);
  const prog       = d._progress;

  // Smart recommendation text
  let recommendation = '';
  if (d._isOverdue) {
    recommendation = `This is overdue. Complete what you can and move on, or update the due date.`;
  } else if (d._startStatus === 'behind') {
    recommendation = `You need to start immediately. Begin working on this today.`;
  } else if (d._startStatus === 'start-today') {
    recommendation = `Start today to stay on track.`;
  } else if (d._dailyEffort > safeNum(settings.workHoursPerDay, 6)) {
    recommendation = `Daily effort needed exceeds your work hours. Consider breaking this into smaller sessions.`;
  } else if (d.subtasks && d.subtasks.length > 0) {
    const nextSubtask = d.subtasks.find(s => !s.done);
    if (nextSubtask) recommendation = `Next subtask: "${truncate(nextSubtask.title, 50)}"`;
  } else {
    recommendation = `Stay on schedule — keep making consistent progress.`;
  }

  return `<div class="focus-card" style="border-left:4px solid ${color}">
    <div class="focus-rank">${rank}</div>
    <div class="focus-body">
      <div class="focus-title-row">
        <span class="focus-title">${escapeHTML(d.title)}</span>
        <span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}44">${daysLabel}</span>
      </div>
      <div class="focus-meta">
        ${escapeHTML(d.category || '')} · ${priorityBadge(d.priority)} · ${riskBadgeHtml(d._riskLevel)}
      </div>
      <div class="focus-recommendation">${escapeHTML(recommendation)}</div>
      ${d.estimatedHours > 0 ? `
      <div class="progress-wrap" style="margin:8px 0 2px">
        <div class="progress-bar" style="width:${prog}%;background:${color}"></div>
      </div>
      <div style="font-size:10px;color:var(--muted)">${prog}% complete · ${formatHours(d._remainingHours)} remaining</div>
      ` : ''}
      <div class="focus-actions">
        <button class="btn btn-green btn-sm" data-action="complete" data-id="${escapeHTML(d.id)}">✓ Mark Done</button>
        <button class="btn btn-ghost btn-sm" data-action="view" data-id="${escapeHTML(d.id)}">View Details</button>
        <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${escapeHTML(d.id)}">Edit</button>
      </div>
    </div>
  </div>`;
}

// ─── Workload Bar ────────────────────────────────────────────────
function renderFocusWorkloadBar(items, settings) {
  const el = document.getElementById('focus-workload');
  if (!el) return;
  const wph       = safeNum(settings.workHoursPerDay, 6);
  const totalLoad = items.reduce((sum, d) => sum + safeNum(d._dailyEffort, 0), 0);
  const pct       = Math.min(200, Math.round((totalLoad / wph) * 100));
  const color     = pct >= 150 ? 'var(--red)' : pct >= 100 ? 'var(--orange)' : pct >= 70 ? 'var(--gold)' : 'var(--green)';
  const msg       = pct >= 150 ? 'Severely overloaded — defer or delegate tasks.'
                  : pct >= 100 ? 'Overloaded — consider pushing a low-priority task.'
                  : pct >= 70  ? 'Heavy day — stay focused.'
                  : 'Manageable load — stay on schedule.';

  el.innerHTML = `
    <div class="workload-label">Today's required effort across all active deadlines:</div>
    <div style="margin:8px 0">
      <div class="workload-bar-wrap">
        <div class="workload-bar" style="width:${Math.min(100, pct)}%;background:${color}"></div>
      </div>
    </div>
    <p style="font-size:.82rem;color:${color}">${escapeHTML(msg)}</p>
  `;
}

// ─── Nudge / Behavioral Feedback ────────────────────────────────
function renderFocusNudge(items, settings) {
  const el = document.getElementById('focus-nudge');
  if (!el) return;

  const nudges = [];

  // Overdue items
  const overdueItems = items.filter(d => d._isOverdue);
  if (overdueItems.length > 0) {
    nudges.push({
      icon: '🔴',
      msg:  `You have ${overdueItems.length} overdue item${overdueItems.length > 1 ? 's' : ''}. Address these first.`,
      cls:  'nudge-critical',
    });
  }

  // Items with no effort estimate
  const noEstimate = items.filter(d => !d.estimatedHours && !['completed'].includes(d.status));
  if (noEstimate.length >= 3) {
    nudges.push({
      icon: '⏱',
      msg:  `${noEstimate.length} deadlines have no effort estimate. Adding hours helps you plan better.`,
      cls:  'nudge-info',
    });
  }

  // Items due in ≤ 2 days with 0 progress
  const startNow = items.filter(d => d._daysLeft >= 0 && d._daysLeft <= 2 && d._progress === 0);
  if (startNow.length > 0) {
    nudges.push({
      icon: '⚡',
      msg:  `${startNow.length} item${startNow.length > 1 ? 's' : ''} due within 2 days ${startNow.length > 1 ? 'have' : 'has'} not been started yet.`,
      cls:  'nudge-warning',
    });
  }

  if (!nudges.length) {
    el.innerHTML = '';
    return;
  }

  el.innerHTML = nudges.map(n => `
    <div class="nudge-card ${n.cls}">
      <span class="nudge-icon">${n.icon}</span>
      <span>${escapeHTML(n.msg)}</span>
    </div>
  `).join('');
}

// ─── Schedule Recovery ───────────────────────────────────────────
function renderFocusRecovery(items, settings) {
  const el = document.getElementById('focus-recovery');
  if (!el) return;

  const critical = items.filter(d => d._riskLevel === 'critical' && !d._isOverdue);
  if (!critical.length) {
    el.innerHTML = `<p class="text-muted" style="font-size:.85rem">No schedule recovery needed. You're on track!</p>`;
    return;
  }

  const wph = safeNum(settings.workHoursPerDay, 6);
  el.innerHTML = `<p style="font-size:.85rem;margin-bottom:10px;color:var(--gold)">
    These deadlines are critical risk. Here's a recovery plan:
  </p>` +
  critical.slice(0, 4).map(d => {
    const dailyNeeded = d._dailyEffort;
    const daysLeft    = d._daysLeft;
    const isRealistic = dailyNeeded <= wph;
    return `<div class="recovery-row" data-id="${escapeHTML(d.id)}">
      <span class="recovery-title">${escapeHTML(truncate(d.title, 40))}</span>
      <div class="recovery-detail">
        ${daysLeft === 0
          ? '<span class="text-red">Due today</span>'
          : `<span>${daysLeft} days left</span>`}
        ${!isRealistic
          ? `<span class="text-red"> — Negotiate deadline or reduce scope.</span>`
          : '<span class="text-green"> — achievable with focus.</span>'}
      </div>
      <div style="margin-top:6px;display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${escapeHTML(d.id)}">Adjust</button>
        <button class="btn btn-ghost btn-sm" data-action="postpone" data-id="${escapeHTML(d.id)}">Postpone</button>
      </div>
    </div>`;
  }).join('');
}
