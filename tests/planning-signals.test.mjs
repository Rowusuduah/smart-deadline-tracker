import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const context = createContext({ console });
for (const file of ['js/utils.js', 'js/calculations.js', 'js/deadlines.js']) {
  runInContext(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), context, { filename: file });
}

function evaluate(source) { return runInContext(source, context); }

test('an ordinary deadline due tomorrow is a warning, while urgent or overdue work is critical', () => {
  assert.equal(evaluate(`calcRiskLevel({ dueDate: addDays(todayISO(), 1), status: 'not-started', priority: 'medium', progressPercent: 0 }, {})`), 'warning');
  assert.equal(evaluate(`calcRiskLevel({ dueDate: todayISO(), status: 'not-started', priority: 'high', progressPercent: 0 }, {})`), 'critical');
  assert.equal(evaluate(`calcRiskLevel({ dueDate: addDays(todayISO(), -1), status: 'not-started', priority: 'medium', progressPercent: 0 }, {})`), 'critical');
});

test('archived deadlines do not inflate the Today overview', () => {
  const stats = evaluate(`getDashboardStats([
    { id: 'open', title: 'Open', dueDate: addDays(todayISO(), 3), status: 'not-started', priority: 'medium', progressPercent: 0 },
    { id: 'archived', title: 'Archived', dueDate: addDays(todayISO(), 1), status: 'not-started', isArchived: true, priority: 'medium', progressPercent: 0 }
  ], { bufferDays: 1, includeWeekends: true })`);
  assert.equal(stats.totalActive, 1);
  assert.equal(stats.topUrgent.length, 1);
  assert.equal(stats.topUrgent[0].id, 'open');
});

test('archived work stays out of active filters and appears only when requested', () => {
  const defaultList = evaluate(`filterDeadlines([
    { id: 'open', status: 'not-started' },
    { id: 'old', status: 'not-started', isArchived: true }
  ], { status: 'active', showArchived: false })`);
  assert.equal(defaultList.length, 1);
  assert.equal(defaultList[0].id, 'open');
  const all = evaluate(`filterDeadlines([
    { id: 'open', status: 'not-started' },
    { id: 'old', status: 'archived', isArchived: true }
  ], { showArchived: true })`);
  assert.equal(all.length, 2);
});
