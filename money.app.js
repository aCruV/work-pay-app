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
        rate: 50,
        weekendStartDow: 5,
        weekendStartTime: '00:00',
        weekendEndDow: 0,
        weekendEndTime: '04:00',
        weekendPercent: 150,
        holidayPercent: 150,
        overtimeThreshold: 0,
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

  function genId() { return Date.now() + '-' + Math.random().toString(36).slice(2); }
  function escapeHtml(s) { return String(s).replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

  function load() {
    const def = defaultState();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          settings: Object.assign({}, def.settings, parsed.settings || {}),
          shifts: parsed.shifts || [],
          incomes: parsed.incomes || [],
          templates: parsed.templates || []
        };
      }
    } catch(e) {}
    try {
      const oldRaw = localStorage.getItem(OLD_KEY);
      if (oldRaw) return migrateFromV1(JSON.parse(oldRaw));
    } catch(e) {}
    return def;
  }

  let state = load();
  function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

  function getLang() { return state.settings.language === 'he' ? 'he' : 'en'; }
  function t(key) { return I18N[getLang()][key] || key; }
  function categoryLabel(cat) { return CATEGORY_LABELS[getLang()][cat] || cat; }

  let activeTab = 'summary';
  let monthFilter = 'all';
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
    const months = allMonths();
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
        <div class="entry-row" data-id="${s.id}" data-kind="shift">
          <div class="entry-main">
            <div class="entry-date">${dname}</div>
            <div class="entry-sub">${s.startTime}–${s.endTime} · ${fmt(c.totalHours)}h${s.note ? ' · ' + escapeHtml(s.note) : ''}</div>
            <div class="entry-badges">${badges}</div>
          </div>
          <div class="entry-amount">${money(c.pay)}</div>
          <div class="entry-chevron">›</div>
        </div>
      </div>`;
    }).join('');
    $('shiftsList').outerHTML = `<div class="list-group" id="shiftsList">${html}</div>`;
    attachRowHandlers();
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
        <div class="entry-row" data-id="${i.id}" data-kind="income">
          <div class="entry-main">
            <div class="entry-date">${categoryLabel(i.category)}</div>
            <div class="entry-sub">${dname}${i.note ? ' · ' + escapeHtml(i.note) : ''}</div>
          </div>
          <div class="entry-amount">${money(i.amount)}</div>
          <div class="entry-chevron">›</div>
        </div>
      </div>`;
    }).join('');
    $('incomeList').outerHTML = `<div class="list-group" id="incomeList">${html}</div>`;
    attachRowHandlers();
  }

  function deleteShift(id) { state.shifts = state.shifts.filter(s => s.id !== id); save(); renderDataViews(); }
  function deleteIncome(id) { state.incomes = state.incomes.filter(i => i.id !== id); save(); renderDataViews(); }

  function attachRowHandlers() {
    document.querySelectorAll('.entry-row-wrap').forEach(wrap => {
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
    state.settings.goalValue = parseFloat($('goalTargetInput').value) || 0;
    save(); renderGoals();
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
  function readSettingsForm() {
    state.settings.currency = $('setCurrency').value.trim() || '$';
    state.settings.rate = parseFloat($('setRate').value) || 0;
    state.settings.weekendPercent = parseFloat($('setWkPercent').value) || 100;
    state.settings.holidayPercent = parseFloat($('setHolidayPercent').value) || 100;
    state.settings.overtimeThreshold = Math.max(0, parseFloat($('setOtThreshold').value) || 0);
    state.settings.overtimePercent = parseFloat($('setOtPercent').value) || 100;
    save();
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
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.settings) throw new Error('Invalid file');
        const def = defaultState();
        state = {
          settings: Object.assign({}, def.settings, data.settings || {}),
          shifts: data.shifts || [],
          incomes: data.incomes || [],
          templates: data.templates || []
        };
        save();
        loadSettingsForm();
        loadGoalForm();
        applyLanguage();
        alert(t('alertImportOk'));
      } catch (err) {
        alert(t('alertImportFail') + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  $('resetBtn').addEventListener('click', () => {
    if (!confirm(t('confirmErase'))) return;
    state = defaultState();
    save();
    loadSettingsForm();
    loadGoalForm();
    applyLanguage();
  });

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
  function closeSheetOverlay() { $('sheetOverlay').classList.add('hidden'); sheetMode = null; editingId = null; }
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
  function initSettingsPickers() {
    const s = state.settings;
    const lang = getLang();

    buildWheelColumn($('wkStartDayCol'), DOW_FULL[lang], s.weekendStartDow);
    bindWheelScroll($('wkStartDayCol'), idx => { state.settings.weekendStartDow = idx; save(); updateSettingsPickerValues(); renderDataViews(); });
    bindWheelClicks($('wkStartDayCol'), idx => { state.settings.weekendStartDow = idx; save(); updateSettingsPickerValues(); renderDataViews(); });

    buildWheelColumn($('wkEndDayCol'), DOW_FULL[lang], s.weekendEndDow);
    bindWheelScroll($('wkEndDayCol'), idx => { state.settings.weekendEndDow = idx; save(); updateSettingsPickerValues(); renderDataViews(); });
    bindWheelClicks($('wkEndDayCol'), idx => { state.settings.weekendEndDow = idx; save(); updateSettingsPickerValues(); renderDataViews(); });

    function setWkTime(field, part, idx) {
      const cur = state.settings[field].split(':').map(Number);
      if (part==='hour') cur[0]=idx; else cur[1]=idx;
      state.settings[field] = String(cur[0]).padStart(2,'0')+':'+String(cur[1]).padStart(2,'0');
      save(); updateSettingsPickerValues(); renderDataViews();
    }

    const [sh,sm] = s.weekendStartTime.split(':').map(Number);
    buildWheelColumn($('wkStartHourCol'), HOURS, sh);
    buildWheelColumn($('wkStartMinCol'), MINUTES, sm);
    bindWheelScroll($('wkStartHourCol'), idx => setWkTime('weekendStartTime','hour',idx));
    bindWheelScroll($('wkStartMinCol'), idx => setWkTime('weekendStartTime','minute',idx));
    bindWheelClicks($('wkStartHourCol'), idx => setWkTime('weekendStartTime','hour',idx));
    bindWheelClicks($('wkStartMinCol'), idx => setWkTime('weekendStartTime','minute',idx));

    const [eh,em] = s.weekendEndTime.split(':').map(Number);
    buildWheelColumn($('wkEndHourCol'), HOURS, eh);
    buildWheelColumn($('wkEndMinCol'), MINUTES, em);
    bindWheelScroll($('wkEndHourCol'), idx => setWkTime('weekendEndTime','hour',idx));
    bindWheelScroll($('wkEndMinCol'), idx => setWkTime('weekendEndTime','minute',idx));
    bindWheelClicks($('wkEndHourCol'), idx => setWkTime('weekendEndTime','hour',idx));
    bindWheelClicks($('wkEndMinCol'), idx => setWkTime('weekendEndTime','minute',idx));

    setupPickerToggles(document);
    updateSettingsPickerValues();
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
      <button class="tpl-chip-select" data-apply="${tpl.id}">
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
    el.innerHTML = state.templates.map(tpl => `
      <div class="list-row picker-row" data-template-id="${tpl.id}">
        <div class="rlabel">${escapeHtml(tpl.name)}<span class="rsub">${tpl.startTime}–${tpl.endTime}</span></div>
        <span class="entry-chevron">›</span>
      </div>`).join('');
    el.querySelectorAll('[data-template-id]').forEach(row => {
      row.addEventListener('click', () => openTemplateSheet(row.dataset.templateId));
    });
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
          <div class="list-row"><div class="rlabel" data-i18n="fieldTemplateName">Name</div><input type="text" id="fTplName" placeholder="${t('templateNamePlaceholder')}" value="${escapeHtml(formTemplate.name)}" maxlength="24"></div>
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
          <div class="list-row"><div class="rlabel" data-i18n="fieldNote">Note</div><input type="text" id="fNote" placeholder="${t('notePlaceholder')}" value="${shift && shift.note ? escapeHtml(shift.note) : ''}"></div>
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
          <div class="list-row ${currentKey==='other'?'':'hidden'}" id="fCustomCatRow"><div class="rlabel" data-i18n="fieldCustomLabel">Custom label</div><input type="text" id="fCustomCat" placeholder="${t('customLabelPlaceholder')}" value="${escapeHtml(customVal)}"></div>
          <div class="list-row"><div class="rlabel" data-i18n="fieldAmount">Amount</div><input type="number" id="fAmount" min="0" step="0.5" value="${income ? income.amount : ''}"></div>
        </div>
      </div>
      <div class="field-group">
        <div class="list-group">
          <div class="list-row"><div class="rlabel" data-i18n="fieldNote">Note</div><input type="text" id="fNote" placeholder="${t('notePlaceholder')}" value="${income && income.note ? escapeHtml(income.note) : ''}"></div>
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
      if (!formShift.date || !formShift.startTime || !formShift.endTime) { alert(t('alertFillShiftTimes')); return; }
      const shiftObj = {
        id: editingId || genId(),
        date: formShift.date, startTime: formShift.startTime, endTime: formShift.endTime,
        isHoliday: $('fHoliday').checked,
        note: $('fNote').value.trim()
      };
      if (editingId) {
        const idx = state.shifts.findIndex(s => s.id === editingId);
        if (idx !== -1) state.shifts[idx] = shiftObj;
      } else {
        state.shifts.push(shiftObj);
      }
    } else if (sheetMode === 'income') {
      const amount = parseFloat($('fAmount').value);
      let category = $('fCategory').value;
      if (category === 'other') {
        const custom = $('fCustomCat').value.trim();
        if (custom) category = custom;
      }
      if (!formIncome.date || !amount || amount <= 0) { alert(t('alertFillIncome')); return; }
      const incomeObj = { id: editingId || genId(), date: formIncome.date, category, amount, note: $('fNote').value.trim() };
      if (editingId) {
        const idx = state.incomes.findIndex(i => i.id === editingId);
        if (idx !== -1) state.incomes[idx] = incomeObj;
      } else {
        state.incomes.push(incomeObj);
      }
    } else if (sheetMode === 'template') {
      const name = $('fTplName').value.trim();
      if (!name) { alert(t('alertFillTemplateName')); return; }
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

  // ---- boot ----
  loadSettingsForm();
  loadGoalForm();
  initSettingsPickers();
  applyLanguage();
})();
