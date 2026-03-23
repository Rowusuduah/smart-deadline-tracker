# Smart Deadline Tracker

A comprehensive, intelligent deadline management web app. Not just a to-do list — a full planning intelligence system with urgency scoring, workload analysis, risk detection, and behavioral insights.

## Features

### Core Capabilities
- Add, edit, duplicate, delete, archive, and postpone deadlines
- Mark complete with optional recurring deadline generation
- Subtasks with weighted progress roll-up
- Tags, notes, and external links per deadline
- Recurring deadline engine (daily/weekly/monthly/yearly)
- Full import/export (JSON + CSV) with optional Google Drive sync
- PWA — installable on desktop and mobile

### Smart Intelligence
- **Urgency Score (0–100)** — automatically ranks every deadline by real urgency
- **Risk Level** — `safe / warning / critical` based on effort, time, and history
- **Smart Start Date** — calculates exactly when to start based on hours needed
- **Daily Effort Needed** — how many hours/day to finish on time
- **Workload Warnings** — alerts when today or this week is overloaded
- **Procrastination Detection** — tracks postpone counts, effort underestimation, late patterns
- **Urgency Color System** — red → orange → amber → green → blue by time horizon

### Views
1. **Dashboard** — KPI cards, top urgent, at-risk panel, workload bars, category load
2. **All Deadlines** — search, filter, sort, bulk actions, compact/detailed modes
3. **Calendar** — month view with per-day deadline dots, click-to-inspect, quick-add
4. **Timeline** — upcoming deadlines grouped by week or month
5. **Focus Mode** — top 3 action items, nudges, schedule recovery plan
6. **Analytics** — completion trends, on-time rate, effort accuracy, procrastination indicators
7. **Settings** — planning assumptions, category manager, theme, export/import

## Getting Started

1. Open `index.html` in any modern browser (no server needed)
2. Or serve it:
   ```bash
   npx serve .
   # or
   python -m http.server 8080
   ```
3. Start adding deadlines with **+ Add** in the top nav

## Architecture

```
index.html              — Full HTML structure (7 tabs, modal, detail panel)
css/styles.css          — Complete CSS (design tokens, components, responsive)
js/utils.js             — Pure utilities: date math, formatting, download helpers
js/storage.js           — localStorage I/O, export/import, default data
js/calculations.js      — All smart formulas (urgency, risk, workload, etc.)
js/state.js             — In-memory UI state (filters, active tab, selection)
js/deadlines.js         — CRUD operations, validation, recurrence engine
js/ui-dashboard.js      — Dashboard rendering
js/ui-list.js           — All Deadlines list view
js/ui-calendar.js       — Calendar view
js/ui-timeline.js       — Timeline view
js/ui-focus.js          — Focus mode
js/ui-analytics.js      — Analytics tab
js/ui-settings.js       — Settings tab
js/app.js               — Tab system, modal, events, init, Drive sync
manifest.json           — PWA manifest
sw.js                   — Service worker (offline support)
```

## Calculation Reference

### Urgency Score (0–100)
```
base:
  overdue      → 100
  ≤ 1 day      → 90
  ≤ 3 days     → 78
  ≤ 7 days     → 62
  ≤ 14 days    → 45
  ≤ 30 days    → 28
  > 30 days    → 12

adjustments:
  priority=critical     → +15
  priority=high         → +8
  dailyEffort > wph     → +12  (workload exceeds capacity)
  progress=0, ≤7 days   → +10
  postponed ≥ 2 times   → +8

result clamped to 0–100
```

### Risk Level
```
critical if:
  - overdue and not complete
  - dailyEffortNeeded > workHoursPerDay × 1.5
  - daysLeft ≤ 1 and progress < 50%

warning if:
  - dailyEffortNeeded > workHoursPerDay × 0.75
  - daysLeft ≤ 3 and progress < 30%
  - daysLeft ≤ 7 and progress = 0 and estimatedHours > 0
  - postponed ≥ 2 times

safe otherwise
```

### Daily Effort Needed
```
dailyEffortNeeded = remainingHours / workdaysLeft

remainingHours = estimatedHours × (1 − progress/100)
workdaysLeft   = count Mon–Fri from today to dueDate (inclusive)
               = calendar days if includeWeekends = true
```

### Recommended Start Date
```
startDate = dueDate − ceil(estimatedHours / workHoursPerDay) − bufferDays
clamped to: never before today
```

### Progress from Subtasks
```
if subtasks with weights:
  progress = (sum of weights of done subtasks) / (total weight) × 100
else (equal weight):
  progress = (done count / total count) × 100
fallback:
  manual progressPercent field
```

## Customization

### Adding Urgency Color Rules
Edit `calcUrgencyColor()` in `js/calculations.js`. Change the day thresholds in `URGENCY_COLOR`.

### Changing Planning Assumptions
Edit defaults in `DEFAULT_SETTINGS` in `js/storage.js`, or change them in-app via Settings.

### Adding a New Category
Go to **Settings → Categories → Add Category**. Categories are stored per-device.

### Google Drive Sync
1. Create a Google Cloud project at console.cloud.google.com
2. Enable the Google Drive API
3. Create an OAuth 2.0 Client ID (type: Web application)
4. Add `http://localhost` and your domain to Authorized JavaScript origins
5. Paste the Client ID into `GDRIVE_CLIENT_ID` in `js/app.js`

## GitHub Setup

```bash
git init
git add .
git commit -m "feat: initial Smart Deadline Tracker implementation"
git remote add origin https://github.com/your-username/smart-deadline-tracker.git
git push -u origin main
```

### Recommended Branch Strategy
- `main` — stable, deployable
- `dev` — active development
- `feature/[name]` — feature branches
- `fix/[issue]` — bug fixes

### Suggested GitHub Actions
- Deploy to GitHub Pages on push to `main`
- Lighthouse CI for performance auditing

## Future Improvements

- [ ] Browser push notifications for deadline reminders
- [ ] Multi-device sync beyond Google Drive (Supabase, Firebase)
- [ ] AI-powered workload suggestions via Claude API
- [ ] Gantt chart / dependency visualization
- [ ] Pomodoro timer integration in Focus Mode
- [ ] Teams / shared deadlines
- [ ] Email digest of upcoming deadlines
- [ ] Mobile app wrapper (Capacitor/Tauri)
- [ ] Keyboard shortcut system (N = new, / = search, etc.)
- [ ] Drag-and-drop deadline reordering
- [ ] Custom formula builder for urgency scoring

## Data Privacy

All data is stored in your browser's `localStorage`. Nothing is sent to any server unless you explicitly use Google Drive Sync. Export JSON regularly as a backup.
