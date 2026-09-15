/* ============================================================
   ESCAPE CARTEL — shared app logic
   nav/footer, helpers, API client, auth, bookings, widgets.
   Talks to the Node backend (/api/*). If the API is unreachable
   (e.g. opened as a plain static file) it falls back to browser
   storage so the site still works in demo mode.
   ============================================================ */
(function () {
  const C = () => window.EC.get();
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* ---------- storage ---------- */
  const store = {
    get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { localStorage.setItem(k, JSON.stringify(v)); },
    del(k) { localStorage.removeItem(k); }
  };

  /* ---------- API client ---------- */
  let online = false;
  const session = () => store.get('ec_session', null);
  async function api(path, opts) {
    opts = opts || {};
    const headers = { 'Content-Type': 'application/json' };
    const tok = opts.auth === 'admin' ? sessionStorage.getItem('ec_admin_token') : (session() || {}).token;
    if (tok) headers.Authorization = 'Bearer ' + tok;
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), opts.timeout || 15000);
    let res;
    try { res = await fetch(path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: ctrl.signal }); }
    catch (e) { clearTimeout(timer); throw Object.assign(new Error('Network error — check your connection and try again.'), { network: true }); }
    clearTimeout(timer);
    let data = null; try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) { const err = new Error((data && data.error) || `Request failed (${res.status})`); err.status = res.status; throw err; }
    return data;
  }

  /* ---------- helpers ---------- */
  const inr = n => '₹' + Number(n).toLocaleString('en-IN');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const param = k => new URLSearchParams(location.search).get(k);
  const fallback = seed => `https://picsum.photos/seed/${seed}/1200/800`;
  const imgTag = (src, seed, alt, cls) => `<img src="${src}" alt="${esc(alt || '')}" loading="lazy" ${cls ? `class="${cls}"` : ''} onerror="this.onerror=null;this.src='${fallback(seed)}'">`;
  const diffClass = d => (d || '').toLowerCase();

  /* ---------- occupancy ---------- */
  let counts = {};
  function localBookings() { return store.get('ec_bookings', []); }
  function bookedCount(trip) {
    const extra = online ? (counts[trip.id] || 0) : localBookings().filter(b => b.tripId === trip.id && b.status !== 'cancelled').reduce((a, b) => a + b.seats, 0);
    return Math.min(trip.slots, trip.booked + extra);
  }
  function slotsLeft(trip) { return Math.max(0, trip.slots - bookedCount(trip)); }
  function pctFilled(trip) { return Math.round(bookedCount(trip) / trip.slots * 100); }
  function daysLeft(trip) { return Math.ceil((new Date(trip.start) - new Date()) / 86400000); }
  function upcoming() { return window.EC_TRIPS.filter(t => new Date(t.end) > new Date()).sort((a, b) => new Date(a.start) - new Date(b.start)); }
  function trip(id) { return window.EC_TRIPS.find(t => t.id === id); }

  /* ---------- WhatsApp / UPI ---------- */
  function waLink(msg) {
    const n = (C().WHATSAPP_NUMBER || '').replace(/\D/g, '');
    return `https://wa.me/${n}?text=${encodeURIComponent(msg || `Hi ${C().BRAND}! I want to know more about your trips.`)}`;
  }
  function upiLink(amount, note) {
    const c = C();
    return `upi://pay?pa=${encodeURIComponent(c.UPI_ID)}&pn=${encodeURIComponent(c.UPI_NAME)}&am=${amount}&cu=INR&tn=${encodeURIComponent(note || 'Escape Cartel booking')}`;
  }

  /* ---------- auth ---------- */
  const auth = {
    current() { const s = session(); return s ? s.user : null; },
    token() { return (session() || {}).token || null; },
    async signup(u) {
      if (online) { const r = await api('/api/auth/signup', { method: 'POST', body: u }); store.set('ec_session', r); return r.user; }
      /* demo fallback */
      const users = store.get('ec_users', []);
      if (users.some(x => x.email.toLowerCase() === u.email.toLowerCase())) throw new Error('An account with this email already exists. Log in instead.');
      u.id = 'U' + Date.now().toString(36).toUpperCase(); u.joined = new Date().toISOString(); users.push(u); store.set('ec_users', users);
      const user = { id: u.id, name: u.name, email: u.email, phone: u.phone, college: u.college || '', year: u.year, vibes: u.vibes, crew: u.crew, joined: u.joined };
      store.set('ec_session', { token: null, user }); return user;
    },
    async login(email, pass) {
      if (online) { const r = await api('/api/auth/login', { method: 'POST', body: { email, pass } }); store.set('ec_session', r); return r.user; }
      const u = store.get('ec_users', []).find(x => x.email.toLowerCase() === email.toLowerCase());
      if (!u || u.pass !== pass) throw new Error('Wrong email or password.');
      const user = { id: u.id, name: u.name, email: u.email, phone: u.phone, college: u.college || '', year: u.year, vibes: u.vibes, crew: u.crew, joined: u.joined };
      store.set('ec_session', { token: null, user }); return user;
    },
    async refresh() { if (!online || !auth.token()) return; try { const user = await api('/api/auth/me'); store.set('ec_session', { token: auth.token(), user }); } catch (e) { if (e.status === 401) store.del('ec_session'); } },
    logout() { store.del('ec_session'); location.href = 'index.html'; }
  };

  /* ---------- bookings ---------- */
  async function saveBooking(b) {
    if (online) { const saved = await api('/api/bookings', { method: 'POST', body: b, timeout: 30000 }); counts[saved.tripId] = (counts[saved.tripId] || 0) + saved.seats; return saved; }
    b.id = b.id || ('EC-' + Date.now().toString(36).toUpperCase().slice(-6)); b.created = new Date().toISOString(); b.status = 'pending';
    const shot = b.shot; delete b.shot; b.hasShot = !!shot;
    const all = localBookings(); all.unshift(b); store.set('ec_bookings', all);
    if (shot) { try { localStorage.setItem('ec_shot_' + b.id, shot); } catch (e) { /* too big */ } }
    return b;
  }
  async function myBookings() {
    if (online) return api('/api/bookings/mine');
    const u = auth.current(); if (!u) return [];
    return localBookings().filter(b => b.userId === u.id || (b.email || '').toLowerCase() === u.email.toLowerCase());
  }
  async function sendRequest(r) { if (!online) return; try { await api('/api/requests', { method: 'POST', body: r }); } catch (e) { /* non-blocking */ } }

  /* ---------- admin ---------- */
  const admin = {
    ok() { return !!sessionStorage.getItem('ec_admin_token') || (!online && sessionStorage.getItem('ec_admin') === '1'); },
    async login(pin) {
      if (online) { const r = await api('/api/admin/login', { method: 'POST', body: { pin } }); sessionStorage.setItem('ec_admin_token', r.token); return true; }
      if (String(pin) === String(C().ADMIN_PIN)) { sessionStorage.setItem('ec_admin', '1'); return true; }
      throw new Error('Wrong PIN');
    },
    logout() { sessionStorage.removeItem('ec_admin_token'); sessionStorage.removeItem('ec_admin'); },
    async bookings() { return online ? api('/api/admin/bookings', { auth: 'admin' }) : localBookings(); },
    async setStatus(id, status) { if (online) return api('/api/admin/bookings/' + encodeURIComponent(id), { method: 'PATCH', auth: 'admin', body: { status } }); const all = localBookings().map(b => b.id === id ? Object.assign(b, { status }) : b); store.set('ec_bookings', all); },
    shotUrl(id) { return online ? '/api/admin/bookings/' + encodeURIComponent(id) + '/shot?t=' + encodeURIComponent(sessionStorage.getItem('ec_admin_token') || '') : (localStorage.getItem('ec_shot_' + id) || ''); },
    async getConfig() { return online ? api('/api/admin/config', { auth: 'admin' }) : C(); },
    async setConfig(patch) { if (online) { const cfg = await api('/api/admin/config', { method: 'PUT', auth: 'admin', body: patch, timeout: 30000 }); window.EC.setServer(cfg); return cfg; } window.EC.set(patch); return C(); },
    async requests() { return online ? api('/api/admin/requests', { auth: 'admin' }) : []; },
    async clearBookings() { if (online) return api('/api/admin/bookings', { method: 'DELETE', auth: 'admin' }); store.del('ec_bookings'); Object.keys(localStorage).filter(k => k.startsWith('ec_shot_')).forEach(k => localStorage.removeItem(k)); },
    async clearUsers() { if (online) return api('/api/admin/users', { method: 'DELETE', auth: 'admin' }); store.del('ec_users'); store.del('ec_session'); }
  };

  /* ---------- toast ---------- */
  let toastEl;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastEl._t); toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  /* ---------- nav / footer ---------- */
  const WA_SVG = '<svg viewBox="0 0 24 24"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.6c.2-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5 2.5 1 3 .8 3.6.8.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.2-.3-.3-.6-.4M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2m0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2"/></svg>';
  const page = location.pathname.split('/').pop() || 'index.html';

  function renderNav() {
    const c = C(); const u = auth.current();
    const links = [['trips.html', 'Trips'], ['plan.html', 'Plan an Escape'], ['crew.html', 'Cartel Crew'], ['blog.html', 'Blog'], ['about.html', 'About']];
    const nav = document.createElement('header'); nav.className = 'nav';
    nav.innerHTML = `<div class="wrap">
      <a class="brand" href="index.html"><img src="assets/img/logo.jpg" alt="${esc(c.BRAND)}"><span>${esc(c.BRAND)}</span></a>
      <nav class="nav-links">${links.map(l => `<a href="${l[0]}" class="${page === l[0] ? 'active' : ''}">${l[1]}</a>`).join('')}</nav>
      <div class="nav-cta">
        ${u ? `<a href="dashboard.html" class="btn btn-ghost btn-sm">Hi, ${esc(u.name.split(' ')[0])}</a><a href="trips.html" class="btn btn-red btn-sm">Book a Trip</a>`
           : `<a href="login.html" class="btn btn-ghost btn-sm">Login</a><a href="signup.html" class="btn btn-red btn-sm">Join the Cartel</a>`}
        <button class="nav-burger" aria-label="Menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button>
      </div></div>`;
    const mm = document.createElement('div'); mm.className = 'mobile-menu';
    mm.innerHTML = links.map(l => `<a href="${l[0]}">${l[1]}</a>`).join('') +
      (u ? `<a href="dashboard.html">My Bookings</a><a href="trips.html" class="btn btn-red">Book a Trip</a>` : `<a href="login.html">Login</a><a href="signup.html" class="btn btn-red">Join the Cartel</a>`);
    document.body.prepend(mm); document.body.prepend(nav);
    $('.nav-burger', nav).onclick = () => mm.classList.toggle('open');
  }

  function renderFooter() {
    const c = C();
    const f = document.createElement('footer'); f.className = 'footer';
    f.innerHTML = `<div class="wrap">
      <div class="footer-grid">
        <div>
          <a class="brand" href="index.html"><img src="assets/img/logo.jpg" alt=""><span>${esc(c.BRAND)}</span></a>
          <p style="margin-top:18px">${esc(c.TAGLINE)} A bunch of strangers who become your people. ${esc(c.CITY)}'s most trusted youth travel community.</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px"><span class="award">🏆 Student Travel Experience of the Year</span></div>
        </div>
        <div><h4>Explore</h4><ul><li><a href="trips.html">All Trips</a></li><li><a href="crew.html">Cartel Crew</a></li><li><a href="plan.html">Plan an Escape</a></li><li><a href="blog.html">Blog</a></li><li><a href="about.html">Our Story</a></li></ul></div>
        <div><h4>Account</h4><ul><li><a href="signup.html">Join the Cartel</a></li><li><a href="login.html">Login</a></li><li><a href="dashboard.html">My Bookings</a></li><li><a href="admin.html">Admin</a></li></ul></div>
        <div><h4>Get in touch</h4><ul><li><a href="mailto:${esc(c.EMAIL)}">${esc(c.EMAIL)}</a></li><li><a href="tel:${esc(c.PHONE)}">${esc(c.PHONE)}</a></li><li><a href="${waLink()}" target="_blank" rel="noopener">WhatsApp us →</a></li><li><a href="${esc(c.INSTAGRAM)}" target="_blank" rel="noopener">Instagram</a></li></ul></div>
      </div>
      <div class="footer-big">ESCAPE CARTEL</div>
      <div class="footer-bottom"><span>© ${new Date().getFullYear()} ${esc(c.BRAND)}. All rights reserved.</span><span><a href="policy.html">Privacy & Terms</a> · <a href="policy.html#refund">Cancellation Policy</a></span></div>
    </div>`;
    document.body.appendChild(f);
    const wa = document.createElement('a'); wa.className = 'wa-float'; wa.href = waLink(); wa.target = '_blank'; wa.rel = 'noopener'; wa.setAttribute('aria-label', 'Chat on WhatsApp'); wa.innerHTML = WA_SVG;
    document.body.appendChild(wa);
  }

  /* ---------- sticky next-up bar ---------- */
  function renderNextBar() {
    if (!['index.html', 'trips.html', 'about.html', 'blog.html', 'crew.html'].includes(page)) return;
    const t = upcoming().find(x => slotsLeft(x) > 0 && x.price); if (!t) return;
    if (sessionStorage.getItem('ec_nextbar_hidden')) return;
    const bar = document.createElement('div'); bar.className = 'nextbar';
    bar.innerHTML = `<div class="in"><span class="lbl">NEXT UP</span><div><b>${esc(t.name)}</b><div class="meta">${esc(t.location)} · ${esc(t.dateText)}</div></div><span class="spacer"></span><span class="cd" data-cd="${t.start}"></span><span class="meta"><b style="color:var(--red);font-family:var(--font-body);font-size:13px">${slotsLeft(t)} spots left</b></span><a class="btn btn-red btn-sm" href="trip.html?id=${t.id}">Register →</a><button class="x" aria-label="Dismiss">×</button></div>`;
    document.body.appendChild(bar);
    $('.x', bar).onclick = () => { bar.classList.remove('show'); sessionStorage.setItem('ec_nextbar_hidden', '1'); };
    window.addEventListener('scroll', () => bar.classList.toggle('show', window.scrollY > 500), { passive: true });
  }

  /* ---------- countdown ---------- */
  function tickCountdowns() {
    $$('[data-cd]').forEach(el => {
      const d = new Date(el.dataset.cd) - new Date();
      if (d <= 0) { el.textContent = 'LIVE'; return; }
      const dd = Math.floor(d / 864e5), hh = Math.floor(d % 864e5 / 36e5), mm = Math.floor(d % 36e5 / 6e4), ss = Math.floor(d % 6e4 / 1e3);
      el.textContent = dd > 0 ? `${dd}D ${hh}H ${mm}M` : `${hh}H ${mm}M ${ss}S`;
    });
  }

  /* ---------- trip card ---------- */
  function tripCard(t, opts) {
    opts = opts || {};
    const left = slotsLeft(t), pct = pctFilled(t), sold = left === 0;
    const dl = daysLeft(t);
    return `<a class="card ${sold ? 'sold' : ''} rv" href="trip.html?id=${t.id}">
      <div class="card-img">${imgTag(t.image, t.seed, t.name)}
        <div class="card-tags"><span class="tag">${esc(opts.showDuration ? t.duration : t.tag)}</span><span class="tag tag-diff ${diffClass(t.difficulty)}">${esc(t.difficulty)}</span></div>
      </div>
      <div class="card-body">
        <div class="card-loc">${esc(t.location)}</div>
        <h3>${esc(t.name)}</h3>
        <div class="card-date">📅 ${esc(t.dateText)}${dl > 0 && dl <= 21 ? ` · <span class="red" style="font-weight:700">${dl}d left</span>` : ''}</div>
        ${opts.compact ? '' : `<p class="card-desc">${esc(t.short)}</p>`}
        <div class="progress"><i style="width:${pct}%"></i></div>
        <div class="progress-meta"><span><b>${left}</b> slots left</span><span>${pct}% filled</span></div>
        <div class="card-foot">
          ${t.price ? `<span class="price">${inr(t.price)}<small>/ person</small></span>` : `<span class="price soon">Price revealing soon</span>`}
          <span class="btn btn-white btn-sm">Know More →</span>
        </div>
      </div></a>`;
  }

  /* ---------- gallery lightbox ---------- */
  function renderGallery(el, items) {
    el.innerHTML = items.map((g, i) => `<figure data-i="${i}">${imgTag(g.img, g.seed, g.title)}<figcaption>${esc(g.title)}</figcaption></figure>`).join('');
    const lb = document.createElement('div'); lb.className = 'lightbox';
    lb.innerHTML = `<button class="lb-x" aria-label="Close">×</button><button class="lb-prev" aria-label="Previous">‹</button><img alt=""><button class="lb-next" aria-label="Next">›</button><div class="lb-cap"></div>`;
    document.body.appendChild(lb);
    let cur = 0;
    const show = i => { cur = (i + items.length) % items.length; const g = items[cur]; const im = $('img', lb); im.src = g.img; im.onerror = () => { im.onerror = null; im.src = fallback(g.seed); }; $('.lb-cap', lb).textContent = g.title; lb.classList.add('open'); };
    el.addEventListener('click', e => { const f = e.target.closest('figure'); if (f) show(+f.dataset.i); });
    $('.lb-x', lb).onclick = () => lb.classList.remove('open');
    $('.lb-prev', lb).onclick = () => show(cur - 1);
    $('.lb-next', lb).onclick = () => show(cur + 1);
    lb.addEventListener('click', e => { if (e.target === lb) lb.classList.remove('open'); });
    document.addEventListener('keydown', e => { if (!lb.classList.contains('open')) return; if (e.key === 'Escape') lb.classList.remove('open'); if (e.key === 'ArrowLeft') show(cur - 1); if (e.key === 'ArrowRight') show(cur + 1); });
  }

  /* ---------- reveal on scroll + counters ---------- */
  function initReveal() {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12 });
    const watch = () => $$('.rv:not(.in)').forEach(el => io.observe(el));
    watch(); new MutationObserver(watch).observe(document.body, { childList: true, subtree: true });
    const cio = new IntersectionObserver(es => es.forEach(e => {
      if (!e.isIntersecting) return; cio.unobserve(e.target);
      const el = e.target, end = +el.dataset.count, suf = el.dataset.suffix || '', t0 = performance.now();
      const step = now => { const p = Math.min(1, (now - t0) / 1400), v = Math.round(end * (1 - Math.pow(1 - p, 3))); el.textContent = v.toLocaleString('en-IN') + suf; if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    }));
    $$('[data-count]').forEach(el => cio.observe(el));
  }


  /* ---------- site-wide calm backdrop: contour lines + dot grid + soft glow ---------- */
  function initBackdrop() {
    const cv = document.createElement('canvas'); cv.className = 'site-fx'; cv.setAttribute('aria-hidden', 'true'); document.body.prepend(cv);
    const ctx = cv.getContext('2d'); const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0, H = 0, t = 0, last = 0, grid = null;
    function size() {
      const d = Math.min(devicePixelRatio || 1, 1.5); W = innerWidth; H = innerHeight; cv.width = Math.round(W * d); cv.height = Math.round(H * d); ctx.setTransform(d, 0, 0, d, 0, 0);
      grid = document.createElement('canvas'); grid.width = cv.width; grid.height = cv.height; const g = grid.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0);
      g.fillStyle = 'rgba(255,255,255,.07)'; for (let x = 14; x < W; x += 28) for (let y = 14; y < H; y += 28) { g.fillRect(x, y, 1, 1); }
    }
    function line(base, amp, freq, speed, col, lw) {
      ctx.beginPath();
      for (let x = 0; x <= W; x += 8) { const y = base + Math.sin(x * freq + t * speed) * amp + Math.sin(x * freq * 2.1 - t * speed * .7) * amp * .4; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke();
    }
    function draw(now) {
      if (now - last < 33) { requestAnimationFrame(draw); return; } last = now; t += reduce ? 0 : .012;
      ctx.clearRect(0, 0, W, H); ctx.drawImage(grid, 0, 0, W, H);
      const gx = W * (.15 + Math.sin(t * .15) * .06), gy = H * (.2 + Math.cos(t * .11) * .08);
      const rg = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(W, H) * .5); rg.addColorStop(0, 'rgba(229,32,46,.17)'); rg.addColorStop(1, 'rgba(229,32,46,0)'); ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
      const n = 6; for (let i = 0; i < n; i++) line(H * (.12 + i * .15), 18 + i * 4, .0028 + i * .0002, .28 + i * .05, i === 3 ? 'rgba(229,32,46,.24)' : `rgba(255,255,255,${.06 + i * .008})`, 1);
      if (!reduce) requestAnimationFrame(draw);
    }
    size(); addEventListener('resize', size, { passive: true }); requestAnimationFrame(draw);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !reduce) { last = 0; requestAnimationFrame(draw); } });
  }

  window.App = { $, $$, store, api, inr, esc, param, imgTag, fallback, trip, upcoming, slotsLeft, pctFilled, daysLeft, bookedCount, waLink, upiLink, auth, admin, saveBooking, myBookings, sendRequest, toast, tripCard, renderGallery, tickCountdowns, C, get online() { return online; } };

  /* ---------- bootstrap: pull live config + occupancy, then render ---------- */
  async function boot() {
    const [cfg, cnt] = await Promise.allSettled([api('/api/config', { timeout: 5000 }), api('/api/bookings/counts', { timeout: 5000 })]);
    if (cfg.status === 'fulfilled' && cfg.value && typeof cfg.value === 'object') { online = true; window.EC.setServer(cfg.value); }
    if (cnt.status === 'fulfilled' && cnt.value) counts = cnt.value;
    if (online) await auth.refresh();
    if (!document.body.classList.contains('no-chrome')) { initBackdrop(); renderNav(); renderFooter(); renderNextBar(); }
    initReveal(); tickCountdowns(); setInterval(tickCountdowns, 1000);
    document.dispatchEvent(new Event('app:ready'));
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
