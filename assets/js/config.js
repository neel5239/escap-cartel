/* ============================================================
   ESCAPE CARTEL — SITE CONFIG
   Edit these values. Anything set from the Admin panel
   (admin.html) overrides these at runtime via localStorage.
   ============================================================ */
window.EC_CONFIG = {
  BRAND: 'Escape Cartel',
  TAGLINE: 'Not a tour. An escape.',
  CITY: 'Jaipur',

  // WhatsApp number in international format, digits only (no +, no spaces).
  // Example: '919876543210'
  WHATSAPP_NUMBER: '919825744110',

  // UPI payment details. QR is auto-generated from UPI_ID.
  // To use your own QR photo instead, set QR_IMAGE to its path (e.g. 'assets/img/qr.jpg')
  // or upload it from the Admin panel.
  UPI_ID: 'escapecartel@upi',
  UPI_NAME: 'Escape Cartel',
  QR_IMAGE: '',

  EMAIL: 'hello@escapecartel.in',
  PHONE: '+91 98257 44110',
  INSTAGRAM: 'https://instagram.com/escapecartel',

  // PIN to open admin.html
  ADMIN_PIN: '2024'
};

/* Runtime config: file defaults < browser overrides (demo mode) < live server config */
window.EC = (function () {
  let server = null;
  function get() {
    let o = {};
    try { o = JSON.parse(localStorage.getItem('ec_config') || '{}'); } catch (e) {}
    ['WHATSAPP_NUMBER', 'PHONE'].forEach(k => { if (o[k] && /9999999/.test(o[k])) delete o[k]; });
    return Object.assign({}, window.EC_CONFIG, server ? {} : o, server || {});
  }
  function set(patch) {
    let o = {};
    try { o = JSON.parse(localStorage.getItem('ec_config') || '{}'); } catch (e) {}
    Object.assign(o, patch);
    localStorage.setItem('ec_config', JSON.stringify(o));
  }
  function setServer(cfg) { server = cfg; }
  return { get, set, setServer };
})();
