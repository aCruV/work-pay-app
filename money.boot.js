(function(){
  // Refuse to run inside another site's frame (clickjacking protection).
  if (window.top !== window.self) {
    try { window.top.location = window.self.location.href; }
    catch (e) { document.documentElement.style.display = 'none'; }
  }
  // Apply right-to-left before first paint so Hebrew users don't see a flash of the LTR layout.
  try {
    var raw = localStorage.getItem('workTrackerData_v2');
    if (raw) {
      var d = JSON.parse(raw);
      if (d && d.settings && d.settings.language === 'he') {
        document.documentElement.setAttribute('dir', 'rtl');
        document.documentElement.setAttribute('lang', 'he');
      }
    }
  } catch (e) {}
})();
