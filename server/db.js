/* ============================================================
   Data layer — Postgres when DATABASE_URL is set (Railway),
   otherwise a JSON file at DATA_DIR/db.json for local dev.
   ============================================================ */
const fs = require('fs');
const path = require('path');

const uid = (p) => p + Date.now().toString(36).toUpperCase().slice(-5) + Math.random().toString(36).slice(2, 5).toUpperCase();

/* ---------------- JSON file backend ---------------- */
function jsonBackend() {
  const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  const file = path.join(dir, 'db.json');
  fs.mkdirSync(dir, { recursive: true });
  let db = { users: [], bookings: [], requests: [], config: {} };
  try { db = Object.assign(db, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) { /* fresh */ }
  const save = () => fs.writeFileSync(file, JSON.stringify(db, null, 2));
  return {
    kind: 'json',
    async init() {},
    async getUserByEmail(email) { return db.users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null; },
    async getUser(id) { return db.users.find(u => u.id === id) || null; },
    async createUser(u) { u.id = uid('U'); u.created = new Date().toISOString(); db.users.push(u); save(); return u; },
    async clearUsers() { db.users = []; save(); },
    async createBooking(b) { b.id = b.id || uid('EC-'); b.created = new Date().toISOString(); db.bookings.unshift(b); save(); return b; },
    async listBookings(where) { return db.bookings.filter(b => Object.entries(where || {}).every(([k, v]) => b[k] === v)); },
    async getBooking(id) { return db.bookings.find(b => b.id === id) || null; },
    async updateBooking(id, patch) { const b = db.bookings.find(x => x.id === id); if (!b) return null; Object.assign(b, patch); save(); return b; },
    async countsByTrip() { const c = {}; db.bookings.filter(b => b.status !== 'cancelled').forEach(b => { c[b.tripId] = (c[b.tripId] || 0) + b.seats; }); return c; },
    async clearBookings() { db.bookings = []; save(); },
    async createRequest(r) { r.id = uid('R'); r.created = new Date().toISOString(); db.requests.unshift(r); save(); return r; },
    async listRequests() { return db.requests; },
    async getConfig() { return db.config; },
    async setConfig(patch) { Object.assign(db.config, patch); save(); return db.config; }
  };
}

/* ---------------- Postgres backend ---------------- */
function pgBackend(url) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  const q = (sql, params) => pool.query(sql, params);
  const row = (r) => r.rows[0] || null;
  const ub = (r) => r && Object.assign({}, r.data, { id: r.id, created: r.created });
  return {
    kind: 'postgres',
    async init() {
      await q(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, data JSONB NOT NULL, created TIMESTAMPTZ DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS bookings (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL, user_id TEXT, email TEXT, status TEXT NOT NULL DEFAULT 'pending', seats INT NOT NULL DEFAULT 1, data JSONB NOT NULL, created TIMESTAMPTZ DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, data JSONB NOT NULL, created TIMESTAMPTZ DEFAULT now())`);
      await q(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value JSONB)`);
    },
    async getUserByEmail(email) { return ub(row(await q(`SELECT * FROM users WHERE lower(email)=lower($1)`, [email]))); },
    async getUser(id) { return ub(row(await q(`SELECT * FROM users WHERE id=$1`, [id]))); },
    async createUser(u) { u.id = uid('U'); await q(`INSERT INTO users (id,email,data) VALUES ($1,$2,$3)`, [u.id, u.email, u]); return this.getUser(u.id); },
    async clearUsers() { await q(`DELETE FROM users`); },
    async createBooking(b) { b.id = b.id || uid('EC-'); await q(`INSERT INTO bookings (id,trip_id,user_id,email,status,seats,data) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [b.id, b.tripId, b.userId || null, (b.email || '').toLowerCase(), b.status || 'pending', b.seats || 1, b]); return this.getBooking(b.id); },
    async listBookings(where) {
      const map = { userId: 'user_id', email: 'email', tripId: 'trip_id', status: 'status' };
      const keys = Object.keys(where || {}), vals = keys.map(k => where[k]);
      const sql = `SELECT * FROM bookings ${keys.length ? 'WHERE ' + keys.map((k, i) => `${map[k] || k}=$${i + 1}`).join(' AND ') : ''} ORDER BY created DESC`;
      return (await q(sql, vals)).rows.map(ub);
    },
    async getBooking(id) { return ub(row(await q(`SELECT * FROM bookings WHERE id=$1`, [id]))); },
    async updateBooking(id, patch) {
      const cur = await this.getBooking(id); if (!cur) return null;
      const next = Object.assign({}, cur, patch); delete next.created;
      await q(`UPDATE bookings SET status=$2, seats=$3, data=$4 WHERE id=$1`, [id, next.status, next.seats, next]);
      return this.getBooking(id);
    },
    async countsByTrip() { const c = {}; (await q(`SELECT trip_id, SUM(seats)::int AS n FROM bookings WHERE status<>'cancelled' GROUP BY trip_id`)).rows.forEach(r => c[r.trip_id] = r.n); return c; },
    async clearBookings() { await q(`DELETE FROM bookings`); },
    async createRequest(r) { r.id = uid('R'); await q(`INSERT INTO requests (id,data) VALUES ($1,$2)`, [r.id, r]); return r; },
    async listRequests() { return (await q(`SELECT * FROM requests ORDER BY created DESC LIMIT 500`)).rows.map(ub); },
    async getConfig() { const o = {}; (await q(`SELECT key,value FROM config`)).rows.forEach(r => o[r.key] = r.value); return o; },
    async setConfig(patch) { for (const [k, v] of Object.entries(patch)) await q(`INSERT INTO config (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [k, JSON.stringify(v)]); return this.getConfig(); }
  };
}

module.exports = process.env.DATABASE_URL ? pgBackend(process.env.DATABASE_URL) : jsonBackend();
