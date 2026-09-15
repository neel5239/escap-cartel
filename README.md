# Escape Cartel

Student travel community website — trips, bookings with UPI payment verification, member accounts, admin panel.

- **Frontend**: static HTML/CSS/JS (no build step)
- **Backend**: Node + Express, JWT auth, bcrypt passwords
- **Database**: Postgres when `DATABASE_URL` is set (Railway), otherwise a JSON file in `./data` for local dev

## Run locally

```bash
npm install
npm start
```

Open http://localhost:8090. Copy `.env.example` to `.env` if you want to set variables locally (or just export them).

## Deploy on Railway

1. Push this repo to GitHub.
2. Railway → **New Project → Deploy from GitHub repo** → pick this repo. Nixpacks detects Node and runs `npm start`.
3. In the same project click **+ New → Database → PostgreSQL**. Railway injects `DATABASE_URL` into the web service automatically (if not, add a variable reference to `${{Postgres.DATABASE_URL}}`).
4. Service → **Variables** → add:

| Variable | Value |
|---|---|
| `JWT_SECRET` | any long random string (keep it secret, never change it casually — logs everyone out) |
| `ADMIN_PIN` | PIN for `/admin.html` |
| `WHATSAPP_NUMBER` | e.g. `919825744110` (optional — also editable from admin panel) |
| `UPI_ID` / `UPI_NAME` | optional overrides |

5. Settings → **Networking → Generate Domain**. Done. Health check: `/api/health`.

Every `git push` redeploys.

## Configure

- Contact / payment details: `assets/js/config.js` (defaults) → overridden by env vars → overridden by whatever you save in **admin.html → Settings** (stored in the DB).
- Upload your own UPI QR photo from admin → Settings. Otherwise the checkout generates a QR from the UPI ID.
- Trips, gallery, reviews, blog posts: `assets/js/data.js`. Edit, commit, push.

## Pages

| Page | What |
|---|---|
| `index.html` | Home |
| `trips.html` | All trips with filters |
| `trip.html?id=…` | Trip detail — hero, timeline itinerary, inclusions, request form |
| `book.html?id=…` | 4-step registration: travellers → review → UPI QR + UTR + screenshot → ticket + WhatsApp confirm |
| `plan.html` | Escape planner |
| `crew.html` | Campus chapter program |
| `about.html`, `blog.html`, `policy.html` | Content |
| `login.html`, `signup.html`, `dashboard.html` | Accounts and bookings |
| `admin.html` | Bookings, requests, occupancy, settings |

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | – | Health check |
| GET | `/api/config` | – | Public config (WhatsApp, UPI, QR…) |
| GET | `/api/trips` | – | Trips with live occupancy |
| GET | `/api/bookings/counts` | – | Seats booked per trip |
| POST | `/api/auth/signup` · `/api/auth/login` | – | Returns JWT |
| GET | `/api/auth/me` | user | Current user |
| POST | `/api/bookings` | optional | Create booking (validates seats, UTR, travellers) |
| GET | `/api/bookings/mine` | user | My bookings |
| POST | `/api/requests` | – | Question from trip page |
| POST | `/api/admin/login` | – | PIN → admin JWT |
| GET | `/api/admin/bookings` · `/requests` · `/config` | admin | Read |
| PATCH | `/api/admin/bookings/:id` | admin | Set status |
| GET | `/api/admin/bookings/:id/shot` | admin | Payment screenshot |
| PUT | `/api/admin/config` | admin | Update settings / QR |
| DELETE | `/api/admin/bookings` · `/users` | admin | Wipe |

If the API is unreachable (e.g. the HTML is opened as a plain file) the frontend falls back to browser storage so it still demos.
