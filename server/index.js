/* ============================================================
   Escape Cartel — API + static server
   Env: PORT, DATABASE_URL (Postgres), JWT_SECRET, ADMIN_PIN,
        WHATSAPP_NUMBER, UPI_ID, UPI_NAME, DATA_DIR
   ============================================================ */
const express = require('express');
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 8090;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) console.warn('[warn] JWT_SECRET not set — sessions reset on every restart. Set it in Railway variables.');

/* defaults from the frontend config file (single source of truth) */
function fileDefaults() {
  const sb = { window: {}, localStorage: { getItem: () => null, setItem() {} } };
  try { vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'assets/js/config.js'), 'utf8'), sb); } catch (e) { /* ignore */ }
  return sb.window.EC_CONFIG || {};
}
const DEFAULTS = fileDefaults();
const ENV_OVERRIDES = () => Object.fromEntries(['WHATSAPP_NUMBER', 'UPI_ID', 'UPI_NAME', 'EMAIL', 'PHONE', 'INSTAGRAM'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
const adminPin = () => String(process.env.ADMIN_PIN || DEFAULTS.ADMIN_PIN || '2024');
const PUBLIC_KEYS = ['BRAND', 'TAGLINE', 'CITY', 'WHATSAPP_NUMBER', 'UPI_ID', 'UPI_NAME', 'QR_IMAGE', 'QR_IMAGE_DATA', 'EMAIL', 'PHONE', 'INSTAGRAM'];
async function publicConfig() {
  const merged = Object.assign({}, DEFAULTS, ENV_OVERRIDES(), await db.getConfig());
  return Object.fromEntries(PUBLIC_KEYS.filter(k => merged[k] !== undefined).map(k => [k, merged[k]]));
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '8mb' }));
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'SAMEORIGIN'); next(); });

/* ---------- helpers ---------- */
const sign = (payload, exp) => jwt.sign(payload, JWT_SECRET, { expiresIn: exp || '30d' });
const bearer = (req) => { const h = req.headers.authorization || ''; return h.startsWith('Bearer ') ? h.slice(7) : null; };
const userOpt = (req, _res, next) => { try { const t = bearer(req); req.user = t ? jwt.verify(t, JWT_SECRET) : null; if (req.user && req.user.role !== 'user') req.user = null; } catch (e) { req.user = null; } next(); };
const userReq = (req, res, next) => userOpt(req, res, () => req.user ? next() : res.status(401).json({ error: 'Login required' }));
const adminReq = (req, res, next) => { try { const t = jwt.verify(bearer(req) || '', JWT_SECRET); if (t.role !== 'admin') throw 0; next(); } catch (e) { res.status(401).json({ error: 'Admin login required' }); } };
const wrap = (fn) => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(e.status || 500).json({ error: e.message || 'Server error' }); });
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const safeUser = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, college: u.college || '', year: u.year || '', city: u.city || '', vibes: u.vibes || [], crew: !!u.crew, joined: u.created });
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || '');
const validPhone = (p) => /^[6-9]\d{9}$/.test(String(p || '').replace(/\D/g, '').slice(-10));

/* simple in-memory rate limit for auth/admin */
const hits = new Map();
const limit = (max, windowMs) => (req, res, next) => {
  const k = req.ip + req.path, now = Date.now(); const a = (hits.get(k) || []).filter(t => now - t < windowMs); a.push(now); hits.set(k, a);
  if (a.length > max) return res.status(429).json({ error: 'Too many attempts. Try again in a bit.' }); next();
};

/* ---------- public ---------- */
app.get('/api/health', (_req, res) => res.json({ ok: true, db: db.kind }));
app.get('/api/config', wrap(async (_req, res) => res.json(await publicConfig())));
app.get('/api/bookings/counts', wrap(async (_req, res) => res.json(await db.countsByTrip())));

/* ---------- auth ---------- */
app.post('/api/auth/signup', limit(20, 15 * 60e3), wrap(async (req, res) => {
  const { name, email, phone, pass, college, year, city, vibes, crew } = req.body || {};
  if (!name || String(name).trim().length < 2) throw bad('Enter your name');
  if (!validEmail(email)) throw bad('Enter a valid email');
  if (!validPhone(phone)) throw bad('Enter a valid 10-digit phone');
  if (!pass || String(pass).length < 6) throw bad('Password must be at least 6 characters');
  if (await db.getUserByEmail(email)) throw bad('An account with this email already exists. Log in instead.');
  const u = await db.createUser({ name: String(name).trim(), email: String(email).trim().toLowerCase(), phone: String(phone).replace(/\D/g, '').slice(-10), hash: await bcrypt.hash(String(pass), 10), college: college || '', year: year || '', city: city || '', vibes: Array.isArray(vibes) ? vibes.slice(0, 10) : [], crew: !!crew });
  res.json({ token: sign({ id: u.id, role: 'user' }), user: safeUser(u) });
}));
app.post('/api/auth/login', limit(30, 15 * 60e3), wrap(async (req, res) => {
  const { email, pass } = req.body || {};
  const u = email ? await db.getUserByEmail(email) : null;
  if (!u || !(await bcrypt.compare(String(pass || ''), u.hash))) throw Object.assign(new Error('Wrong email or password.'), { status: 401 });
  res.json({ token: sign({ id: u.id, role: 'user' }), user: safeUser(u) });
}));
app.get('/api/auth/me', userReq, wrap(async (req, res) => { const u = await db.getUser(req.user.id); if (!u) return res.status(401).json({ error: 'Session expired' }); res.json(safeUser(u)); }));

/* ---------- bookings ---------- */
app.post('/api/bookings', userOpt, wrap(async (req, res) => {
  const b = req.body || {};
  const trips = loadTrips(); const t = trips.find(x => x.id === b.tripId);
  if (!t) throw bad('Unknown trip'); if (!t.price) throw bad('This trip is not open for booking yet');
  const seats = Math.max(1, Math.min(6, parseInt(b.seats, 10) || 1));
  const travellers = (Array.isArray(b.travellers) ? b.travellers : []).slice(0, seats).map(p => ({ name: String(p.name || '').trim().slice(0, 80), phone: String(p.phone || '').replace(/\D/g, '').slice(-10), email: String(p.email || '').trim().toLowerCase().slice(0, 120), college: String(p.college || '').slice(0, 120) }));
  if (travellers.length !== seats || travellers.some(p => p.name.length < 2 || !validPhone(p.phone))) throw bad('Traveller details incomplete');
  if (!validEmail(travellers[0].email)) throw bad('Primary traveller needs a valid email');
  if (!b.utr || String(b.utr).trim().length < 6) throw bad('Enter the UTR / transaction ID');
  const counts = await db.countsByTrip(); const left = t.slots - (t.booked + (counts[t.id] || 0));
  if (left < seats) throw bad(left <= 0 ? 'Sold out' : `Only ${left} seat(s) left`);
  const shot = typeof b.shot === 'string' && b.shot.startsWith('data:image/') && b.shot.length < 6e6 ? b.shot : '';
  const saved = await db.createBooking({ tripId: t.id, tripName: t.name, dateText: t.dateText, seats, amount: t.price * seats, travellers, name: travellers[0].name, phone: travellers[0].phone, email: travellers[0].email, pickup: String(b.pickup || '').slice(0, 80), notes: String(b.notes || '').slice(0, 500), utr: String(b.utr).trim().slice(0, 40), shot, hasShot: !!shot, userId: req.user ? req.user.id : null, status: 'pending' });
  res.json(strip(saved));
}));
app.get('/api/bookings/mine', userReq, wrap(async (req, res) => {
  const u = await db.getUser(req.user.id); if (!u) return res.status(401).json({ error: 'Session expired' });
  const byId = await db.listBookings({ userId: u.id }); const byEmail = await db.listBookings({ email: u.email.toLowerCase() });
  const seen = new Set(); const all = byId.concat(byEmail).filter(b => !seen.has(b.id) && seen.add(b.id)).sort((a, c) => new Date(c.created) - new Date(a.created));
  res.json(all.map(strip));
}));
app.post('/api/requests', limit(20, 10 * 60e3), wrap(async (req, res) => {
  const { name, phone, message, tripId, tripName } = req.body || {};
  if (!name || !phone) throw bad('Name and phone required');
  await db.createRequest({ name: String(name).slice(0, 80), phone: String(phone).slice(0, 20), message: String(message || '').slice(0, 1000), tripId: tripId || null, tripName: tripName || null });
  res.json({ ok: true });
}));
const strip = (b) => { const o = Object.assign({}, b); delete o.shot; return o; };

/* ---------- admin ---------- */
app.post('/api/admin/login', limit(10, 15 * 60e3), (req, res) => {
  const pin = String((req.body || {}).pin || '');
  const ok = pin.length === adminPin().length && crypto.timingSafeEqual(Buffer.from(pin), Buffer.from(adminPin()));
  if (!ok) return res.status(401).json({ error: 'Wrong PIN' });
  res.json({ token: sign({ role: 'admin' }, '12h') });
});
app.get('/api/admin/bookings', adminReq, wrap(async (_req, res) => res.json((await db.listBookings({})).map(strip))));
app.get('/api/admin/bookings/:id/shot', adminReq, wrap(async (req, res) => { const b = await db.getBooking(req.params.id); if (!b || !b.shot) return res.status(404).send('No screenshot'); const m = b.shot.match(/^data:(image\/[a-z+]+);base64,(.+)$/); if (!m) return res.status(404).send('Bad image'); res.type(m[1]).send(Buffer.from(m[2], 'base64')); }));
app.patch('/api/admin/bookings/:id', adminReq, wrap(async (req, res) => { const { status } = req.body || {}; if (!['pending', 'confirmed', 'cancelled'].includes(status)) throw bad('Bad status'); const b = await db.updateBooking(req.params.id, { status }); if (!b) return res.status(404).json({ error: 'Not found' }); res.json(strip(b)); }));
app.delete('/api/admin/bookings', adminReq, wrap(async (_req, res) => { await db.clearBookings(); res.json({ ok: true }); }));
app.delete('/api/admin/users', adminReq, wrap(async (_req, res) => { await db.clearUsers(); res.json({ ok: true }); }));
app.get('/api/admin/requests', adminReq, wrap(async (_req, res) => res.json(await db.listRequests())));
app.get('/api/admin/config', adminReq, wrap(async (_req, res) => res.json(await publicConfig())));
app.put('/api/admin/config', adminReq, wrap(async (req, res) => {
  const allowed = ['WHATSAPP_NUMBER', 'UPI_ID', 'UPI_NAME', 'EMAIL', 'PHONE', 'INSTAGRAM', 'QR_IMAGE_DATA'];
  const patch = {}; for (const k of allowed) if (k in (req.body || {})) patch[k] = k === 'QR_IMAGE_DATA' ? (typeof req.body[k] === 'string' && (req.body[k] === '' || (req.body[k].startsWith('data:image/') && req.body[k].length < 4e6)) ? req.body[k] : undefined) : String(req.body[k]).slice(0, 300);
  Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k]);
  if (patch.WHATSAPP_NUMBER) patch.WHATSAPP_NUMBER = patch.WHATSAPP_NUMBER.replace(/\D/g, '');
  await db.setConfig(patch); res.json(await publicConfig());
}));

/* trips come from the frontend data file (single source of truth) */
function loadTrips() { const sb = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'assets/js/data.js'), 'utf8'), sb); return sb.window.EC_TRIPS || []; }
app.get('/api/trips', wrap(async (_req, res) => { const counts = await db.countsByTrip(); res.json(loadTrips().map(t => Object.assign({}, t, { bookedLive: t.booked + (counts[t.id] || 0) }))); }));

/* ---------- static frontend ---------- */
app.use(express.static(ROOT, { extensions: ['html'], index: 'index.html', setHeaders(res, p) { if (/\.(js|css)$/.test(p)) res.setHeader('Cache-Control', 'public, max-age=300'); } }));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((_req, res) => res.status(404).sendFile(path.join(ROOT, 'index.html')));

db.init().then(() => app.listen(PORT, () => console.log(`Escape Cartel running on :${PORT} (db: ${db.kind})`))).catch(e => { console.error('DB init failed', e); process.exit(1); });
