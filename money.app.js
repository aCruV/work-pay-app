(function(){
  const $ = id => document.getElementById(id);
  const OLD_KEY = 'workTrackerData_v1';
  const KEY = 'workTrackerData_v2';
  const ITEM_H = 36;
  const HOURS = Array.from({length:24},(_,i)=>String(i).padStart(2,'0'));
  const MINUTES = Array.from({length:60},(_,i)=>String(i).padStart(2,'0'));
  const CATEGORY_KEYS = ['driving','cashback','bonus','reimbursement','other'];
  const SWIPE_W = 76;
  const ICON_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>';
  const ICON_WALLET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v3"/><rect x="3" y="7" width="18" height="12" rx="2"/><circle cx="16" cy="13" r="1.3" fill="currentColor" stroke="none"/></svg>';
  const ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M10 11v6M14 11v6"/></svg>';

  function defaultState() {
    return {
      settings: {
        currency: '₪',
        rate: 39.11,
        weekendStartDow: 5,
        weekendStartTime: '00:00',
        weekendEndDow: 0,
        weekendEndTime: '04:00',
        weekendPercent: 150,
        holidayPercent: 150,
        overtimeThreshold: 8,
        overtimePercent: 125,
        language: 'en',
        goalType: 'hours',
        goalValue: 0
      },
      shifts: [],
      incomes: [],
      templates: []
    };
  }

  function migrateFromV1(v1) {
    const s = defaultState();
    if (v1.settings) {
      s.settings.currency = v1.settings.currency || s.settings.currency;
      s.settings.rate = v1.settings.rate ?? s.settings.rate;
      s.settings.weekendPercent = v1.settings.satPercent ?? s.settings.weekendPercent;
      s.settings.holidayPercent = v1.settings.holidayPercent ?? s.settings.holidayPercent;
    }
    (v1.entries || []).forEach(e => {
      const startTime = '09:00';
      const totalMin = Math.round((e.hours || 0) * 60);
      const endMin = (9 * 60 + totalMin) % (24 * 60);
      const eh = String(Math.floor(endMin / 60)).padStart(2, '0');
      const em = String(endMin % 60).padStart(2, '0');
      s.shifts.push({
        id: e.id || genId(),
        date: e.date, startTime, endTime: eh + ':' + em,
        isHoliday: !!e.isHoliday, note: e.note || ''
      });
    });
    return s;
  }

  function genId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now() + '-' + Math.random().toString(36).slice(2);
  }
  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => HTML_ESCAPES[c]); }

  // Limits must stay in sync with firestore.rules.
  const LIMITS = { shifts: 5000, incomes: 5000, templates: 50, note: 200, category: 40, tplName: 24, currency: 4, importBytes: 2 * 1024 * 1024 };
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

  function str(v, max) { return typeof v === 'string' ? v.slice(0, max) : ''; }
  function num(v, min, max, fallback) {
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }
  function isValidTime(v) { return typeof v === 'string' && TIME_RE.test(v); }
  function isValidDate(v) {
    if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
    const [y, m, d] = v.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  // Every piece of data from storage, Firestore or a backup file passes through here,
  // so the rest of the app can trust the shape and never renders unchecked values.
  function normalizeState(raw) {
    const def = defaultState().settings;
    const src = raw && typeof raw === 'object' ? raw : {};
    const s = src.settings && typeof src.settings === 'object' ? src.settings : {};
    const settings = {
      currency: str(s.currency, LIMITS.currency).trim() || def.currency,
      rate: num(s.rate, 0, 100000, def.rate),
      weekendStartDow: Math.round(num(s.weekendStartDow, 0, 6, def.weekendStartDow)),
      weekendStartTime: isValidTime(s.weekendStartTime) ? s.weekendStartTime : def.weekendStartTime,
      weekendEndDow: Math.round(num(s.weekendEndDow, 0, 6, def.weekendEndDow)),
      weekendEndTime: isValidTime(s.weekendEndTime) ? s.weekendEndTime : def.weekendEndTime,
      weekendPercent: num(s.weekendPercent, 0, 1000, def.weekendPercent),
      holidayPercent: num(s.holidayPercent, 0, 1000, def.holidayPercent),
      overtimeThreshold: num(s.overtimeThreshold, 0, 24, def.overtimeThreshold),
      overtimePercent: num(s.overtimePercent, 0, 1000, def.overtimePercent),
      language: s.language === 'he' ? 'he' : 'en',
      goalType: s.goalType === 'income' ? 'income' : 'hours',
      goalValue: num(s.goalValue, 0, 10000000, def.goalValue)
    };
    const seen = new Set();
    const uniqueId = v => {
      let id = typeof v === 'string' && ID_RE.test(v) ? v : genId();
      while (seen.has(id)) id = genId();
      seen.add(id);
      return id;
    };
    const list = v => Array.isArray(v) ? v : [];
    const shifts = list(src.shifts)
      .filter(x => x && isValidDate(x.date) && isValidTime(x.startTime) && isValidTime(x.endTime))
      .slice(0, LIMITS.shifts)
      .map(x => ({ id: uniqueId(x.id), date: x.date, startTime: x.startTime, endTime: x.endTime, isHoliday: x.isHoliday === true, note: str(x.note, LIMITS.note) }));
    const incomes = list(src.incomes)
      .filter(x => x && isValidDate(x.date) && num(x.amount, 0, 10000000, 0) > 0)
      .slice(0, LIMITS.incomes)
      .map(x => ({ id: uniqueId(x.id), date: x.date, category: str(x.category, LIMITS.category).trim() || 'other', amount: num(x.amount, 0, 10000000, 0), note: str(x.note, LIMITS.note) }));
    const templates = list(src.templates)
      .filter(x => x && str(x.name, LIMITS.tplName).trim() && isValidTime(x.startTime) && isValidTime(x.endTime))
      .slice(0, LIMITS.templates)
      .map(x => ({ id: uniqueId(x.id), name: str(x.name, LIMITS.tplName).trim(), startTime: x.startTime, endTime: x.endTime }));
    return { settings, shifts, incomes, templates };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return normalizeState(JSON.parse(raw));
    } catch(e) {}
    try {
      const oldRaw = localStorage.getItem(OLD_KEY);
      if (oldRaw) return normalizeState(migrateFromV1(JSON.parse(oldRaw)));
    } catch(e) {}
    return defaultState();
  }

  // OWNER_KEY records which account the local cache belongs to, so one person's
  // cached data is never uploaded into, or shown to, a different account.
  const OWNER_KEY = 'workTrackerOwner';
  function getCacheOwner() { try { return localStorage.getItem(OWNER_KEY); } catch(e) { return null; } }
  function clearLocalCache() {
    try { localStorage.removeItem(KEY); localStorage.removeItem(OLD_KEY); localStorage.removeItem(OWNER_KEY); } catch(e) {}
  }

  let state = load();
  let currentUser = null;
  let firestoreUnsub = null;
  let remoteReady = false;

  function saveLocal() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      if (currentUser) localStorage.setItem(OWNER_KEY, currentUser.uid);
    } catch(e) {}
  }

  // Firestore writes are batched: rapid changes (e.g. scrolling a wheel) become one write.
  const WRITE_DEBOUNCE_MS = 600;
  let writeTimer = null;
  function flushRemoteWrite() {
    clearTimeout(writeTimer);
    writeTimer = null;
    if (!currentUser || !remoteReady) return Promise.resolve();
    return db.collection('users').doc(currentUser.uid).set(state)
      .catch(err => { console.error('Firestore save failed:', err); showToast(t('syncFailed')); });
  }
  function save() {
    state = normalizeState(state);
    saveLocal();
    if (!currentUser) return;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(flushRemoteWrite, WRITE_DEBOUNCE_MS);
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && writeTimer) flushRemoteWrite(); });
  window.addEventListener('pagehide', () => { if (writeTimer) flushRemoteWrite(); });

  let toastTimer = null;
  function showToast(msg) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
  }

  function getLang() { return state.settings.language === 'he' ? 'he' : 'en'; }
  function t(key) { return I18N[getLang()][key] || key; }
  function categoryLabel(cat) { return CATEGORY_LABELS[getLang()][cat] || cat; }

  let activeTab = 'summary';
  let monthFilter = currentMonthStr();
  let goalMonth = currentMonthStr();
  let sheetMode = null;
  let editingId = null;
  let formShift = {};
  let formIncome = {};
  let formTemplate = {};
  let openSwipeRow = null;

  function fmt(n) {
    return (Math.round((n + Number.EPSILON) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function money(n) { return state.settings.currency + fmt(n); }
  function timeToMinutes(tm) { const [h,m] = tm.split(':').map(Number); return h*60+m; }

  function shiftRange(shift) {
    const start = new Date(shift.date + 'T' + shift.startTime + ':00');
    let end = new Date(shift.date + 'T' + shift.endTime + ':00');
    if (end <= start) end = new Date(end.getTime() + 24*3600*1000);
    return { start, end };
  }

  function windowDurationMinutes(settings) {
    const startTotal = settings.weekendStartDow*1440 + timeToMinutes(settings.weekendStartTime);
    let endTotal = settings.weekendEndDow*1440 + timeToMinutes(settings.weekendEndTime);
    let duration = endTotal - startTotal;
    if (duration <= 0) duration += 7*1440;
    return duration;
  }

  function weekendOverlapHours(start, end, settings) {
    const durationMin = windowDurationMinutes(settings);
    if (durationMin <= 0) return 0;
    let overlapMs = 0;
    let cursor = new Date(start);
    cursor.setDate(cursor.getDate() - 8);
    cursor.setHours(0,0,0,0);
    const limit = new Date(end.getTime() + 24*3600*1000);
    let guard = 0;
    while (cursor <= limit && guard < 40) {
      guard++;
      if (cursor.getDay() === settings.weekendStartDow) {
        const [sh, sm] = settings.weekendStartTime.split(':').map(Number);
        const winStart = new Date(cursor);
        winStart.setHours(sh, sm, 0, 0);
        const winEnd = new Date(winStart.getTime() + durationMin*60000);
        const overlapStart = Math.max(start.getTime(), winStart.getTime());
        const overlapEnd = Math.min(end.getTime(), winEnd.getTime());
        if (overlapEnd > overlapStart) overlapMs += (overlapEnd - overlapStart);
      }
      cursor.setDate(cursor.getDate()+1);
    }
    return overlapMs / 3600000;
  }

  function calcShift(shift) {
    const settings = state.settings;
    const { start, end } = shiftRange(shift);
    const totalHours = (end - start) / 3600000;
    const threshold = settings.overtimeThreshold || 0;
    const otPercent = settings.overtimePercent || 100;
    const overtimeHours = threshold > 0 ? Math.max(0, totalHours - threshold) : 0;
    const otBoundary = new Date(end.getTime() - overtimeHours*3600000);

    const baseWindowHours = Math.max(0, Math.min(totalHours - overtimeHours, weekendOverlapHours(start, otBoundary, settings)));
    const otWindowHours = overtimeHours > 0 ? Math.max(0, Math.min(overtimeHours, weekendOverlapHours(otBoundary, end, settings))) : 0;
    const baseHours = totalHours - overtimeHours;
    const baseRegularHours = baseHours - baseWindowHours;
    const otRegularHours = overtimeHours - otWindowHours;

    const holidayPct = shift.isHoliday ? settings.holidayPercent : 100;
    const pctBaseRegular = holidayPct;
    const pctBaseWindow = shift.isHoliday ? Math.max(settings.weekendPercent, settings.holidayPercent) : settings.weekendPercent;
    const pctOtRegular = Math.max(holidayPct, otPercent);
    const pctOtWindow = Math.max(pctBaseWindow, otPercent);

    const pay = baseRegularHours*settings.rate*pctBaseRegular/100
      + baseWindowHours*settings.rate*pctBaseWindow/100
      + otRegularHours*settings.rate*pctOtRegular/100
      + otWindowHours*settings.rate*pctOtWindow/100;
    const basePay = totalHours*settings.rate;
    const windowHours = baseWindowHours + otWindowHours;
    return { totalHours, windowHours, overtimeHours, pay, bonusPay: pay - basePay };
  }

  function monthKey(dateStr) { return dateStr.slice(0,7); }
  function currentMonthStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
  }
  function monthLabel(m) {
    const locale = getLang()==='he' ? 'he-IL' : undefined;
    return new Date(m + '-01T00:00:00').toLocaleDateString(locale, { year: 'numeric', month: 'short' });
  }
  function formatDateDisplay(v) {
    const locale = getLang()==='he' ? 'he-IL' : undefined;
    return new Date(v + 'T00:00:00').toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  function nowTimeStr() {
    const d = new Date();
    return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }
  function addHoursToTime(hhmm, hours) {
    const [h,m] = hhmm.split(':').map(Number);
    let total = ((h*60 + m + Math.round(hours*60)) % 1440 + 1440) % 1440;
    return String(Math.floor(total/60)).padStart(2,'0') + ':' + String(total%60).padStart(2,'0');
  }

  function allMonths() {
    const set = new Set();
    state.shifts.forEach(s => set.add(monthKey(s.date)));
    state.incomes.forEach(i => set.add(monthKey(i.date)));
    return Array.from(set).sort().reverse();
  }

  function renderPills(containerId) {
    const months = Array.from(new Set([currentMonthStr(), ...allMonths()])).sort().reverse();
    const el = $(containerId);
    const opts = [{ v: 'all', l: t('allTime') }].concat(months.map(m => ({ v: m, l: monthLabel(m) })));
    el.innerHTML = opts.map(o => `<button class="pill ${monthFilter === o.v ? 'active' : ''}" data-month="${o.v}">${o.l}</button>`).join('');
    el.querySelectorAll('.pill').forEach(btn => {
      btn.addEventListener('click', () => { monthFilter = btn.dataset.month; renderDataViews(); });
    });
  }

  function filteredShifts() {
    return state.shifts.filter(s => monthFilter === 'all' || monthKey(s.date) === monthFilter)
      .slice().sort((a,b) => (b.date+b.startTime).localeCompare(a.date+a.startTime));
  }
  function filteredIncomes() {
    return state.incomes.filter(i => monthFilter === 'all' || monthKey(i.date) === monthFilter)
      .slice().sort((a,b) => b.date.localeCompare(a.date));
  }

  function renderSummary() {
    renderPills('summaryMonthPills');
    const shifts = filteredShifts();
    const incomes = filteredIncomes();
    let totalHours=0, weekendHours=0, holidayHours=0, bonusPay=0, workPay=0;
    shifts.forEach(s => {
      const c = calcShift(s);
      totalHours += c.totalHours;
      weekendHours += c.windowHours;
      if (s.isHoliday) holidayHours += c.totalHours;
      bonusPay += c.bonusPay;
      workPay += c.pay;
    });
    const otherIncome = incomes.reduce((sum,i) => sum + i.amount, 0);

    $('sumTotal').textContent = money(workPay + otherIncome);
    $('sumSub').textContent = `${t('sumSubWork')} ${money(workPay)} · ${t('sumSubOther')} ${money(otherIncome)}`;
    $('statDays').textContent = shifts.length;
    $('statHours').textContent = fmt(totalHours);
    $('statWeekendHours').textContent = fmt(weekendHours);
    $('statHolidayHours').textContent = fmt(holidayHours);
    $('statBonusPay').textContent = money(bonusPay);
    $('statWorkPay').textContent = money(workPay);
    $('statOtherIncome').textContent = money(otherIncome);
  }

  // ---- swipe to delete ----
  function isRtl() { return document.documentElement.getAttribute('dir') === 'rtl'; }
  function setRowOpen(rowEl, open) {
    if (openSwipeRow && openSwipeRow !== rowEl) setRowOpen(openSwipeRow, false);
    const rtl = isRtl();
    if (open) {
      rowEl.style.transform = `translateX(${rtl ? SWIPE_W : -SWIPE_W}px)`;
      rowEl.classList.add('open');
      openSwipeRow = rowEl;
    } else {
      rowEl.style.transform = 'translateX(0px)';
      rowEl.classList.remove('open');
      if (openSwipeRow === rowEl) openSwipeRow = null;
    }
  }
  document.addEventListener('pointerdown', (e) => {
    if (openSwipeRow && !openSwipeRow.parentElement.contains(e.target)) setRowOpen(openSwipeRow, false);
  });

  function attachSwipe(wrapEl, onDelete) {
    const rowEl = wrapEl.querySelector('.entry-row');
    const delBtn = wrapEl.querySelector('.entry-swipe-delete');
    let startX=0, startY=0, dragging=false, isHorizontal=null, moved=false, currentX=0;

    rowEl.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      startX = e.clientX; startY = e.clientY; dragging = true; isHorizontal = null; moved = false;
      rowEl.style.transition = 'none';
      try { rowEl.setPointerCapture(e.pointerId); } catch(err) {}
    });
    rowEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (isHorizontal === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        isHorizontal = Math.abs(dx) > Math.abs(dy);
        if (!isHorizontal) { dragging = false; return; }
      }
      moved = true;
      const rtl = isRtl();
      const base = rowEl.classList.contains('open') ? (rtl ? SWIPE_W : -SWIPE_W) : 0;
      let x = base + dx;
      x = rtl ? Math.max(0, Math.min(SWIPE_W, x)) : Math.min(0, Math.max(-SWIPE_W, x));
      currentX = x;
      rowEl.style.transform = `translateX(${x}px)`;
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      rowEl.style.transition = '';
      if (!moved) return;
      const rtl = isRtl();
      const openNow = rtl ? currentX > SWIPE_W/2 : currentX < -SWIPE_W/2;
      setRowOpen(rowEl, openNow);
      rowEl.dataset.justSwiped = '1';
    }
    rowEl.addEventListener('pointerup', endDrag);
    rowEl.addEventListener('pointercancel', endDrag);
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); onDelete(); });
    return rowEl;
  }

  function renderShifts() {
    renderPills('shiftsMonthPills');
    const shifts = filteredShifts();
    openSwipeRow = null;
    if (!shifts.length) {
      $('shiftsList').outerHTML = `<div class="list-group" id="shiftsList"><div class="empty-state"><div class="big">${ICON_CLOCK}</div>${t('emptyShifts')}</div></div>`;
      return;
    }
    const html = shifts.map(s => {
      const c = calcShift(s);
      const dname = formatDateDisplay(s.date);
      let badges = '';
      if (c.windowHours > 0) badges += `<span class="badge badge-weekend">${t('badgeWeekend')} ${fmt(c.windowHours)}h</span>`;
      if (s.isHoliday) badges += `<span class="badge badge-holiday">${t('badgeHoliday')}</span>`;
      if (c.overtimeHours > 0) badges += `<span class="badge badge-overtime">${t('badgeOvertime')} ${fmt(c.overtimeHours)}h</span>`;
      return `<div class="entry-row-wrap">
        <button class="entry-swipe-delete">${ICON_TRASH}</button>
        <div class="entry-row" data-id="${escapeHtml(s.id)}" data-kind="shift">
          <div class="entry-main">
            <div class="entry-date">${escapeHtml(dname)}</div>
            <div class="entry-sub">${s.startTime}–${s.endTime} · ${fmt(c.totalHours)}h${s.note ? ' · ' + escapeHtml(s.note) : ''}</div>
            <div class="entry-badges">${badges}</div>
          </div>
          <div class="entry-amount">${escapeHtml(money(c.pay))}</div>
          <div class="entry-chevron">›</div>
        </div>
      </div>`;
    }).join('');
    $('shiftsList').outerHTML = `<div class="list-group" id="shiftsList">${html}</div>`;
    attachRowHandlers($('shiftsList'));
  }

  function renderIncomes() {
    renderPills('incomeMonthPills');
    const incomes = filteredIncomes();
    openSwipeRow = null;
    if (!incomes.length) {
      $('incomeList').outerHTML = `<div class="list-group" id="incomeList"><div class="empty-state"><div class="big">${ICON_WALLET}</div>${t('emptyIncome')}</div></div>`;
      return;
    }
    const html = incomes.map(i => {
      const dname = formatDateDisplay(i.date);
      return `<div class="entry-row-wrap">
        <button class="entry-swipe-delete">${ICON_TRASH}</button>
        <div class="entry-row" data-id="${escapeHtml(i.id)}" data-kind="income">
          <div class="entry-main">
            <div class="entry-date">${escapeHtml(categoryLabel(i.category))}</div>
            <div class="entry-sub">${escapeHtml(dname)}${i.note ? ' · ' + escapeHtml(i.note) : ''}</div>
          </div>
          <div class="entry-amount">${escapeHtml(money(i.amount))}</div>
          <div class="entry-chevron">›</div>
        </div>
      </div>`;
    }).join('');
    $('incomeList').outerHTML = `<div class="list-group" id="incomeList">${html}</div>`;
    attachRowHandlers($('incomeList'));
  }

  function deleteShift(id) { state.shifts = state.shifts.filter(s => s.id !== id); save(); renderDataViews(); }
  function deleteIncome(id) { state.incomes = state.incomes.filter(i => i.id !== id); save(); renderDataViews(); }

  function attachRowHandlers(container) {
    container.querySelectorAll('.entry-row-wrap').forEach(wrap => {
      const rowEl = wrap.querySelector('.entry-row');
      const id = rowEl.dataset.id;
      const kind = rowEl.dataset.kind;
      attachSwipe(wrap, () => kind === 'shift' ? deleteShift(id) : deleteIncome(id));
      rowEl.addEventListener('click', () => {
        if (rowEl.dataset.justSwiped) { delete rowEl.dataset.justSwiped; return; }
        if (kind === 'shift') openShiftSheet(id); else openIncomeSheet(id);
      });
    });
  }

  // ---- goals ----
  function renderGoalPills() {
    const months = Array.from(new Set([currentMonthStr(), ...allMonths()])).sort().reverse();
    const el = $('goalMonthPills');
    el.innerHTML = months.map(m => `<button class="pill ${goalMonth===m?'active':''}" data-month="${m}">${monthLabel(m)}</button>`).join('');
    el.querySelectorAll('.pill').forEach(btn => btn.addEventListener('click', () => { goalMonth = btn.dataset.month; renderGoals(); }));
  }
  function loadGoalForm() {
    $('goalTargetInput').value = state.settings.goalValue || '';
    $('goalTypeToggle').querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.goaltype === (state.settings.goalType||'hours')));
  }
  $('goalTypeToggle').querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
    state.settings.goalType = b.dataset.goaltype;
    save(); loadGoalForm(); renderGoals();
  }));
  $('goalTargetInput').addEventListener('change', () => {
    state.settings.goalValue = num($('goalTargetInput').value, 0, 10000000, 0);
    save(); loadGoalForm(); renderGoals();
  });

  function renderGoals() {
    renderGoalPills();
    const shifts = state.shifts.filter(s => monthKey(s.date) === goalMonth);
    const incomes = state.incomes.filter(i => monthKey(i.date) === goalMonth);
    let totalHours = 0, workPay = 0;
    shifts.forEach(s => { const c = calcShift(s); totalHours += c.totalHours; workPay += c.pay; });
    const otherIncome = incomes.reduce((sum,i) => sum + i.amount, 0);
    const totalEarn = workPay + otherIncome;

    const type = state.settings.goalType || 'hours';
    const target = state.settings.goalValue || 0;
    const achieved = type === 'hours' ? totalHours : totalEarn;
    const pct = target > 0 ? Math.min(1, achieved/target) : 0;
    const CIRC = 2*Math.PI*52;
    const ring = $('goalRingProgress');
    ring.setAttribute('stroke-dasharray', CIRC);
    ring.setAttribute('stroke-dashoffset', CIRC*(1-pct));
    ring.style.stroke = (target>0 && achieved>=target) ? 'var(--green)' : 'var(--accent)';
    $('goalPercent').textContent = target>0 ? Math.round(pct*100)+'%' : '—';

    const fmtVal = v => type==='hours' ? fmt(v)+'h' : money(v);
    $('goalAchievedLabel').textContent = target>0 ? `${fmtVal(achieved)} ${t('goalOf')} ${fmtVal(target)}` : fmtVal(achieved);
    if (target<=0) $('goalRemainingLabel').textContent = t('goalSetPrompt');
    else if (achieved>=target) $('goalRemainingLabel').textContent = t('goalReached');
    else $('goalRemainingLabel').textContent = `${fmtVal(target-achieved)} ${t('goalRemaining')}`;
  }

  function renderDataViews() {
    renderSummary();
    renderShifts();
    renderIncomes();
    renderGoals();
  }

  // ---- static i18n ----
  function applyStaticTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  }

  // ---- plain settings inputs ----
  function loadSettingsForm() {
    const s = state.settings;
    $('setCurrency').value = s.currency;
    $('setRate').value = s.rate;
    $('setWkPercent').value = s.weekendPercent;
    $('setHolidayPercent').value = s.holidayPercent;
    $('setOtThreshold').value = s.overtimeThreshold;
    $('setOtPercent').value = s.overtimePercent;
  }
  // Invalid or out-of-range input keeps the previous value instead of silently becoming 0.
  function readSettingsForm() {
    const s = state.settings;
    s.currency = $('setCurrency').value.trim().slice(0, LIMITS.currency) || s.currency;
    s.rate = num($('setRate').value, 0, 100000, s.rate);
    s.weekendPercent = num($('setWkPercent').value, 0, 1000, s.weekendPercent);
    s.holidayPercent = num($('setHolidayPercent').value, 0, 1000, s.holidayPercent);
    s.overtimeThreshold = num($('setOtThreshold').value, 0, 24, s.overtimeThreshold);
    s.overtimePercent = num($('setOtPercent').value, 0, 1000, s.overtimePercent);
    save();
    loadSettingsForm();
    renderDataViews();
  }
  ['setCurrency','setRate','setWkPercent','setHolidayPercent','setOtThreshold','setOtPercent'].forEach(id => $(id).addEventListener('change', readSettingsForm));

  $('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'work-tracker-backup-' + new Date().toISOString().slice(0,10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  $('importInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > LIMITS.importBytes) { alert(t('alertImportTooBig')); return; }
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try {
        data = JSON.parse(reader.result);
        if (!data || typeof data !== 'object' || !data.settings) throw new Error(t('alertImportInvalid'));
      } catch (err) {
        alert(t('alertImportFail') + err.message);
        return;
      }
      if (!confirm(t('confirmImport'))) return;
      state = normalizeState(data);
      save();
      refreshAll();
      alert(t('alertImportOk'));
    };
    reader.onerror = () => alert(t('alertImportFail') + t('alertImportInvalid'));
    reader.readAsText(file);
  });

  $('resetBtn').addEventListener('click', openEraseSheet);

  // Erasing also wipes the cloud copy, so it needs a typed confirmation, not just a tap.
  function openEraseSheet() {
    sheetMode = 'erase'; editingId = null;
    const word = t('eraseWord');
    $('sheetTitle').textContent = t('eraseTitle');
    $('sheetSave').style.visibility = 'hidden';
    $('sheetBody').innerHTML = `
      <div class="erase-warning"><strong>${escapeHtml(t('eraseWarnTitle'))}</strong>${escapeHtml(t('eraseWarnBody'))}</div>
      <div class="field-group">
        <div class="section-header" style="margin:0 2px 8px;">${escapeHtml(t('eraseTypeLabel').replace('{w}', word))}</div>
        <div class="list-group"><label class="auth-field"><input type="text" id="fEraseConfirm" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${escapeHtml(word)}"></label></div>
      </div>
      <button type="button" class="btn-danger btn-block" id="fEraseBtn" disabled>${escapeHtml(t('eraseConfirmBtn'))}</button>
    `;
    const input = $('fEraseConfirm');
    const btn = $('fEraseBtn');
    const matches = () => input.value.trim().toUpperCase() === word.toUpperCase();
    input.addEventListener('input', () => { btn.disabled = !matches(); });
    btn.addEventListener('click', () => {
      if (!matches()) return;
      const language = state.settings.language;
      state = defaultState();
      state.settings.language = language;
      save();
      flushRemoteWrite();
      closeSheetOverlay();
      refreshAll();
      showToast(t('eraseDone'));
    });
    openSheetOverlay();
  }

  function refreshAll() {
    loadSettingsForm();
    loadGoalForm();
    resyncSettingsWheels();
    applyLanguage();
  }

  // ---- tabs ----
  function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.tab-page').forEach(p => p.classList.add('hidden'));
    $('tab-' + tab).classList.remove('hidden');
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('fab').classList.toggle('hidden', tab === 'summary' || tab === 'settings' || tab === 'goals');
    $('content').scrollTop = 0;
  }
  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
  $('fab').addEventListener('click', () => {
    if (activeTab === 'shifts') openShiftSheet(null);
    else if (activeTab === 'income') openIncomeSheet(null);
  });

  // ---- sheet plumbing ----
  function openSheetOverlay() { $('sheetOverlay').classList.remove('hidden'); }
  function closeSheetOverlay() {
    $('sheetOverlay').classList.add('hidden');
    $('sheetSave').style.visibility = '';
    sheetMode = null;
    editingId = null;
  }
  $('sheetCancel').addEventListener('click', closeSheetOverlay);
  $('sheetOverlay').addEventListener('click', (e) => { if (e.target === $('sheetOverlay')) closeSheetOverlay(); });

  function syncWheelScroll(colEl) {
    const sel = colEl.querySelector('.wheel-item.selected');
    if (sel) colEl.scrollTop = parseInt(sel.dataset.index, 10) * ITEM_H;
  }
  function setupPickerToggles(root) {
    root.querySelectorAll('[data-toggle]').forEach(row => {
      row.addEventListener('click', () => {
        const panel = document.getElementById(row.dataset.toggle);
        const wasHidden = panel.classList.contains('hidden');
        root.querySelectorAll('.wheel-panel').forEach(p => p.classList.add('hidden'));
        if (wasHidden) {
          panel.classList.remove('hidden');
          panel.querySelectorAll('.wheel-col').forEach(syncWheelScroll);
        }
      });
    });
  }

  // ---- wheel picker core ----
  function buildWheelColumn(colEl, labels, selectedIndex) {
    colEl.innerHTML = '<div class="wheel-pad"></div>' +
      labels.map((l,i) => `<div class="wheel-item${i===selectedIndex?' selected':''}" data-index="${i}">${l}</div>`).join('') +
      '<div class="wheel-pad"></div>';
    colEl.scrollTop = selectedIndex * ITEM_H;
  }
  function relabelWheelColumn(colEl, labels) {
    colEl.querySelectorAll('.wheel-item').forEach(el => { el.textContent = labels[parseInt(el.dataset.index,10)]; });
  }
  function markWheelSelected(colEl, idx) {
    colEl.querySelectorAll('.wheel-item').forEach(el => el.classList.toggle('selected', parseInt(el.dataset.index,10)===idx));
  }
  function bindWheelScroll(colEl, onSettle) {
    let timer;
    colEl.addEventListener('scroll', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const items = colEl.querySelectorAll('.wheel-item');
        let idx = Math.round(colEl.scrollTop / ITEM_H);
        idx = Math.max(0, Math.min(items.length-1, idx));
        colEl.scrollTo({ top: idx*ITEM_H, behavior:'smooth' });
        markWheelSelected(colEl, idx);
        onSettle(idx);
      }, 130);
    }, { passive:true });
  }
  function bindWheelClicks(colEl, onSettle) {
    colEl.querySelectorAll('.wheel-item').forEach(el => {
      el.onclick = () => {
        const idx = parseInt(el.dataset.index,10);
        colEl.scrollTo({ top: idx*ITEM_H, behavior:'smooth' });
        markWheelSelected(colEl, idx);
        onSettle(idx);
      };
    });
  }

  function initDatePicker(panelEl, initialDateStr, onChange) {
    const lang = getLang();
    const d = new Date(initialDateStr + 'T00:00:00');
    const st = { day: d.getDate(), month: d.getMonth(), year: d.getFullYear() };
    const dayCol = panelEl.querySelector('[data-col="day"]');
    const monthCol = panelEl.querySelector('[data-col="month"]');
    const yearCol = panelEl.querySelector('[data-col="year"]');
    const nowY = new Date().getFullYear();
    const years = []; for (let y=nowY-3; y<=nowY+2; y++) years.push(y);

    function cur() { return st.year + '-' + String(st.month+1).padStart(2,'0') + '-' + String(st.day).padStart(2,'0'); }
    function rebuildDay() {
      const count = new Date(st.year, st.month+1, 0).getDate();
      if (st.day > count) st.day = count;
      buildWheelColumn(dayCol, Array.from({length:count},(_,i)=>String(i+1)), st.day-1);
      bindWheelClicks(dayCol, idx => { st.day = idx+1; onChange(cur()); });
    }

    buildWheelColumn(monthCol, MONTH_NAMES[lang], st.month);
    buildWheelColumn(yearCol, years.map(String), years.indexOf(st.year));
    rebuildDay();

    bindWheelScroll(dayCol, idx => { st.day = idx+1; onChange(cur()); });
    bindWheelScroll(monthCol, idx => { st.month = idx; rebuildDay(); onChange(cur()); });
    bindWheelScroll(yearCol, idx => { st.year = years[idx]; rebuildDay(); onChange(cur()); });
    bindWheelClicks(monthCol, idx => { st.month = idx; rebuildDay(); onChange(cur()); });
    bindWheelClicks(yearCol, idx => { st.year = years[idx]; rebuildDay(); onChange(cur()); });

    onChange(cur());
  }

  function initTimePicker(panelEl, initialTimeStr, onChange) {
    const [h,m] = initialTimeStr.split(':').map(Number);
    const st = { hour:h, minute:m };
    const hourCol = panelEl.querySelector('[data-col="hour"]');
    const minCol = panelEl.querySelector('[data-col="minute"]');
    function cur() { return String(st.hour).padStart(2,'0')+':'+String(st.minute).padStart(2,'0'); }
    buildWheelColumn(hourCol, HOURS, st.hour);
    buildWheelColumn(minCol, MINUTES, st.minute);
    bindWheelScroll(hourCol, idx => { st.hour=idx; onChange(cur()); });
    bindWheelScroll(minCol, idx => { st.minute=idx; onChange(cur()); });
    bindWheelClicks(hourCol, idx => { st.hour=idx; onChange(cur()); });
    bindWheelClicks(minCol, idx => { st.minute=idx; onChange(cur()); });
    onChange(cur());
  }

  // ---- settings persistent wheels (weekend window) ----
  function setWkTime(field, part, idx) {
    const cur = state.settings[field].split(':').map(Number);
    if (part==='hour') cur[0]=idx; else cur[1]=idx;
    state.settings[field] = String(cur[0]).padStart(2,'0')+':'+String(cur[1]).padStart(2,'0');
    save(); updateSettingsPickerValues(); renderDataViews();
  }

  function resyncSettingsWheels() {
    const s = state.settings;
    const lang = getLang();

    buildWheelColumn($('wkStartDayCol'), DOW_FULL[lang], s.weekendStartDow);
    bindWheelClicks($('wkStartDayCol'), idx => { state.settings.weekendStartDow = idx; save(); updateSettingsPickerValues(); renderDataViews(); });

    buildWheelColumn($('wkEndDayCol'), DOW_FULL[lang], s.weekendEndDow);
    bindWheelClicks($('wkEndDayCol'), idx => { state.settings.weekendEndDow = idx; save(); updateSettingsPickerValues(); renderDataViews(); });

    const [sh,sm] = s.weekendStartTime.split(':').map(Number);
    buildWheelColumn($('wkStartHourCol'), HOURS, sh);
    buildWheelColumn($('wkStartMinCol'), MINUTES, sm);
    bindWheelClicks($('wkStartHourCol'), idx => setWkTime('weekendStartTime','hour',idx));
    bindWheelClicks($('wkStartMinCol'), idx => setWkTime('weekendStartTime','minute',idx));

    const [eh,em] = s.weekendEndTime.split(':').map(Number);
    buildWheelColumn($('wkEndHourCol'), HOURS, eh);
    buildWheelColumn($('wkEndMinCol'), MINUTES, em);
    bindWheelClicks($('wkEndHourCol'), idx => setWkTime('weekendEndTime','hour',idx));
    bindWheelClicks($('wkEndMinCol'), idx => setWkTime('weekendEndTime','minute',idx));

    updateSettingsPickerValues();
  }

  function initSettingsPickers() {
    resyncSettingsWheels();
    bindWheelScroll($('wkStartDayCol'), idx => { state.settings.weekendStartDow = idx; save(); updateSettingsPickerValues(); renderDataViews(); });
    bindWheelScroll($('wkEndDayCol'), idx => { state.settings.weekendEndDow = idx; save(); updateSettingsPickerValues(); renderDataViews(); });
    bindWheelScroll($('wkStartHourCol'), idx => setWkTime('weekendStartTime','hour',idx));
    bindWheelScroll($('wkStartMinCol'), idx => setWkTime('weekendStartTime','minute',idx));
    bindWheelScroll($('wkEndHourCol'), idx => setWkTime('weekendEndTime','hour',idx));
    bindWheelScroll($('wkEndMinCol'), idx => setWkTime('weekendEndTime','minute',idx));
    setupPickerToggles(document);
  }

  function updateSettingsPickerValues() {
    const lang = getLang();
    $('wkStartDayValue').textContent = DOW_FULL[lang][state.settings.weekendStartDow];
    $('wkStartTimeValue').textContent = state.settings.weekendStartTime;
    $('wkEndDayValue').textContent = DOW_FULL[lang][state.settings.weekendEndDow];
    $('wkEndTimeValue').textContent = state.settings.weekendEndTime;
  }

  // ---- language ----
  function applyLanguage() {
    const lang = getLang();
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', lang === 'he' ? 'rtl' : 'ltr');
    applyStaticTranslations();
    relabelWheelColumn($('wkStartDayCol'), DOW_FULL[lang]);
    relabelWheelColumn($('wkEndDayCol'), DOW_FULL[lang]);
    updateSettingsPickerValues();
    $('languageToggle').querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
    renderDataViews();
    renderTemplatesSettings();
  }
  $('languageToggle').querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
    state.settings.language = b.dataset.lang;
    save();
    applyLanguage();
  }));

  // ---- shift templates: read-only picker inside Add Shift ----
  function renderShiftTemplateChips() {
    const container = $('templateChips');
    if (!container) return;
    if (!state.templates.length) {
      container.innerHTML = `<div class="tpl-empty-hint">${t('noTemplatesHint')}</div>`;
      return;
    }
    container.innerHTML = state.templates.map(tpl => `
      <button class="tpl-chip-select" data-apply="${escapeHtml(tpl.id)}">
        <span class="tpl-name">${escapeHtml(tpl.name)}</span>
        <span class="tpl-time">${tpl.startTime}–${tpl.endTime}</span>
      </button>`).join('');
    container.querySelectorAll('[data-apply]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tpl = state.templates.find(x => x.id === btn.dataset.apply);
        if (!tpl) return;
        formShift.startTime = tpl.startTime;
        formShift.endTime = tpl.endTime;
        $('valShiftStart').textContent = tpl.startTime;
        $('valShiftEnd').textContent = tpl.endTime;
        initTimePicker($('panelShiftStart'), tpl.startTime, v => { formShift.startTime=v; $('valShiftStart').textContent=v; });
        initTimePicker($('panelShiftEnd'), tpl.endTime, v => { formShift.endTime=v; $('valShiftEnd').textContent=v; });
      });
    });
  }

  // ---- shift templates: manage in Settings ----
  function renderTemplatesSettings() {
    const el = $('templatesSettingsList');
    if (!el) return;
    if (!state.templates.length) {
      el.innerHTML = `<div class="list-row"><div class="rlabel" style="color:var(--muted);">${t('templatesEmpty')}</div></div>`;
      return;
    }
    const last = state.templates.length - 1;
    const arrow = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
    el.innerHTML = state.templates.map((tpl, i) => `
      <div class="list-row picker-row tpl-row" data-template-id="${escapeHtml(tpl.id)}">
        <div class="rlabel">${escapeHtml(tpl.name)}<span class="rsub">${tpl.startTime}–${tpl.endTime}</span></div>
        ${last > 0 ? `<div class="tpl-order">
          <button type="button" class="tpl-move" data-move="-1" aria-label="${escapeHtml(t('moveUp'))}" ${i === 0 ? 'disabled' : ''}>${arrow('M6 15l6-6 6 6')}</button>
          <button type="button" class="tpl-move" data-move="1" aria-label="${escapeHtml(t('moveDown'))}" ${i === last ? 'disabled' : ''}>${arrow('M6 9l6 6 6-6')}</button>
        </div>` : ''}
        <span class="entry-chevron">›</span>
      </div>`).join('');
    el.querySelectorAll('[data-template-id]').forEach(row => {
      row.addEventListener('click', () => openTemplateSheet(row.dataset.templateId));
    });
    el.querySelectorAll('.tpl-move').forEach(btn => btn.addEventListener('click', e => {
      e.stopPropagation();
      moveTemplate(btn.closest('[data-template-id]').dataset.templateId, parseInt(btn.dataset.move, 10));
    }));
  }

  function moveTemplate(id, dir) {
    const i = state.templates.findIndex(x => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= state.templates.length) return;
    const list = state.templates.slice();
    [list[i], list[j]] = [list[j], list[i]];
    state.templates = list;
    save();
    renderTemplatesSettings();
  }
  $('addTemplateBtn').addEventListener('click', () => openTemplateSheet(null));

  function openTemplateSheet(id) {
    sheetMode = 'template'; editingId = id;
    const tpl = id ? state.templates.find(x => x.id === id) : null;
    formTemplate = {
      name: tpl ? tpl.name : '',
      startTime: tpl ? tpl.startTime : '09:00',
      endTime: tpl ? tpl.endTime : '17:00'
    };
    $('sheetTitle').textContent = tpl ? t('sheetEditTemplate') : t('sheetNewTemplate');
    $('sheetBody').innerHTML = `
      <div class="field-group">
        <div class="list-group">
          <div class="list-row"><div class="rlabel" data-i18n="fieldTemplateName">Name</div><input type="text" id="fTplName" placeholder="${escapeHtml(t('templateNamePlaceholder'))}" value="${escapeHtml(formTemplate.name)}" maxlength="${LIMITS.tplName}"></div>
        </div>
      </div>
      <div class="field-group">
        <div class="list-group">
          <div class="list-row picker-row" data-toggle="panelTplStart"><div class="rlabel" data-i18n="fieldStartTime">Start time</div><div><span class="picker-value" id="valTplStart"></span><span class="chev">⌄</span></div></div>
        </div>
        <div class="wheel-panel hidden" id="panelTplStart">
          <div class="wheel-fade-top"></div>
          <div class="wheel-col" data-col="hour"></div>
          <div class="wheel-col" data-col="minute"></div>
          <div class="wheel-highlight"></div>
          <div class="wheel-fade-bottom"></div>
        </div>
        <div class="list-group" style="margin-top:10px;">
          <div class="list-row picker-row" data-toggle="panelTplEnd"><div class="rlabel" data-i18n="fieldEndTime">End time</div><div><span class="picker-value" id="valTplEnd"></span><span class="chev">⌄</span></div></div>
        </div>
        <div class="wheel-panel hidden" id="panelTplEnd">
          <div class="wheel-fade-top"></div>
          <div class="wheel-col" data-col="hour"></div>
          <div class="wheel-col" data-col="minute"></div>
          <div class="wheel-highlight"></div>
          <div class="wheel-fade-bottom"></div>
        </div>
      </div>
      ${tpl ? `<button class="btn-danger btn-block" id="fDelete" data-i18n="deleteTemplateBtn">Delete Template</button>` : ''}
    `;
    applyStaticTranslations();
    initTimePicker($('panelTplStart'), formTemplate.startTime, v => { formTemplate.startTime = v; $('valTplStart').textContent = v; });
    initTimePicker($('panelTplEnd'), formTemplate.endTime, v => { formTemplate.endTime = v; $('valTplEnd').textContent = v; });
    setupPickerToggles($('sheetBody'));
    if (tpl) $('fDelete').addEventListener('click', () => {
      if (!confirm(t('confirmDeleteTemplate'))) return;
      state.templates = state.templates.filter(x => x.id !== id);
      save(); closeSheetOverlay(); renderTemplatesSettings();
    });
    openSheetOverlay();
  }

  // ---- add/edit shift sheet ----
  function openShiftSheet(id) {
    sheetMode = 'shift'; editingId = id;
    const shift = id ? state.shifts.find(s => s.id === id) : null;
    const defaultStart = nowTimeStr();
    formShift = {
      date: shift ? shift.date : todayStr(),
      startTime: shift ? shift.startTime : defaultStart,
      endTime: shift ? shift.endTime : addHoursToTime(defaultStart, 8)
    };
    $('sheetTitle').textContent = shift ? t('sheetEditShift') : t('sheetNewShift');
    $('sheetBody').innerHTML = `
      <div class="field-group">
        <div class="list-group">
          <div class="list-row picker-row" data-toggle="panelShiftDate"><div class="rlabel" data-i18n="fieldDate">Date</div><div><span class="picker-value" id="valShiftDate"></span><span class="chev">⌄</span></div></div>
        </div>
        <div class="wheel-panel hidden" id="panelShiftDate">
          <div class="wheel-fade-top"></div>
          <div class="wheel-col" data-col="day"></div>
          <div class="wheel-col" data-col="month"></div>
          <div class="wheel-col" data-col="year"></div>
          <div class="wheel-highlight"></div>
          <div class="wheel-fade-bottom"></div>
        </div>
      </div>
      <div class="field-group">
        <div class="section-header" data-i18n="fieldTemplates" style="margin:0 2px 8px;">Templates</div>
        <div class="template-chips" id="templateChips"></div>
      </div>
      <div class="field-group">
        <div class="list-group">
          <div class="list-row picker-row" data-toggle="panelShiftStart"><div class="rlabel" data-i18n="fieldStartTime">Start time</div><div><span class="picker-value" id="valShiftStart"></span><span class="chev">⌄</span></div></div>
        </div>
        <div class="wheel-panel hidden" id="panelShiftStart">
          <div class="wheel-fade-top"></div>
          <div class="wheel-col" data-col="hour"></div>
          <div class="wheel-col" data-col="minute"></div>
          <div class="wheel-highlight"></div>
          <div class="wheel-fade-bottom"></div>
        </div>
        <div class="list-group" style="margin-top:10px;">
          <div class="list-row picker-row" data-toggle="panelShiftEnd"><div class="rlabel" data-i18n="fieldEndTime">End time</div><div><span class="picker-value" id="valShiftEnd"></span><span class="chev">⌄</span></div></div>
        </div>
        <div class="wheel-panel hidden" id="panelShiftEnd">
          <div class="wheel-fade-top"></div>
          <div class="wheel-col" data-col="hour"></div>
          <div class="wheel-col" data-col="minute"></div>
          <div class="wheel-highlight"></div>
          <div class="wheel-fade-bottom"></div>
        </div>
      </div>
      <div class="field-group">
        <div class="list-group">
          <div class="list-row">
            <div class="rlabel" data-i18n="fieldHoliday">Holiday<span class="rsub" data-i18n="fieldHolidaySub">Applies the holiday bonus %</span></div>
            <label class="switch"><input type="checkbox" id="fHoliday" ${shift && shift.isHoliday ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></label>
          </div>
        </div>
      </div>
      <div class="field-group">
        <div class="list-group">
          <div class="list-row"><div class="rlabel" data-i18n="fieldNote">Note</div><input type="text" id="fNote" maxlength="${LIMITS.note}" placeholder="${escapeHtml(t('notePlaceholder'))}" value="${shift && shift.note ? escapeHtml(shift.note) : ''}"></div>
        </div>
      </div>
      ${shift ? `<button class="btn-danger btn-block" id="fDelete" data-i18n="deleteShiftBtn">Delete Shift</button>` : ''}
    `;
    applyStaticTranslations();
    initDatePicker($('panelShiftDate'), formShift.date, v => { formShift.date = v; $('valShiftDate').textContent = formatDateDisplay(v); });
    initTimePicker($('panelShiftStart'), formShift.startTime, v => { formShift.startTime = v; $('valShiftStart').textContent = v; });
    initTimePicker($('panelShiftEnd'), formShift.endTime, v => { formShift.endTime = v; $('valShiftEnd').textContent = v; });
    renderShiftTemplateChips();
    setupPickerToggles($('sheetBody'));
    if (shift) $('fDelete').addEventListener('click', () => {
      if (!confirm(t('confirmDeleteShift'))) return;
      deleteShift(id);
      closeSheetOverlay();
    });
    openSheetOverlay();
  }

  function openIncomeSheet(id) {
    sheetMode = 'income'; editingId = id;
    const income = id ? state.incomes.find(i => i.id === id) : null;
    const lang = getLang();
    let currentKey = 'driving';
    let customVal = '';
    if (income) {
      if (CATEGORY_KEYS.includes(income.category)) currentKey = income.category;
      else { currentKey = 'other'; customVal = income.category; }
    }
    formIncome = { date: income ? income.date : todayStr() };
    $('sheetTitle').textContent = income ? t('sheetEditIncome') : t('sheetNewIncome');
    $('sheetBody').innerHTML = `
      <div class="field-group">
        <div class="list-group">
          <div class="list-row picker-row" data-toggle="panelIncomeDate"><div class="rlabel" data-i18n="fieldDate">Date</div><div><span class="picker-value" id="valIncomeDate"></span><span class="chev">⌄</span></div></div>
        </div>
        <div class="wheel-panel hidden" id="panelIncomeDate">
          <div class="wheel-fade-top"></div>
          <div class="wheel-col" data-col="day"></div>
          <div class="wheel-col" data-col="month"></div>
          <div class="wheel-col" data-col="year"></div>
          <div class="wheel-highlight"></div>
          <div class="wheel-fade-bottom"></div>
        </div>
      </div>
      <div class="field-group">
        <div class="list-group">
          <div class="list-row">
            <div class="rlabel" data-i18n="fieldCategory">Category</div>
            <select id="fCategory">
              ${CATEGORY_KEYS.map(k => `<option value="${k}" ${k===currentKey?'selected':''}>${CATEGORY_LABELS[lang][k]}</option>`).join('')}
            </select>
          </div>
          <div class="list-row ${currentKey==='other'?'':'hidden'}" id="fCustomCatRow"><div class="rlabel" data-i18n="fieldCustomLabel">Custom label</div><input type="text" id="fCustomCat" maxlength="${LIMITS.category}" placeholder="${escapeHtml(t('customLabelPlaceholder'))}" value="${escapeHtml(customVal)}"></div>
          <div class="list-row"><div class="rlabel" data-i18n="fieldAmount">Amount</div><input type="number" id="fAmount" min="0" max="10000000" step="0.01" inputmode="decimal" value="${income ? escapeHtml(income.amount) : ''}"></div>
        </div>
      </div>
      <div class="field-group">
        <div class="list-group">
          <div class="list-row"><div class="rlabel" data-i18n="fieldNote">Note</div><input type="text" id="fNote" maxlength="${LIMITS.note}" placeholder="${escapeHtml(t('notePlaceholder'))}" value="${income && income.note ? escapeHtml(income.note) : ''}"></div>
        </div>
      </div>
      ${income ? `<button class="btn-danger btn-block" id="fDelete" data-i18n="deleteIncomeBtn">Delete Entry</button>` : ''}
    `;
    applyStaticTranslations();
    initDatePicker($('panelIncomeDate'), formIncome.date, v => { formIncome.date = v; $('valIncomeDate').textContent = formatDateDisplay(v); });
    setupPickerToggles($('sheetBody'));
    $('fCategory').addEventListener('change', () => {
      $('fCustomCatRow').classList.toggle('hidden', $('fCategory').value !== 'other');
    });
    if (income) $('fDelete').addEventListener('click', () => {
      if (!confirm(t('confirmDeleteIncome'))) return;
      deleteIncome(id);
      closeSheetOverlay();
    });
    openSheetOverlay();
  }

  $('sheetSave').addEventListener('click', () => {
    if (sheetMode === 'shift') {
      if (!isValidDate(formShift.date) || !isValidTime(formShift.startTime) || !isValidTime(formShift.endTime)) { alert(t('alertFillShiftTimes')); return; }
      if (formShift.startTime === formShift.endTime) { alert(t('alertSameTimes')); return; }
      if (!editingId && state.shifts.length >= LIMITS.shifts) { alert(t('alertLimitReached')); return; }
      const shiftObj = {
        id: editingId || genId(),
        date: formShift.date, startTime: formShift.startTime, endTime: formShift.endTime,
        isHoliday: $('fHoliday').checked,
        note: $('fNote').value.trim().slice(0, LIMITS.note)
      };
      if (editingId) {
        const idx = state.shifts.findIndex(s => s.id === editingId);
        if (idx !== -1) state.shifts[idx] = shiftObj;
      } else {
        state.shifts.push(shiftObj);
      }
    } else if (sheetMode === 'income') {
      const amount = parseFloat($('fAmount').value);
      let category = CATEGORY_KEYS.includes($('fCategory').value) ? $('fCategory').value : 'other';
      if (category === 'other') {
        const custom = $('fCustomCat').value.trim().slice(0, LIMITS.category);
        if (custom) category = custom;
      }
      if (!isValidDate(formIncome.date) || !Number.isFinite(amount) || amount <= 0 || amount > 10000000) { alert(t('alertFillIncome')); return; }
      if (!editingId && state.incomes.length >= LIMITS.incomes) { alert(t('alertLimitReached')); return; }
      const incomeObj = { id: editingId || genId(), date: formIncome.date, category, amount: Math.round(amount * 100) / 100, note: $('fNote').value.trim().slice(0, LIMITS.note) };
      if (editingId) {
        const idx = state.incomes.findIndex(i => i.id === editingId);
        if (idx !== -1) state.incomes[idx] = incomeObj;
      } else {
        state.incomes.push(incomeObj);
      }
    } else if (sheetMode === 'template') {
      const name = $('fTplName').value.trim().slice(0, LIMITS.tplName);
      if (!name) { alert(t('alertFillTemplateName')); return; }
      if (formTemplate.startTime === formTemplate.endTime) { alert(t('alertSameTimes')); return; }
      if (!editingId && state.templates.length >= LIMITS.templates) { alert(t('alertLimitReached')); return; }
      const tplObj = { id: editingId || genId(), name, startTime: formTemplate.startTime, endTime: formTemplate.endTime };
      if (editingId) {
        const idx = state.templates.findIndex(x => x.id === editingId);
        if (idx !== -1) state.templates[idx] = tplObj;
      } else {
        state.templates.push(tplObj);
      }
      save();
      closeSheetOverlay();
      renderTemplatesSettings();
      return;
    }
    save();
    closeSheetOverlay();
    renderDataViews();
  });

  // ---- auth ----
  const REMEMBER_KEY = 'workTrackerRememberEmail';
  const LOCK_KEY = 'workTrackerAuthLock';
  const RESET_COOLDOWN_MS = 60000;
  const CREDENTIAL_ERRORS = ['auth/wrong-password', 'auth/user-not-found', 'auth/invalid-credential', 'auth/invalid-login-credentials'];
  let authMode = 'signin';
  let authBusy = false;
  let lockTicker = null;
  let lastResetAt = 0;

  function authMsg(text, isInfo) {
    const el = $('authError');
    el.textContent = text;
    el.classList.toggle('info', !!isInfo);
  }

  function updateAuthUI() {
    const signIn = authMode === 'signin';
    $('authTitle').textContent = signIn ? t('authSignIn') : t('authSignUp');
    $('authSubmitBtn').textContent = signIn ? t('authSignIn') : t('authSignUp');
    $('authToggleBtn').textContent = signIn ? t('authNeedAccount') : t('authHaveAccount');
    $('authForgotBtn').textContent = t('authForgot');
    $('authForgotBtn').classList.toggle('hidden', !signIn);
    $('authEmail').placeholder = t('authEmail');
    $('authPassword').placeholder = t('authPassword');
    $('authPassword').autocomplete = signIn ? 'current-password' : 'new-password';
    $('authRememberLabel').textContent = t('authRemember');
    authMsg('');
    updateLockUI();
  }

  // Local lockout after repeated wrong passwords. Firebase also throttles failed
  // sign-ins on its servers, which is what stops scripted attacks that bypass this page.
  function getLock() {
    try {
      const l = JSON.parse(localStorage.getItem(LOCK_KEY));
      if (l && typeof l.fails === 'number' && typeof l.until === 'number') return l;
    } catch(e) {}
    return { fails: 0, until: 0 };
  }
  function setLock(l) { try { localStorage.setItem(LOCK_KEY, JSON.stringify(l)); } catch(e) {} }
  function lockRemainingSec() { return Math.max(0, Math.ceil((getLock().until - Date.now()) / 1000)); }
  function registerFailure() {
    const l = getLock();
    l.fails += 1;
    if (l.fails >= 3) l.until = Date.now() + Math.min(300, 15 * Math.pow(2, l.fails - 3)) * 1000;
    setLock(l);
  }
  let showingLock = false;
  function updateLockUI() {
    clearInterval(lockTicker);
    const tick = () => {
      const sec = lockRemainingSec();
      $('authSubmitBtn').disabled = authBusy || sec > 0;
      if (sec > 0) {
        authMsg(t('authLocked').replace('{s}', sec));
        showingLock = true;
      } else {
        clearInterval(lockTicker);
        if (showingLock) { authMsg(''); showingLock = false; }
      }
    };
    tick();
    if (lockRemainingSec() > 0) lockTicker = setInterval(tick, 1000);
  }

  // Wrong email and wrong password share one message so the form never reveals
  // which email addresses have accounts.
  function authErrorMessage(err) {
    const code = err && err.code;
    if (CREDENTIAL_ERRORS.includes(code)) return t('authErrCredentials');
    switch (code) {
      case 'auth/invalid-email': return t('authErrInvalidEmail');
      case 'auth/email-already-in-use': return t('authErrEmailInUse');
      case 'auth/weak-password': return t('authErrPasswordRules');
      case 'auth/too-many-requests': return t('authErrTooMany');
      case 'auth/network-request-failed': return t('authErrNetwork');
      case 'auth/user-disabled': return t('authErrDisabled');
      default: return t('authErrGeneric');
    }
  }
  function isPlausibleEmail(v) { return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
  function isStrongPassword(v) { return v.length >= 8 && v.length <= 128 && /[A-Za-z]/.test(v) && /\d/.test(v); }
  function setAuthBusy(busy) { authBusy = busy; updateLockUI(); }

  try {
    const savedEmail = localStorage.getItem(REMEMBER_KEY);
    if (savedEmail) $('authEmail').value = savedEmail;
  } catch(e) {}
  // The fields sit in a <form> so password managers recognize the login, but it never submits itself.
  $('authForm').addEventListener('submit', e => { e.preventDefault(); $('authSubmitBtn').click(); });
  ['authEmail','authPassword'].forEach(id => $(id).addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); $('authSubmitBtn').click(); }
  }));
  $('authToggleBtn').addEventListener('click', () => {
    authMode = authMode === 'signin' ? 'signup' : 'signin';
    updateAuthUI();
  });

  $('authSubmitBtn').addEventListener('click', () => {
    if (authBusy || lockRemainingSec() > 0) return;
    const email = $('authEmail').value.trim();
    const password = $('authPassword').value;
    if (!email || !password) { authMsg(t('authFillFields')); return; }
    if (!isPlausibleEmail(email)) { authMsg(t('authErrInvalidEmail')); return; }
    if (authMode === 'signup' && !isStrongPassword(password)) { authMsg(t('authErrPasswordRules')); return; }
    authMsg('');
    const remember = $('authRemember').checked;
    try {
      if (remember) localStorage.setItem(REMEMBER_KEY, email);
      else localStorage.removeItem(REMEMBER_KEY);
    } catch(e) {}
    setAuthBusy(true);
    const persistence = remember ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION;
    auth.setPersistence(persistence)
      .then(() => authMode === 'signin'
        ? auth.signInWithEmailAndPassword(email, password)
        : auth.createUserWithEmailAndPassword(email, password))
      .then(() => { setLock({ fails: 0, until: 0 }); $('authPassword').value = ''; })
      .catch(err => {
        if (CREDENTIAL_ERRORS.includes(err && err.code)) registerFailure();
        if (lockRemainingSec() === 0) authMsg(authErrorMessage(err));
      })
      .finally(() => setAuthBusy(false));
  });

  // Same confirmation whether or not the email has an account, to avoid revealing registered emails.
  $('authForgotBtn').addEventListener('click', () => {
    const email = $('authEmail').value.trim();
    if (!isPlausibleEmail(email)) { authMsg(t('authErrInvalidEmail')); return; }
    if (Date.now() - lastResetAt < RESET_COOLDOWN_MS) { authMsg(t('authResetSent'), true); return; }
    lastResetAt = Date.now();
    auth.sendPasswordResetEmail(email)
      .then(() => authMsg(t('authResetSent'), true))
      .catch(err => {
        if (err && err.code === 'auth/network-request-failed') { lastResetAt = 0; authMsg(t('authErrNetwork')); }
        else authMsg(t('authResetSent'), true);
      });
  });

  // Sign-out sends any unsaved change first, then wipes this device's copies of the data.
  $('signOutBtn').addEventListener('click', () => {
    $('signOutBtn').disabled = true;
    const timeout = new Promise(resolve => setTimeout(resolve, 2500));
    Promise.race([flushRemoteWrite(), timeout])
      .then(() => auth.signOut())
      .catch(() => {})
      .then(() => {
        clearLocalCache();
        return db.terminate().then(() => db.clearPersistence()).catch(() => {});
      })
      .then(() => location.reload());
  });

  function applyRemoteState(data) {
    const incoming = normalizeState(data);
    if (JSON.stringify(incoming) === JSON.stringify(state)) return;
    state = incoming;
    saveLocal();
    refreshAll();
  }

  function hideAuthScreen() {
    $('authScreen').classList.remove('loading');
    $('authScreen').classList.add('hidden');
  }

  function startSync(user) {
    const docRef = db.collection('users').doc(user.uid);
    const owner = getCacheOwner();
    const localIsMine = !owner || owner === user.uid;
    if (!localIsMine) { state = defaultState(); refreshAll(); }
    let firstSnapshot = true;
    firestoreUnsub = docRef.onSnapshot(snap => {
      if (firstSnapshot) { firstSnapshot = false; hideAuthScreen(); }
      if (snap.exists) {
        remoteReady = true;
        // Ignore echoes of our own unconfirmed writes and anything arriving while a
        // local change is still waiting to be sent, so edits are never overwritten.
        if (snap.metadata.hasPendingWrites || writeTimer) return;
        applyRemoteState(snap.data());
      } else if (!snap.metadata.fromCache) {
        // New account: seed it with this device's data only if that data belongs to this user.
        remoteReady = true;
        saveLocal();
        flushRemoteWrite();
      }
    }, err => {
      console.error('Sync error:', err);
      if (firstSnapshot) { firstSnapshot = false; hideAuthScreen(); }
      showToast(t('syncFailed'));
    });
  }

  // ---- boot ----
  loadSettingsForm();
  loadGoalForm();
  initSettingsPickers();
  applyLanguage();
  updateAuthUI();

  const authLoadingFallback = setTimeout(() => $('authScreen').classList.remove('loading'), 8000);
  try {
    auth.onAuthStateChanged(user => {
      clearTimeout(authLoadingFallback);
      if (firestoreUnsub) { firestoreUnsub(); firestoreUnsub = null; }
      if (user) {
        currentUser = user;
        remoteReady = false;
        $('accountEmail').textContent = user.email || '';
        startSync(user);
      } else {
        currentUser = null;
        remoteReady = false;
        clearTimeout(writeTimer);
        writeTimer = null;
        // A cache stamped with an account that's no longer signed in (e.g. "Remember me"
        // was off) is private data, so it's removed rather than left on the device.
        if (getCacheOwner()) { clearLocalCache(); state = defaultState(); refreshAll(); }
        closeSheetOverlay();
        authMode = 'signin';
        updateAuthUI();
        $('authScreen').classList.remove('loading', 'hidden');
      }
    });
  } catch (err) {
    console.error('Firebase failed to initialize:', err);
    clearTimeout(authLoadingFallback);
    $('authScreen').classList.remove('loading');
    authMsg(t('authErrNetwork'));
  }
})();
