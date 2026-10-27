(function(){
  // Refuse to run inside another site's frame (clickjacking protection).
  if (window.top !== window.self) {
    try { window.top.location = window.self.location.href; }
    catch (e) { document.documentElement.style.display = 'none'; }
  }
  // Apply right-to-left before first paint so Hebrew users don't see a flash of the LTR layout.
  try {
    var raw = localStorage.getItem('workTrackerData_v2');
    var d = raw ? JSON.parse(raw) : null;
    var lang = d && d.settings ? d.settings.language : localStorage.getItem('workTrackerUiLang');
    if (lang === 'he') {
      document.documentElement.setAttribute('dir', 'rtl');
      document.documentElement.setAttribute('lang', 'he');
    }
  } catch (e) {}
  // Light/Dark chosen in Settings, applied before first paint (Auto = follow the phone).
  try {
    var theme = localStorage.getItem('workTrackerTheme');
    if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
  // The app always fits the screen: Safari ignores user-scalable=no for pinch, so pinch gestures are
  // cancelled here; double-tap zoom is turned off in CSS (touch-action: manipulation).
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (type) {
    document.addEventListener(type, function (e) { e.preventDefault(); }, { passive: false });
  });
  document.addEventListener('touchmove', function (e) { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  // Offline support (see sw.js). Only on real web addresses, not when opened as a local file.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) { console.warn('Offline support unavailable:', err); });
    });
  }
  // Failsafe: even if the app script fails to load, never leave the launch screen up forever.
  setTimeout(function () {
    var s = document.getElementById('splash');
    if (s) s.classList.add('done');
  }, 12000);
})();
