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
      rateSets: [],
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
  // Sized so a full account stays well under Firestore's 1 MiB per-document limit.
  const LIMITS = { shifts: 3000, incomes: 1500, templates: 50, rateSets: 500, note: 200, category: 40, tplName: 24, currency: 4, importBytes: 2 * 1024 * 1024 };
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

  // The pay settings that decide what a shift earns. Each shift keeps its own copy (a "rate
  // set") so changing rates later never rewrites the pay of shifts already worked.
  const RATE_FIELDS = ['rate', 'weekendStartDow', 'weekendStartTime', 'weekendEndDow', 'weekendEndTime', 'weekendPercent', 'holidayPercent', 'overtimeThreshold', 'overtimePercent'];
  function ratesFrom(src, fallback) {
    const f = fallback || defaultState().settings;
    return {
      rate: num(src.rate, 0, 100000, f.rate),
      weekendStartDow: Math.round(num(src.weekendStartDow, 0, 6, f.weekendStartDow)),
      weekendStartTime: isValidTime(src.weekendStartTime) ? src.weekendStartTime : f.weekendStartTime,
      weekendEndDow: Math.round(num(src.weekendEndDow, 0, 6, f.weekendEndDow)),
      weekendEndTime: isValidTime(src.weekendEndTime) ? src.weekendEndTime : f.weekendEndTime,
      weekendPercent: num(src.weekendPercent, 0, 1000, f.weekendPercent),
      holidayPercent: num(src.holidayPercent, 0, 1000, f.holidayPercent),
      overtimeThreshold: num(src.overtimeThreshold, 0, 24, f.overtimeThreshold),
      overtimePercent: num(src.overtimePercent, 0, 1000, f.overtimePercent)
    };
  }
  function rateKey(r) { return RATE_FIELDS.map(k => r[k]).join('|'); }

  // Every piece of data from storage, Firestore or a backup file passes through here,
  // so the rest of the app can trust the shape and never renders unchecked values.
  function normalizeState(raw) {
    const def = defaultState().settings;
    const src = raw && typeof raw === 'object' ? raw : {};
    const s = src.settings && typeof src.settings === 'object' ? src.settings : {};
    const settings = Object.assign(ratesFrom(s, def), {
      currency: str(s.currency, LIMITS.currency).trim() || def.currency,
      language: s.language === 'he' ? 'he' : 'en',
      goalType: s.goalType === 'income' ? 'income' : 'hours',
      goalValue: num(s.goalValue, 0, 10000000, def.goalValue)
    });
    const seen = new Set();
    const uniqueId = v => {
      let id = typeof v === 'string' && ID_RE.test(v) ? v : genId();
      while (seen.has(id)) id = genId();
      seen.add(id);
      return id;
    };
    const list = v => Array.isArray(v) ? v : [];

    const rateSets = [];
    const rateIdByKey = new Map();
    const rateIdRemap = new Map();
    const addRateSet = (r, wantedId) => {
      const key = rateKey(r);
      if (rateIdByKey.has(key)) return rateIdByKey.get(key);
      const id = uniqueId(wantedId);
      rateSets.push(Object.assign({ id }, r));
      rateIdByKey.set(key, id);
      return id;
    };
    list(src.rateSets).slice(0, LIMITS.rateSets).forEach(x => {
      if (x && typeof x === 'object' && typeof x.id === 'string') rateIdRemap.set(x.id, addRateSet(ratesFrom(x, settings), x.id));
    });
    // Shifts saved before rate history existed get the settings in effect now.
    let currentRateId = null;
    const fallbackRateId = () => currentRateId || (currentRateId = addRateSet(ratesFrom(settings, settings)));

    const shifts = list(src.shifts)
      .filter(x => x && isValidDate(x.date) && isValidTime(x.startTime) && isValidTime(x.endTime))
      .slice(0, LIMITS.shifts)
      .map(x => ({
        id: uniqueId(x.id), date: x.date, startTime: x.startTime, endTime: x.endTime,
        isHoliday: x.isHoliday === true, note: str(x.note, LIMITS.note),
        rateId: typeof x.rateId === 'string' && rateIdRemap.has(x.rateId) ? rateIdRemap.get(x.rateId) : fallbackRateId()
      }));
    const usedRateIds = new Set(shifts.map(x => x.rateId));
    const incomes = list(src.incomes)
      .filter(x => x && isValidDate(x.date) && num(x.amount, 0, 10000000, 0) > 0)
      .slice(0, LIMITS.incomes)
      .map(x => ({ id: uniqueId(x.id), date: x.date, category: str(x.category, LIMITS.category).trim() || 'other', amount: num(x.amount, 0, 10000000, 0), note: str(x.note, LIMITS.note) }));
    const templates = list(src.templates)
      .filter(x => x && str(x.name, LIMITS.tplName).trim() && isValidTime(x.startTime) && isValidTime(x.endTime))
      .slice(0, LIMITS.templates)
      .map(x => ({ id: uniqueId(x.id), name: str(x.name, LIMITS.tplName).trim(), startTime: x.startTime, endTime: x.endTime }));
    return { settings, rateSets: rateSets.filter(r => usedRateIds.has(r.id)), shifts, incomes, templates };
  }

  function ratesFor(shift) {
    return state.rateSets.find(r => r.id === shift.rateId) || state.settings;
  }
  function currentRates() { return ratesFrom(state.settings, state.settings); }
  function ensureCurrentRateSet() {
    const r = currentRates();
    const key = rateKey(r);
    const found = state.rateSets.find(x => rateKey(x) === key);
    if (found) return found.id;
    const id = genId();
    state.rateSets.push(Object.assign({ id }, r));
    return id;
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
  function showToast(msg, action) {
    const el = $('toast');
    if (!el) return;
    el.textContent = '';
    const text = document.createElement('span');
    text.textContent = msg;
    el.appendChild(text);
    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'toast-action';
      btn.textContent = action.label;
      btn.addEventListener('click', () => { el.classList.remove('show'); action.onClick(); });
      el.appendChild(btn);
    }
    el.classList.toggle('has-action', !!action);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), action ? 8000 : 4000);
  }

  // Big, destructive changes (erase, import, restore, re-rating a month) can be undone right after.
  let undoSnapshot = null;
  function rememberForUndo() { undoSnapshot = JSON.parse(JSON.stringify(state)); }
  function offerUndo(msg) {
    const snapshot = undoSnapshot;
    if (!snapshot) { showToast(msg); return; }
    showToast(msg, {
      label: t('undo'),
      onClick: () => {
        state = normalizeState(snapshot);
        save();
        flushRemoteWrite();
        refreshAll();
        showToast(t('undone'));
      }
    });
  }

  function getLang() { return state.settings.language === 'he' ? 'he' : 'en'; }
  function t(key) { return I18N[getLang()][key] || key; }
  function categoryLabel(cat) { return CATEGORY_LABELS[getLang()][cat] || cat; }

  let activeTab = 'summary';
  let monthFilter = currentMonthStr();
  // One selected month is shared by every tab. Goals needs a specific month, so while the
  // other tabs show "All time" it falls back to the last specific month that was chosen.
  let lastSpecificMonth = monthFilter;
  function selectMonth(m) {
    monthFilter = m;
    if (m !== 'all') lastSpecificMonth = m;
    renderDataViews();
  }
  function goalMonth() { return monthFilter === 'all' ? lastSpecificMonth : monthFilter; }
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
    const settings = ratesFor(shift);
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

  function rateSummary(r) {
    let s = `${money(r.rate)} ${t('rsPerHour')} · ${t('rsWeekend')} ${r.weekendPercent}% · ${t('rsHoliday')} ${r.holidayPercent}%`;
    if (r.overtimeThreshold > 0) s += ` · ${t('rsOvertime')} ${r.overtimePercent}% ${t('rsAfter').replace('{h}', r.overtimeThreshold)}`;
    return s;
  }

  function rangesOverlap(a, b) { return a.start < b.end && b.start < a.end; }
  function findClash(shift, ignoreId) {
    const r = shiftRange(shift);
    return state.shifts.find(o => o.id !== ignoreId && rangesOverlap(r, shiftRange(o)));
  }
  // Sweep over shifts sorted by start time; any shift starting before the latest end seen so far overlaps it.
  function findOverlaps(list) {
    const items = list.map(s => { const r = shiftRange(s); return { id: s.id, start: r.start.getTime(), end: r.end.getTime() }; })
      .sort((a, b) => a.start - b.start);
    const ids = new Set();
    let maxEnd = -Infinity, maxId = null;
    items.forEach(it => {
      if (it.start < maxEnd) { ids.add(it.id); ids.add(maxId); }
      if (it.end > maxEnd) { maxEnd = it.end; maxId = it.id; }
    });
    return ids;
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
      btn.addEventListener('click', () => selectMonth(btn.dataset.month));
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
    const overlapping = findOverlaps(state.shifts);
    const html = shifts.map(s => {
      const c = calcShift(s);
      const dname = formatDateDisplay(s.date);
      let badges = overlapping.has(s.id) ? `<span class="badge badge-overlap">${t('badgeOverlap')}</span>` : '';
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
    const active = goalMonth();
    el.innerHTML = months.map(m => `<button class="pill ${active===m?'active':''}" data-month="${m}">${monthLabel(m)}</button>`).join('');
    el.querySelectorAll('.pill').forEach(btn => btn.addEventListener('click', () => selectMonth(btn.dataset.month)));
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
    const month = goalMonth();
    const shifts = state.shifts.filter(s => monthKey(s.date) === month);
    const incomes = state.incomes.filter(i => monthKey(i.date) === month);
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
    renderApplyRatesList();
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

  // On phones, hand the file to the Share sheet (a plain download is unreliable in
  // Home Screen web apps); on computers, download it.
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function deliverFile(blob, filename) {
    const file = typeof File === 'function' ? new File([blob], filename, { type: blob.type }) : null;
    const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (touch && file && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: filename })
        .catch(err => { if (!err || err.name !== 'AbortError') downloadBlob(blob, filename); });
      return;
    }
    downloadBlob(blob, filename);
  }

  $('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    deliverFile(blob, 'work-tracker-backup-' + todayStr() + '.json');
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
      rememberForUndo();
      state = normalizeState(data);
      save();
      refreshAll();
      offerUndo(t('alertImportOk'));
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
      rememberForUndo();
      state = defaultState();
      state.settings.language = language;
      save();
      flushRemoteWrite();
      closeSheetOverlay();
      refreshAll();
      offerUndo(t('eraseDone'));
    });
    openSheetOverlay();
  }

  function monthLongLabel(m) {
    return new Date(m + '-01T00:00:00').toLocaleDateString(getLang() === 'he' ? 'he-IL' : undefined, { month: 'long', year: 'numeric' });
  }

  // ---- rate history: apply today's rates to past months (e.g. a retroactive raise) ----
  // Lists only months that still have shifts on older rates; beyond RATES_LIST_VISIBLE the
  // rest fold away behind a "Show more" row so the list never floods the screen.
  const RATES_LIST_VISIBLE = 2;
  let ratesListExpanded = false;
  function outdatedShiftsByMonth() {
    const current = rateKey(currentRates());
    const byMonth = new Map();
    state.shifts.forEach(s => {
      if (rateKey(ratesFor(s)) === current) return;
      const m = monthKey(s.date);
      byMonth.set(m, (byMonth.get(m) || []).concat(s));
    });
    return Array.from(byMonth.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }
  function renderApplyRatesList() {
    const el = $('applyRatesList');
    const months = outdatedShiftsByMonth();
    if (!months.length) {
      ratesListExpanded = false;
      el.innerHTML = `<div class="list-row"><div class="rlabel" style="color:var(--muted);">${escapeHtml(t('ratesAllCurrent'))}</div></div>`;
      return;
    }
    const hidden = Math.max(0, months.length - RATES_LIST_VISIBLE);
    const shown = ratesListExpanded ? months : months.slice(0, RATES_LIST_VISIBLE);
    el.innerHTML = shown.map(([m, list]) => `
      <div class="list-row picker-row" data-rates-month="${m}">
        <div class="rlabel">${escapeHtml(monthLongLabel(m))}<span class="rsub">${escapeHtml(t('ratesListCount').replace('{n}', list.length))}</span></div>
        <span class="entry-chevron">›</span>
      </div>`).join('') + (hidden ? `
      <div class="list-row picker-row rates-toggle" id="ratesListToggle">
        <div class="rlabel" style="color:var(--accent);">${escapeHtml(ratesListExpanded ? t('ratesShowLess') : t('ratesShowMore').replace('{n}', hidden))}</div>
        <span class="chev">${ratesListExpanded ? '⌃' : '⌄'}</span>
      </div>` : '');
    el.querySelectorAll('[data-rates-month]').forEach(row => row.addEventListener('click', () => applyCurrentRatesToMonth(row.dataset.ratesMonth)));
    if (hidden) $('ratesListToggle').addEventListener('click', () => { ratesListExpanded = !ratesListExpanded; renderApplyRatesList(); });
  }
  function applyCurrentRatesToMonth(month) {
    const entry = outdatedShiftsByMonth().find(([m]) => m === month);
    if (!entry) return;
    const shifts = entry[1];
    if (!confirm(t('confirmApplyRates').replace('{n}', shifts.length).replace('{m}', monthLongLabel(month)))) return;
    rememberForUndo();
    const id = ensureCurrentRateSet();
    const ids = new Set(shifts.map(s => s.id));
    state.shifts.forEach(s => { if (ids.has(s.id)) s.rateId = id; });
    save();
    refreshAll();
    offerUndo(t('ratesApplied').replace('{n}', shifts.length));
  }

  // ---- cloud backups: one snapshot per day, last BACKUP_KEEP_DAYS kept ----
  const BACKUP_KEEP_DAYS = 14;
  function dateStr(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function backupsRef(uid) { return db.collection('users').doc(uid).collection('backups'); }
  function runDailyBackup(uid) {
    const today = todayStr();
    const flagKey = 'workTrackerBackup_' + uid;
    try { if (localStorage.getItem(flagKey) === today) return; } catch(e) {}
    if (!state.shifts.length && !state.incomes.length && !state.templates.length) return;
    const col = backupsRef(uid);
    col.doc(today).get().then(snap => {
      const writes = [];
      if (!snap.exists) writes.push(col.doc(today).set({ data: state, createdAt: firebase.firestore.FieldValue.serverTimestamp() }));
      // Drop anything older than the retention window (covers a week of not opening the app).
      for (let i = BACKUP_KEEP_DAYS; i < BACKUP_KEEP_DAYS + 7; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        writes.push(col.doc(dateStr(d)).delete());
      }
      return Promise.all(writes);
    }).then(() => { try { localStorage.setItem(flagKey, today); } catch(e) {} })
      .catch(err => console.warn('Daily backup skipped:', err && err.code));
  }

  function openRestoreSheet() {
    if (!currentUser) return;
    sheetMode = 'restore'; editingId = null;
    $('sheetTitle').textContent = t('restoreTitle');
    $('sheetSave').style.visibility = 'hidden';
    $('sheetBody').innerHTML = `<div class="empty-state">${escapeHtml(t('restoreLoading'))}</div>`;
    openSheetOverlay();
    const uid = currentUser.uid;
    backupsRef(uid).get().then(snap => {
      if (sheetMode !== 'restore') return;
      const docs = snap.docs.filter(d => isValidDate(d.id)).sort((a, b) => b.id.localeCompare(a.id));
      docs.slice(BACKUP_KEEP_DAYS).forEach(d => d.ref.delete().catch(() => {}));
      const kept = docs.slice(0, BACKUP_KEEP_DAYS);
      if (!kept.length) {
        $('sheetBody').innerHTML = `<div class="empty-state">${escapeHtml(t('restoreNone'))}</div>`;
        return;
      }
      const locale = getLang() === 'he' ? 'he-IL' : undefined;
      const labelFor = id => new Date(id + 'T00:00:00').toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
      const entries = kept.map(d => ({ id: d.id, data: normalizeState((d.data() || {}).data) }));
      $('sheetBody').innerHTML = `
        <div class="section-footer" style="margin:0 4px 12px;">${escapeHtml(t('restoreHint'))}</div>
        <div class="list-group">${entries.map(e => `
          <div class="list-row picker-row" data-backup="${e.id}">
            <div class="rlabel">${escapeHtml(labelFor(e.id))}<span class="rsub">${escapeHtml(t('backupEntry').replace('{s}', e.data.shifts.length).replace('{i}', e.data.incomes.length))}</span></div>
            <span class="entry-chevron">›</span>
          </div>`).join('')}</div>`;
      $('sheetBody').querySelectorAll('[data-backup]').forEach(row => row.addEventListener('click', () => {
        const entry = entries.find(e => e.id === row.dataset.backup);
        const label = labelFor(entry.id);
        if (!confirm(t('confirmRestore').replace('{d}', label))) return;
        rememberForUndo();
        state = entry.data;
        save();
        flushRemoteWrite();
        closeSheetOverlay();
        refreshAll();
        offerUndo(t('restoreDone').replace('{d}', label));
      }));
    }).catch(err => {
      console.error('Loading backups failed:', err);
      if (sheetMode === 'restore') $('sheetBody').innerHTML = `<div class="empty-state">${escapeHtml(t('restoreFailed'))}</div>`;
    });
  }
  $('restoreBtn').addEventListener('click', openRestoreSheet);

  // ---- new month while the app was open or suspended ----
  let lastSeenMonth = currentMonthStr();
  function checkMonthRollover() {
    const now = currentMonthStr();
    if (now === lastSeenMonth) return;
    const previous = lastSeenMonth;
    lastSeenMonth = now;
    if (lastSpecificMonth === previous) lastSpecificMonth = now;
    if (monthFilter === previous) selectMonth(now);
    else renderDataViews();
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkMonthRollover(); });
  window.addEventListener('pageshow', checkMonthRollover);
  setInterval(checkMonthRollover, 60000);

  // ---- monthly shift report (Word or PDF, generated in the browser without external libraries) ----
  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // A .docx is a ZIP of XML files; an uncompressed ("stored") ZIP is valid and keeps this small.
  function buildZip(files, mime) {
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [], central = [];
    let offset = 0;
    files.forEach(f => {
      const name = enc.encode(f.name);
      const data = enc.encode(f.content);
      const crc = crc32(data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      parts.push(new Uint8Array(local.buffer), name, data);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint16(12, dosTime, true);
      cen.setUint16(14, dosDate, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, data.length, true);
      cen.setUint32(24, data.length, true);
      cen.setUint16(28, name.length, true);
      cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), name);
      offset += 30 + name.length + data.length;
    });
    const centralSize = central.reduce((sum, c) => sum + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: mime });
  }

  const HEBREW_RE = /[֐-׿]/;
  function xmlText(s) { return escapeHtml(String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')); }
  function wRun(text, o = {}) {
    const sz = (o.size || 10) * 2;
    return `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${o.bold ? '<w:b/><w:bCs/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>${HEBREW_RE.test(text) ? '<w:rtl/>' : ''}</w:rPr><w:t xml:space="preserve">${xmlText(text)}</w:t></w:r>`;
  }
  // Viewers disagree on how "left"/"right" alignment and Word's RTL-table flag behave in
  // right-to-left documents (iPhone/Mac Quick Look ignores them). So start-aligned text uses
  // the paragraph's natural alignment, end-aligned numbers are centered in RTL, and RTL tables
  // are written with their columns already mirrored. That renders the same in every viewer.
  function jcFor(align, rtl) {
    if (!align || align === 'left') return '';
    if (rtl && align === 'right') return 'center';
    return align;
  }
  function wPara(runs, o = {}) {
    const jc = jcFor(o.align, o.rtl);
    return `<w:p><w:pPr>${o.rtl ? '<w:bidi/>' : ''}<w:spacing w:before="0" w:after="${o.after ?? 120}"/>${jc ? `<w:jc w:val="${jc}"/>` : ''}</w:pPr>${runs}</w:p>`;
  }
  function wCell(text, width, o = {}) {
    const shd = o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : '';
    return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shd}<w:vAlign w:val="center"/></w:tcPr>${wPara(wRun(text, { bold: o.bold, size: 9 }), { rtl: o.rtl, after: 0, align: o.align })}</w:tc>`;
  }
  function wRow(cells, widths, o = {}) {
    const order = cells.map((_, i) => i);
    if (o.rtl) order.reverse();
    return `<w:tr><w:trPr>${o.header ? '<w:tblHeader/>' : '<w:cantSplit/>'}</w:trPr>${order.map(i => wCell(cells[i][0], widths[i], { rtl: o.rtl, align: cells[i][1], bold: o.bold, fill: o.fill })).join('')}</w:tr>`;
  }
  function wTable(widths, rows, rtl) {
    const border = side => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="C8C8CC"/>`;
    const grid = rtl ? widths.slice().reverse() : widths;
    return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/>${rtl ? '<w:jc w:val="right"/>' : ''}<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`;
  }

  const REPORT_FORMAT_KEY = 'workTrackerReportFormat';
  function getReportFormat() { try { return localStorage.getItem(REPORT_FORMAT_KEY) === 'pdf' ? 'pdf' : 'docx'; } catch(e) { return 'docx'; } }
  function setReportFormat(f) { try { localStorage.setItem(REPORT_FORMAT_KEY, f); } catch(e) {} }

  // One description of the report feeds both the Word and the PDF renderer, so they always match.
  function buildReportModel(month) {
    const lang = getLang();
    const rtl = lang === 'he';
    const locale = rtl ? 'he-IL' : undefined;
    const shifts = state.shifts.filter(x => monthKey(x.date) === month)
      .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
    const incomes = state.incomes.filter(x => monthKey(x.date) === month)
      .sort((a, b) => a.date.localeCompare(b.date));
    const dateFmt = d => new Date(d + 'T00:00:00').toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
    const dayFmt = d => new Date(d + 'T00:00:00').toLocaleDateString(locale, { weekday: 'long' });
    const dash = '–';
    const describe = r => {
      const overtime = r.overtimeThreshold > 0
        ? t('reportOvertimeDesc').replace('{p}', r.overtimePercent).replace('{h}', r.overtimeThreshold)
        : t('reportOvertimeOff');
      return [
        `${t('reportRate')}: ${money(r.rate)}`,
        `${t('reportWeekend')}: ${r.weekendPercent}% · ${DOW_FULL[lang][r.weekendStartDow]} ${r.weekendStartTime} ${dash} ${DOW_FULL[lang][r.weekendEndDow]} ${r.weekendEndTime}`,
        `${t('reportHoliday')}: ${r.holidayPercent}%`,
        `${t('reportOvertime')}: ${overtime}`
      ];
    };
    // Usually one group per month; more than one when rates changed mid-month.
    const groups = [];
    shifts.forEach(x => {
      const r = ratesFor(x);
      const key = rateKey(r);
      let g = groups.find(gr => gr.key === key);
      if (!g) { g = { key, rates: r, dates: [] }; groups.push(g); }
      g.dates.push(x.date);
    });
    const rateBlocks = groups.map(g => ({
      label: groups.length > 1
        ? t('reportRatesFor').replace('{d}', g.dates.length === 1 ? dateFmt(g.dates[0]) : `${dateFmt(g.dates[0])} ${dash} ${dateFmt(g.dates[g.dates.length - 1])}`)
        : null,
      lines: describe(g.rates)
    }));
    if (!rateBlocks.length) rateBlocks.push({ label: null, lines: describe(currentRates()) });

    let sumHours = 0, sumWeekend = 0, sumOvertime = 0, sumPay = 0;
    const shiftRows = shifts.map(x => {
      const c = calcShift(x);
      sumHours += c.totalHours; sumWeekend += c.windowHours; sumOvertime += c.overtimeHours; sumPay += c.pay;
      return [
        dateFmt(x.date), dayFmt(x.date), x.startTime, x.endTime, fmt(c.totalHours), money(ratesFor(x).rate),
        c.windowHours > 0 ? fmt(c.windowHours) : dash, c.overtimeHours > 0 ? fmt(c.overtimeHours) : dash,
        x.isHoliday ? t('reportYes') : dash, money(c.pay), x.note || ''
      ];
    });
    // Widths are in Word twips; landscape A4 content width is 15398.
    const tables = [{
      title: t('reportShifts'),
      cols: [
        { label: t('colDate'), width: 1300 }, { label: t('colDay'), width: 1150 },
        { label: t('colStart'), width: 800, align: 'center' }, { label: t('colEnd'), width: 800, align: 'center' },
        { label: t('colHours'), width: 850, align: 'right' }, { label: t('colRate'), width: 1050, align: 'right' },
        { label: t('colWeekend'), width: 1300, align: 'right' }, { label: t('colOvertime'), width: 1300, align: 'right' },
        { label: t('colHoliday'), width: 850, align: 'center' }, { label: t('colPay'), width: 1400, align: 'right' },
        { label: t('colNote'), width: 4598 }
      ],
      rows: shiftRows,
      total: [t('reportTotal'), '', '', '', fmt(sumHours), '', fmt(sumWeekend), fmt(sumOvertime), '', money(sumPay), '']
    }];
    let sumIncome = 0;
    if (incomes.length) {
      const incomeRows = incomes.map(x => {
        sumIncome += x.amount;
        return [dateFmt(x.date), categoryLabel(x.category), money(x.amount), x.note || ''];
      });
      tables.push({
        title: t('reportOtherIncome'),
        cols: [{ label: t('colDate'), width: 1600 }, { label: t('colCategory'), width: 3600 }, { label: t('colAmount'), width: 1800, align: 'right' }, { label: t('colNote'), width: 8398 }],
        rows: incomeRows,
        total: [t('reportTotal'), '', money(sumIncome), '']
      });
    }
    const meta = [];
    if (currentUser && currentUser.email) meta.push({ text: `${t('reportEmployee')}: ${currentUser.email}` });
    meta.push({ text: `${t('reportGenerated')}: ${new Date().toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}`, muted: true });
    return {
      rtl,
      title: `${t('reportTitle')} ${dash} ${monthLongLabel(month)}`,
      meta,
      ratesTitle: t('reportRates'),
      rateBlocks,
      tables,
      summary: `${t('reportShiftCount')}: ${shifts.length}  ·  ${t('colHours')}: ${fmt(sumHours)}  ·  ${t('sumSubWork')}: ${money(sumPay)}${incomes.length ? `  ·  ${t('reportOtherIncome')}: ${money(sumIncome)}` : ''}`,
      grandTotal: `${t('reportGrandTotal')}: ${money(sumPay + sumIncome)}`,
      footer: t('reportFooter')
    };
  }

  function renderReportDocx(m) {
    const rtl = m.rtl;
    const body = [];
    const para = (text, o = {}) => body.push(wPara(wRun(text, o), { rtl, align: o.align, after: o.after }));
    para(m.title, { bold: true, size: 18, after: 80 });
    m.meta.forEach((x, i) => para(x.text, { color: x.muted ? '6E6E73' : undefined, after: i === m.meta.length - 1 ? 220 : 40 }));
    para(m.ratesTitle, { bold: true, size: 12, after: 60 });
    m.rateBlocks.forEach(b => {
      if (b.label) para(b.label, { bold: true, after: 20 });
      b.lines.forEach(line => para(line, { after: 20 }));
      body.push(wPara('', { rtl, after: 80 }));
    });
    m.tables.forEach(tb => {
      body.push(wPara('', { rtl, after: 120 }));
      para(tb.title, { bold: true, size: 12, after: 80 });
      const widths = tb.cols.map(c => c.width);
      let rows = wRow(tb.cols.map(c => [c.label, c.align]), widths, { rtl, header: true, bold: true, fill: 'E8EEF7' });
      tb.rows.forEach(r => { rows += wRow(r.map((v, i) => [v, tb.cols[i].align]), widths, { rtl }); });
      rows += wRow(tb.total.map((v, i) => [v, tb.cols[i].align]), widths, { rtl, bold: true, fill: 'F2F2F7' });
      body.push(wTable(widths, rows, rtl));
    });
    body.push(wPara('', { rtl, after: 200 }));
    para(m.summary, { after: 60 });
    para(m.grandTotal, { bold: true, size: 13, after: 240 });
    para(m.footer, { size: 8, color: '8E8E93', after: 0 });

    const sect = `<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/>${rtl ? '<w:bidi/>' : ''}</w:sectPr>`;
    const xmlHead = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    return buildZip([
      { name: '[Content_Types].xml', content: `${xmlHead}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>` },
      { name: '_rels/.rels', content: `${xmlHead}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
      { name: 'word/document.xml', content: `${xmlHead}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}${sect}</w:body></w:document>` }
    ], DOCX_MIME);
  }

  // PDF: each page is drawn on a canvas (so Hebrew and right-to-left text render exactly as in
  // the app) and embedded as an image in a minimal hand-built PDF. No fonts or libraries needed,
  // and the fixed layout is much harder to edit than a Word file.
  const PDF_W = 842, PDF_H = 595, PDF_M = 36, PDF_SCALE = 2;
  const PDF_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  function renderReportPdf(m) {
    const rtl = m.rtl;
    const pages = [];
    const contentW = PDF_W - 2 * PDF_M;
    const bottom = PDF_H - PDF_M - 12;
    let ctx, y;
    const newPage = () => {
      const canvas = document.createElement('canvas');
      canvas.width = PDF_W * PDF_SCALE;
      canvas.height = PDF_H * PDF_SCALE;
      ctx = canvas.getContext('2d');
      ctx.scale(PDF_SCALE, PDF_SCALE);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, PDF_W, PDF_H);
      ctx.direction = rtl ? 'rtl' : 'ltr';
      ctx.textBaseline = 'middle';
      pages.push({ canvas, ctx });
      y = PDF_M;
    };
    const setFont = (size, bold) => { ctx.font = `${bold ? 700 : 400} ${size}px ${PDF_FONT}`; };
    const ellipsize = (s, maxW) => {
      if (ctx.measureText(s).width <= maxW) return s;
      let cut = s;
      while (cut.length && ctx.measureText(cut + '…').width > maxW) cut = cut.slice(0, -1);
      return cut + '…';
    };
    const wrap = (s, maxW) => {
      const lines = [];
      let cur = '';
      String(s).split(' ').forEach(word => {
        const next = cur ? cur + ' ' + word : word;
        if (cur && ctx.measureText(next).width > maxW) { lines.push(cur); cur = word; } else cur = next;
      });
      if (cur) lines.push(cur);
      return lines.length ? lines : [''];
    };
    const text = (s, o = {}) => {
      const size = o.size || 10;
      const lh = size * 1.45;
      setFont(size, o.bold);
      wrap(s, contentW).forEach(line => {
        if (y + lh > bottom) { newPage(); setFont(size, o.bold); }
        ctx.fillStyle = o.color || '#000000';
        ctx.textAlign = rtl ? 'right' : 'left';
        ctx.fillText(line, rtl ? PDF_W - PDF_M : PDF_M, y + lh / 2);
        y += lh;
      });
      y += o.after || 0;
    };
    const table = tb => {
      const sum = tb.cols.reduce((a, c) => a + c.width, 0);
      const widths = tb.cols.map(c => c.width / sum * contentW);
      const lefts = [];
      let acc = 0;
      widths.forEach(w => { lefts.push(rtl ? PDF_W - PDF_M - acc - w : PDF_M + acc); acc += w; });
      const HEAD_H = 20, ROW_H = 18;
      const header = tb.cols.map(c => c.label);
      const row = (cells, o = {}) => {
        const h = o.header ? HEAD_H : ROW_H;
        if (o.fill) { ctx.fillStyle = o.fill; ctx.fillRect(PDF_M, y, contentW, h); }
        setFont(8.5, o.bold);
        ctx.fillStyle = '#000000';
        cells.forEach((v, i) => {
          const align = tb.cols[i].align || 'left';
          const x0 = lefts[i], x1 = x0 + widths[i], pad = 4;
          let x;
          if (align === 'center') { ctx.textAlign = 'center'; x = (x0 + x1) / 2; }
          else if ((align === 'left') !== rtl) { ctx.textAlign = 'left'; x = x0 + pad; }
          else { ctx.textAlign = 'right'; x = x1 - pad; }
          ctx.fillText(ellipsize(String(v), widths[i] - 2 * pad), x, y + h / 2 + 0.5);
        });
        ctx.strokeStyle = '#C8C8CC';
        ctx.lineWidth = 0.6;
        ctx.strokeRect(PDF_M, y, contentW, h);
        lefts.forEach(x0 => { ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0, y + h); ctx.stroke(); });
        y += h;
      };
      const headerRow = () => row(header, { header: true, bold: true, fill: '#E8EEF7' });
      headerRow();
      tb.rows.forEach(r => {
        if (y + ROW_H > bottom) { newPage(); headerRow(); }
        row(r);
      });
      if (y + ROW_H > bottom) { newPage(); headerRow(); }
      row(tb.total, { bold: true, fill: '#F2F2F7' });
    };

    newPage();
    text(m.title, { size: 18, bold: true, after: 4 });
    m.meta.forEach(x => text(x.text, { size: 10, color: x.muted ? '#6E6E73' : '#000000' }));
    y += 12;
    text(m.ratesTitle, { size: 12, bold: true, after: 2 });
    m.rateBlocks.forEach(b => {
      if (b.label) text(b.label, { size: 10, bold: true });
      b.lines.forEach(line => text(line, { size: 10 }));
      y += 4;
    });
    m.tables.forEach(tb => {
      y += 10;
      if (y + 17 + 38 > bottom) newPage();
      text(tb.title, { size: 12, bold: true, after: 4 });
      table(tb);
    });
    y += 16;
    text(m.summary, { size: 10, after: 2 });
    text(m.grandTotal, { size: 13, bold: true });

    // Page footer on every page: the note on the start side, page number on the end side.
    pages.forEach((p, i) => {
      const fy = PDF_H - PDF_M / 2;
      p.ctx.font = `400 8px ${PDF_FONT}`;
      p.ctx.fillStyle = '#8E8E93';
      p.ctx.textAlign = rtl ? 'right' : 'left';
      p.ctx.fillText(m.footer, rtl ? PDF_W - PDF_M : PDF_M, fy);
      p.ctx.textAlign = rtl ? 'left' : 'right';
      p.ctx.fillText(t('reportPage').replace('{p}', i + 1).replace('{n}', pages.length), rtl ? PDF_M : PDF_W - PDF_M, fy);
    });
    // toDataURL is synchronous, which keeps the iPhone Share sheet inside the user's tap.
    const images = pages.map(p => dataUrlToBytes(p.canvas.toDataURL('image/jpeg', 0.92)));
    return buildPdf(images, PDF_W * PDF_SCALE, PDF_H * PDF_SCALE, m.title);
  }

  function dataUrlToBytes(url) {
    const bin = atob(url.slice(url.indexOf(',') + 1));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function buildPdf(images, pxW, pxH, title) {
    const enc = new TextEncoder();
    const parts = [];
    const offsets = [];
    let pos = 0;
    const put = x => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); pos += b.length; };
    const obj = (id, body) => { offsets[id] = pos; put(`${id} 0 obj\n${body}\nendobj\n`); };
    const utf16Hex = s => '<FEFF' + Array.from(s).map(ch => {
      const c = ch.codePointAt(0);
      if (c > 0xFFFF) { const v = c - 0x10000; return ((0xD800 + (v >> 10)).toString(16) + (0xDC00 + (v & 0x3FF)).toString(16)).toUpperCase(); }
      return c.toString(16).padStart(4, '0').toUpperCase();
    }).join('') + '>';
    const count = images.length;
    const lastId = 3 + count * 3;
    put('%PDF-1.4\n%âãÏÓ\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, `<< /Type /Pages /Kids [${images.map((_, i) => `${4 + i * 3} 0 R`).join(' ')}] /Count ${count} >>`);
    obj(3, `<< /Title ${utf16Hex(title)} /Producer (Work & Pay) >>`);
    images.forEach((img, i) => {
      const pageId = 4 + i * 3, contentId = pageId + 1, imageId = pageId + 2;
      obj(pageId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_W} ${PDF_H}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
      const content = `q\n${PDF_W} 0 0 ${PDF_H} 0 0 cm\n/Im0 Do\nQ\n`;
      obj(contentId, `<< /Length ${content.length} >>\nstream\n${content}endstream`);
      offsets[imageId] = pos;
      put(`${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`);
      put(img);
      put('\nendstream\nendobj\n');
    });
    const xrefPos = pos;
    let xref = `xref\n0 ${lastId + 1}\n0000000000 65535 f \n`;
    for (let id = 1; id <= lastId; id++) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    put(`${xref}trailer\n<< /Size ${lastId + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  function openReportSheet() {
    sheetMode = 'report'; editingId = null;
    $('sheetTitle').textContent = t('reportSheetTitle');
    $('sheetSave').style.visibility = 'hidden';
    const months = Array.from(new Set(state.shifts.map(x => monthKey(x.date)))).sort().reverse();
    if (!months.length) {
      $('sheetBody').innerHTML = `<div class="empty-state"><div class="big">${ICON_CLOCK}</div>${escapeHtml(t('reportNoShifts'))}</div>`;
      openSheetOverlay();
      return;
    }
    let format = getReportFormat();
    $('sheetBody').innerHTML = `
      <div class="list-group">
        <div class="list-row">
          <div class="rlabel">${escapeHtml(t('reportFormat'))}</div>
          <div class="seg-toggle" id="reportFormatToggle">
            <button type="button" class="seg-btn" data-fmt="docx">Word</button>
            <button type="button" class="seg-btn" data-fmt="pdf">PDF</button>
          </div>
        </div>
      </div>
      <div class="section-footer" id="reportFormatHint" style="margin:8px 6px 18px;"></div>
      <div class="section-header" style="margin:0 2px 8px;">${escapeHtml(t('reportPickMonth'))}</div>
      <div class="list-group">${months.map(mo => {
        const list = state.shifts.filter(x => monthKey(x.date) === mo);
        const pay = list.reduce((sum, x) => sum + calcShift(x).pay, 0);
        return `<div class="list-row picker-row" data-report-month="${mo}">
          <div class="rlabel">${escapeHtml(monthLongLabel(mo))}<span class="rsub">${escapeHtml(t('reportShiftsCount').replace('{n}', list.length))} · ${escapeHtml(money(pay))}</span></div>
          <span class="entry-chevron">›</span>
        </div>`;
      }).join('')}</div>`;
    const syncFormat = () => {
      $('reportFormatToggle').querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.fmt === format));
      $('reportFormatHint').textContent = t(format === 'pdf' ? 'reportHintPdf' : 'reportHintDocx');
    };
    $('reportFormatToggle').querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
      format = b.dataset.fmt;
      setReportFormat(format);
      syncFormat();
    }));
    syncFormat();
    $('sheetBody').querySelectorAll('[data-report-month]').forEach(row => {
      row.addEventListener('click', () => exportReport(row.dataset.reportMonth, format));
    });
    openSheetOverlay();
  }

  function exportReport(month, format) {
    let blob;
    try {
      const model = buildReportModel(month);
      blob = format === 'pdf' ? renderReportPdf(model) : renderReportDocx(model);
    } catch (err) {
      console.error('Report failed:', err);
      showToast(t('reportExportFailed'));
      return;
    }
    closeSheetOverlay();
    deliverFile(blob, `Shift-Report-${month}.${format === 'pdf' ? 'pdf' : 'docx'}`);
  }
  $('reportBtn').addEventListener('click', openReportSheet);

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
      endTime: shift ? shift.endTime : addHoursToTime(defaultStart, 8),
      rateId: shift ? shift.rateId : null
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
            <div class="rlabel"><span data-i18n="fieldHoliday">Holiday</span><span class="rsub" data-i18n="fieldHolidaySub">Applies the holiday bonus %</span></div>
            <label class="switch"><input type="checkbox" id="fHoliday" ${shift && shift.isHoliday ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></label>
          </div>
        </div>
      </div>
      <div class="field-group">
        <div class="list-group">
          <div class="list-row">
            <div class="rlabel"><span data-i18n="fieldRates">Pay rates</span><span class="rsub" id="valShiftRates"></span></div>
            <button type="button" class="small-btn hidden" id="fUseCurrentRates" data-i18n="useCurrentRates">Use current rates</button>
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
    // New shifts always use today's rates; an existing shift keeps its own unless the user switches it.
    const showRates = () => {
      const stored = formShift.rateId && state.rateSets.find(x => x.id === formShift.rateId);
      const r = stored || currentRates();
      $('valShiftRates').textContent = rateSummary(r);
      $('fUseCurrentRates').classList.toggle('hidden', !stored || rateKey(stored) === rateKey(currentRates()));
    };
    showRates();
    $('fUseCurrentRates').addEventListener('click', () => { formShift.rateId = null; showRates(); });
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
      const clash = findClash(formShift, editingId);
      if (clash && !confirm(t('confirmOverlap').replace('{d}', formatDateDisplay(clash.date)).replace('{t}', `${clash.startTime}–${clash.endTime}`))) return;
      const keepRate = formShift.rateId && state.rateSets.some(r => r.id === formShift.rateId);
      const shiftObj = {
        id: editingId || genId(),
        date: formShift.date, startTime: formShift.startTime, endTime: formShift.endTime,
        isHoliday: $('fHoliday').checked,
        note: $('fNote').value.trim().slice(0, LIMITS.note),
        rateId: keepRate ? formShift.rateId : ensureCurrentRateSet()
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

  // Password changes and account deletion both require the current password again.
  function reauthenticate(password) {
    const user = auth.currentUser;
    if (!user || !user.email) return Promise.reject({ code: 'auth/no-current-user' });
    return user.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(user.email, password));
  }

  function openChangePasswordSheet() {
    if (!auth.currentUser) return;
    sheetMode = 'account'; editingId = null;
    $('sheetTitle').textContent = t('changePwTitle');
    $('sheetSave').style.visibility = 'hidden';
    $('sheetBody').innerHTML = `
      <form id="pwForm" novalidate>
        <input type="email" autocomplete="username" value="${escapeHtml(auth.currentUser.email || '')}" hidden>
        <div class="list-group">
          <label class="auth-field"><input type="password" id="pwCurrent" autocomplete="current-password" maxlength="128" placeholder="${escapeHtml(t('pwCurrent'))}"></label>
          <label class="auth-field"><input type="password" id="pwNew" autocomplete="new-password" maxlength="128" placeholder="${escapeHtml(t('pwNew'))}"></label>
          <label class="auth-field"><input type="password" id="pwConfirm" autocomplete="new-password" maxlength="128" placeholder="${escapeHtml(t('pwConfirm'))}"></label>
        </div>
        <div class="section-footer">${escapeHtml(t('authErrPasswordRules'))}</div>
        <div class="auth-error" id="pwMsg"></div>
        <button type="submit" class="btn-accent btn-block" id="pwSaveBtn">${escapeHtml(t('changePwBtn'))}</button>
      </form>`;
    $('pwForm').addEventListener('submit', e => {
      e.preventDefault();
      const current = $('pwCurrent').value, next = $('pwNew').value, again = $('pwConfirm').value;
      const msg = text => { $('pwMsg').textContent = text; };
      if (!current || !next || !again) return msg(t('pwFill'));
      if (!isStrongPassword(next)) return msg(t('authErrPasswordRules'));
      if (next !== again) return msg(t('pwMismatch'));
      if (next === current) return msg(t('pwSame'));
      msg('');
      $('pwSaveBtn').disabled = true;
      reauthenticate(current)
        .then(() => auth.currentUser.updatePassword(next))
        .then(() => { closeSheetOverlay(); showToast(t('pwChanged')); })
        .catch(err => { msg(authErrorMessage(err)); $('pwSaveBtn').disabled = false; });
    });
    openSheetOverlay();
  }
  $('changePwBtn').addEventListener('click', openChangePasswordSheet);

  function openDeleteAccountSheet() {
    if (!auth.currentUser) return;
    sheetMode = 'account'; editingId = null;
    const word = t('eraseWord');
    $('sheetTitle').textContent = t('deleteAccTitle');
    $('sheetSave').style.visibility = 'hidden';
    $('sheetBody').innerHTML = `
      <div class="erase-warning"><strong>${escapeHtml(t('deleteAccWarnTitle'))}</strong>${escapeHtml(t('deleteAccWarnBody'))}</div>
      <form id="delForm" novalidate>
        <input type="email" autocomplete="username" value="${escapeHtml(auth.currentUser.email || '')}" hidden>
        <div class="field-group">
          <div class="list-group"><label class="auth-field"><input type="password" id="delPassword" autocomplete="current-password" maxlength="128" placeholder="${escapeHtml(t('deleteAccPassword'))}"></label></div>
        </div>
        <div class="field-group">
          <div class="section-header" style="margin:0 2px 8px;">${escapeHtml(t('eraseTypeLabel').replace('{w}', word))}</div>
          <div class="list-group"><label class="auth-field"><input type="text" id="delConfirm" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${escapeHtml(word)}"></label></div>
        </div>
        <div class="auth-error" id="delMsg"></div>
        <button type="submit" class="btn-danger btn-block" id="delBtn" disabled>${escapeHtml(t('deleteAccBtn'))}</button>
      </form>`;
    const ready = () => $('delPassword').value.length > 0 && $('delConfirm').value.trim().toUpperCase() === word.toUpperCase();
    ['delPassword', 'delConfirm'].forEach(id => $(id).addEventListener('input', () => { $('delBtn').disabled = !ready(); }));
    $('delForm').addEventListener('submit', e => {
      e.preventDefault();
      if (!ready()) return;
      $('delBtn').disabled = true;
      $('delMsg').textContent = '';
      const user = auth.currentUser;
      const uid = user.uid;
      reauthenticate($('delPassword').value)
        .then(() => {
          // Stop syncing first so nothing re-creates the data while it's being removed.
          if (firestoreUnsub) { firestoreUnsub(); firestoreUnsub = null; }
          clearTimeout(writeTimer);
          writeTimer = null;
          remoteReady = false;
          return backupsRef(uid).get().then(snap => Promise.all(snap.docs.map(d => d.ref.delete())));
        })
        .then(() => db.collection('users').doc(uid).delete())
        .then(() => user.delete())
        .then(() => {
          clearLocalCache();
          try { localStorage.removeItem(REMEMBER_KEY); localStorage.removeItem('workTrackerBackup_' + uid); } catch(e) {}
          return db.terminate().then(() => db.clearPersistence()).catch(() => {});
        })
        .then(() => location.reload())
        .catch(err => {
          console.error('Account deletion failed:', err);
          $('delMsg').textContent = authErrorMessage(err);
          $('delBtn').disabled = !ready();
        });
    });
    openSheetOverlay();
  }
  $('deleteAccountBtn').addEventListener('click', openDeleteAccountSheet);

  function applyRemoteState(data) {
    const incoming = normalizeState(data);
    if (JSON.stringify(incoming) === JSON.stringify(state)) return;
    state = incoming;
    saveLocal();
    refreshAll();
  }

  // The launch screen stays until there's something real to show (the app with data, or the
  // sign-in form), and at least SPLASH_MIN_MS so it never just flickers.
  const SPLASH_MIN_MS = 700;
  let splashHidden = false;
  function hideSplash() {
    if (splashHidden) return;
    splashHidden = true;
    const wait = Math.max(0, SPLASH_MIN_MS - performance.now());
    setTimeout(() => {
      const el = $('splash');
      if (!el) return;
      el.classList.add('done');
      setTimeout(() => el.remove(), 450);
    }, wait);
  }

  function hideAuthScreen() {
    $('authScreen').classList.remove('loading');
    $('authScreen').classList.add('hidden');
    hideSplash();
  }

  function startSync(user) {
    const docRef = db.collection('users').doc(user.uid);
    const owner = getCacheOwner();
    const localIsMine = !owner || owner === user.uid;
    if (!localIsMine) { state = defaultState(); refreshAll(); }
    let firstSnapshot = true;
    let backupChecked = false;
    firestoreUnsub = docRef.onSnapshot(snap => {
      if (firstSnapshot) { firstSnapshot = false; hideAuthScreen(); }
      if (snap.exists) {
        remoteReady = true;
        // Ignore echoes of our own unconfirmed writes and anything arriving while a
        // local change is still waiting to be sent, so edits are never overwritten.
        if (!snap.metadata.hasPendingWrites && !writeTimer) applyRemoteState(snap.data());
        // The day's backup is taken from server-confirmed data, before today's edits.
        if (!backupChecked && !snap.metadata.fromCache) { backupChecked = true; runDailyBackup(user.uid); }
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

  const authLoadingFallback = setTimeout(() => { $('authScreen').classList.remove('loading'); hideSplash(); }, 8000);
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
        hideSplash();
      }
    });
  } catch (err) {
    console.error('Firebase failed to initialize:', err);
    clearTimeout(authLoadingFallback);
    $('authScreen').classList.remove('loading');
    authMsg(t('authErrNetwork'));
    hideSplash();
  }
})();
