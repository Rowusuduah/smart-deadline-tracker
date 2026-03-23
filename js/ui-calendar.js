'use strict';
/* ═══════════════════════════════════════════════════════════════
   ui-calendar.js — Month/week calendar view.
═══════════════════════════════════════════════════════════════ */

function renderCalendarTab() {
  const sec = document.getElementById('sec-calendar');
  if (!sec || !sec.classList.contains('on')) return;
  renderCalendarHeader();
  renderCalendarGrid();
}

function renderCalendarHeader() {
  const el = document.getElementById('cal-title');
  if (!el) return;
  const { year, month } = AppState.calendar;
  el.textContent = `${MONTH_NAMES[month]} ${year}`;
}

function renderCalendarGrid() {
  const el = document.getElementById('cal-grid');
  if (!el) return;

  const { year, month } = AppState.calendar;
  const settings = loadSettings();
  const deadlines = loadDeadlines().map(d => enrichDeadline(d, settings));
  const today = todayISO();

  const firstDay   = getFirstDayOfMonth(year, month);
  const daysInMon  = getDaysInMonth(year, month);
  const daysInPrev = getDaysInMonth(year, month - 1 < 0 ? 11 : month - 1);

  // Day name headers
  let html = DAY_ABBR.map(d => `<div class="cal-day-name">${d}</div>`).join('');

  // Blank cells for days before month starts
  for (let i = 0; i < firstDay; i++) {
    const prevDay = daysInPrev - firstDay + i + 1;
    html += `<div class="cal-cell other-month"><span class="cal-day-num">${prevDay}</span></div>`;
  }

  // Calendar cells
  for (let day = 1; day <= daysInMon; day++) {
    const dateISO = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isToday = dateISO === today;
    const dayItems = deadlines.filter(d =>
      d.dueDate === dateISO && !['archived','canceled'].includes(d.status)
    );
    const dots = dayItems.slice(0, 4).map(d =>
      `<span class="cal-dot" style="background:${d._urgencyColor}" title="${escapeHTML(d.title)}"></span>`
    ).join('');
    const overflow = dayItems.length > 4 ? `<span class="cal-overflow">+${dayItems.length - 4}</span>` : '';
    const hasOverdue = dayItems.some(d => d._isOverdue);
    html += `<div class="cal-cell ${isToday ? 'cal-today' : ''} ${hasOverdue ? 'has-overdue' : ''}" data-date="${dateISO}">
      <span class="cal-day-num ${isToday ? 'today-num' : ''}">${day}</span>
      <div class="cal-items">
        ${dayItems.slice(0, 3).map(d =>
          `<div class="cal-item" data-id="${escapeHTML(d.id)}" style="border-left:2px solid ${d._urgencyColor}" title="${escapeHTML(d.title)}">
            ${escapeHTML(truncate(d.title, 22))}
          </div>`
        ).join('')}
        ${dayItems.length > 3 ? `<div class="cal-more">+${dayItems.length - 3} more</div>` : ''}
      </div>
    </div>`;
  }

  // Fill remaining cells
  const totalCells = firstDay + daysInMon;
  const remaining  = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let i = 1; i <= remaining; i++) {
    html += `<div class="cal-cell other-month"><span class="cal-day-num">${i}</span></div>`;
  }

  el.innerHTML = html;
}

// ─── Calendar Navigation ─────────────────────────────────────────
function calPrevMonth() {
  let { year, month } = AppState.calendar;
  month--;
  if (month < 0) { month = 11; year--; }
  AppState.calendar.year  = year;
  AppState.calendar.month = month;
  renderCalendarTab();
}

function calNextMonth() {
  let { year, month } = AppState.calendar;
  month++;
  if (month > 11) { month = 0; year++; }
  AppState.calendar.year  = year;
  AppState.calendar.month = month;
  renderCalendarTab();
}

function calGoToday() {
  AppState.calendar.year  = new Date().getFullYear();
  AppState.calendar.month = new Date().getMonth();
  renderCalendarTab();
}

// ─── Day Detail Popup ────────────────────────────────────────────
function renderCalendarDayPopup(dateISO) {
  const settings  = loadSettings();
  const deadlines = loadDeadlines()
    .map(d => enrichDeadline(d, settings))
    .filter(d => d.dueDate === dateISO && !['archived','canceled'].includes(d.status));

  const popup = document.getElementById('cal-popup');
  if (!popup) return;

  if (!deadlines.length) {
    popup.innerHTML = `<div class="cal-popup-inner">
      <div class="cal-popup-header">
        <strong>${formatDateFull(dateISO)}</strong>
        <button class="icon-btn" id="cal-popup-close">×</button>
      </div>
      <p class="text-muted" style="padding:12px;font-size:.85rem">No deadlines on this day.</p>
      <div style="padding:0 12px 12px">
        <button class="btn btn-green btn-sm" data-action="quick-add" data-date="${escapeHTML(dateISO)}">+ Add deadline</button>
      </div>
    </div>`;
  } else {
    const items = deadlines.map(d => `
      <div class="popup-item" data-id="${escapeHTML(d.id)}" style="border-left:3px solid ${d._urgencyColor}">
        <div class="popup-item-title">${escapeHTML(d.title)}</div>
        <div class="popup-item-meta">
          ${escapeHTML(d.category || '')} · ${statusBadge(d.status, d._isOverdue)}
        </div>
        <div style="display:flex;gap:6px;margin-top:4px">
          <button class="btn btn-ghost btn-sm" data-action="view" data-id="${escapeHTML(d.id)}">View</button>
          <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${escapeHTML(d.id)}">Edit</button>
        </div>
      </div>`).join('');
    popup.innerHTML = `<div class="cal-popup-inner">
      <div class="cal-popup-header">
        <strong>${formatDateFull(dateISO)}</strong>
        <button class="icon-btn" id="cal-popup-close">×</button>
      </div>
      <div class="popup-items">${items}</div>
      <div style="padding:8px 12px 12px">
        <button class="btn btn-green btn-sm" data-action="quick-add" data-date="${escapeHTML(dateISO)}">+ Add deadline</button>
      </div>
    </div>`;
  }

  popup.classList.add('open');
}

function closeCalendarPopup() {
  const popup = document.getElementById('cal-popup');
  if (popup) popup.classList.remove('open');
}
