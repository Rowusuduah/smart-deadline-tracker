'use strict';
/* ═══════════════════════════════════════════════════════════════
   state.js — In-memory UI state. Not persisted.
   Mutate via the AppState object directly; re-render after changes.
═══════════════════════════════════════════════════════════════ */

const AppState = {
  // ─── Navigation ──────────────────────────────────────────────
  activeTab: 'tab-dashboard',

  // ─── List Tab ────────────────────────────────────────────────
  list: {
    search:   '',
    category: '',       // '' = all
    status:   '',       // '' = active (non-archived, non-canceled)
    priority: '',       // '' = all
    sort:     'urgency',
    selected: new Set(),  // IDs of bulk-selected items
    viewMode: 'compact', // 'compact' | 'detailed'
    showArchived: false,
  },

  // ─── Calendar Tab ────────────────────────────────────────────
  calendar: {
    year:  new Date().getFullYear(),
    month: new Date().getMonth(), // 0-indexed
    view:  'month', // 'month' | 'week'
  },

  // ─── Timeline Tab ────────────────────────────────────────────
  timeline: {
    groupBy: 'week', // 'week' | 'month'
  },

  // ─── Detail / Edit ───────────────────────────────────────────
  detailId:     null,   // ID of deadline shown in detail panel
  editId:       null,   // ID of deadline being edited (null = new)
  modalOpen:    false,
  detailOpen:   false,

  // ─── Focus Tab ───────────────────────────────────────────────
  focus: {
    collapsed: false,
  },

  // ─── Analytics Tab ───────────────────────────────────────────
  analytics: {
    period: '30', // days to look back for trends
  },

  // ─── Countdown Timer ─────────────────────────────────────────
  countdownInterval:       null,
  detailCountdownInterval: null,
};
