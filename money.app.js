(function(){
  const $ = id => document.getElementById(id);
  const OLD_KEY = 'workTrackerData_v1';
  const KEY = 'workTrackerData_v2';
  const ITEM_H = 36;
  const HOURS = Array.from({length:24},(_,i)=>String(i).padStart(2,'0'));
  const MINUTES = Array.from({length:60},(_,i)=>String(i).padStart(2,'0'));
  const CATEGORY_KEYS = ['driving','cashback','bonus','reimbursement','other'];
  const ICON_CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>';
  const ICON_CHEV_L = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  const ICON_CHEV_R = '<svg class="ico-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  const ICON_CHEV_D = '<svg class="ico-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  const ICON_CHEV_U = '<svg class="ico-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
  const ICON_EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const ICON_EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.1M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M3 3l18 18"/></svg>';

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
        goalValue: 0,
        goalHours: 0,
        goalIncome: 0
      },
      rateSets: [],
      shifts: [],
      additions: [],
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
  const LIMITS = { shifts: 3000, additions: 50, templates: 50, rateSets: 500, note: 200, category: 40, tplName: 24, currency: 4, importBytes: 2 * 1024 * 1024 };
  const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
  function isValidMonth(v) { return typeof v === 'string' && MONTH_RE.test(v); }
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
  const CUSTOM_PAY_MAX = 1000000;
  const GOAL_MAX = { hours: 744, income: 10000000 };
  function isValidCustomPay(v) { return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= CUSTOM_PAY_MAX; }
  function normalizeState(raw) {
    const def = defaultState().settings;
    const src = raw && typeof raw === 'object' ? raw : {};
    const s = src.settings && typeof src.settings === 'object' ? src.settings : {};
    const goalType = s.goalType === 'income' ? 'income' : 'hours';
    const legacyGoal = num(s.goalValue, 0, GOAL_MAX.income, 0);
    const goalHours = num(s.goalHours, 0, GOAL_MAX.hours, goalType === 'hours' ? Math.min(legacyGoal, GOAL_MAX.hours) : 0);
    const goalIncome = num(s.goalIncome, 0, GOAL_MAX.income, goalType === 'income' ? legacyGoal : 0);
    const settings = Object.assign(ratesFrom(s, def), {
      currency: str(s.currency, LIMITS.currency).trim() || def.currency,
      language: s.language === 'he' ? 'he' : 'en',
      goalType: goalType,
      // The hours goal and the income goal are kept separately; goalValue mirrors the active one
      // (older app versions read it). A goal saved before the split belongs to the type it was set for.
      goalValue: goalType === 'income' ? goalIncome : goalHours,
      goalHours, goalIncome
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
      .map(x => {
        const shift = {
          id: uniqueId(x.id), date: x.date, startTime: x.startTime, endTime: x.endTime,
          isHoliday: x.isHoliday === true, note: str(x.note, LIMITS.note),
          rateId: typeof x.rateId === 'string' && rateIdRemap.has(x.rateId) ? rateIdRemap.get(x.rateId) : fallbackRateId()
        };
        // A pay amount the user set by hand for this shift replaces the calculated pay.
        if (isValidCustomPay(x.customPay)) shift.customPay = Math.round(x.customPay * 100) / 100;
        return shift;
      });
    const usedRateIds = new Set(shifts.map(x => x.rateId));
    // Monthly additions (e.g. driving expenses): each keeps an amount history so changing the
    // amount later never rewrites months that already passed. One-time incomes are no longer kept.
    const additions = list(src.additions)
      .filter(x => x && isValidMonth(x.from) && Array.isArray(x.versions))
      .slice(0, LIMITS.additions)
      .map(x => {
        const byMonth = new Map();
        x.versions.forEach(v => { if (v && isValidMonth(v.from)) byMonth.set(v.from, num(v.amount, 0, 10000000, 0)); });
        const versions = Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([from, amount]) => ({ from, amount }));
        return {
          id: uniqueId(x.id), category: str(x.category, LIMITS.category).trim() || 'other', from: x.from,
          until: isValidMonth(x.until) && x.until >= x.from ? x.until : null, versions
        };
      })
      .filter(x => x.versions.length);
    const templates = list(src.templates)
      .filter(x => x && str(x.name, LIMITS.tplName).trim() && isValidTime(x.startTime) && isValidTime(x.endTime))
      .slice(0, LIMITS.templates)
      .map(x => ({ id: uniqueId(x.id), name: str(x.name, LIMITS.tplName).trim(), startTime: x.startTime, endTime: x.endTime }));
    return { settings, rateSets: rateSets.filter(r => usedRateIds.has(r.id)), shifts, additions, templates };
  }

  // ---- monthly additions ----
  function additionAmountFor(a, month) {
    if (month < a.from || (a.until && month > a.until)) return 0;
    let amount = 0;
    a.versions.forEach(v => { if (v.from <= month) amount = v.amount; });
    return amount;
  }
  function monthHasShifts(month) { return state.shifts.some(s => monthKey(s.date) === month); }
  // Additions only count in months where at least one shift was logged.
  function additionsForMonth(month) {
    if (!monthHasShifts(month)) return [];
    return state.additions.map(a => ({ a, amount: additionAmountFor(a, month) })).filter(x => x.amount > 0);
  }
  function additionsTotal(month) { return additionsForMonth(month).reduce((sum, x) => sum + x.amount, 0); }

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
    return freshState();
  }

  // The last language used on this device, kept separately from the data so the sign-in
  // screen still speaks it after signing out (which wipes the data from the device).
  const UI_LANG_KEY = 'workTrackerUiLang';
  function freshState() {
    const s = defaultState();
    try { if (localStorage.getItem(UI_LANG_KEY) === 'he') s.settings.language = 'he'; } catch(e) {}
    return s;
  }

  // OWNER_KEY records which account the local cache belongs to, so one person's
  // cached data is never uploaded into, or shown to, a different account.
  const OWNER_KEY = 'workTrackerOwner';
  function getCacheOwner() { try { return localStorage.getItem(OWNER_KEY); } catch(e) { return null; } }
  function clearLocalCache() {
    try { localStorage.removeItem(KEY); localStorage.removeItem(OLD_KEY); localStorage.removeItem(OWNER_KEY); localStorage.removeItem(BASE_KEY); } catch(e) {}
    baseJson = null;
  }

  let state = load();
  let currentUser = null;
  let firestoreUnsub = null;
  // paychecks (see "paychecks" below); declared here because the Summary can be drawn before that code runs
  const PC_MAX_FILES = 3, PC_MAX_BYTES = 5 * 1024 * 1024, PC_CHUNK = 900000, PC_MAX_CHUNKS = 6;
  const PC_TYPES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };
  // Photos bigger than this, or wider/taller than PC_IMG_MAX px, are scaled down (still easy to read).
  const PC_SHRINK_OVER = 1.5 * 1024 * 1024, PC_IMG_MAX = 2200;
  // A photo may start bigger than PC_MAX_BYTES (it gets shrunk), but not bigger than this: reading and
  // decoding a much larger file could run a phone out of memory.
  const PC_MAX_PHOTO_BYTES = 30 * 1024 * 1024;
  const PC_REMIND_DAY = 10; // salaries are due by the 9th, so the slip should be in by the 10th
  const PC_SAVE_WAIT_MS = 30000; // after this, "Saving…" gives way to a "taking longer than usual" message
  const PC_SLOT_WAIT_MS = 15000; // how long to wait for the server to say which slot is free
  const ICON_CLIP = '<svg class="pill-clip" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"/></svg>';
  const ICON_FILE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>';
  const ICON_IMAGE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-9 9"/></svg>';
  const ICON_EXPAND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
  const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

  let paychecks = [];          // details of the signed-in user's files, newest data from the cloud
  let paychecksLoaded = false; // the first list has arrived (the reminder waits for it)
  let paycheckUnsub = null;
  const pcSaving = new Set();  // months with a file being saved, each shown with a "Saving…" row
  let pcZoomHistory = false;   // the full-screen picture added a Back-button step
  const pcBlobCache = new Map();
  let pcViewUrl = null;
  let pcZoomEl = null;         // the full-screen picture layer, while open

  let remoteReady = false;
  // the big Summary total's fitting (see fitTotal); declared up here because the Summary can be drawn early
  const TOTAL_MIN_PX = 22;
  let fitTotalTimer = null, totalProbe = null;

  // The data as the cloud last confirmed it. Comparing it with `state` shows which changes were
  // made on this device, so they're merged into whatever other devices saved meanwhile instead of
  // overwriting it. It's stored next to the data, so offline changes still merge after a restart.
  const BASE_KEY = 'workTrackerSyncBase';
  let baseJson = (() => {
    try { const raw = localStorage.getItem(BASE_KEY); return raw ? JSON.stringify(normalizeState(JSON.parse(raw))) : null; } catch(e) { return null; }
  })();
  function setBase(data) { baseJson = data ? JSON.stringify(data) : null; }
  function hasLocalChanges() { return baseJson !== null && JSON.stringify(state) !== baseJson; }

  function saveLocal() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      if (baseJson === null) localStorage.removeItem(BASE_KEY); else localStorage.setItem(BASE_KEY, baseJson);
      if (currentUser) localStorage.setItem(OWNER_KEY, currentUser.uid);
    } catch(e) {}
  }

  // Three-way merge: this device's changes (base -> local) applied on top of the cloud copy.
  // List items are matched by id; when both sides touched the same item, an edit beats a delete.
  function mergeStates(base, local, remote) {
    base = base || { settings: {}, rateSets: [], shifts: [], additions: [], templates: [] };
    const settings = Object.assign({}, remote.settings);
    Object.keys(local.settings).forEach(k => { if (local.settings[k] !== base.settings[k]) settings[k] = local.settings[k]; });
    // Both sides changed the same item (e.g. a note here while offline, custom pay on another device):
    // start from theirs and apply each field this device changed, so neither change is lost.
    // Only if both changed the same field does this device's value win.
    const mergeFields = (base, mine, theirs) => {
      const out = Object.assign({}, theirs);
      new Set([...Object.keys(base), ...Object.keys(mine)]).forEach(k => {
        if (JSON.stringify(mine[k]) === JSON.stringify(base[k])) return;
        if (k in mine) out[k] = mine[k]; else delete out[k];
      });
      return out;
    };
    const mergeList = (b, l, r) => {
      const was = new Map(b.map(x => [x.id, JSON.stringify(x)]));
      const baseItem = new Map(b.map(x => [x.id, x]));
      const mine = new Map(l.map(x => [x.id, x]));
      const out = [];
      const inRemote = new Set();
      r.forEach(x => {
        inRemote.add(x.id);
        const m = mine.get(x.id);
        if (m && JSON.stringify(m) !== was.get(x.id)) out.push(was.has(x.id) && JSON.stringify(x) !== was.get(x.id) ? mergeFields(baseItem.get(x.id), m, x) : m);
        else if (m || !was.has(x.id) || JSON.stringify(x) !== was.get(x.id)) out.push(x);
      });
      l.forEach(x => { if (!inRemote.has(x.id) && (!was.has(x.id) || JSON.stringify(x) !== was.get(x.id))) out.push(x); });
      return out;
    };
    const shifts = mergeList(base.shifts, local.shifts, remote.shifts);
    const rateSets = mergeList(base.rateSets, local.rateSets, remote.rateSets);
    // A rate set removed here as unused may be in use by a shift another device added.
    const known = new Set(rateSets.map(r => r.id));
    remote.rateSets.concat(local.rateSets, base.rateSets).forEach(r => {
      if (!known.has(r.id) && shifts.some(x => x.rateId === r.id)) { rateSets.push(r); known.add(r.id); }
    });
    return normalizeState({
      settings, rateSets, shifts,
      additions: mergeList(base.additions, local.additions, remote.additions),
      templates: mergeList(base.templates, local.templates, remote.templates)
    });
  }

  // Changes are sent in a transaction that reads the cloud copy and merges this device's changes
  // into it, so two devices (or one that was offline) never overwrite each other's work. Rapid
  // changes (e.g. scrolling a wheel) become one write. Offline the transaction fails; the changes
  // stay on this device and are sent when the connection returns.
  const WRITE_DEBOUNCE_MS = 600;
  let writeTimer = null;
  let syncing = null;
  let syncAgain = false;
  let inflightJson = null;
  function flushRemoteWrite() {
    clearTimeout(writeTimer);
    writeTimer = null;
    if (!currentUser || !remoteReady) return Promise.resolve();
    if (syncing) { syncAgain = true; return syncing; }
    const uid = currentUser.uid;
    const docRef = db.collection('users').doc(uid);
    const sent = JSON.parse(JSON.stringify(state));
    const base = baseJson === null ? null : JSON.parse(baseJson);
    syncing = db.runTransaction(tx => tx.get(docRef).then(snap => {
      if (!remoteReady || !currentUser || currentUser.uid !== uid) throw new Error('sync-stopped');
      const remote = snap.exists ? normalizeState(snap.data()) : null;
      const merged = remote ? mergeStates(base, sent, remote) : normalizeState(sent);
      inflightJson = JSON.stringify(merged);
      if (!remote || inflightJson !== JSON.stringify(remote)) tx.set(docRef, merged);
      return merged;
    }))
      .then(merged => {
        if (!currentUser || currentUser.uid !== uid) return;
        const before = JSON.stringify(state);
        const changedMeanwhile = before !== JSON.stringify(sent);
        setBase(merged);
        // Edits made while the transaction ran are carried over onto the merged result.
        state = changedMeanwhile ? mergeStates(sent, state, merged) : merged;
        saveLocal();
        if (JSON.stringify(state) !== before) refreshAll();
        if (changedMeanwhile) syncAgain = true;
      })
      .catch(err => {
        if (err && (err.message === 'sync-stopped' || err.code === 'unavailable')) return;
        console.error('Firestore save failed:', err);
        showToast(t('syncFailed'));
      })
      .then(() => {
        syncing = null;
        inflightJson = null;
        if (syncAgain) { syncAgain = false; return flushRemoteWrite(); }
      });
    return syncing;
  }
  function save() {
    state = normalizeState(state);
    saveLocal();
    if (!currentUser) return;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(flushRemoteWrite, WRITE_DEBOUNCE_MS);
  }
  function retrySync() { if (currentUser && remoteReady && !writeTimer && !syncing && hasLocalChanges()) flushRemoteWrite(); }
  window.addEventListener('online', retrySync);
  setInterval(retrySync, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (writeTimer) flushRemoteWrite(); }
    else retrySync();
  });
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

  function fmt(n) {
    return (Math.round((n + Number.EPSILON) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function money(n) { return state.settings.currency + fmt(n); }

  // ---- motion ----
  const reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  // Numbers glide to their new value instead of jumping (first render and format-only changes are instant).
  function countTo(el, value, format) {
    const from = el._countValue;
    el._countValue = value;
    cancelAnimationFrame(el._countRaf);
    if (typeof from !== 'number' || from === value || reduceMotion.matches || document.hidden) { el.textContent = format(value); return; }
    const t0 = performance.now(), dur = 550;
    const step = now => {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = format(p < 1 ? from + (value - from) * (1 - Math.pow(1 - p, 3)) : value);
      if (p < 1) el._countRaf = requestAnimationFrame(step);
    };
    el._countRaf = requestAnimationFrame(step);
  }
  // A removed row folds away before the data changes.
  function collapseRow(wrap, done) {
    if (!wrap || !wrap.isConnected || reduceMotion.matches) { done(); return; }
    wrap.style.height = wrap.offsetHeight + 'px';
    void wrap.offsetHeight;
    wrap.classList.add('removing');
    wrap.style.height = '0px';
    setTimeout(done, 240);
  }
  function shiftRowWrap(id) {
    const row = Array.from(document.querySelectorAll('#shiftsList .entry-row')).find(r => r.dataset.id === id);
    return row ? row.closest('.entry-row-wrap') : null;
  }
  function timeToMinutes(tm) { const [h,m] = tm.split(':').map(Number); return h*60+m; }

  // An end time at or before the start time means the shift ends the next day. The next day is
  // found on the calendar (not by adding 24h), so shifts on clock-change nights get their real length.
  function shiftRange(shift) {
    const [y, mo, d] = shift.date.split('-').map(Number);
    const [sh, sm] = shift.startTime.split(':').map(Number);
    const [eh, em] = shift.endTime.split(':').map(Number);
    const nextDay = timeToMinutes(shift.endTime) <= timeToMinutes(shift.startTime) ? 1 : 0;
    return { start: new Date(y, mo-1, d, sh, sm), end: new Date(y, mo-1, d + nextDay, eh, em) };
  }

  // A window whose end equals its start has no length (no weekend bonus), not a whole week.
  function windowDurationMinutes(settings) {
    const startTotal = settings.weekendStartDow*1440 + timeToMinutes(settings.weekendStartTime);
    let endTotal = settings.weekendEndDow*1440 + timeToMinutes(settings.weekendEndTime);
    let duration = endTotal - startTotal;
    if (duration < 0) duration += 7*1440;
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
        // The window ends at a wall-clock time a set number of days later (calendar math, DST-safe).
        const endWall = sh*60 + sm + durationMin;
        const winEnd = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + Math.floor(endWall/1440), Math.floor((endWall%1440)/60), endWall%60);
        const overlapStart = Math.max(start.getTime(), winStart.getTime());
        const overlapEnd = Math.min(end.getTime(), winEnd.getTime());
        if (overlapEnd > overlapStart) overlapMs += (overlapEnd - overlapStart);
      }
      cursor.setDate(cursor.getDate()+1);
    }
    return overlapMs / 3600000;
  }

  // Overtime follows the Israeli rest rule: shifts with less than 8 hours' rest between them are one work
  // period, and every hour beyond the threshold within that period is overtime (in whichever shift it falls).
  // 06:00-14:00 then 22:00 starts fresh; 06:00-14:00 then 20:00 makes the 20:00 shift overtime.
  // carry = hours already worked in the period before a shift starts.
  const REST_GAP_MS = 8 * 3600000;
  const shiftKey = s => s.date + ' ' + s.startTime + ' ' + s.endTime;
  let carryCache = { list: null, len: -1, map: null };
  function periodCarries(list) {
    const items = list.map(s => { const r = shiftRange(s); return { s, start: +r.start, end: +r.end }; })
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const map = new Map();
    let periodEnd = -Infinity, worked = 0;
    items.forEach(it => {
      if (it.start - periodEnd >= REST_GAP_MS) worked = 0;
      map.set(it.s.id, { key: shiftKey(it.s), carry: worked });
      worked += (it.end - it.start) / 3600000;
      periodEnd = Math.max(periodEnd, it.end);
    });
    return map;
  }
  function carryFor(shift) {
    const list = state.shifts;
    // saving always makes a new list, so the periods are worked out once per change
    if (carryCache.list !== list || carryCache.len !== list.length) carryCache = { list, len: list.length, map: periodCarries(list) };
    const hit = shift.id != null && carryCache.map.get(shift.id);
    if (hit && hit.key === shiftKey(shift)) return hit.carry;
    // a shift being edited (or not saved yet) is worked out in place of its saved version
    const draft = Object.assign({}, shift, { id: '__draft' });
    return periodCarries(list.filter(x => x.id !== shift.id).concat(draft)).get('__draft').carry;
  }

  function calcShift(shift) {
    const settings = ratesFor(shift);
    const { start, end } = shiftRange(shift);
    const totalHours = (end - start) / 3600000;
    const threshold = settings.overtimeThreshold || 0;
    const otPercent = settings.overtimePercent || 100;
    const carry = threshold > 0 ? carryFor(shift) : 0;
    const overtimeHours = threshold > 0 ? Math.min(totalHours, Math.max(0, totalHours - Math.max(0, threshold - carry))) : 0;
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
    // Rounded here the way the rows show them; totals add exactHours and round once (see the return below).
    const r2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
    if (isValidCustomPay(shift.customPay)) {
      return { totalHours: r2(totalHours), exactHours: totalHours, windowHours: 0, overtimeHours: 0, pay: r2(shift.customPay), bonusPay: 0, custom: true,
        parts: [{ key: 'custom', hours: r2(totalHours), amount: r2(shift.customPay), pct: null }] };
    }
    // The pay split by kind of hour, for the "how your pay adds up" breakdown. Each part is rounded and
    // any leftover agora/minute goes to the largest part, so the parts always add up to the shift's row.
    const parts = [];
    const part = (key, hours, pct) => { if (hours > 0) parts.push({ key, hours, pct, amount: hours * settings.rate * pct / 100 }); };
    if (shift.isHoliday) {
      part('holiday', baseRegularHours, pctBaseRegular); part('holiday', baseWindowHours, pctBaseWindow);
      part('holiday', otRegularHours, pctOtRegular); part('holiday', otWindowHours, pctOtWindow);
    } else {
      part('regular', baseRegularHours, 100); part('weekend', baseWindowHours, pctBaseWindow);
      part('overtime', otRegularHours, pctOtRegular); part('weekendOt', otWindowHours, pctOtWindow);
    }
    if (parts.length) {
      parts.forEach(x => { x.hours = r2(x.hours); x.amount = r2(x.amount); });
      const biggest = parts.reduce((a, b) => b.amount > a.amount ? b : a);
      biggest.amount = r2(biggest.amount + r2(pay) - parts.reduce((t, x) => t + x.amount, 0));
      biggest.hours = r2(biggest.hours + r2(totalHours) - parts.reduce((t, x) => t + x.hours, 0));
    }
    // exactHours: unrounded, for totals (adding rounded hours drifted, e.g. 179.92h for exactly 180h)
    return { totalHours: r2(totalHours), exactHours: totalHours, windowHours: r2(windowHours), overtimeHours: r2(overtimeHours), pay: r2(pay), bonusPay: r2(r2(pay) - r2(basePay)), parts };
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
    return Array.from(set).sort().reverse();
  }

  // Months offered as pills (and stepped through by the calendar swipe): this month, months with shifts,
  // and months with paychecks, so a paycheck stays reachable even if its month's shifts are all deleted.
  function pillMonths() {
    return Array.from(new Set([currentMonthStr(), ...allMonths(), ...paychecks.map(p => p.month)])).sort().reverse();
  }
  function renderPills(containerId) {
    const months = pillMonths();
    const el = $(containerId);
    const opts = [{ v: 'all', l: t('allTime') }].concat(months.map(m => ({ v: m, l: monthLabel(m) })));
    const withPay = new Set(paychecks.map(p => p.month));
    el.innerHTML = opts.map(o => `<button class="pill ${monthFilter === o.v ? 'active' : ''}" data-month="${o.v}">${o.l}${withPay.has(o.v) ? ICON_CLIP : ''}</button>`).join('');
    el.querySelectorAll('.pill').forEach(btn => {
      btn.addEventListener('click', () => selectMonth(btn.dataset.month));
    });
    if (pillsNeedScroll) {
      const a = el.querySelector('.pill.active');
      if (a) el.scrollTo({ left: el.scrollLeft + a.getBoundingClientRect().left - el.getBoundingClientRect().left - (el.clientWidth - a.offsetWidth) / 2, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
    }
  }
  let pillsNeedScroll = false;

  function filteredShifts() {
    return state.shifts.filter(s => monthFilter === 'all' || monthKey(s.date) === monthFilter)
      .slice().sort((a,b) => (b.date+b.startTime).localeCompare(a.date+a.startTime));
  }

  function renderSummary() {
    renderPills('summaryMonthPills');
    const shifts = filteredShifts();
    let totalHours=0, workPay=0;
    shifts.forEach(s => {
      const c = calcShift(s);
      totalHours += c.exactHours;
      workPay += c.pay;
    });
    const months = monthFilter === 'all' ? allMonths() : [monthFilter];
    const otherIncome = months.reduce((sum, m) => sum + additionsTotal(m), 0);

    const totalEl = $('sumTotal'), total = workPay + otherIncome;
    fitTotal([money(typeof totalEl._countValue === 'number' ? totalEl._countValue : total), money(total)]);
    countTo(totalEl, total, money);
    clearTimeout(fitTotalTimer);
    fitTotalTimer = setTimeout(() => fitTotal([money(total)]), 600);
    $('sumSub').textContent = `${t('sumSubWork')} ${money(workPay)} · ${t('sumSubOther')} ${money(otherIncome)}`;
    renderCalendar();
    renderBreakdown(shifts, months, totalHours, workPay + otherIncome);
    renderPaychecks();
  }

  // The big total shrinks to fit beside the eye button when it's long (e.g. ₪183,740.34 under "All time" on a
  // narrow phone) instead of running under the button; normal totals keep the full size. It's measured with an
  // invisible copy (same font and digit widths) and sized for the widest number a count-up or count-down will
  // pass through, then for the final number once the count is over.
  function fitTotal(texts) {
    const el = $('sumTotal');
    const room = el.clientWidth;
    if (!room) return; // Summary isn't on screen; it's fitted again when it's shown
    if (!totalProbe) {
      totalProbe = document.createElement('div');
      totalProbe.className = 'balance-value';
      totalProbe.setAttribute('aria-hidden', 'true');
      totalProbe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;top:0;left:0;pointer-events:none;';
    }
    // the copy is in the page only while measuring, then taken out again
    el.parentElement.appendChild(totalProbe);
    const full = parseFloat(getComputedStyle(totalProbe).fontSize);
    const widest = Math.max(...texts.map(x => { totalProbe.textContent = x; return totalProbe.scrollWidth; }));
    totalProbe.remove();
    el.style.fontSize = widest > room ? Math.max(TOTAL_MIN_PX, Math.floor(full * room / widest * 100) / 100) + 'px' : '';
  }
  function refitTotal() { fitTotal([$('sumTotal').textContent]); }
  window.addEventListener('resize', refitTotal);

  // "How your pay adds up": one line per kind of pay that actually happened in the period
  // (no empty lines), then a total of all the money and all the hours.
  const BREAKDOWN_ORDER = ['regular', 'weekend', 'overtime', 'weekendOt', 'holiday', 'custom'];
  function renderBreakdown(shifts, months, totalHours, totalMoney) {
    const lines = {};
    let customShifts = 0;
    shifts.forEach(s => {
      const c = calcShift(s);
      if (c.custom) customShifts++;
      c.parts.forEach(p => {
        const l = lines[p.key] || (lines[p.key] = { hours: 0, amount: 0, pcts: new Set() });
        l.hours += p.hours; l.amount += p.amount;
        if (p.pct !== null) l.pcts.add(p.pct);
      });
    });
    const additions = new Map();
    months.forEach(m => additionsForMonth(m).forEach(({ a, amount }) => {
      const cur = additions.get(a.id) || { label: categoryLabel(a.category), amount: 0, months: 0 };
      cur.amount += amount; cur.months++;
      additions.set(a.id, cur);
    }));
    const row = (label, sub, amount, cls = '') => `<div class="list-row bd-row${cls}"><div class="rlabel">${escapeHtml(label)}${sub ? `<span class="rsub">${escapeHtml(sub)}</span>` : ''}</div><div class="stat-val money-private">${escapeHtml(money(amount))}</div></div>`;
    let html = '';
    BREAKDOWN_ORDER.forEach(key => {
      const l = lines[key];
      if (!l || (l.hours <= 0 && l.amount <= 0)) return;
      const hours = hrsText(fmt(Math.round(l.hours * 100) / 100));
      const sub = key === 'custom'
        ? (customShifts === 1 ? t('bdOneShift') : t('bdShifts').replace('{n}', customShifts)) + ' · ' + hours
        : hours + (l.pcts.size === 1 ? ' · ' + [...l.pcts][0] + '%' : '');
      html += row(t('bd_' + key), sub, Math.round(l.amount * 100) / 100);
    });
    additions.forEach(x => { if (x.amount > 0) html += row(x.label, months.length > 1 ? t('bdAdditionMonths').replace('{n}', x.months) : t('bdAddition'), x.amount); });
    const wrap = $('payBreakdownWrap');
    wrap.classList.toggle('hidden', !html);
    if (!html) return;
    // Days worked counts calendar days, so two shifts on one day are one day.
    const days = new Set(shifts.map(x => x.date)).size;
    html += row(t('bdTotal'), hrsText(fmt(totalHours)) + ' · ' + (days === 1 ? t('bdOneDay') : t('bdDays').replace('{n}', days)), totalMoney, ' bd-total');
    const list = $('payBreakdown');
    list.innerHTML = html;
    const totalEl = list.querySelector('.bd-total .stat-val');
    totalEl._countValue = bdShownFor === monthFilter ? bdLastTotal : undefined;
    countTo(totalEl, totalMoney, money);
    bdLastTotal = totalMoney;
    if (bdShownFor !== monthFilter && !reduceMotion.matches) {
      list.querySelectorAll('.bd-row').forEach((r, i) => { r.style.setProperty('--row-delay', Math.min(i, 8) * 30 + 'ms'); r.classList.add('bd-in'); });
    }
    bdShownFor = monthFilter;
  }
  let bdShownFor = null, bdLastTotal = 0;

  // ---- Luach: the month on the Israeli wall calendar ----
  // Hebrew numerals for Hebrew dates: 15 → ט״ו, 22 → כ״ב, 5787 → תשפ״ז.
  function hebNumeral(n) {
    n %= 1000;
    const ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
    const tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
    const hundreds = ['', 'ק', 'ר', 'ש', 'ת'];
    let out = '';
    let h = Math.floor(n / 100);
    while (h > 4) { out += 'ת'; h -= 4; }
    out += hundreds[h];
    const rest = n % 100;
    if (rest === 15) out += 'טו';
    else if (rest === 16) out += 'טז';
    else out += tens[Math.floor(rest / 10)] + ones[rest % 10];
    return out.length === 1 ? out + '׳' : out.slice(0, -1) + '״' + out.slice(-1);
  }
  const hebDateFmt = (() => { try { return new Intl.DateTimeFormat('he-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric' }); } catch (e) { return null; } })();
  // Showing Hebrew dates is a per-device display choice: on by default in Hebrew, off in English,
  // until the user flips the switch in Settings.
  const HEB_DATES_KEY = 'workTrackerHebrewDates';
  function showHebrewDates() {
    try { const v = localStorage.getItem(HEB_DATES_KEY); if (v === '1') return true; if (v === '0') return false; } catch (e) {}
    return getLang() === 'he';
  }
  function hebrewDate(d) {
    if (!hebDateFmt || !showHebrewDates()) return null;
    const parts = {};
    hebDateFmt.formatToParts(d).forEach(p => { parts[p.type] = p.value; });
    const day = parseInt(parts.day, 10), year = parseInt(parts.year, 10);
    return { day: isNaN(day) ? parts.day : hebNumeral(day), month: parts.month, year: isNaN(year) ? parts.year : hebNumeral(year) };
  }
  // Parts of a weekday (minutes from midnight) inside the weekend-rate window, by wall clock.
  function weekendBands(dow, settings) {
    const ws = settings.weekendStartDow * 1440 + timeToMinutes(settings.weekendStartTime);
    const we = ws + windowDurationMinutes(settings);
    const bands = [];
    [-10080, 0, 10080].forEach(wrap => {
      const from = Math.max(ws + wrap, dow * 1440), to = Math.min(we + wrap, dow * 1440 + 1440);
      if (to > from) bands.push([from - dow * 1440, to - dow * 1440]);
    });
    return bands;
  }
  function dowShort(dow) {
    const he = getLang() === 'he';
    return new Date(2026, 9, 4 + dow).toLocaleDateString(he ? 'he-IL' : 'en', { weekday: he ? 'narrow' : 'short' });
  }
  const shortHours = h => String(Math.round(h * 100) / 100);
  // Hebrew puts a (non-breaking) space before the unit, so "8.00 ש׳" never splits across two lines.
  function hrsText(v) { return getLang() === 'he' ? v + '\u00a0' + t('hoursUnit') : v + t('hoursUnit'); }
  // One month of the Luach (weekday row + day grid). The swipe also uses it to draw the month beside the current one.
  function monthGridHtml(month) {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1), daysIn = new Date(y, m, 0).getDate();
    const settings = state.settings;
    const byDate = new Map();
    state.shifts.forEach(x => { if (monthKey(x.date) === month) byDate.set(x.date, (byDate.get(x.date) || []).concat(x)); });
    const today = todayStr();
    const fullDays = [0, 1, 2, 3, 4, 5, 6].map(d => weekendBands(d, settings).some(([a, z]) => a === 0 && z === 1440));
    let html = '<div class="luach-dow" aria-hidden="true">' + fullDays.map((full, d) => `<span${full ? ' class="shab"' : ''}>${escapeHtml(dowShort(d))}</span>`).join('') + '</div><div class="luach-grid">';
    const lead = first.getDay();
    const cells = Math.ceil((lead + daysIn) / 7) * 7;
    for (let i = 0; i < cells; i++) {
      const d = new Date(y, m - 1, 1 - lead + i);
      const ds = dateStr(d), inMonth = d.getMonth() === m - 1;
      const hd = hebrewDate(d);
      // Only days fully inside the weekend window are shaded; part days stay plain (the legend gives the exact hours).
      const shade = fullDays[d.getDay()] ? '<span class="luach-shade" style="top:0;height:100%"></span>' : '';
      const list = inMonth ? (byDate.get(ds) || []) : [];
      let chip = '', label = formatDateDisplay(ds);
      if (list.length) {
        const calcs = list.map(calcShift);
        const hours = calcs.reduce((sum, c) => sum + c.exactHours, 0);
        const kind = list.some((x, i) => x.isHoliday && !calcs[i].custom) ? ' holiday' : calcs.some(c => c.windowHours > 0) ? ' weekend' : '';
        chip = `<span class="luach-hrs${kind}">${shortHours(hours)}</span>`;
        label += ` · ${hrsText(fmt(hours))}`;
      }
      html += `<button type="button" class="luach-day${inMonth ? '' : ' out'}${ds === today ? ' today' : ''}${list.some(x => x.isHoliday) ? ' hol' : ''}" data-date="${ds}"${inMonth ? '' : ' disabled tabindex="-1"'} aria-label="${escapeHtml(label)}">${shade}`
        + `<span class="luach-d">${d.getDate()}</span>${chip}${hd ? `<span class="luach-heb" lang="he">${escapeHtml(hd.day)}</span>` : ''}</button>`;
    }
    return html + '</div>';
  }
  // calHold: while a swipe slides the calendar, the rest of the page already shows the new month
  // and the calendar itself is redrawn once the slide ends.
  let calShownFor = null, calChips = new Set(), calSwiping = false, calHold = false;
  function renderCalendar() {
    if (calHold) return;
    const cal = $('summaryCalendar'), legend = $('summaryCalendarLegend'), heb = $('summaryHebMonth');
    const on = monthFilter !== 'all';
    [cal, legend].forEach(el => el.classList.toggle('hidden', !on));
    heb.classList.toggle('hidden', !on || !showHebrewDates());
    if (!on) return;
    const [y, m] = monthFilter.split('-').map(Number);
    const first = new Date(y, m - 1, 1), daysIn = new Date(y, m, 0).getDate();
    const settings = state.settings;
    const h1 = hebrewDate(first), h2 = hebrewDate(new Date(y, m - 1, daysIn));
    heb.textContent = !h1 ? '' : h1.year !== h2.year ? `${h1.month} ${h1.year} – ${h2.month} ${h2.year}`
      : h1.month === h2.month ? `${h1.month} ${h1.year}` : `${h1.month} – ${h2.month} ${h1.year}`;
    cal.innerHTML = `<div class="luach-track"><div class="luach-pane">${monthGridHtml(monthFilter)}</div></div>`;
    const chips = new Set(Array.from(cal.querySelectorAll('.luach-hrs')).map(c => c.parentElement.dataset.date));
    if (!reduceMotion.matches) {
      if (calShownFor && calShownFor !== monthFilter && !calSwiping) {
        cal.style.setProperty('--cal-from', (monthFilter > calShownFor) !== isRtl() ? '-28px' : '28px');
        cal.classList.remove('cal-in'); void cal.offsetWidth; cal.classList.add('cal-in');
      }
      // The gold bar draws in when a month is picked from a pill; after a swipe it was already on screen, so it just stays.
      if (calShownFor !== monthFilter) cal.classList.toggle('cal-enter', !calSwiping);
      else {
        cal.classList.remove('cal-enter');
        chips.forEach(d => { if (!calChips.has(d)) cal.querySelector(`.luach-day[data-date="${d}"] .luach-hrs`).classList.add('pop'); });
      }
    }
    calShownFor = monthFilter; calChips = chips;
    cal.classList.toggle('with-heb', showHebrewDates());
    const windowText = windowDurationMinutes(settings) === 0 ? t('calNoWeekend')
      : `${t('calLegendWeekend')} · ${dowShort(settings.weekendStartDow)} ${settings.weekendStartTime} – ${dowShort(settings.weekendEndDow)} ${settings.weekendEndTime}`;
    legend.innerHTML = `<span><b>8</b>${escapeHtml(t('calLegendHours'))}</span><span><i class="swatch-shab"></i>${escapeHtml(windowText)}</span>`
      + `<span><i style="background:var(--red)"></i>${escapeHtml(t('calLegendHoliday'))}</span>`;
  }
  // The pill slide plays once; later re-renders of the same month must not replay it.
  $('summaryCalendar').addEventListener('animationend', e => { if (e.animationName === 'calIn') $('summaryCalendar').classList.remove('cal-in'); });
  // Tapping a day: edit its shift, add one on that date, or show several in the Shifts list.
  $('summaryCalendar').addEventListener('click', e => {
    const cell = e.target.closest('.luach-day');
    if (!cell || cell.disabled) return;
    const list = state.shifts.filter(x => x.date === cell.dataset.date).sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (list.length === 1) openShiftSheet(list[0].id);
    else if (!list.length) openShiftSheet(null, cell.dataset.date);
    else showShiftsInList(list.map(x => x.id));
  });
  // Shared feel for both swipes: the finger is followed once per frame, a quick flick counts even
  // when short, and the slide settles with a soft ease that is slower than a tap's response.
  // Page swipes are snappier; the calendar keeps its own, slightly longer timing.
  const SLIDE_MS = 280, SLIDE_MIN_MS = 200, SLIDE_BACK_MS = 260;
  const CAL_SLIDE = { max: 340, min: 240, back: 300, start: 1.8 };
  function swipeVelocity() {
    let pts = [];
    return {
      reset() { pts = []; },
      push(x) { const t = performance.now(); pts.push([x, t]); while (pts.length > 2 && t - pts[0][1] > 100) pts.shift(); },
      // px per ms: the fastest stretch of the last ~100ms (a finger eases off in the instant it lifts, so the
      // plain average undersold the swipe and the slide took over slower than the finger); 0 if it rested
      get() {
        if (pts.length < 2 || performance.now() - pts[pts.length - 1][1] > 80) return 0;
        const z = pts[pts.length - 1];
        let best = (z[0] - pts[0][0]) / Math.max(1, z[1] - pts[0][1]);
        for (let i = 1; i < pts.length - 1; i++) {
          const span = z[1] - pts[i][1];
          if (span >= 24) { const v = (z[0] - pts[i][0]) / span; if (Math.abs(v) > Math.abs(best)) best = v; }
          const prevSpan = pts[i][1] - pts[0][1];
          if (prevSpan >= 24) { const v = (pts[i][0] - pts[0][0]) / prevSpan; if (Math.abs(v) > Math.abs(best) && Math.sign(v) === Math.sign(best || v)) best = v; }
        }
        return best;
      }
    };
  }
  // Release: commit past 35% of the width, or on a clear flick in the swipe's direction. Flicks finish a little sooner.
  const swipeCommits = (dx, v, w) => Math.abs(dx) > w * 0.35 || (Math.abs(v) > 0.5 && Math.sign(v) === Math.sign(dx) && Math.abs(dx) > 40);
  // After the finger lifts, the slide is moved frame by frame here rather than by a CSS transition. On iPhone a
  // transition's clock starts when it is set, but its first frame is drawn a few frames later, so the page
  // jumped ahead (seen in a screen recording: two frozen frames, then a 161pt leap). Here the clock starts on
  // the first frame actually drawn, and the curve starts at the finger's own speed and slows to a stop, so
  // there is no kick when the finger lifts.
  function glide(from, to, v, maxMs, apply, done, minMs = SLIDE_MIN_MS, aMin = 2.4) {
    const D = to - from, dist = Math.abs(D);
    const speed = Math.max(0, v * Math.sign(D || 1));
    const T = Math.max(minMs, Math.min(maxMs, speed > 0 ? 3 * dist / speed : maxMs));
    // cubic that ends at speed 0 and starts at the finger's speed, but never slower than a brisk start
    // (a >= aMin), so the slide only ever decelerates and never creeps up to speed (that read as slow motion);
    // a <= 3 keeps it from overshooting
    const a = dist ? Math.max(aMin, Math.min(3, speed * T / dist)) : 0;
    const ease = u => a * u + (3 - 2 * a) * u * u + (a - 2) * u * u * u;
    // The first frame advances by the real time since the finger lifted (right at 60Hz or 120Hz), but by no
    // more than one 60Hz frame, so a late first frame can never turn into a jump.
    const lifted = performance.now();
    let t0 = null, stopped = false;
    const step = now => {
      if (stopped) return;
      if (t0 === null) t0 = Math.max(Math.min(lifted, now), now - 16.7);
      const u = Math.min(1, (now - t0) / T), e = ease(u);
      apply(from + D * e, e);
      if (u < 1) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
    // stop() halts the slide where it is (its "done" step never runs)
    return { stop() { stopped = true; } };
  }
  // A drag only becomes a sideways swipe once it is clearly sideways, so scrolling never flips pages by accident.
  const SWIPE_START = 14, SWIPE_AXIS = 1.6;

  // Swiping the calendar sideways steps through the months that have shifts (plus this month);
  // All time is picked from its pill. The next month is drawn beside the current one and both
  // move with the finger, so the card is never empty. Mirrored in Hebrew.
  (() => {
    const cal = $('summaryCalendar'), vel = swipeVelocity();
    let x0 = 0, y0 = 0, dx = 0, curX = 0, mode = null, busy = false, swallowClick = false, raf = 0, track = null, side = null, sideKey = '';
    const order = () => pillMonths().reverse();
    // Finger moving right goes forward in time in English (the next month comes in from the left).
    const targetFor = d => { const list = order(), i = list.indexOf(monthFilter); return i < 0 ? null : list[i + ((d > 0) !== isRtl() ? 1 : -1)] || null; };
    const place = (x, h) => {
      curX = x;
      track.style.transform = `translate3d(${x}px, 0, 0)`;
      if (h != null) track.style.height = h + 'px';
    };
    const dropSide = () => { if (side) side.remove(); side = null; sideKey = ''; };
    const pullSide = (month, d) => {
      const key = month ? month + (d > 0 ? '<' : '>') : '';
      if (key === sideKey) return;
      dropSide();
      if (!month) return;
      side = document.createElement('div');
      side.className = 'luach-pane side';
      side.setAttribute('aria-hidden', 'true'); side.inert = true;
      side.innerHTML = monthGridHtml(month);
      side.style.transform = `translate3d(${d > 0 ? -100 : 100}%, 0, 0)`;
      track.appendChild(side); sideKey = key;
    };
    const reset = () => { if (track) { track.style.transform = track.style.height = track.style.willChange = ''; } dropSide(); busy = false; };
    const frame = () => { raf = 0; const target = targetFor(dx); pullSide(target, dx); place(target ? dx : dx * 0.3); };
    cal.addEventListener('touchstart', e => {
      if (busy || e.touches.length !== 1) { mode = 'off'; return; }
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; mode = null; vel.reset();
      track = cal.querySelector('.luach-track');
    }, { passive: true });
    cal.addEventListener('touchmove', e => {
      if (mode === 'off' || e.touches.length !== 1) return;
      const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if (!mode) {
        if (Math.abs(mx) < SWIPE_START && Math.abs(my) < SWIPE_START) return;
        mode = Math.abs(mx) > Math.abs(my) * SWIPE_AXIS ? 'swipe' : 'off';
        if (mode !== 'swipe') return;
        if (!reduceMotion.matches) track.style.willChange = 'transform';
      }
      e.preventDefault();
      dx = mx; vel.push(e.touches[0].clientX);
      if (!reduceMotion.matches && !raf) raf = requestAnimationFrame(frame);
    }, { passive: false });
    const springBack = v => {
      busy = true;
      glide(curX, 0, v || 0, CAL_SLIDE.back, x => place(x), reset, CAL_SLIDE.min, CAL_SLIDE.start);
    };
    cal.addEventListener('touchend', () => {
      if (mode !== 'swipe') { mode = null; return; }
      mode = null;
      swallowClick = true; setTimeout(() => { swallowClick = false; }, 350);
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      const target = targetFor(dx), v = vel.get(), w = track.offsetWidth;
      if (!target || !swipeCommits(dx, v, w)) { if (reduceMotion.matches) return; springBack(v); return; }
      if (reduceMotion.matches) { pillsNeedScroll = calSwiping = true; selectMonth(target); pillsNeedScroll = calSwiping = false; return; }
      calHold = true;
      busy = true;
      pullSide(target, dx);
      const out = dx > 0 ? w : -w;
      // Months have 5 or 6 week rows: the card eases to the new month's height during the slide.
      const h0 = track.offsetHeight, h1 = side.offsetHeight;
      // Pills, totals and breakdown switch right away (just after the slide's first frame is on screen); only the
      // Summary is redrawn then, to keep the slide smooth. The rest (Shifts list, Goals) follows when it ends.
      let early = false;
      const switchSummary = () => { pillsNeedScroll = true; monthFilter = lastSpecificMonth = target; renderSummary(); pillsNeedScroll = false; };
      glide(curX, out, v, CAL_SLIDE.max, (x, e) => { place(x, h0 + (h1 - h0) * e); if (!early) { early = true; setTimeout(switchSummary, 0); } }, () => {
        calHold = false; calSwiping = true; renderDataViews(); calSwiping = false; reset();
      }, CAL_SLIDE.min, CAL_SLIDE.start);
    });
    cal.addEventListener('touchcancel', () => { if (mode === 'swipe') springBack(0); mode = null; });
    cal.addEventListener('click', e => { if (swallowClick) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  })();
  function showShiftsInList(ids) {
    switchTab('shifts');
    ids.forEach((id, i) => {
      const wrap = shiftRowWrap(id);
      if (!wrap) return;
      if (i === 0) wrap.scrollIntoView({ block: 'center' });
      wrap.classList.remove('row-flash');
      void wrap.offsetWidth;
      wrap.classList.add('row-flash');
      wrap.addEventListener('animationend', function done(ev) {
        if (ev.animationName !== 'rowFlash') return;
        wrap.classList.remove('row-flash');
        wrap.removeEventListener('animationend', done);
      });
    });
  }

  function isRtl() { return document.documentElement.getAttribute('dir') === 'rtl'; }

  function renderShifts() {
    renderPills('shiftsMonthPills');
    const shifts = filteredShifts();
    if (!shifts.length) {
      $('shiftsList').outerHTML = `<div class="list-group" id="shiftsList"><div class="empty-state"><div class="big">${ICON_CLOCK}</div>${t('emptyShifts')}</div></div>`;
      return;
    }
    const overlapping = findOverlaps(state.shifts);
    const html = shifts.map(s => {
      const c = calcShift(s);
      const dname = formatDateDisplay(s.date);
      const hd = hebrewDate(new Date(s.date + 'T00:00:00'));
      let badges = overlapping.has(s.id) ? `<span class="badge badge-overlap">${t('badgeOverlap')}</span>` : '';
      if (c.windowHours > 0) badges += `<span class="badge badge-weekend">${t('badgeWeekend')} ${hrsText(fmt(c.windowHours))}</span>`;
      if (s.isHoliday && !c.custom) badges += `<span class="badge badge-holiday">${t('badgeHoliday')}</span>`;
      if (c.custom) badges += `<span class="badge badge-custom">${t('badgeCustomPay')}</span>`;
      if (c.overtimeHours > 0) badges += `<span class="badge badge-overtime">${t('badgeOvertime')} ${hrsText(fmt(c.overtimeHours))}</span>`;
      return `<div class="entry-row-wrap">
        <div class="entry-row" data-id="${escapeHtml(s.id)}" data-kind="shift">
          <div class="entry-main">
            <div class="entry-date">${escapeHtml(dname)}${hd ? `<span class="heb-date" lang="he">${escapeHtml(hd.day + ' ' + hd.month)}</span>` : ''}</div>
            <div class="entry-sub">${s.startTime}–${s.endTime} · ${hrsText(fmt(c.totalHours))}${s.note ? ' · ' + escapeHtml(s.note) : ''}</div>
            <div class="entry-badges">${badges}</div>
          </div>
          <div class="entry-amount">${escapeHtml(money(c.pay))}</div>
          <div class="entry-chevron">${ICON_CHEV_R}</div>
        </div>
      </div>`;
    }).join('');
    $('shiftsList').outerHTML = `<div class="list-group" id="shiftsList">${html}</div>`;
    attachRowHandlers($('shiftsList'));
    animateNewRows(shifts);
  }

  // Rows not on screen before slide in; when the month changes the whole list cascades in.
  let shownRowIds = null, shownRowsFilter = null;
  function animateNewRows(shifts) {
    const listChanged = shownRowsFilter !== monthFilter;
    const before = shownRowIds;
    shownRowIds = new Set(shifts.map(s => s.id));
    shownRowsFilter = monthFilter;
    if (reduceMotion.matches) return;
    let n = 0;
    $('shiftsList').querySelectorAll('.entry-row-wrap').forEach(wrap => {
      const id = wrap.querySelector('.entry-row').dataset.id;
      if (!listChanged && before && before.has(id)) return;
      if (listChanged) wrap.style.setProperty('--row-delay', Math.min(n++, 10) * 28 + 'ms');
      wrap.classList.add('row-in');
      wrap.addEventListener('animationend', () => { wrap.classList.remove('row-in'); wrap.style.removeProperty('--row-delay'); }, { once: true });
    });
  }

  function deleteShift(id) { state.shifts = state.shifts.filter(s => s.id !== id); save(); renderDataViews(); }

  function attachRowHandlers(container) {
    container.querySelectorAll('.entry-row-wrap').forEach(wrap => {
      const rowEl = wrap.querySelector('.entry-row');
      const id = rowEl.dataset.id;
      const kind = rowEl.dataset.kind;
      rowEl.addEventListener('click', () => openShiftSheet(id));
    });
  }

  // ---- goals ----
  function renderGoalPills() {
    const months = pillMonths();
    const el = $('goalMonthPills');
    const active = goalMonth();
    const withPay = new Set(paychecks.map(p => p.month));
    el.innerHTML = months.map(m => `<button class="pill ${active===m?'active':''}" data-month="${m}">${monthLabel(m)}${withPay.has(m) ? ICON_CLIP : ''}</button>`).join('');
    el.querySelectorAll('.pill').forEach(btn => btn.addEventListener('click', () => selectMonth(btn.dataset.month)));
  }
  const goalKey = () => state.settings.goalType === 'income' ? 'goalIncome' : 'goalHours';
  function loadGoalForm() {
    $('goalTargetInput').value = state.settings[goalKey()] || '';
    $('goalTypeToggle').querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.goaltype === (state.settings.goalType||'hours')));
  }
  $('goalTypeToggle').querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
    state.settings.goalType = b.dataset.goaltype;
    state.settings.goalValue = state.settings[goalKey()] || 0;
    save(); loadGoalForm(); renderGoals();
  }));
  $('goalTargetInput').addEventListener('change', () => {
    const raw = $('goalTargetInput').value.trim();
    const n = parseFloat(raw);
    const max = GOAL_MAX[state.settings.goalType === 'income' ? 'income' : 'hours'];
    if (raw === '') state.settings[goalKey()] = 0;
    else if (Number.isFinite(n) && n >= 0 && n <= max) state.settings[goalKey()] = n;
    else showToast(t('settingsInvalidKept'));
    state.settings.goalValue = state.settings[goalKey()] || 0;
    save(); loadGoalForm(); renderGoals();
  });

  function renderGoals() {
    renderGoalPills();
    const month = goalMonth();
    const shifts = state.shifts.filter(s => monthKey(s.date) === month);
    let totalHours = 0, workPay = 0;
    shifts.forEach(s => { const c = calcShift(s); totalHours += c.exactHours; workPay += c.pay; });
    const otherIncome = additionsTotal(month);
    const totalEarn = workPay + otherIncome;

    const type = state.settings.goalType || 'hours';
    const target = state.settings[goalKey()] || 0;
    const achieved = type === 'hours' ? totalHours : totalEarn;
    const pct = target > 0 ? Math.min(1, achieved/target) : 0;
    const CIRC = 2*Math.PI*52;
    const ring = $('goalRingProgress');
    ring.setAttribute('stroke-dasharray', CIRC);
    ring.setAttribute('stroke-dashoffset', CIRC*(1-pct));
    ring.style.stroke = (target>0 && achieved>=target) ? 'var(--green)' : 'var(--accent)';
    if (target > 0) countTo($('goalPercent'), Math.round(pct*100), v => Math.round(v)+'%');
    else { $('goalPercent')._countValue = null; $('goalPercent').textContent = '—'; }

    const fmtVal = v => type==='hours' ? hrsText(fmt(v)) : money(v);
    $('goalAchievedLabel').textContent = target>0 ? `${fmtVal(achieved)} ${t('goalOf')} ${fmtVal(target)}` : fmtVal(achieved);
    if (target<=0) $('goalRemainingLabel').textContent = t('goalSetPrompt');
    else if (achieved>=target) $('goalRemainingLabel').textContent = t('goalReached');
    else $('goalRemainingLabel').textContent = `${fmtVal(target-achieved)} ${t('goalRemaining')}`;
  }

  function renderDataViews() {
    renderSummary();
    renderShifts();
    renderGoals();
    renderApplyRatesList();
  }

  // ---- static i18n ----
  function applyStaticTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    $('fab').setAttribute('aria-label', t('sheetNewShift'));
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
    $('setHebDates').checked = showHebrewDates();
  }
  // Invalid or out-of-range input (e.g. a negative rate) keeps the previous value instead of
  // being clamped, so a typo can never silently turn pay into 0.
  function readSettingsForm() {
    const s = state.settings;
    let rejected = false;
    const field = (id, min, max, current) => {
      const raw = $(id).value.trim();
      const n = parseFloat(raw);
      if (raw !== '' && Number.isFinite(n) && n >= min && n <= max) return n;
      if (raw !== '' && n !== current) rejected = true;
      return current;
    };
    s.currency = $('setCurrency').value.trim().slice(0, LIMITS.currency) || s.currency;
    s.rate = field('setRate', 0, 100000, s.rate);
    s.weekendPercent = field('setWkPercent', 0, 1000, s.weekendPercent);
    s.holidayPercent = field('setHolidayPercent', 0, 1000, s.holidayPercent);
    s.overtimeThreshold = field('setOtThreshold', 0, 24, s.overtimeThreshold);
    s.overtimePercent = field('setOtPercent', 0, 1000, s.overtimePercent);
    if (rejected) showToast(t('settingsInvalidKept'));
    save();
    loadSettingsForm();
    renderDataViews();
  }
  ['setCurrency','setRate','setWkPercent','setHolidayPercent','setOtThreshold','setOtPercent'].forEach(id => $(id).addEventListener('change', readSettingsForm));
  $('setHebDates').addEventListener('change', () => {
    try { localStorage.setItem(HEB_DATES_KEY, $('setHebDates').checked ? '1' : '0'); } catch (e) {}
    renderDataViews();
  });

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
        if (!data || typeof data !== 'object' || Array.isArray(data) || !data.settings) throw new Error('not a backup');
      } catch (err) {
        // A plain message in the app's language; the technical reason (e.g. a JSON parse error) only goes to the console.
        console.warn('Import refused:', err && err.message);
        alert(t('alertImportFail') + t('alertImportInvalid'));
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
        <span class="entry-chevron">${ICON_CHEV_R}</span>
      </div>`).join('') + (hidden ? `
      <div class="list-row picker-row rates-toggle" id="ratesListToggle">
        <div class="rlabel" style="color:var(--accent);">${escapeHtml(ratesListExpanded ? t('ratesShowLess') : t('ratesShowMore').replace('{n}', hidden))}</div>
        <span class="chev">${ratesListExpanded ? ICON_CHEV_U : ICON_CHEV_D}</span>
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
  function runDailyBackup(uid, data) {
    const today = todayStr();
    const flagKey = 'workTrackerBackup_' + uid;
    try { if (localStorage.getItem(flagKey) === today) return; } catch(e) {}
    if (!data.shifts.length && !data.additions.length && !data.templates.length) return;
    const col = backupsRef(uid);
    col.doc(today).get().then(snap => {
      const writes = [];
      if (!snap.exists) writes.push(col.doc(today).set({ data, createdAt: firebase.firestore.FieldValue.serverTimestamp() }));
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
            <div class="rlabel">${escapeHtml(labelFor(e.id))}<span class="rsub">${escapeHtml(t('backupEntry').replace('{s}', e.data.shifts.length))}</span></div>
            <span class="entry-chevron">${ICON_CHEV_R}</span>
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

  // ---- paychecks: up to 3 files (PDF, JPEG, PNG) per month, saved on the account ----
  // Stored in Firestore (no Cloud Storage on the free plan): each file is split into pieces of at most
  // PC_CHUNK bytes under users/{uid}/paychecks/{month}-{slot}/chunks/{n}, and its details doc is written
  // in the same batch, so a file is either saved whole or not at all. Limits must match firestore.rules.
  function paychecksRef(uid) { return db.collection('users').doc(uid).collection('paychecks'); }
  function paychecksFor(month) { return paychecks.filter(p => p.month === month).sort((a, b) => a.slot - b.slot); }
  function paycheckMonths() { return Array.from(new Set(paychecks.map(p => p.month))).sort(); }
  function formatBytes(n) { return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function pcDismissKey() { return 'workTrackerPaycheckDismissed_' + (currentUser ? currentUser.uid : ''); }

  function startPaycheckSync(user) {
    stopPaycheckSync();
    paycheckUnsub = paychecksRef(user.uid).onSnapshot(snap => {
      paychecks = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(p => /^\d{4}-\d{2}$/.test(p.month) && PC_TYPES[p.type] && p.chunks >= 1);
      paychecksLoaded = true;
      renderDataViews();
    }, err => console.error('Paychecks sync error:', err));
  }
  function stopPaycheckSync() {
    if (paycheckUnsub) { paycheckUnsub(); paycheckUnsub = null; }
    paychecks = []; paychecksLoaded = false; pcSaving.clear();
    pcBlobCache.clear();
  }

  // Checks the file's first bytes, not just its name, so a renamed file can't slip through.
  function sniffType(bytes) {
    if (bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'application/pdf';
    if (bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
    if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
    return null;
  }

  // Large photos are redrawn smaller as JPEG (white behind transparent PNG areas). Returns null if it can't help.
  function shrinkImage(blob) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, PC_IMG_MAX / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        c.toBlob(out => resolve(out && out.size < blob.size ? out : null), 'image/jpeg', 0.85);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  // Reads, checks and (for big photos) shrinks a picked file. Resolves { bytes, type, name } or rejects with a message key.
  // Only the first bytes are read before the type and size are checked, so a wrong or huge file (say a long
  // video picked by mistake) is refused at once instead of being loaded into the phone's memory first.
  async function preparePaycheckFile(file) {
    let type = sniffType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    if (!type) throw new Error('pcBadType');
    if (type === 'application/pdf' && file.size > PC_MAX_BYTES) throw new Error('pcTooBig');
    if (type !== 'application/pdf' && file.size > PC_MAX_PHOTO_BYTES) throw new Error('pcTooBigPhoto');
    let bytes = new Uint8Array(await file.arrayBuffer());
    let name = String(file.name || 'paycheck').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 120) || 'paycheck';
    if (type !== 'application/pdf' && (bytes.length > PC_SHRINK_OVER || await imageTooLarge(file))) {
      const small = await shrinkImage(new Blob([bytes], { type }));
      if (small) {
        bytes = new Uint8Array(await small.arrayBuffer());
        type = 'image/jpeg';
        name = name.replace(/\.(png|jpe?g)$/i, '') + '.jpg';
      }
    }
    if (bytes.length > PC_MAX_BYTES) throw new Error('pcTooBig');
    if (!bytes.length) throw new Error('pcBadType');
    return { bytes, type, name };
  }
  function imageTooLarge(blob) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(Math.max(img.naturalWidth, img.naturalHeight) > PC_IMG_MAX); };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(false); };
      img.src = url;
    });
  }

  // Which of the month's 3 slots is free: 1-3, 0 = month full, -1 = can't tell. Asked of the server, so it is
  // right even before this device's list has loaded (just after signing in on a new phone) and if another
  // device added a file meanwhile. If the server can't be reached in time, the list on this device is used.
  async function freePaycheckSlot(uid, month) {
    const lookup = Promise.all([1, 2, 3].map(n => paychecksRef(uid).doc(`${month}-${n}`).get({ source: 'server' })))
      .then(snaps => { const i = snaps.findIndex(x => !x.exists); return i < 0 ? 0 : i + 1; });
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), PC_SLOT_WAIT_MS));
    try { return await Promise.race([lookup, timeout]); }
    catch (err) {
      console.warn('Paycheck slot check failed:', err && (err.code || err.message));
      if (!paychecksLoaded) return -1;
      const taken = paychecksFor(month).map(p => p.slot);
      return [1, 2, 3].find(x => !taken.includes(x)) || 0;
    }
  }

  async function uploadPaycheck(month, file) {
    if (!currentUser) return;
    if (paychecksLoaded && paychecksFor(month).length >= PC_MAX_FILES) { showToast(t('pcFull')); return; }
    if (navigator.onLine === false) { showToast(t('pcOffline')); return; }
    let prepared;
    try { prepared = await preparePaycheckFile(file); }
    catch (err) { showToast(t(err && /^pc/.test(err.message) ? err.message : 'pcBadType')); return; }
    const { bytes, type, name } = prepared;
    const chunks = Math.ceil(bytes.length / PC_CHUNK);
    if (chunks > PC_MAX_CHUNKS) { showToast(t('pcTooBig')); return; }
    const uid = currentUser.uid;
    pcSaving.add(month);
    renderPaychecks();
    const finish = key => { showToast(t(key)); pcSaving.delete(month); renderPaychecks(); };
    const began = Date.now(); // the slot check and the save share one time limit (PC_SAVE_WAIT_MS)
    // Two tries: if another device took the free slot between the check and the save (the server refuses
    // writing over an existing file), the slots are checked again once.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const slot = await freePaycheckSlot(uid, month);
      if (slot === 0) return finish('pcFull');
      if (slot < 0) return finish('pcUploadFailed');
      const ref = paychecksRef(uid).doc(`${month}-${slot}`);
      const batch = db.batch();
      for (let i = 0; i < chunks; i++) {
        batch.set(ref.collection('chunks').doc(String(i)), { d: firebase.firestore.Blob.fromUint8Array(bytes.subarray(i * PC_CHUNK, (i + 1) * PC_CHUNK)) });
      }
      // the details doc is part of the same batch, so it only exists once every piece is saved
      batch.set(ref, { month, slot, name, type, fileSize: bytes.length, chunks, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      // A connection that looks online but can't reach the server would keep "Saving…" spinning forever, so the
      // wait is capped. The save itself can't be cancelled; it keeps going and finishes when the connection does.
      let gaveUp = false;
      const commit = batch.commit().then(() => {
        pcBlobCache.set(ref.id, new Blob([bytes], { type }));
        if (gaveUp) showToast(t('pcSaved'));
        return 'ok';
      }, err => {
        console.error('Paycheck upload failed:', err);
        if (gaveUp) showToast(t('pcUploadFailed'));
        return err && err.code === 'permission-denied' ? 'taken' : 'fail';
      });
      const wait = Math.max(5000, PC_SAVE_WAIT_MS - (Date.now() - began));
      const result = await Promise.race([commit, new Promise(res => setTimeout(() => res('slow'), wait))]);
      if (result === 'slow') { gaveUp = true; return finish('pcSlow'); }
      if (result === 'taken' && attempt === 1) continue;
      return finish(result === 'ok' ? 'pcSaved' : 'pcUploadFailed');
    }
  }

  async function loadPaycheckBlob(p) {
    if (pcBlobCache.has(p.id)) return pcBlobCache.get(p.id);
    const ref = paychecksRef(currentUser.uid).doc(p.id).collection('chunks');
    const parts = await Promise.all(Array.from({ length: p.chunks }, (_, i) => ref.doc(String(i)).get()));
    const pieces = parts.map(s => { const d = s.exists && s.data().d; if (!d) throw new Error('missing piece'); return d.toUint8Array(); });
    const blob = new Blob(pieces, { type: p.type });
    if (blob.size !== p.fileSize) throw new Error('size mismatch');
    pcBlobCache.set(p.id, blob);
    return blob;
  }

  function deletePaycheckDocs(uid, p) {
    const ref = paychecksRef(uid).doc(p.id);
    const batch = db.batch();
    // every possible piece is removed, so nothing is left behind even if the count was off
    for (let i = 0; i < PC_MAX_CHUNKS; i++) batch.delete(ref.collection('chunks').doc(String(i)));
    batch.delete(ref);
    return batch.commit();
  }
  function deleteAllPaychecks(uid) {
    return paychecksRef(uid).get().then(snap => Promise.all(snap.docs.map(d => deletePaycheckDocs(uid, { id: d.id }))));
  }

  // File name used when saving: "Paycheck 2026-10.pdf", a second one that month "Paycheck 2026-10 (2).jpg".
  function paycheckFileName(p) {
    const n = paychecksFor(p.month).findIndex(x => x.id === p.id) + 1;
    return `Paycheck ${p.month}${n > 1 ? ` (${n})` : ''}.${PC_TYPES[p.type]}`;
  }

  // ---- Summary: the selected month's paycheck files, and the reminder ----
  function renderPaychecks() {
    const wrap = $('paycheckWrap'), reminder = $('paycheckReminder');
    const on = !!currentUser && monthFilter !== 'all';
    wrap.classList.toggle('hidden', !on);
    renderPaycheckReminder(reminder);
    // Under "All time" (or signed out) the section is hidden and emptied, so no other month's files linger.
    if (!on) { $('paycheckList').innerHTML = ''; return; }
    const files = paychecksFor(monthFilter);
    let html = files.map(p => `<button type="button" class="list-row pc-row" data-pc="${escapeHtml(p.id)}">
        <span class="pc-ico">${p.type === 'application/pdf' ? ICON_FILE : ICON_IMAGE}</span>
        <span class="rlabel">${escapeHtml(p.name)}<span class="rsub">${escapeHtml(PC_TYPES[p.type].toUpperCase())} · ${escapeHtml(formatBytes(p.fileSize))}</span></span>
        <span class="entry-chevron">${ICON_CHEV_R}</span>
      </button>`).join('');
    if (pcSaving.has(monthFilter)) html += `<div class="list-row pc-row pc-busy"><span class="pc-ico pc-spin"></span><span class="rlabel">${escapeHtml(t('pcUploading'))}</span></div>`;
    else if (files.length < PC_MAX_FILES) html += `<button type="button" class="list-row pc-row pc-add" id="paycheckAddBtn"><span class="pc-ico">${ICON_PLUS}</span><span class="rlabel">${escapeHtml(t(files.length ? 'pcAttachMore' : 'pcAttach'))}</span></button>`;
    $('paycheckList').innerHTML = html;
    $('paycheckList').querySelectorAll('[data-pc]').forEach(row => row.addEventListener('click', () => {
      const p = paychecks.find(x => x.id === row.dataset.pc);
      if (p) openPaycheckViewer(p);
    }));
    const add = $('paycheckAddBtn');
    if (add) add.addEventListener('click', () => pickPaycheck(monthFilter));
  }
  function pickPaycheck(month) {
    const input = $('paycheckInput');
    input.dataset.month = month;
    input.value = '';
    input.click();
  }
  $('paycheckInput').addEventListener('change', () => {
    const input = $('paycheckInput'), file = input.files && input.files[0], month = input.dataset.month;
    input.value = '';
    if (file && /^\d{4}-\d{2}$/.test(month || '')) uploadPaycheck(month, file);
  });

  // Every past month of the last PC_REMIND_MONTHS that has shifts but no paycheck is listed on Summary
  // (last month only from the 10th). "Not now" hides the months shown until another one goes missing.
  const PC_REMIND_MONTHS = 12;
  function pcDismissedMonths() {
    let raw = '';
    try { raw = localStorage.getItem(pcDismissKey()) || ''; } catch (e) {}
    if (isValidMonth(raw)) return [raw]; // saved by the version that reminded about one month only
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter(isValidMonth) : []; } catch (e) { return []; }
  }
  function missingPaycheckMonths() {
    const d = new Date(), dismissed = new Set(pcDismissedMonths()), out = [];
    for (let k = PC_REMIND_MONTHS; k >= 1; k--) {
      if (k === 1 && d.getDate() < PC_REMIND_DAY) continue;
      const m = new Date(d.getFullYear(), d.getMonth() - k, 1);
      const month = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
      if (!dismissed.has(month) && state.shifts.some(x => monthKey(x.date) === month) && !paychecksFor(month).length && !pcSaving.has(month)) out.push(month);
    }
    return out; // oldest first
  }
  function renderPaycheckReminder(el) {
    const months = currentUser && paychecksLoaded ? missingPaycheckMonths() : [];
    el.classList.toggle('hidden', !months.length);
    if (!months.length) { el.innerHTML = ''; return; }
    const thisYear = new Date().getFullYear();
    const chipLabel = m => +m.slice(0, 4) === thisYear
      ? new Date(m + '-01T00:00:00').toLocaleDateString(getLang() === 'he' ? 'he-IL' : undefined, { month: 'short' })
      : monthLabel(m);
    const one = months.length === 1;
    el.classList.toggle('many', !one);
    el.innerHTML = `<div class="pc-rem-head"><span class="pc-ico">${ICON_CLIP}</span>
        <span class="pc-rem-text">${escapeHtml(one ? t('pcReminder').replace('{m}', monthLongLabel(months[0])) : t('pcReminderMany').replace('{n}', months.length))}</span>
        ${one ? `<button type="button" class="pc-rem-btn" data-pc-month="${months[0]}">${escapeHtml(t('pcReminderAdd'))}</button>` : ''}
        <button type="button" class="pc-rem-btn pc-rem-dismiss" id="pcRemDismiss">${escapeHtml(t('pcReminderDismiss'))}</button></div>
      ${one ? '' : `<div class="pc-rem-chips">${months.map(m => `<button type="button" class="pc-rem-chip" data-pc-month="${m}" aria-label="${escapeHtml(t('pcReminderChip').replace('{m}', monthLongLabel(m)))}">${ICON_PLUS}<span>${escapeHtml(chipLabel(m))}</span></button>`).join('')}</div>`}`;
    el.querySelectorAll('[data-pc-month]').forEach(b => b.addEventListener('click', () => { selectMonth(b.dataset.pcMonth); pickPaycheck(b.dataset.pcMonth); }));
    $('pcRemDismiss').addEventListener('click', () => {
      const keep = pcDismissedMonths().concat(months).slice(-24);
      try { localStorage.setItem(pcDismissKey(), JSON.stringify(Array.from(new Set(keep)))); } catch (e) {}
      renderPaycheckReminder(el);
    });
  }

  // ---- viewing one file: preview, save, delete ----
  function revokePaycheckView() { closePaycheckZoom(true); if (pcViewUrl) { URL.revokeObjectURL(pcViewUrl); pcViewUrl = null; } }

  // ---- full-screen picture: pinch or double-tap to zoom, drag to move, swipe down or ✕ to close ----
  // The rest of the app stays zoom-locked; this layer reads the fingers itself (its own pinch, not the
  // browser's), so only the picture grows. PDFs open full screen in the browser's own PDF view.
  function openPaycheckZoom(url, p) {
    closePaycheckZoom(true);
    const isPdf = p.type === 'application/pdf';
    const el = document.createElement('div');
    el.className = 'pc-zoom';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', p.name);
    el.innerHTML = (isPdf
      ? `<iframe class="pc-zoom-pdf" src="${url}" title="${escapeHtml(p.name)}"></iframe>`
      : `<img class="pc-zoom-img" src="${url}" alt="${escapeHtml(p.name)}" draggable="false">`)
      + `<button type="button" class="pc-zoom-close" aria-label="${escapeHtml(t('pcClose'))}">${ICON_X}</button>`;
    document.body.appendChild(el);
    pcZoomEl = el;
    // its own Back-button step, so Back closes just the picture and leaves the paycheck viewer open
    try { history.pushState({ zoom: true }, ''); pcZoomHistory = true; } catch (e) {}
    el.querySelector('.pc-zoom-close').addEventListener('click', () => closePaycheckZoom());
    if (!isPdf) attachZoomGestures(el, el.querySelector('.pc-zoom-img'));
    requestAnimationFrame(() => el.classList.add('open'));
  }
  function closePaycheckZoom(now, fromBack) {
    const el = pcZoomEl;
    if (!el) return;
    pcZoomEl = null;
    // closed by ✕, swipe or Escape: remove the Back-button step it added
    if (pcZoomHistory && !fromBack) { pcZoomHistory = false; ignoreNextPop = true; history.back(); }
    if (now || reduceMotion.matches) { el.remove(); return; }
    el.classList.remove('open');
    el.classList.add('closing');
    setTimeout(() => el.remove(), 220);
  }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && pcZoomEl) { e.stopPropagation(); closePaycheckZoom(); } }, true);

  function attachZoomGestures(el, img) {
    const MAX = 5, DOUBLE = 2.5;
    let s = 1, tx = 0, ty = 0, raf = 0, mode = null, st = null, lastTap = null;
    const apply = ms => { img.style.transition = ms ? `transform ${ms}ms var(--ease-out)` : 'none'; img.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${s})`; };
    const later = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; apply(0); }); };
    const rel = (x, y) => { const r = el.getBoundingClientRect(); return { x: x - r.left - r.width / 2, y: y - r.top - r.height / 2 }; };
    const clampPan = () => {
      const bx = Math.max(0, (img.offsetWidth * s - el.clientWidth) / 2), by = Math.max(0, (img.offsetHeight * s - el.clientHeight) / 2);
      tx = Math.max(-bx, Math.min(bx, tx)); ty = Math.max(-by, Math.min(by, ty));
    };
    // keeps the spot under the fingers (f, measured from the screen's centre) in place while scaling
    const zoomTo = (ns, f) => { ns = Math.max(1, Math.min(MAX, ns)); tx = f.x - (f.x - tx) * ns / s; ty = f.y - (f.y - ty) * ns / s; s = ns; };
    const settle = () => { if (s <= 1.01) { s = 1; tx = 0; ty = 0; } clampPan(); apply(240); };
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = t => rel((t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2);
    const begin = e => {
      const t = e.touches;
      if (t.length >= 2) { mode = 'pinch'; st = { d: dist(t), s, tx, ty, m: mid(t) }; }
      else { mode = s > 1 ? 'pan' : 'drag'; st = { x: t[0].clientX, y: t[0].clientY, tx, ty, at: performance.now(), moved: false }; }
    };
    el.addEventListener('touchstart', e => {
      if (e.target.closest('.pc-zoom-close')) return;
      e.preventDefault();
      begin(e);
    }, { passive: false });
    el.addEventListener('touchmove', e => {
      if (!mode) return;
      e.preventDefault();
      const t = e.touches;
      if (mode === 'pinch' && t.length >= 2) {
        const m = mid(t), ns = Math.max(0.8, Math.min(MAX, st.s * dist(t) / st.d));
        tx = m.x - (st.m.x - st.tx) * ns / st.s; ty = m.y - (st.m.y - st.ty) * ns / st.s; s = ns;
      } else if (t.length === 1) {
        const dx = t[0].clientX - st.x, dy = t[0].clientY - st.y;
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) st.moved = true;
        if (mode === 'pan') { tx = st.tx + dx; ty = st.ty + dy; }
        else if (mode === 'drag') { tx = 0; ty = dy; el.style.setProperty('--zoom-bg', String(Math.max(0.35, 1 - Math.abs(dy) / 450))); }
      }
      later();
    }, { passive: false });
    el.addEventListener('touchend', e => {
      if (!mode) return;
      e.preventDefault();
      if (e.touches.length) { begin(e); return; } // one finger lifted from a pinch: keep moving with the other
      const m = mode; mode = null;
      if (m === 'drag' && st.moved) {
        // swipe down (or up) far enough at normal size closes it; otherwise it springs back
        if (Math.abs(ty) > 110) { el.style.setProperty('--zoom-bg', '0'); ty = ty > 0 ? el.clientHeight : -el.clientHeight; apply(220); closePaycheckZoom(); return; }
        ty = 0; el.style.setProperty('--zoom-bg', '1'); apply(220); return;
      }
      if (m !== 'pinch' && !st.moved && performance.now() - st.at < 300) {
        const now = performance.now(), here = rel(st.x, st.y);
        if (lastTap && now - lastTap.at < 320 && Math.hypot(here.x - lastTap.x, here.y - lastTap.y) < 40) {
          lastTap = null;
          if (s > 1) { s = 1; tx = 0; ty = 0; } else { zoomTo(DOUBLE, here); clampPan(); }
          apply(260);
          return;
        }
        lastTap = { at: now, x: here.x, y: here.y };
        return;
      }
      settle();
    }, { passive: false });
    el.addEventListener('touchcancel', () => { mode = null; el.style.setProperty('--zoom-bg', '1'); settle(); });
    // computers: double-click to zoom, wheel to zoom around the pointer, drag to move
    el.addEventListener('dblclick', e => { if (e.target.closest('.pc-zoom-close')) return; if (s > 1) { s = 1; tx = 0; ty = 0; } else { zoomTo(DOUBLE, rel(e.clientX, e.clientY)); clampPan(); } apply(260); });
    el.addEventListener('wheel', e => { e.preventDefault(); zoomTo(s * Math.exp(-e.deltaY * 0.002), rel(e.clientX, e.clientY)); clampPan(); apply(0); }, { passive: false });
    let drag = null;
    el.addEventListener('mousedown', e => { if (e.button || s <= 1 || e.target.closest('.pc-zoom-close')) return; drag = { x: e.clientX, y: e.clientY, tx, ty }; e.preventDefault(); });
    el.addEventListener('mousemove', e => { if (!drag) return; tx = drag.tx + e.clientX - drag.x; ty = drag.ty + e.clientY - drag.y; later(); });
    const endDrag = () => { if (drag) { drag = null; settle(); } };
    el.addEventListener('mouseup', endDrag);
    el.addEventListener('mouseleave', endDrag);
  }
  function openPaycheckViewer(p) {
    sheetMode = 'paycheck'; editingId = null;
    revokePaycheckView();
    $('sheetTitle').textContent = monthLongLabel(p.month);
    $('sheetSave').style.visibility = 'hidden';
    $('sheetBody').innerHTML = `<div class="empty-state">${escapeHtml(t('pcLoading'))}</div>`;
    openSheetOverlay();
    loadPaycheckBlob(p).then(blob => {
      if (sheetMode !== 'paycheck') return;
      pcViewUrl = URL.createObjectURL(blob);
      const isPdf = p.type === 'application/pdf';
      const preview = isPdf
        ? `<iframe class="pc-preview pc-pdf" src="${pcViewUrl}" title="${escapeHtml(p.name)}"></iframe>`
        : `<button type="button" class="pc-preview-btn" id="pcZoomOpen" aria-label="${escapeHtml(t('pcFullScreen'))}"><img class="pc-preview" src="${pcViewUrl}" alt="${escapeHtml(p.name)}"><span class="pc-expand">${ICON_EXPAND}</span></button>`;
      $('sheetBody').innerHTML = `${preview}
        <div class="list-group"><div class="list-row"><div class="rlabel">${escapeHtml(p.name)}<span class="rsub">${escapeHtml(PC_TYPES[p.type].toUpperCase())} · ${escapeHtml(formatBytes(p.fileSize))}</span></div></div></div>
        <div class="btn-stack" style="margin-top:12px;">
          ${isPdf ? `<button type="button" class="btn-plain btn-block" id="pcZoomOpen">${escapeHtml(t('pcFullScreen'))}</button>` : ''}
          <button type="button" class="btn-plain btn-block" id="pcSaveBtn">${escapeHtml(t('pcDownload'))}</button>
          <button type="button" class="btn-danger btn-block" id="pcDeleteBtn">${escapeHtml(t('pcDelete'))}</button>
        </div>`;
      $('pcZoomOpen').addEventListener('click', () => openPaycheckZoom(pcViewUrl, p));
      $('pcSaveBtn').addEventListener('click', () => deliverFile(blob, paycheckFileName(p)));
      // Deleting closes the viewer and drops the file from the list at once, instead of waiting for the
      // cloud to confirm (which can take a moment on a phone). If the cloud refuses, the file comes back.
      $('pcDeleteBtn').addEventListener('click', () => {
        if (!confirm(t('pcConfirmDelete').replace('{name}', p.name))) return;
        const uid = currentUser.uid;
        paychecks = paychecks.filter(x => x.id !== p.id);
        pcBlobCache.delete(p.id);
        closeSheetOverlay();
        renderDataViews();
        showToast(t('pcDeleted'));
        deletePaycheckDocs(uid, p).catch(err => { console.error('Paycheck delete failed:', err); showToast(t('pcDeleteFailed')); });
      });
    }).catch(err => {
      console.error('Opening paycheck failed:', err);
      if (sheetMode === 'paycheck') $('sheetBody').innerHTML = `<div class="empty-state">${escapeHtml(t('pcOpenFailed'))}</div>`;
    });
  }

  // ---- Settings: download the paychecks of a range of months (one file, or one .zip) ----
  function openPaycheckDownloadSheet() {
    if (!currentUser) return;
    sheetMode = 'paycheckDownload'; editingId = null;
    $('sheetTitle').textContent = t('pcDlTitle');
    $('sheetSave').style.visibility = 'hidden';
    const months = paycheckMonths();
    if (!months.length) {
      $('sheetBody').innerHTML = `<div class="empty-state"><div class="big">${ICON_FILE}</div>${escapeHtml(paychecksLoaded ? t('pcDlNone') : t('pcLoading'))}</div>`;
      openSheetOverlay();
      return;
    }
    const opts = sel => months.map(m => `<option value="${m}"${m === sel ? ' selected' : ''}>${escapeHtml(monthLongLabel(m))}</option>`).join('');
    $('sheetBody').innerHTML = `
      <div class="list-group">
        <label class="list-row"><span class="rlabel">${escapeHtml(t('pcDlFrom'))}</span><select class="pc-select" id="pcDlFrom">${opts(months[0])}</select></label>
        <label class="list-row"><span class="rlabel">${escapeHtml(t('pcDlTo'))}</span><select class="pc-select" id="pcDlTo">${opts(months[months.length - 1])}</select></label>
      </div>
      <div class="section-footer" id="pcDlCount" style="margin:8px 6px 16px;"></div>
      <button type="button" class="btn-accent btn-block" id="pcDlBtn">${escapeHtml(t('pcDlBtn'))}</button>`;
    const range = () => {
      let a = $('pcDlFrom').value, b = $('pcDlTo').value;
      if (a > b) [a, b] = [b, a];
      return paychecks.filter(p => p.month >= a && p.month <= b).sort((x, y) => x.month.localeCompare(y.month) || x.slot - y.slot);
    };
    const update = () => { const n = range().length; $('pcDlCount').textContent = n === 1 ? t('pcDlOne') : t('pcDlCount').replace('{n}', n); };
    $('pcDlFrom').addEventListener('change', update);
    $('pcDlTo').addEventListener('change', update);
    update();
    $('pcDlBtn').addEventListener('click', async () => {
      const files = range();
      if (!files.length) return;
      const btn = $('pcDlBtn');
      btn.disabled = true;
      try {
        const blobs = [];
        for (let i = 0; i < files.length; i++) {
          btn.textContent = t('pcDlPreparing').replace('{i}', i + 1).replace('{n}', files.length);
          blobs.push(await loadPaycheckBlob(files[i]));
        }
        let a = $('pcDlFrom').value, b = $('pcDlTo').value;
        if (a > b) [a, b] = [b, a];
        if (files.length === 1) { closeSheetOverlay(); deliverFile(blobs[0], paycheckFileName(files[0])); return; }
        const entries = await Promise.all(files.map(async (p, i) => ({ name: paycheckFileName(p), content: new Uint8Array(await blobs[i].arrayBuffer()) })));
        closeSheetOverlay();
        deliverFile(buildZip(entries, 'application/zip'), a === b ? `Paychecks ${a}.zip` : `Paychecks ${a} to ${b}.zip`);
      } catch (err) {
        console.error('Paycheck download failed:', err);
        showToast(t('pcDlFailed'));
        if (sheetMode === 'paycheckDownload') { btn.disabled = false; btn.textContent = t('pcDlBtn'); }
      }
    });
    openSheetOverlay();
  }
  $('downloadPaychecksBtn').addEventListener('click', openPaycheckDownloadSheet);

  // ---- new month while the app was open or suspended ----
  let lastSeenMonth = currentMonthStr();
  let lastSeenDay = todayStr();
  function checkMonthRollover() {
    const now = currentMonthStr();
    // A new day inside the same month only moves "today" on the calendar.
    if (now === lastSeenMonth) {
      if (todayStr() !== lastSeenDay) { lastSeenDay = todayStr(); renderSummary(); }
      return;
    }
    lastSeenDay = todayStr();
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
  // Also zips downloaded paychecks (content given as bytes; PDFs and photos are already compressed).
  function buildZip(files, mime) {
    const enc = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [], central = [];
    let offset = 0;
    files.forEach(f => {
      const name = enc.encode(f.name);
      const data = typeof f.content === 'string' ? enc.encode(f.content) : f.content;
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
    const additions = additionsForMonth(month);
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
      sumHours += c.exactHours; sumWeekend += c.windowHours; sumOvertime += c.overtimeHours; sumPay += c.pay;
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
    if (additions.length) {
      const additionRows = additions.map(x => {
        sumIncome += x.amount;
        return [categoryLabel(x.a.category), money(x.amount)];
      });
      tables.push({
        title: t('reportOtherIncome'),
        cols: [{ label: t('colCategory'), width: 11398 }, { label: t('colAmount'), width: 4000, align: 'right' }],
        rows: additionRows,
        total: [t('reportTotal'), money(sumIncome)]
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
      summary: `${t('reportShiftCount')}: ${shifts.length}  ·  ${t('colHours')}: ${fmt(sumHours)}  ·  ${t('sumSubWork')}: ${money(sumPay)}${additions.length ? `  ·  ${t('reportOtherIncome')}: ${money(sumIncome)}` : ''}`,
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
    obj(3, `<< /Title ${utf16Hex(title)} /Producer (Shifts Tracker) >>`);
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
          <span class="entry-chevron">${ICON_CHEV_R}</span>
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
  let stopTabSlide = null; // set by the page swipe below: stops a swipe in progress (a tab tap beats it)
  function switchTab(tab) {
    activeTab = tab;
    // 'swipe-page' (set while a swipe drags a page in) stops the page's fade-in; it is cleared once the page is hidden again.
    document.querySelectorAll('.tab-page').forEach(p => { if (p.id !== 'tab-' + tab) { p.classList.add('hidden'); p.classList.remove('swipe-page'); } });
    $('tab-' + tab).classList.remove('hidden');
    if (tab === 'summary') refitTotal();
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('fab').classList.toggle('hidden', tab !== 'shifts');
    $('content').scrollTop = 0;
  }
  // Tapping a tab plays its page's entrance every time (rows cascade, the goal ring fills), not only the first
  // time its data changed. Swipes skip this: the page is already in view as it slides in.
  function replayEntrance(tab) {
    if (reduceMotion.matches) return;
    const cascade = (els, cls, step, max) => {
      els = Array.from(els);
      els.forEach(el => el.classList.remove(cls));
      void document.body.offsetWidth;
      els.forEach((el, i) => {
        el.style.setProperty('--row-delay', Math.min(i, max) * step + 'ms');
        el.classList.add(cls);
        el.addEventListener('animationend', () => { el.classList.remove(cls); el.style.removeProperty('--row-delay'); }, { once: true });
      });
    };
    if (tab === 'shifts') cascade($('shiftsList').querySelectorAll('.entry-row-wrap'), 'row-in', 28, 10);
    if (tab === 'summary') cascade($('payBreakdown').querySelectorAll('.bd-row'), 'bd-in', 30, 8);
    if (tab === 'goals') {
      const ring = $('goalRingProgress'), to = ring.getAttribute('stroke-dashoffset');
      ring.style.transition = 'none';
      ring.setAttribute('stroke-dashoffset', ring.getAttribute('stroke-dasharray'));
      void ring.getBoundingClientRect();
      ring.style.transition = '';
      ring.setAttribute('stroke-dashoffset', to);
    }
  }
  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
    if (stopTabSlide) stopTabSlide();
    const same = btn.dataset.tab === activeTab;
    switchTab(btn.dataset.tab);
    if (!same) replayEntrance(btn.dataset.tab);
  }));

  // Swiping sideways anywhere on a page (except the calendar, the month pills and text fields)
  // moves to the next or previous tab. Like iOS, the next page is pulled in beside the current one
  // and both move with the finger, so the screen is never empty. Mirrored in Hebrew.
  (() => {
    const content = $('content'), TABS = ['summary', 'shifts', 'goals', 'settings'], vel = swipeVelocity();
    let x0 = 0, y0 = 0, dx = 0, curX = 0, mode = null, cur = null, side = null, sideTab = null, busy = false, swallowClick = false, raf = 0;
    let slide = null; // the slide running after the finger lifted (to the next tab, or springing back)
    // measured once when the finger lands, so moving frames never ask the page for sizes
    let w = 0, padTop = 0, padLeft = '', viewH = 0, sideTop = -1;
    const target = d => TABS[TABS.indexOf(activeTab) + ((d < 0) !== isRtl() ? 1 : -1)];
    const move = (el, x) => { el.style.transform = `translate3d(${x}px, 0, 0)`; };
    const clear = el => { el.style.transition = el.style.transform = el.style.position = el.style.top = el.style.left = el.style.width = el.style.height = el.style.overflow = el.style.willChange = ''; };
    // The Shifts "+" button lives in its title row, so it shows while that page slides in (otherwise the title shifts when it appears).
    const dropSide = () => { if (side) { side.classList.add('hidden'); clear(side); side.classList.remove('swipe-page'); $('fab').classList.toggle('hidden', activeTab !== 'shifts'); } side = sideTab = null; };
    // A finger that drifts up/down before the swipe is recognised can leave the page scrolling; the pulled-in
    // page follows the scroll so it always sits at the top of the screen. Without this the new page arrives
    // too high and snaps down at the end. (Scrolling is stopped by re-setting the position, not by turning
    // overflow off: on iPhone that rebuilds the whole scrolling layer and costs frames.)
    const pinSide = () => { if (side && content.scrollTop !== sideTop) { sideTop = content.scrollTop; side.style.top = sideTop + padTop + 'px'; } };
    // Show the neighbouring page level with the top of the screen, just off the edge.
    const pullSide = tab => {
      if (sideTab === tab) return;
      dropSide();
      if (!tab) return;
      sideTab = tab; side = $('tab-' + tab);
      side.classList.add('swipe-page');
      if (tab === 'shifts') $('fab').classList.remove('hidden');
      // Only one screen of the incoming page is ever visible while it slides, so it is cut to that height:
      // the phone then draws a screenful instead of a whole long list before it can start moving.
      sideTop = content.scrollTop;
      Object.assign(side.style, { position: 'absolute', top: sideTop + padTop + 'px', left: padLeft, width: cur.offsetWidth + 'px', height: viewH + 'px', overflow: 'hidden', willChange: 'transform' });
      side.classList.remove('hidden');
      if (tab === 'summary') refitTotal();
    };
    const W = () => w;
    const frame = () => {
      raf = 0;
      const next = target(dx);
      pullSide(next);
      // Past the first or last tab the page only gives a little, then springs back.
      curX = next ? dx : dx * 0.3;
      move(cur, curX);
      pinSide();
      if (side) move(side, dx + (dx < 0 ? W() : -W()));
    };
    content.addEventListener('touchstart', e => {
      mode = busy || e.touches.length !== 1 || e.target.closest('#summaryCalendar, .pills, input, textarea, select') ? 'off' : null;
      if (mode) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; vel.reset();
      cur = $('tab-' + activeTab);
      const cs = getComputedStyle(content);
      w = content.clientWidth; padTop = parseFloat(cs.paddingTop); padLeft = cs.paddingLeft; viewH = content.clientHeight - padTop;
    }, { passive: true });
    content.addEventListener('touchmove', e => {
      if (mode === 'off' || e.touches.length !== 1) return;
      const mx = e.touches[0].clientX - x0, my = e.touches[0].clientY - y0;
      if (!mode) {
        if (Math.abs(mx) < SWIPE_START && Math.abs(my) < SWIPE_START) return;
        mode = Math.abs(mx) > Math.abs(my) * SWIPE_AXIS ? 'swipe' : 'off';
        if (mode !== 'swipe') return;
        if (!reduceMotion.matches) { cur.style.willChange = 'transform'; content.scrollTop = content.scrollTop; }
      }
      e.preventDefault();
      dx = mx; vel.push(e.touches[0].clientX);
      if (!reduceMotion.matches && !raf) raf = requestAnimationFrame(frame);
    }, { passive: false });
    const springBack = v => {
      const s = side, off = dx < 0 ? W() : -W();
      busy = true;
      slide = glide(curX, 0, v || 0, SLIDE_BACK_MS, x => { move(cur, x); if (s) move(s, x + off); }, () => { slide = null; clear(cur); if (side === s) dropSide(); busy = false; });
    };
    // A tap on the tab bar while a swipe is moving wins: the swipe stops where it is, both pages go back to
    // normal, and the tab bar then opens the tapped tab (before, the slide finished and overrode the tap).
    stopTabSlide = () => {
      if (!slide && mode !== 'swipe') return;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (slide) { slide.stop(); slide = null; }
      mode = 'off';
      if (cur) clear(cur);
      if (side) clear(side);
      side = sideTab = null;
      busy = false;
    };
    content.addEventListener('touchend', () => {
      if (mode !== 'swipe') { mode = null; return; }
      mode = null;
      swallowClick = true; setTimeout(() => { swallowClick = false; }, 350);
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      const next = target(dx), v = vel.get();
      if (!next || !swipeCommits(dx, v, W())) { if (reduceMotion.matches) return; springBack(v); return; }
      if (reduceMotion.matches) { switchTab(next); return; }
      pullSide(next);
      pinSide();
      const out = dx < 0 ? -w : w, off = dx < 0 ? w : -w;
      busy = true;
      // The tab bar highlight moves the moment the finger lifts, together with the page, not after the slide.
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === next));
      slide = glide(curX, out, v, SLIDE_MS, x => { move(cur, x); move(side, x + off); }, () => {
        slide = null;
        // The pulled-in page sits at the top of the screen; switchTab scrolls to the top, so it stays put.
        const old = cur, s = side;
        side = sideTab = null;
        clear(s);
        switchTab(next);
        clear(old);
        busy = false;
      });
    });
    content.addEventListener('touchcancel', () => { if (mode === 'swipe') springBack(0); mode = null; });
    content.addEventListener('click', e => { if (swallowClick) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  })();
  $('fab').addEventListener('click', () => {
    if (activeTab === 'shifts') openAddChoiceSheet();
  });

  // ---- sheet plumbing ----
  const SHEET_CLOSE_MS = 200;
  let sheetCloseTimer = null;
  // An open sheet owns one history entry, so the phone's or browser's Back closes the sheet
  // instead of leaving the app. Closing it any other way removes that entry again.
  let sheetHistory = false, ignoreNextPop = false;
  const sheetIsOpen = () => { const o = $('sheetOverlay'); return !o.classList.contains('hidden') && !o.classList.contains('closing'); };
  function openSheetOverlay() {
    clearTimeout(sheetCloseTimer);
    $('sheetOverlay').classList.remove('hidden', 'closing');
    if (!sheetHistory) { try { history.pushState({ sheet: true }, ''); sheetHistory = true; } catch (e) {} }
  }
  window.addEventListener('popstate', () => {
    if (ignoreNextPop) { ignoreNextPop = false; return; }
    if (pcZoomHistory) { pcZoomHistory = false; closePaycheckZoom(false, true); return; }
    if (!sheetHistory) return;
    sheetHistory = false;
    if (sheetIsOpen()) closeSheetOverlay();
  });
  function closeSheetOverlay() {
    const overlay = $('sheetOverlay');
    $('sheetSave').style.visibility = '';
    if (sheetMode === 'paycheck') revokePaycheckView();
    sheetMode = null;
    editingId = null;
    if (overlay.classList.contains('hidden') || overlay.classList.contains('closing')) return;
    // Drop the sheet's history entry, unless another sheet opens straight away and reuses it.
    setTimeout(() => {
      if (sheetHistory && !sheetIsOpen()) { sheetHistory = false; ignoreNextPop = true; history.back(); }
    }, 0);
    // Keyboard focus leaves the sheet, so a second Enter can't press its button again.
    if (overlay.contains(document.activeElement)) document.activeElement.blur();
    if (reduceMotion.matches) { overlay.classList.add('hidden'); return; }
    overlay.classList.add('closing');
    sheetCloseTimer = setTimeout(() => overlay.classList.add('hidden'), SHEET_CLOSE_MS);
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
    $('wkNoWindowHint').classList.toggle('hidden', windowDurationMinutes(state.settings) !== 0);
  }

  // ---- earnings privacy: amounts show by default; the eye button blurs them, and the choice is remembered on this device ----
  const MONEY_HIDDEN_KEY = 'workTrackerMoneyHidden';
  try { if (localStorage.getItem(MONEY_HIDDEN_KEY) === '1') document.querySelector('.app').classList.add('money-hidden'); } catch (e) {}
  function isMoneyHidden() { return document.querySelector('.app').classList.contains('money-hidden'); }
  function setMoneyHidden(hidden) {
    document.querySelector('.app').classList.toggle('money-hidden', hidden);
    const btn = $('moneyToggle');
    btn.innerHTML = hidden ? ICON_EYE : ICON_EYE_OFF;
    btn.setAttribute('aria-label', t(hidden ? 'showAmounts' : 'hideAmounts'));
    btn.setAttribute('aria-pressed', String(!hidden));
  }
  $('moneyToggle').addEventListener('click', () => {
    const hidden = !isMoneyHidden();
    setMoneyHidden(hidden);
    try { localStorage.setItem(MONEY_HIDDEN_KEY, hidden ? '1' : '0'); } catch (e) {}
  });

  // ---- appearance: Auto (follow the phone), Light or Dark, remembered on this device ----
  const THEME_KEY = 'workTrackerTheme';
  function currentTheme() { try { const v = localStorage.getItem(THEME_KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch (e) { return 'auto'; } }
  function applyTheme(choice) {
    if (choice === 'light' || choice === 'dark') document.documentElement.setAttribute('data-theme', choice);
    else document.documentElement.removeAttribute('data-theme');
    $('themeToggle').querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.themeChoice === choice));
  }
  $('themeToggle').querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
    try { localStorage.setItem(THEME_KEY, b.dataset.themeChoice); } catch (e) {}
    applyTheme(b.dataset.themeChoice);
  }));
  applyTheme(currentTheme());

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
    $('authLangToggle').querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === lang));
    try { localStorage.setItem(UI_LANG_KEY, lang); } catch(e) {}
    renderDataViews();
    renderTemplatesSettings();
    renderAdditionsSettings();
    setMoneyHidden(isMoneyHidden());
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
        <span class="entry-chevron">${ICON_CHEV_R}</span>
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
    $('sheetSave').style.visibility = '';
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
          <div class="list-row picker-row" data-toggle="panelTplStart"><div class="rlabel" data-i18n="fieldStartTime">Start time</div><div><span class="picker-value" id="valTplStart"></span><span class="chev">${ICON_CHEV_D}</span></div></div>
        </div>
        <div class="wheel-panel hidden" id="panelTplStart">
          <div class="wheel-fade-top"></div>
          <div class="wheel-col" data-col="hour"></div>
          <div class="wheel-col" data-col="minute"></div>
          <div class="wheel-highlight"></div>
          <div class="wheel-fade-bottom"></div>
        </div>
        <div class="list-group" style="margin-top:10px;">
          <div class="list-row picker-row" data-toggle="panelTplEnd"><div class="rlabel" data-i18n="fieldEndTime">End time</div><div><span class="picker-value" id="valTplEnd"></span><span class="chev">${ICON_CHEV_D}</span></div></div>
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

  // ---- monthly additions in Settings ----
  function monthOptionsHtml(selected) {
    const months = Array.from(new Set([currentMonthStr(), ...allMonths(), selected].filter(Boolean))).sort().reverse();
    return months.map(m => `<option value="${m}" ${m === selected ? 'selected' : ''}>${escapeHtml(monthLongLabel(m))}</option>`).join('');
  }
  // The month whose amount best describes an addition right now.
  function additionDisplayMonth(a) {
    const cur = currentMonthStr();
    if (a.until && a.until < cur) return a.until;
    return a.from > cur ? a.from : cur;
  }
  function renderAdditionsSettings() {
    const el = $('additionsList');
    if (!el) return;
    if (!state.additions.length) {
      el.innerHTML = `<div class="list-row"><div class="rlabel" style="color:var(--muted);">${escapeHtml(t('additionsEmpty'))}</div></div>`;
      return;
    }
    const cur = currentMonthStr();
    el.innerHTML = state.additions.map(a => {
      const ended = a.until && a.until < cur;
      let sub = `${money(additionAmountFor(a, additionDisplayMonth(a)))} ${t('additionPerMonth')} · ${t('additionSince').replace('{m}', monthLongLabel(a.from))}`;
      if (a.until) sub += ` · ${t('additionUntil').replace('{m}', monthLongLabel(a.until))}`;
      return `<div class="list-row picker-row${ended ? ' addition-ended' : ''}" data-addition="${escapeHtml(a.id)}">
        <div class="rlabel">${escapeHtml(categoryLabel(a.category))}<span class="rsub">${escapeHtml(sub)}</span></div>
        <span class="entry-chevron">${ICON_CHEV_R}</span>
      </div>`;
    }).join('');
    el.querySelectorAll('[data-addition]').forEach(row => row.addEventListener('click', () => openAdditionSheet(row.dataset.addition)));
  }
  $('addAdditionBtn').addEventListener('click', () => openAdditionSheet(null));

  function openAdditionSheet(id) {
    sheetMode = 'addition'; editingId = id;
    $('sheetSave').style.visibility = '';
    const a = id ? state.additions.find(x => x.id === id) : null;
    const cur = currentMonthStr();
    const lang = getLang();
    const ended = !!(a && a.until && a.until < cur);
    let currentKey = 'driving', customVal = '';
    if (a) {
      if (CATEGORY_KEYS.includes(a.category)) currentKey = a.category;
      else { currentKey = 'other'; customVal = a.category; }
    }
    const amountNow = a ? additionAmountFor(a, additionDisplayMonth(a)) : '';
    let note = '';
    if (ended) note = t('additionEndedNote').replace('{m}', monthLongLabel(a.until));
    else if (a) note = t('additionChangeNote').replace('{m}', monthLongLabel(a.from > cur ? a.from : cur));
    $('sheetTitle').textContent = a ? t('sheetEditAddition') : t('sheetNewAddition');
    $('sheetBody').innerHTML = `
      <div class="field-group">
        <div class="list-group">
          <div class="list-row">
            <div class="rlabel">${escapeHtml(t('fieldCategory'))}</div>
            <select id="fCategory">${CATEGORY_KEYS.map(k => `<option value="${k}" ${k === currentKey ? 'selected' : ''}>${escapeHtml(CATEGORY_LABELS[lang][k])}</option>`).join('')}</select>
          </div>
          <div class="list-row ${currentKey === 'other' ? '' : 'hidden'}" id="fCustomCatRow"><div class="rlabel">${escapeHtml(t('fieldCustomLabel'))}</div><input type="text" id="fCustomCat" maxlength="${LIMITS.category}" placeholder="${escapeHtml(t('customLabelPlaceholder'))}" value="${escapeHtml(customVal)}"></div>
          <div class="list-row"><div class="rlabel">${escapeHtml(t('additionAmountMonthly'))}</div><input type="number" id="fAmount" min="0" max="10000000" step="0.01" inputmode="decimal" value="${escapeHtml(amountNow)}" ${ended ? 'disabled' : ''}></div>
          <div class="list-row"><div class="rlabel">${escapeHtml(t('additionStarts'))}</div><select id="fFrom" ${ended ? 'disabled' : ''}>${monthOptionsHtml(a ? a.from : cur)}</select></div>
        </div>
        ${note ? `<div class="section-footer">${escapeHtml(note)}</div>` : ''}
      </div>
      ${a ? `<div class="btn-stack">
        ${ended ? '' : `<button type="button" class="btn-plain btn-block" id="fStopAddition">${escapeHtml(t('additionStop').replace('{m}', monthLongLabel(cur)))}</button>`}
        <button type="button" class="btn-danger btn-block" id="fDeleteAddition">${escapeHtml(t('additionDeleteAll'))}</button>
      </div>` : ''}`;
    $('fCategory').addEventListener('change', () => { $('fCustomCatRow').classList.toggle('hidden', $('fCategory').value !== 'other'); });
    if (a && !ended) $('fStopAddition').addEventListener('click', () => {
      if (!confirm(t('confirmStopAddition').replace('{m}', monthLongLabel(cur)))) return;
      rememberForUndo();
      const [y, m] = cur.split('-').map(Number);
      const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
      if (prev < a.from) state.additions = state.additions.filter(x => x.id !== a.id);
      else a.until = prev;
      save(); closeSheetOverlay(); refreshAll();
      offerUndo(t('additionStopped'));
    });
    if (a) $('fDeleteAddition').addEventListener('click', () => {
      if (!confirm(t('confirmDeleteAddition'))) return;
      rememberForUndo();
      state.additions = state.additions.filter(x => x.id !== a.id);
      save(); closeSheetOverlay(); refreshAll();
      offerUndo(t('additionDeleted'));
    });
    openSheetOverlay();
  }

  // Keep the first amount anchored at the start month after the start month moves.
  function reanchorAdditionVersions(a) {
    const sorted = a.versions.slice().sort((x, y) => x.from.localeCompare(y.from));
    let atStart = sorted[0].amount;
    sorted.forEach(v => { if (v.from <= a.from) atStart = v.amount; });
    a.versions = [{ from: a.from, amount: atStart }].concat(sorted.filter(v => v.from > a.from));
  }

  // ---- add/edit shift sheet ----
  function openShiftSheet(id, presetDate) {
    sheetMode = 'shift'; editingId = id;
    $('sheetSave').style.visibility = '';
    const shift = id ? state.shifts.find(s => s.id === id) : null;
    const defaultStart = nowTimeStr();
    formShift = {
      date: shift ? shift.date : (presetDate || todayStr()),
      startTime: shift ? shift.startTime : defaultStart,
      endTime: shift ? shift.endTime : addHoursToTime(defaultStart, 8),
      rateId: shift ? shift.rateId : null
    };
    $('sheetTitle').textContent = shift ? t('sheetEditShift') : t('sheetNewShift');
    $('sheetBody').innerHTML = `
      <div class="field-group">
        <div class="list-group">
          <div class="list-row picker-row" data-toggle="panelShiftDate"><div class="rlabel" data-i18n="fieldDate">Date</div><div><span class="picker-value" id="valShiftDate"></span><span class="chev">${ICON_CHEV_D}</span></div></div>
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
          <div class="list-row picker-row" data-toggle="panelShiftStart"><div class="rlabel" data-i18n="fieldStartTime">Start time</div><div><span class="picker-value" id="valShiftStart"></span><span class="chev">${ICON_CHEV_D}</span></div></div>
        </div>
        <div class="wheel-panel hidden" id="panelShiftStart">
          <div class="wheel-fade-top"></div>
          <div class="wheel-col" data-col="hour"></div>
          <div class="wheel-col" data-col="minute"></div>
          <div class="wheel-highlight"></div>
          <div class="wheel-fade-bottom"></div>
        </div>
        <div class="list-group" style="margin-top:10px;">
          <div class="list-row picker-row" data-toggle="panelShiftEnd"><div class="rlabel" data-i18n="fieldEndTime">End time</div><div><span class="picker-value" id="valShiftEnd"></span><span class="chev">${ICON_CHEV_D}</span></div></div>
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
            <div class="rlabel"><span data-i18n="fieldCustomPay">Custom pay</span><span class="rsub" data-i18n="fieldCustomPaySub">Enter this shift's pay yourself</span></div>
            <label class="switch"><input type="checkbox" id="fCustomPayOn" ${shift && isValidCustomPay(shift.customPay) ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></label>
          </div>
          <div class="list-row ${shift && isValidCustomPay(shift.customPay) ? '' : 'hidden'}" id="fCustomPayRow">
            <div class="rlabel" data-i18n="fieldCustomAmount">Amount</div>
            <input type="number" id="fCustomPay" min="0" max="${CUSTOM_PAY_MAX}" step="0.01" inputmode="decimal" placeholder="${escapeHtml(state.settings.currency)}0.00" value="${shift && isValidCustomPay(shift.customPay) ? shift.customPay : ''}">
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
    $('fCustomPayOn').addEventListener('change', () => {
      const on = $('fCustomPayOn').checked;
      $('fCustomPayRow').classList.toggle('hidden', !on);
      $('fCustomPayRow').classList.toggle('reveal', on);
      if (on) $('fCustomPay').focus();
    });
    if (shift) $('fDelete').addEventListener('click', () => {
      if (!confirm(t('confirmDeleteShift'))) return;
      closeSheetOverlay();
      collapseRow(shiftRowWrap(id), () => deleteShift(id));
    });
    openSheetOverlay();
  }

  // ---- "+" on the Shifts tab: choose a single shift or a whole week ----
  function comingSundayStr() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + (7 - d.getDay()) % 7);
    return dateStr(d);
  }
  function addDaysStr(ds, n) {
    const [y, m, d] = ds.split('-').map(Number);
    return dateStr(new Date(y, m - 1, d + n));
  }
  function weekRangeLabel(start) {
    const locale = getLang() === 'he' ? 'he-IL' : undefined;
    const fmtDay = ds => new Date(ds + 'T00:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' });
    return `${fmtDay(start)} – ${fmtDay(addDaysStr(start, 6))}`;
  }

  function openAddChoiceSheet() {
    sheetMode = 'addChoice'; editingId = null;
    $('sheetTitle').textContent = t('addShiftsTitle');
    $('sheetSave').style.visibility = 'hidden';
    $('sheetBody').innerHTML = `
      <div class="btn-stack">
        <button type="button" class="btn-plain btn-block add-choice" id="addSingleBtn">
          <span class="add-choice-title">${escapeHtml(t('addSingle'))}</span>
          <span class="add-choice-sub">${escapeHtml(t('addSingleSub'))}</span>
        </button>
        <button type="button" class="btn-plain btn-block add-choice" id="addWeekBtn">
          <span class="add-choice-title">${escapeHtml(t('addWeek'))}</span>
          <span class="add-choice-sub">${escapeHtml(weekRangeLabel(comingSundayStr()))}</span>
        </button>
      </div>`;
    $('addSingleBtn').addEventListener('click', () => openShiftSheet(null));
    $('addWeekBtn').addEventListener('click', () => openWeekSheet(0));
    openSheetOverlay();
  }

  // ---- week planner: the coming Sunday–Saturday, one shift per day ----
  let weekPlan = [];
  function wheelPanelHtml(id) {
    return `<div class="wheel-panel hidden" id="${id}">
      <div class="wheel-fade-top"></div>
      <div class="wheel-col" data-col="hour"></div>
      <div class="wheel-col" data-col="minute"></div>
      <div class="wheel-highlight"></div>
      <div class="wheel-fade-bottom"></div>
    </div>`;
  }
  function weekDayTimes(d) {
    if (d.mode === 'tpl') {
      const tpl = state.templates.find(x => x.id === d.tplId);
      return tpl ? { start: tpl.startTime, end: tpl.endTime } : null;
    }
    if (d.mode === 'custom') return { start: d.customStart, end: d.customEnd };
    return null;
  }

  // offset = weeks away from the coming week (0 = coming week, -1 = the week before, 1 = the week after).
  const WEEK_NAV_LIMIT = 104;
  let weekOffset = 0;
  function openWeekSheet(offset) {
    sheetMode = 'week'; editingId = null;
    weekOffset = Math.max(-WEEK_NAV_LIMIT, Math.min(WEEK_NAV_LIMIT, Number(offset) || 0));
    const start = addDaysStr(comingSundayStr(), 7 * weekOffset);
    const locale = getLang() === 'he' ? 'he-IL' : undefined;
    weekPlan = Array.from({ length: 7 }, (_, i) => ({
      date: addDaysStr(start, i), mode: 'off', tplId: null,
      customStart: '09:00', customEnd: '17:00', pickersReady: false, holiday: false
    }));
    $('sheetTitle').textContent = t('weekTitle');
    $('sheetSave').style.visibility = 'hidden';
    // The name and the time are isolated from each other, so a name in the other script (e.g. a Hebrew
    // name in the English app) can't flip the order of the times next to it (22:00–06:00 shown as 06:00–22:00).
    const tplChips = state.templates.map(tpl =>
      `<button type="button" class="week-chip" data-mode="tpl" data-tpl="${escapeHtml(tpl.id)}"><bdi>${escapeHtml(tpl.name)}</bdi> <span class="week-chip-time">${tpl.startTime}–${tpl.endTime}</span></button>`).join('');
    $('sheetBody').innerHTML = `
      <div class="week-nav">
        <button type="button" class="week-nav-btn" id="weekPrevBtn" aria-label="${escapeHtml(t('weekPrev'))}" ${weekOffset <= -WEEK_NAV_LIMIT ? 'disabled' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg></button>
        <div class="week-nav-label">
          <div class="week-range">${escapeHtml(weekRangeLabel(start))}</div>
          ${weekOffset === 0
            ? `<div class="week-nav-sub">${escapeHtml(t('weekComing'))}</div>`
            : `<button type="button" class="week-nav-back" id="weekBackBtn">${escapeHtml(t('weekBackToComing'))}</button>`}
        </div>
        <button type="button" class="week-nav-btn" id="weekNextBtn" aria-label="${escapeHtml(t('weekNext'))}" ${weekOffset >= WEEK_NAV_LIMIT ? 'disabled' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button>
      </div>
      ${state.templates.length ? '' : `<div class="tpl-empty-hint" style="margin:0 2px 10px;">${escapeHtml(t('noTemplatesHint'))}</div>`}
      ${weekPlan.map((d, i) => {
        const date = new Date(d.date + 'T00:00:00');
        return `<div class="week-day" data-day="${i}">
          <div class="week-day-head">
            <span class="week-day-name">${escapeHtml(date.toLocaleDateString(locale, { weekday: 'long' }))}</span>
            <span class="week-day-date">${escapeHtml(date.toLocaleDateString(locale, { day: 'numeric', month: 'short' }))}</span>
          </div>
          <div class="week-existing hidden" id="weekExisting${i}"></div>
          <div class="week-chips">
            <button type="button" class="week-chip" data-mode="off">${escapeHtml(t('weekOff'))}</button>
            ${tplChips}
            <button type="button" class="week-chip" data-mode="custom">${escapeHtml(t('weekCustom'))}</button>
          </div>
          <div class="week-custom hidden" id="weekCustom${i}">
            <div class="list-group"><div class="list-row picker-row" data-toggle="weekStartPanel${i}"><div class="rlabel">${escapeHtml(t('fieldStartTime'))}</div><div><span class="picker-value" id="weekStartVal${i}"></span><span class="chev">${ICON_CHEV_D}</span></div></div></div>
            ${wheelPanelHtml('weekStartPanel' + i)}
            <div class="list-group"><div class="list-row picker-row" data-toggle="weekEndPanel${i}"><div class="rlabel">${escapeHtml(t('fieldEndTime'))}</div><div><span class="picker-value" id="weekEndVal${i}"></span><span class="chev">${ICON_CHEV_D}</span></div></div></div>
            ${wheelPanelHtml('weekEndPanel' + i)}
          </div>
          <div class="week-holiday hidden" id="weekHoliday${i}">
            <span>${escapeHtml(t('fieldHoliday'))}</span>
            <label class="switch"><input type="checkbox" id="weekHolidayInput${i}"><span class="track"></span><span class="thumb"></span></label>
          </div>
        </div>`;
      }).join('')}
      <button type="button" class="btn-accent btn-block" id="weekSaveBtn" disabled></button>`;
    setupPickerToggles($('sheetBody'));
    weekPlan.forEach((d, i) => {
      const card = $('sheetBody').querySelector(`[data-day="${i}"]`);
      card.querySelectorAll('.week-chip').forEach(chip => chip.addEventListener('click', () => {
        if (chip.dataset.mode === 'custom' && !d.pickersReady) {
          // Custom times start from whatever the day had (e.g. the template just chosen).
          const seed = weekDayTimes(d);
          if (seed) { d.customStart = seed.start; d.customEnd = seed.end; }
          d.pickersReady = true;
          initTimePicker($('weekStartPanel' + i), d.customStart, v => { d.customStart = v; $('weekStartVal' + i).textContent = v; updateWeekDay(i); });
          initTimePicker($('weekEndPanel' + i), d.customEnd, v => { d.customEnd = v; $('weekEndVal' + i).textContent = v; updateWeekDay(i); });
        }
        d.mode = chip.dataset.mode;
        d.tplId = chip.dataset.tpl || null;
        updateWeekDay(i);
      }));
      $('weekHolidayInput' + i).addEventListener('change', e => { d.holiday = e.target.checked; });
      updateWeekDay(i);
    });
    $('weekSaveBtn').addEventListener('click', saveWeekPlan);
    $('weekPrevBtn').addEventListener('click', () => switchWeek(weekOffset - 1));
    $('weekNextBtn').addEventListener('click', () => switchWeek(weekOffset + 1));
    if ($('weekBackBtn')) $('weekBackBtn').addEventListener('click', () => switchWeek(0));
    $('sheetBody').scrollTop = 0;
    openSheetOverlay();
  }

  // Picks belong to the week on screen, so ask before switching would discard them.
  function switchWeek(offset) {
    if (weekPicks().length && !confirm(t('weekSwitchConfirm'))) return;
    openWeekSheet(offset);
  }

  function updateWeekDay(i) {
    const d = weekPlan[i];
    const card = $('sheetBody').querySelector(`[data-day="${i}"]`);
    if (!card) return;
    card.classList.toggle('active', d.mode !== 'off');
    card.querySelectorAll('.week-chip').forEach(chip => chip.classList.toggle('active',
      chip.dataset.mode === d.mode && (d.mode !== 'tpl' || chip.dataset.tpl === d.tplId)));
    $('weekCustom' + i).classList.toggle('hidden', d.mode !== 'custom');
    $('weekHoliday' + i).classList.toggle('hidden', d.mode === 'off');
    const existing = state.shifts.filter(s => s.date === d.date).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const times = weekDayTimes(d);
    const same = !!times && times.start === times.end;
    const clash = !!times && !!findClash({ date: d.date, startTime: times.start, endTime: times.end }, null);
    const parts = [];
    if (existing.length) parts.push(t('weekExisting').replace('{s}', existing.map(s => `${s.startTime}–${s.endTime}`).join(', ')));
    if (same) parts.push(t('week24h'));
    if (clash) parts.push(t('weekClash'));
    const el = $('weekExisting' + i);
    el.textContent = parts.join(' · ');
    el.classList.toggle('hidden', !parts.length);
    el.classList.toggle('clash', clash);
    updateWeekSaveBtn();
  }

  function weekPicks() {
    return weekPlan.map(d => ({ d, times: weekDayTimes(d) })).filter(x => x.times);
  }
  function updateWeekSaveBtn() {
    const btn = $('weekSaveBtn');
    if (!btn) return;
    const n = weekPicks().length;
    btn.disabled = n === 0;
    btn.textContent = n === 0 ? t('weekAddNone') : n === 1 ? t('weekAddOne') : t('weekAddN').replace('{n}', n);
  }

  function saveWeekPlan() {
    const picks = weekPicks();
    if (!picks.length) return;
    if (state.shifts.length + picks.length > LIMITS.shifts) { alert(t('alertLimitReached')); return; }
    const candidates = picks.map(x => ({ id: genId(), date: x.d.date, startTime: x.times.start, endTime: x.times.end, isHoliday: x.d.holiday, note: '' }));
    // Overlaps with shifts already logged, and between the new shifts themselves (e.g. an overnight shift into the next day).
    const flagged = findOverlaps(candidates);
    candidates.forEach(c => { if (findClash(c, null)) flagged.add(c.id); });
    if (flagged.size) {
      const dates = candidates.filter(c => flagged.has(c.id)).map(c => formatDateDisplay(c.date)).join(', ');
      if (!confirm(t('weekConfirmClash').replace('{d}', dates))) return;
    }
    rememberForUndo();
    const rateId = ensureCurrentRateSet();
    candidates.forEach(c => { c.rateId = rateId; state.shifts.push(c); });
    save();
    closeSheetOverlay();
    refreshAll();
    offerUndo(candidates.length === 1 ? t('weekAddedOne') : t('weekAdded').replace('{n}', candidates.length));
  }

  $('sheetSave').addEventListener('click', () => {
    if (sheetMode === 'shift') {
      if (!isValidDate(formShift.date) || !isValidTime(formShift.startTime) || !isValidTime(formShift.endTime)) { alert(t('alertFillShiftTimes')); return; }
      if (formShift.startTime === formShift.endTime && !confirm(t('confirm24h'))) return;
      if (!editingId && state.shifts.length >= LIMITS.shifts) { alert(t('alertLimitReached')); return; }
      let customPay = null;
      if ($('fCustomPayOn').checked) {
        const raw = $('fCustomPay').value.trim();
        const v = parseFloat(raw);
        if (raw === '' || !isValidCustomPay(v)) { alert(t('alertCustomPay')); return; }
        customPay = Math.round(v * 100) / 100;
      }
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
      if (customPay !== null) shiftObj.customPay = customPay;
      if (editingId) {
        const idx = state.shifts.findIndex(s => s.id === editingId);
        if (idx !== -1) state.shifts[idx] = shiftObj;
      } else {
        state.shifts.push(shiftObj);
      }
    } else if (sheetMode === 'addition') {
      let category = CATEGORY_KEYS.includes($('fCategory').value) ? $('fCategory').value : 'other';
      if (category === 'other') {
        const custom = $('fCustomCat').value.trim().slice(0, LIMITS.category);
        if (custom) category = custom;
      }
      const existing = editingId ? state.additions.find(x => x.id === editingId) : null;
      const cur = currentMonthStr();
      const ended = !!(existing && existing.until && existing.until < cur);
      if (ended) {
        existing.category = category;
      } else {
        const amount = parseFloat($('fAmount').value);
        const from = $('fFrom').value;
        const value = Math.round(amount * 100) / 100;
        if (!Number.isFinite(amount) || value <= 0 || amount > 10000000 || !isValidMonth(from)) { alert(t('alertFillAddition')); return; }
        if (existing) {
          existing.category = category;
          existing.from = from;
          if (existing.until && existing.until < from) existing.until = null;
          reanchorAdditionVersions(existing);
          // A new amount applies from this month on (or from the start, if it hasn't started yet).
          const point = from > cur ? from : cur;
          if (additionAmountFor(existing, point) !== value) {
            existing.versions = existing.versions.filter(v => v.from < point).concat({ from: point, amount: value });
          }
        } else {
          if (state.additions.length >= LIMITS.additions) { alert(t('alertLimitReached')); return; }
          state.additions.push({ id: genId(), category, from, until: null, versions: [{ from, amount: value }] });
        }
      }
      save();
      closeSheetOverlay();
      refreshAll();
      return;
    } else if (sheetMode === 'template') {
      const name = $('fTplName').value.trim().slice(0, LIMITS.tplName);
      if (!name) { alert(t('alertFillTemplateName')); return; }
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
      $('authSubmitBtn').classList.toggle('busy', authBusy);
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
  // A language picked on the sign-in screen is applied to the account once it loads,
  // so signing in doesn't flip the app back to the account's previous language.
  let pendingAuthLang = null;
  $('authLangToggle').querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
    if (state.settings.language === b.dataset.lang) return;
    state.settings.language = b.dataset.lang;
    pendingAuthLang = b.dataset.lang;
    save();
    applyLanguage();
    updateAuthUI();
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
    signingUp = authMode === 'signup';
    const persistence = remember ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION;
    auth.setPersistence(persistence)
      .then(() => authMode === 'signin'
        ? auth.signInWithEmailAndPassword(email, password)
        : auth.createUserWithEmailAndPassword(email, password))
      .then(() => { setLock({ fails: 0, until: 0 }); $('authPassword').value = ''; })
      .catch(err => {
        if (CREDENTIAL_ERRORS.includes(err && err.code)) registerFailure();
        if (lockRemainingSec() === 0) authMsg(authErrorMessage(err));
        signingUp = false;
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
    // The launch screen covers the app from the tap until the reloaded page shows the sign-in form.
    leavingToSignIn = true;
    showSplashAgain();
    const timeout = new Promise(resolve => setTimeout(resolve, 2500));
    Promise.race([flushRemoteWrite(), timeout]).then(() => {
      // Changes not yet in the cloud (e.g. made offline) would be lost with this device's copy.
      if (hasLocalChanges() && !confirm(t('signOutUnsynced'))) {
        leavingToSignIn = false;
        hideSplash();
        $('signOutBtn').disabled = false;
        return;
      }
      return auth.signOut()
        .catch(() => {})
        .then(() => {
          clearLocalCache();
          return db.terminate().then(() => db.clearPersistence()).catch(() => {});
        })
        .then(() => splashSettled($('splash')))
        .then(() => {
          try { sessionStorage.setItem(SPLASH_QUIET_KEY, '1'); } catch(e) {}
          location.reload();
        });
    });
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
      $('delBtn').classList.add('busy');
      $('delMsg').textContent = '';
      const user = auth.currentUser;
      const uid = user.uid;
      reauthenticate($('delPassword').value)
        .then(() => {
          // Stop syncing first so nothing re-creates the data while it's being removed.
          if (firestoreUnsub) { firestoreUnsub(); firestoreUnsub = null; }
          clearTimeout(writeTimer);
          writeTimer = null;
          syncAgain = false;
          remoteReady = false;
          return backupsRef(uid).get().then(snap => Promise.all(snap.docs.map(d => d.ref.delete())));
        })
        .then(() => { stopPaycheckSync(); return deleteAllPaychecks(uid); })
        .then(() => db.collection('users').doc(uid).delete())
        .then(() => {
          // The launch screen covers the app from here until the reloaded page shows the sign-in form (as on sign-out).
          leavingToSignIn = true;
          showSplashAgain();
          return user.delete();
        })
        .then(() => {
          clearLocalCache();
          try { localStorage.removeItem(REMEMBER_KEY); localStorage.removeItem('workTrackerBackup_' + uid); } catch(e) {}
          return db.terminate().then(() => db.clearPersistence()).catch(() => {});
        })
        .then(() => splashSettled($('splash')))
        .then(() => {
          try { sessionStorage.setItem(SPLASH_QUIET_KEY, '1'); } catch(e) {}
          location.reload();
        })
        .catch(err => {
          console.error('Account deletion failed:', err);
          if (leavingToSignIn) { leavingToSignIn = false; hideSplash(); }
          $('delBtn').classList.remove('busy');
          $('delMsg').textContent = authErrorMessage(err);
          $('delBtn').disabled = !ready();
        });
    });
    openSheetOverlay();
  }
  $('deleteAccountBtn').addEventListener('click', openDeleteAccountSheet);

  function applyRemoteState(incoming) {
    setBase(incoming);
    const same = JSON.stringify(incoming) === JSON.stringify(state);
    if (!same) state = incoming;
    saveLocal();
    if (!same) refreshAll();
  }

  // The launch screen stays until there's something real to show (the app with data, or the
  // sign-in form), and at least SPLASH_MIN_MS so it never just flickers. It also lets the opening
  // sweep finish (under a second) so the logo never cuts off half drawn; SPLASH_MAX_WAIT_MS caps that.
  const SPLASH_MIN_MS = 700;
  const SPLASH_MAX_WAIT_MS = 1500;
  const SPLASH_AGAIN_MAX_MS = 10000;
  // A copy taken before the first launch screen goes, so signing in from the form can play it again.
  const splashTemplate = $('splash') ? $('splash').cloneNode(true) : null;
  // Set by money.boot.js after a sign-out reload: the launch screen starts already drawn (see .splash-quiet).
  const SPLASH_QUIET_KEY = 'workTrackerSplashQuiet';
  let splashHidden = false;
  let leavingToSignIn = false; // signing out: the launch screen stays up until the page reloads
  // Resolves once the launch screen's opening sweep has finished (the turning hands don't count), at most SPLASH_MAX_WAIT_MS.
  function splashSettled(el) {
    const entrance = el && el.getAnimations ? el.getAnimations({ subtree: true }).filter(a => a.effect && a.effect.getComputedTiming().iterations !== Infinity) : [];
    const cap = new Promise(r => setTimeout(r, SPLASH_MAX_WAIT_MS));
    return Promise.race([Promise.all(entrance.map(a => a.finished.catch(() => {}))), cap]);
  }
  function hideSplash() {
    if (splashHidden) return;
    splashHidden = true;
    const el = $('splash');
    if (!el) return;
    const quiet = document.documentElement.classList.contains('splash-quiet');
    const minWait = new Promise(r => setTimeout(r, quiet ? 0 : Math.max(0, SPLASH_MIN_MS - performance.now())));
    Promise.all([minWait, splashSettled(el)]).then(() => {
      el.classList.add('done');
      setTimeout(() => { el.remove(); document.documentElement.classList.remove('splash-quiet'); }, 450);
      if (el.classList.contains('again')) replayEntrance(activeTab);
    });
  }
  // After signing in from the form, the launch screen fades in over it and covers the wait for the
  // account's data; the first snapshot then opens the app the same way as a normal launch.
  function showSplashAgain() {
    if (!splashTemplate || $('splash')) return;
    const el = splashTemplate.cloneNode(true);
    el.classList.add('again');
    document.body.prepend(el);
    splashHidden = false;
    setTimeout(hideSplash, SPLASH_AGAIN_MAX_MS); // never left covering the screen if the data never arrives
  }

  function hideAuthScreen() {
    $('authScreen').classList.remove('loading');
    $('authScreen').classList.add('hidden');
    if (currentUser && onboardingPending(currentUser.uid)) openOnboarding();
    hideSplash();
  }

  // ---- first-run setup: shown once after creating an account (and again on this device if closed halfway) ----
  // Three short pages in the Settings style: language, pay, weekend & extras, then a finish page.
  // Every change is saved straight into the settings, so Skip (or closing the app) keeps whatever was set.
  const ONBOARD_KEY = 'workTrackerOnboard'; // holds the uid of the account still to be set up on this device
  let signingUp = false; // a sign-up is in flight: the account it creates gets the setup
  let obStep = 0;
  function onboardingPending(uid) { try { return localStorage.getItem(ONBOARD_KEY) === uid; } catch (e) { return false; } }
  function setOnboardingPending(uid) { try { if (uid) localStorage.setItem(ONBOARD_KEY, uid); else localStorage.removeItem(ONBOARD_KEY); } catch (e) {} }
  function openOnboarding() {
    obStep = 0;
    $('onboard').classList.remove('hidden', 'closing');
    renderOnboarding(0);
  }
  function closeOnboarding(then) {
    setOnboardingPending(null);
    const el = $('onboard');
    el.classList.add('closing');
    setTimeout(() => { el.classList.add('hidden'); el.classList.remove('closing'); el.innerHTML = ''; if (then) then(); else replayEntrance(activeTab); }, reduceMotion.matches ? 0 : 220);
  }
  // The logo for these pages, copied from the launch screen's drawing but still and with its own colours
  // (the launch screen and its gradients are gone once it closes).
  let obMarkHtml = null;
  function obMark() {
    if (obMarkHtml !== null || !splashTemplate) return obMarkHtml || '';
    const svg = splashTemplate.querySelector('.splash-mark').cloneNode(true);
    const mask = svg.querySelector('mask');
    if (mask) mask.remove();
    svg.querySelectorAll('[mask]').forEach(e => e.removeAttribute('mask'));
    svg.querySelectorAll('[id]').forEach(e => { e.id = e.id.replace('splash', 'ob'); });
    svg.querySelectorAll('.splash-person').forEach(e => e.setAttribute('class', 'ob-p'));
    svg.querySelectorAll('.splash-hand').forEach(e => e.setAttribute('class', 'ob-h'));
    svg.setAttribute('class', 'ob-mark-svg');
    svg.setAttribute('aria-hidden', 'true');
    return (obMarkHtml = svg.outerHTML);
  }
  function obInput(id, value, attrs) { return `<input id="${id}" value="${escapeHtml(String(value))}" ${attrs}>`; }
  function obDaySelect(id, dow) {
    return `<select id="${id}" aria-label="${escapeHtml(t(id === 'obWkStartDow' ? 'rowStartDay' : 'rowEndDay'))}">${DOW_FULL[getLang()].map((d, i) => `<option value="${i}"${i === dow ? ' selected' : ''}>${escapeHtml(d)}</option>`).join('')}</select>`;
  }
  function renderOnboarding(dir) {
    const s = state.settings, el = $('onboard'), last = 3;
    const pct = (id, v, label) => `<div class="list-row"><label class="rlabel" for="${id}">${escapeHtml(t(label))}</label><span class="ob-num">${obInput(id, v, 'type="number" inputmode="decimal" min="0" max="1000"')}<span>%</span></span></div>`;
    const pages = [
      () => `<div class="ob-mark">${obMark()}</div><h1 class="large-title" id="obTitle">${escapeHtml(t('obWelcomeTitle'))}</h1><p class="ob-lead">${escapeHtml(t('obWelcomeLead'))}</p>
        <div class="list-group"><div class="list-row"><div class="rlabel">${escapeHtml(t('languageLabel'))}</div>
          <div class="seg-toggle" id="obLang"><button type="button" class="seg-btn${getLang() === 'en' ? ' active' : ''}" data-lang="en">English</button><button type="button" class="seg-btn${getLang() === 'he' ? ' active' : ''}" data-lang="he">עברית</button></div></div></div>`,
      () => `<h1 class="large-title" id="obTitle">${escapeHtml(t('obPayTitle'))}</h1><p class="ob-lead">${escapeHtml(t('obPayLead'))}</p>
        <div class="list-group"><div class="list-row"><label class="rlabel" for="obRate">${escapeHtml(t('rowRate'))}</label>${obInput('obRate', s.rate, 'type="number" inputmode="decimal" min="0" step="0.5"')}</div>
          <div class="list-row"><label class="rlabel" for="obCurrency">${escapeHtml(t('rowCurrency'))}</label>${obInput('obCurrency', s.currency, 'type="text" maxlength="4"')}</div></div>
        <div class="section-footer">${escapeHtml(t('obPayFoot'))}</div>`,
      () => `<h1 class="large-title" id="obTitle">${escapeHtml(t('obRulesTitle'))}</h1><p class="ob-lead">${escapeHtml(t('obRulesLead'))}</p>
        <div class="section-header">${escapeHtml(t('obWeekendSec'))}</div>
        <div class="list-group"><div class="list-row"><div class="rlabel">${escapeHtml(t('obStarts'))}</div><span class="ob-when">${obDaySelect('obWkStartDow', s.weekendStartDow)}${obInput('obWkStartTime', s.weekendStartTime, 'type="time" aria-label="' + escapeHtml(t('rowStartTime')) + '"')}</span></div>
          <div class="list-row"><div class="rlabel">${escapeHtml(t('obEnds'))}</div><span class="ob-when">${obDaySelect('obWkEndDow', s.weekendEndDow)}${obInput('obWkEndTime', s.weekendEndTime, 'type="time" aria-label="' + escapeHtml(t('rowEndTime')) + '"')}</span></div>
          ${pct('obWkPercent', s.weekendPercent, 'obPays')}</div>
        <div class="section-header">${escapeHtml(t('obExtrasSec'))}</div>
        <div class="list-group">${pct('obHolidayPercent', s.holidayPercent, 'obHoliday')}
          <div class="list-row"><label class="rlabel" for="obOtThreshold">${escapeHtml(t('obOtAfter'))}</label>${obInput('obOtThreshold', s.overtimeThreshold, 'type="number" inputmode="decimal" min="0" max="24" step="0.5"')}</div>
          ${pct('obOtPercent', s.overtimePercent, 'obOtPays')}</div>`,
      () => `<div class="ob-mark ob-mark-done">${obMark()}</div><h1 class="large-title" id="obTitle">${escapeHtml(t('obDoneTitle'))}</h1><p class="ob-lead">${escapeHtml(t('obDoneLead'))}</p>`
    ];
    const dots = [0, 1, 2].map(i => `<i class="${i === Math.min(obStep, 2) ? 'on' : ''}"></i>`).join('');
    el.innerHTML = `<div class="ob-top">
        ${obStep ? `<button type="button" class="ob-back" id="obBack">${ICON_CHEV_L}<span>${escapeHtml(t('obBack'))}</span></button>` : '<span></span>'}
        <div class="ob-dots" aria-hidden="true">${dots}</div>
        ${obStep < last ? `<button type="button" class="ob-skip" id="obSkip">${escapeHtml(t('obSkip'))}</button>` : '<span></span>'}</div>
      <div class="ob-body${dir ? (dir > 0 ? ' fwd' : ' back') : ''}">${pages[obStep]()}</div>
      <div class="ob-foot">${obStep < last
        ? `<button type="button" class="btn-accent btn-block" id="obNext">${escapeHtml(t('obContinue'))}</button>`
        : `<button type="button" class="btn-accent btn-block" id="obAddFirst">${escapeHtml(t('obAddFirst'))}</button><button type="button" class="ob-link" id="obSummary">${escapeHtml(t('obGoSummary'))}</button>`}</div>`;
    const go = d => { obStep = Math.max(0, Math.min(last, obStep + d)); renderOnboarding(d); };
    if ($('obBack')) $('obBack').addEventListener('click', () => go(-1));
    if ($('obNext')) $('obNext').addEventListener('click', () => go(1));
    if ($('obSkip')) $('obSkip').addEventListener('click', () => closeOnboarding());
    if ($('obSummary')) $('obSummary').addEventListener('click', () => { switchTab('summary'); closeOnboarding(); });
    if ($('obAddFirst')) $('obAddFirst').addEventListener('click', () => closeOnboarding(() => { switchTab('shifts'); openShiftSheet(null); }));
    if ($('obLang')) $('obLang').querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => {
      if (getLang() === b.dataset.lang) return;
      state.settings.language = b.dataset.lang;
      save();
      applyLanguage();
      renderOnboarding(0);
    }));
    el.querySelectorAll('.ob-body input, .ob-body select').forEach(i => i.addEventListener('change', readOnboarding));
  }
  // Same checks as the Settings fields: anything invalid keeps the previous value instead of being clamped.
  function readOnboarding() {
    const s = state.settings;
    let rejected = false;
    const has = id => !!$(id);
    const field = (id, min, max, current) => {
      if (!has(id)) return current;
      const raw = $(id).value.trim(), n = parseFloat(raw);
      if (raw !== '' && Number.isFinite(n) && n >= min && n <= max) return n;
      if (n !== current) rejected = true;
      return current;
    };
    const time = (id, current) => { if (!has(id)) return current; if (isValidTime($(id).value)) return $(id).value; rejected = true; return current; };
    if (has('obCurrency')) s.currency = $('obCurrency').value.trim().slice(0, LIMITS.currency) || s.currency;
    s.rate = field('obRate', 0, 100000, s.rate);
    if (has('obWkStartDow')) s.weekendStartDow = +$('obWkStartDow').value;
    if (has('obWkEndDow')) s.weekendEndDow = +$('obWkEndDow').value;
    s.weekendStartTime = time('obWkStartTime', s.weekendStartTime);
    s.weekendEndTime = time('obWkEndTime', s.weekendEndTime);
    s.weekendPercent = field('obWkPercent', 0, 1000, s.weekendPercent);
    s.holidayPercent = field('obHolidayPercent', 0, 1000, s.holidayPercent);
    s.overtimeThreshold = field('obOtThreshold', 0, 24, s.overtimeThreshold);
    s.overtimePercent = field('obOtPercent', 0, 1000, s.overtimePercent);
    if (rejected) showToast(t('settingsInvalidKept'));
    save();
    loadSettingsForm();
    resyncSettingsWheels();
    updateSettingsPickerValues();
    renderDataViews();
    // show what was actually kept (e.g. after an invalid entry)
    const show = { obRate: s.rate, obCurrency: s.currency, obWkStartTime: s.weekendStartTime, obWkEndTime: s.weekendEndTime, obWkPercent: s.weekendPercent, obHolidayPercent: s.holidayPercent, obOtThreshold: s.overtimeThreshold, obOtPercent: s.overtimePercent };
    Object.keys(show).forEach(id => { if (has(id) && document.activeElement !== $(id)) $(id).value = show[id]; });
  }

  function startSync(user) {
    const docRef = db.collection('users').doc(user.uid);
    const owner = getCacheOwner();
    const localIsMine = !owner || owner === user.uid;
    if (!localIsMine) { state = freshState(); setBase(null); refreshAll(); }
    let firstSnapshot = true;
    let backupChecked = false;
    let lastRemoteJson = null;
    // Metadata changes are included so the moment the cached copy is confirmed by the server is
    // seen even when the data didn't change (that's when changes made offline get sent).
    firestoreUnsub = docRef.onSnapshot({ includeMetadataChanges: true }, snap => {
      if (firstSnapshot) { firstSnapshot = false; hideAuthScreen(); }
      if (snap.exists) {
        remoteReady = true;
        // Only server-confirmed data counts (a cached copy can be older than this device's).
        // While this device has unsent changes, the cloud copy is merged in by a sync instead
        // of replacing them; a sync's own echo is recognised and skipped.
        if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites) {
          const remote = normalizeState(snap.data());
          const remoteJson = JSON.stringify(remote);
          const fresh = remoteJson !== lastRemoteJson;
          lastRemoteJson = remoteJson;
          if (syncing) { if (fresh && remoteJson !== inflightJson) syncAgain = true; }
          else if (writeTimer) { /* the pending write merges it */ }
          else if (hasLocalChanges()) flushRemoteWrite();
          else if (fresh) applyRemoteState(remote);
        }
        if (pendingAuthLang && !snap.metadata.fromCache) {
          const lang = pendingAuthLang;
          pendingAuthLang = null;
          if (state.settings.language !== lang) { state.settings.language = lang; save(); refreshAll(); }
        }
        // The day's backup is taken from server-confirmed data, before today's edits.
        if (!backupChecked && !snap.metadata.fromCache) { backupChecked = true; runDailyBackup(user.uid, normalizeState(snap.data())); }
      } else if (!snap.metadata.fromCache) {
        // New account: seed it with this device's data only if that data belongs to this user.
        remoteReady = true;
        pendingAuthLang = null;
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
        if (signingUp) { signingUp = false; setOnboardingPending(user.uid); }
        const fromForm = !$('authScreen').classList.contains('hidden') && !$('authScreen').classList.contains('loading');
        if (fromForm) showSplashAgain();
        startSync(user);
        startPaycheckSync(user);
      } else {
        currentUser = null;
        stopPaycheckSync();
        remoteReady = false;
        clearTimeout(writeTimer);
        writeTimer = null;
        // Signing out: the app stays as it is under the launch screen; the reload brings up the sign-in form.
        if (leavingToSignIn) return;
        // A cache stamped with an account that's no longer signed in (e.g. "Remember me"
        // was off) is private data, so it's removed rather than left on the device.
        if (getCacheOwner()) { clearLocalCache(); state = freshState(); refreshAll(); }
        closeSheetOverlay();
        authMode = 'signin';
        updateAuthUI();
        $('authScreen').classList.remove('loading', 'hidden');
        if (!leavingToSignIn) hideSplash();
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
