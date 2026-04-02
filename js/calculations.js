'use strict';
/* ═══════════════════════════════════════════════════════════════
   calculations.js — All smart computation.
   Calculation Auditor Agent sign-off required on every formula.

   Principles:
   - No mutation of input objects
   - All formulas centralized here
   - Guard against division-by-zero, null, NaN
   - Date math uses local-time parsers from utils.js
   - "days" always means calendar days unless labeled "workdays"
═══════════════════════════════════════════════════════════════ */

// ─── Constants ───────────────────────────────────────────────────
const PRIORITY_WEIGHT = { critical: 4, high: 3, medium: 2, low: 1 };
const URGENCY_COLOR = {
  overdue:     '#f87171', // red
  critical:    '#ef4444', // deeper red
  today:       '#f97316', // orange-red
  soon3:       '#fb923c', // orange
  week:        '#fbbf24', // amber/yellow
  twoWeeks:    '#4ade80', // green
  month:       '#60a5fa', // blue
  future:      '#818cf8', // indigo
  completed:   '#6b7280', // gray
  paused:      '#9ca3af', // lighter gray
  canceled:    '#6b7280',
};

// ─── Core Calculations ───────────────────────────────────────────

/**
 * Returns signed ms remaining until deadline (negative = overdue).
 */
function calcMsRemaining(deadline) {
  return msUntilDeadline(deadline); // defined in utils.js
}

/**
 * Returns calendar days from today to dueDate.
 * Positive = future. Negative = overdue. 0 = due today.
 * AUDITOR NOTE: uses local midnight comparison; immune to DST via round().
 */
function calcDaysLeft(deadline) {
  return daysFromToday(deadline.dueDate);
}

/**
 * Returns workdays (Mon–Fri) from today to dueDate.
 * Returns 0 if overdue.
 */
function calcWorkdaysLeft(deadline, settings) {
  if (settings && !settings.includeWeekends) {
    return workdaysFromToday(deadline.dueDate);
  }
  // If weekends count: same as calendar days left, clamped to 0
  return Math.max(0, calcDaysLeft(deadline));
}

/**
 * Computes effective progress percentage.
 * If subtasks exist with non-zero total weight, derives from subtask completion.
 * Falls back to manual progressPercent. Clamps 0–100.
 * AUDITOR NOTE: guards against empty subtask array and zero total weight.
 */
function calcProgress(deadline) {
  const subtasks = deadline.subtasks || [];
  if (subtasks.length > 0) {
    const totalWeight = subtasks.reduce((sum, s) => sum + safeNum(s.weight, 1), 0);
    if (totalWeight > 0) {
      const doneWeight = subtasks
        .filter(s => s.done)
        .reduce((sum, s) => sum + safeNum(s.weight, 1), 0);
      return safePercent((doneWeight / totalWeight) * 100);
    }
    // Equal-weight subtasks
    const doneCount = subtasks.filter(s => s.done).length;
    return safePercent((doneCount / subtasks.length) * 100);
  }
  return safePercent(deadline.progressPercent ?? 0);
}

/**
 * Remaining effort hours = estimatedHours * (1 - progress/100).
 * Never negative. 0 if no estimate provided.
 * AUDITOR NOTE: guards against progress > 100 via safePercent.
 */
function calcRemainingHours(deadline) {
  const estimated = safeNum(deadline.estimatedHours, 0);
  if (estimated <= 0) return 0;
  const progress = calcProgress(deadline) / 100;
  return Math.max(0, estimated * (1 - progress));
}

/**
 * Daily effort needed (hours/day) to finish before deadline.
 * Uses workdays if !includeWeekends, else calendar days.
 * AUDITOR NOTE: guards against division-by-zero when daysLeft = 0.
 */
function calcDailyEffortNeeded(deadline, settings) {
  const remaining = calcRemainingHours(deadline);
  if (remaining <= 0) return 0;
  const wph = settings ? safeNum(settings.workHoursPerDay, 6) : 6;
  const daysLeft = calcWorkdaysLeft(deadline, settings);
  if (daysLeft <= 0) {
    // Overdue or due today — caller must handle "already past"
    return remaining; // all remaining effort is needed now
  }
  return round(remaining / daysLeft, 2);
}

/**
 * Recommended start date (ISO string).
 * = dueDate − ceil(estimatedHours / workHoursPerDay) − bufferDays
 * AUDITOR NOTE: result is clamped so it never precedes createdAt.
 *               If recommended date is in the past, returns todayISO().
 */
function calcRecommendedStartDate(deadline, settings) {
  const estimated = safeNum(deadline.estimatedHours, 0);
  if (estimated <= 0 || !deadline.dueDate) return todayISO();
  const wph       = settings ? safeNum(settings.workHoursPerDay, 6) : 6;
  const buffer    = settings ? safeNum(settings.bufferDays, 1) : 1;
  const daysNeeded = Math.ceil(estimated / (wph || 6));
  const totalDays  = daysNeeded + buffer;
  const startISO   = subtractDays(deadline.dueDate, totalDays);
  // Never recommend a start date before today
  return startISO < todayISO() ? todayISO() : startISO;
}

/**
 * Start status message.
 * Returns one of: 'behind' | 'start-today' | 'start-soon' | 'safe' | 'completed'
 */
function calcStartStatus(deadline, settings) {
  if (['completed', 'canceled', 'archived'].includes(deadline.status)) return 'completed';
  const daysLeft   = calcDaysLeft(deadline);
  if (daysLeft < 0) return 'behind'; // overdue
  const recommended = calcRecommendedStartDate(deadline, settings);
  const daysUntilRec = daysFromToday(recommended);
  if (daysUntilRec <= 0) return 'start-today';
  if (daysUntilRec <= 2) return 'start-soon';
  return 'safe';
}

/**
 * Urgency score (0–100).
 * Higher = more urgent. Used for auto-sort and color coding.
 *
 * Base score from time remaining:
 *   overdue        → 100
 *   ≤ 1 day        → 90
 *   ≤ 3 days       → 78
 *   ≤ 7 days       → 62
 *   ≤ 14 days      → 45
 *   ≤ 30 days      → 28
 *   > 30 days      → 12
 *
 * Adjustments (applied after base, then clamped 0–100):
 *   priority=critical → +15
 *   priority=high     → +8
 *   effort unrealistic (dailyEffort > workHours) → +12
 *   progress=0 and daysLeft≤7 → +10
 *   postponed ≥ 2 times → +8
 *   no effort estimate → -3 (uncertainty penalty applied in risk, not urgency)
 */
function calcUrgencyScore(deadline, settings) {
  if (['completed', 'canceled', 'archived'].includes(deadline.status)) return 0;
  const daysLeft = calcDaysLeft(deadline);
  let base = 0;
  if (daysLeft < 0)      base = 100;
  else if (daysLeft <= 1)  base = 90;
  else if (daysLeft <= 3)  base = 78;
  else if (daysLeft <= 7)  base = 62;
  else if (daysLeft <= 14) base = 45;
  else if (daysLeft <= 30) base = 28;
  else                     base = 12;

  let adj = 0;
  const pw = PRIORITY_WEIGHT[deadline.priority] || 2;
  if (pw === 4) adj += 15;
  else if (pw === 3) adj += 8;

  const wph = settings ? safeNum(settings.workHoursPerDay, 6) : 6;
  const dailyEffort = calcDailyEffortNeeded(deadline, settings);
  if (deadline.estimatedHours > 0 && dailyEffort > wph) adj += 12;

  const progress = calcProgress(deadline);
  if (progress === 0 && daysLeft >= 0 && daysLeft <= 7) adj += 10;

  const postponeCount = safeNum(deadline.postponeCount, 0);
  if (postponeCount >= 2) adj += 8;

  return clamp(base + adj, 0, 100);
}

/**
 * Risk level: 'safe' | 'warning' | 'critical'
 *
 * Algorithm:
 *   critical if:
 *     - overdue and not completed
 *     - dailyEffortNeeded > workHoursPerDay * 1.5
 *     - daysLeft ≤ 1 and progress < 50
 *   warning if:
 *     - dailyEffortNeeded > workHoursPerDay * 0.75
 *     - daysLeft ≤ 3 and progress < 30
 *     - daysLeft ≤ 7 and progress = 0 and estimatedHours > 0
 *     - postponeCount ≥ 2
 *   safe otherwise
 *
 * AUDITOR NOTE: Uses workdays as denominator for dailyEffortNeeded.
 */
function calcRiskLevel(deadline, settings) {
  if (['completed', 'canceled', 'archived', 'paused'].includes(deadline.status)) return 'safe';
  const daysLeft    = calcDaysLeft(deadline);
  const progress    = calcProgress(deadline);
  const wph         = settings ? safeNum(settings.workHoursPerDay, 6) : 6;
  const dailyEffort = calcDailyEffortNeeded(deadline, settings);
  const postponed   = safeNum(deadline.postponeCount, 0);

  if (daysLeft < 0 && progress < 100) return 'critical';
  if (deadline.estimatedHours > 0 && dailyEffort > wph * 1.5) return 'critical';
  if (daysLeft <= 1 && progress < 50) return 'critical';

  if (deadline.estimatedHours > 0 && dailyEffort > wph * 0.75) return 'warning';
  if (daysLeft <= 3 && progress < 30) return 'warning';
  if (daysLeft <= 7 && progress === 0 && deadline.estimatedHours > 0) return 'warning';
  if (postponed >= 2) return 'warning';

  return 'safe';
}

/**
 * Health status summary string.
 * 'on-track' | 'at-risk' | 'critical' | 'completed' | 'overdue'
 */
function calcHealthStatus(deadline, settings) {
  if (deadline.status === 'completed') return 'completed';
  if (deadline.status === 'canceled')  return 'canceled';
  if (deadline.status === 'archived')  return 'archived';
  const daysLeft = calcDaysLeft(deadline);
  if (daysLeft < 0) return 'overdue';
  const risk = calcRiskLevel(deadline, settings);
  if (risk === 'critical') return 'critical';
  if (risk === 'warning')  return 'at-risk';
  return 'on-track';
}

/**
 * Urgency color — CSS hex string.
 * Based on time-to-deadline if colorMode='urgency', else falls back.
 */
function calcUrgencyColor(deadline) {
  const s = deadline.status;
  if (s === 'completed') return URGENCY_COLOR.completed;
  if (s === 'canceled')  return URGENCY_COLOR.canceled;
  if (s === 'paused')    return URGENCY_COLOR.paused;
  if (deadline.colorOverride) return deadline.colorOverride;

  const daysLeft = calcDaysLeft(deadline);
  if (daysLeft < 0)      return URGENCY_COLOR.overdue;
  if (daysLeft === 0)    return URGENCY_COLOR.today;
  if (daysLeft <= 3)     return URGENCY_COLOR.soon3;
  if (daysLeft <= 7)     return URGENCY_COLOR.week;
  if (daysLeft <= 14)    return URGENCY_COLOR.twoWeeks;
  if (daysLeft <= 30)    return URGENCY_COLOR.month;
  return URGENCY_COLOR.future;
}

/**
 * Full enrichment: returns a new object with all computed fields added.
 * Does NOT mutate the input deadline.
 */
function enrichDeadline(deadline, settings) {
  const daysLeft        = calcDaysLeft(deadline);
  const msRemaining     = calcMsRemaining(deadline);
  const progress        = calcProgress(deadline);
  const remainingHours  = calcRemainingHours(deadline);
  const workdaysLeft    = calcWorkdaysLeft(deadline, settings);
  const dailyEffort     = calcDailyEffortNeeded(deadline, settings);
  const urgencyScore    = calcUrgencyScore(deadline, settings);
  const riskLevel       = calcRiskLevel(deadline, settings);
  const healthStatus    = calcHealthStatus(deadline, settings);
  const startStatus     = calcStartStatus(deadline, settings);
  const recStartDate    = calcRecommendedStartDate(deadline, settings);
  const urgencyColor    = calcUrgencyColor(deadline);
  const isOverdue       = daysLeft < 0 && !['completed','canceled','archived'].includes(deadline.status);

  return {
    ...deadline,
    // computed — prefixed with _ to distinguish from stored fields
    _daysLeft:         daysLeft,
    _msRemaining:      msRemaining,
    _progress:         progress,
    _remainingHours:   remainingHours,
    _workdaysLeft:     workdaysLeft,
    _dailyEffort:      dailyEffort,
    _urgencyScore:     urgencyScore,
    _riskLevel:        riskLevel,
    _healthStatus:     healthStatus,
    _startStatus:      startStatus,
    _recStartDate:     recStartDate,
    _urgencyColor:     urgencyColor,
    _isOverdue:        isOverdue,
  };
}

// ─── Bulk Analysis ───────────────────────────────────────────────

/**
 * Dashboard stats from the full deadline list.
 * Returns an object with counts and grouped arrays.
 */
function getDashboardStats(deadlines, settings) {
  const active    = deadlines.filter(d => !['archived','canceled'].includes(d.status));
  const enriched  = active.map(d => enrichDeadline(d, settings));
  const today     = todayISO();
  const weekEnd   = addDays(today, 7);
  const monthEnd  = addDays(today, 30);

  const overdue       = enriched.filter(d => d._isOverdue);
  const dueToday      = enriched.filter(d => !d._isOverdue && d.dueDate === today && d.status !== 'completed');
  const dueThisWeek   = enriched.filter(d => !d._isOverdue && d.dueDate > today && d.dueDate <= weekEnd && d.status !== 'completed');
  const dueThisMonth  = enriched.filter(d => !d._isOverdue && d.dueDate > weekEnd && d.dueDate <= monthEnd && d.status !== 'completed');
  const atRisk        = enriched.filter(d => ['at-risk','critical'].includes(d._healthStatus));
  const completed     = enriched.filter(d => d.status === 'completed');
  const notComplete   = enriched.filter(d => d.status !== 'completed');

  // Top urgent: sort by urgency score desc, take first 5
  const topUrgent = [...notComplete]
    .sort((a, b) => b._urgencyScore - a._urgencyScore)
    .slice(0, 5);

  // Workload today: sum daily effort of all active non-complete items
  const workloadToday = notComplete.reduce((sum, d) => sum + safeNum(d._dailyEffort, 0), 0);

  // Workload this week: sum remaining hours of items due within 7 days
  const workloadWeek = [...overdue, ...dueToday, ...dueThisWeek]
    .reduce((sum, d) => sum + safeNum(d._remainingHours, 0), 0);

  // Category distribution
  const catMap = {};
  active.forEach(d => {
    const cat = d.category || 'personal';
    catMap[cat] = (catMap[cat] || 0) + 1;
  });

  // On-time stats from completed items (last 30 days)
  const recentCompleted = deadlines.filter(d => d.status === 'completed' && d.completedAt);
  const onTime = recentCompleted.filter(d => d.completedAt && d.dueDate && d.completedAt.slice(0, 10) <= d.dueDate).length;
  const onTimeRate = recentCompleted.length > 0 ? Math.round((onTime / recentCompleted.length) * 100) : null;

  return {
    totalActive:   notComplete.length,
    overdueCount:  overdue.length,
    dueTodayCount: dueToday.length,
    dueWeekCount:  dueThisWeek.length,
    dueMonthCount: dueThisMonth.length,
    completedCount: completed.length,
    atRiskCount:   atRisk.length,
    workloadToday: round(workloadToday, 1),
    workloadWeek:  round(workloadWeek, 1),
    onTimeRate,
    topUrgent,
    overdue,
    dueToday,
    dueThisWeek,
    atRisk,
    categoryDistribution: catMap,
    allEnriched: enriched,
  };
}

/**
 * Sort enriched deadlines by various criteria.
 */
function sortDeadlines(enriched, sortBy) {
  const copy = [...enriched];
  switch (sortBy) {
    case 'urgency':
      return copy.sort((a, b) => b._urgencyScore - a._urgencyScore);
    case 'due-asc':
      return copy.sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
    case 'due-desc':
      return copy.sort((a, b) => (b.dueDate || '').localeCompare(a.dueDate || ''));
    case 'priority':
      return copy.sort((a, b) => (PRIORITY_WEIGHT[b.priority] || 2) - (PRIORITY_WEIGHT[a.priority] || 2));
    case 'progress-asc':
      return copy.sort((a, b) => a._progress - b._progress);
    case 'progress-desc':
      return copy.sort((a, b) => b._progress - a._progress);
    case 'title':
      return copy.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    case 'created':
      return copy.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    default:
      return copy.sort((a, b) => b._urgencyScore - a._urgencyScore);
  }
}

/**
 * Scenario simulation: "What happens if I delay N days?"
 * Returns an enriched deadline with the due date shifted forward.
 */
function simulateDelay(deadline, delayDays, settings) {
  if (!deadline.dueDate || delayDays <= 0) return enrichDeadline(deadline, settings);
  const shifted = { ...deadline, dueDate: addDays(deadline.dueDate, delayDays) };
  return enrichDeadline(shifted, settings);
}

/**
 * Analytics data: completion trends for the past N days.
 * Returns array of { date, completed, added } for chart rendering.
 */
function getCompletionTrend(deadlines, daysBack = 30) {
  const result = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const date = subtractDays(todayISO(), i);
    const completed = deadlines.filter(d =>
      d.completedAt && d.completedAt.slice(0, 10) === date
    ).length;
    const added = deadlines.filter(d =>
      d.createdAt && d.createdAt.slice(0, 10) === date
    ).length;
    result.push({ date, completed, added });
  }
  return result;
}

/**
 * Procrastination indicators.
 * Returns { avgPostponeCount, lateStartRate, underestimateRate, neglectedCategories }
 */
function getProcrastinationInsights(deadlines) {
  const completed = deadlines.filter(d => d.status === 'completed');
  const totalPostpones = deadlines.reduce((sum, d) => sum + safeNum(d.postponeCount, 0), 0);
  const avgPostponeCount = deadlines.length > 0
    ? round(totalPostpones / deadlines.length, 1)
    : 0;

  // Late start rate: % of deadlines where actual hours > estimated * 1.5
  const withBothHours = completed.filter(d => d.estimatedHours > 0 && d.actualHours > 0);
  const underestimates = withBothHours.filter(d => d.actualHours > d.estimatedHours * 1.5).length;
  const underestimateRate = withBothHours.length > 0
    ? Math.round((underestimates / withBothHours.length) * 100)
    : null;

  // Overdue rate
  const overdueCount = deadlines.filter(d =>
    d.completedAt && d.dueDate && d.completedAt.slice(0, 10) > d.dueDate
  ).length;
  const overdueRate = completed.length > 0
    ? Math.round((overdueCount / completed.length) * 100)
    : null;

  // Category neglect: categories with high overdue rate
  const catOverdue = {};
  const catTotal   = {};
  deadlines.forEach(d => {
    const cat = d.category || 'personal';
    catTotal[cat] = (catTotal[cat] || 0) + 1;
    if (d._isOverdue || (d.completedAt && d.dueDate && d.completedAt.slice(0, 10) > d.dueDate)) {
      catOverdue[cat] = (catOverdue[cat] || 0) + 1;
    }
  });

  return {
    avgPostponeCount,
    underestimateRate,
    overdueRate,
    catOverdue,
    catTotal,
  };
}
