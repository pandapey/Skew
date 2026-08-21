# Skew Enterprise Hub

Enterprise Office Management System for **Skew Infotech Pvt. Ltd.** — a premium, SaaS-style dashboard unifying HR, CRM, Projects, Inventory, Finance, Attendance, Leave, Files, Announcements, Reports and Administration.

Built with **React 19 + Vite + Tailwind CSS + Redux Toolkit + React Query** on the frontend, backed by a **Node / Express / MongoDB** API. All data is persisted in MongoDB — there is no placeholder or in-memory data layer.

---

## ✨ Features

- **Role-based auth** (8 roles) with protected routes, JWT auth, forgot/reset password
- **Dashboard** with KPIs, revenue/expense charts, pipeline donut, attendance bars, quick actions, activity feed, weather & meeting widgets
- **15+ modules**: Employees (full CRUD + filters + export), HR, Attendance (check-in/out), Leave (apply/approve), CRM, Projects (Kanban board), Inventory, Finance, Announcements (feed), Files (drag-drop upload), Calendar, Notifications, Reports, Admin panel, Global search, Profile
- **Light / Dark mode**, fully responsive (desktop → mobile)
- **Framer Motion** animations, skeleton loaders, empty/error states, 404/403/500 pages
- **Google Calendar-style Calendar** — Month / Week / Day / Agenda views, category-based "My Calendars" sidebar (Meetings, Tasks, Events, Deadlines, Company Holidays), full event CRUD with recurrence (daily/weekly/monthly/yearly + weekday rules + end date), drag-and-drop rescheduling, task completion toggles, live "now" indicator and a responsive layout (collapsible sidebar on mobile)
- **Announcements / Company Feed** — Google-style feed with Company News, Announcements, Events and Birthdays; pinned posts, likes, nested comments, rich media (images / videos / file attachments), full-text search, category filters, trending tags and a responsive sidebar — all backed by MongoDB CRUD
- Reusable component library (Button, Card, Modal, DataTable, Pagination, Tabs, Dropdown, Badge, Avatar, ConfirmDialog, StatCard, charts…)
- Axios API layer with **interceptors, JWT refresh, retry, global error handling**
- **Real MongoDB persistence** — every record is saved and survives refresh

---

## 🏗 Architecture

```
Browser (React + Vite, :5173)
   │  HTTPS / JSON (Axios, Bearer JWT)
   ▼
Express API  (Node.js, :5000)  ──►  MongoDB  (database: "skew", :27017)
   │  Mongoose ODM
   ▼
MongoDB collections (63) — users, employees, projects, clients, finance, crm, …
```

- **Frontend** talks ONLY to the REST API (`/api/*`). There is no fallback to local or placeholder data.
- **Backend** is required. It connects to MongoDB via `MONGO_URI` and serves all CRUD, auth, seed, indexes, relationships and real-time (Socket.IO) features.
- **Database:** MongoDB — database name **`skew`**.

---

## 📋 Prerequisites

- **Node.js** 18+ (verified on Node 24)
- **MongoDB** 5.0+ — local Community Server or MongoDB Atlas. Local dev uses `mongodb+srv://teammate282024_db_user:tB6s8YoI4vraB045@cluster0.rrxovbt.mongodb.net/Skew?appName=Cluster0`.

---

## ⚙️ Environment Variables

### Server — `server/.env`

Copy `server/.env.example` to `server/.env`:

```
PORT=5000
MONGO_URI=mongodb+srv://teammate282024_db_user:tB6s8YoI4vraB045@cluster0.rrxovbt.mongodb.net/Skew?appName=Cluster0
JWT_SECRET=change_this_to_a_long_random_secret
JWT_REFRESH_SECRET=change_this_to_another_long_random_secret
JWT_EXPIRES_IN=1d
JWT_REFRESH_EXPIRES_IN=7d
CLIENT_URL=http://localhost:5173
# Optional SMTP for password-reset emails (Nodemailer)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
```

Credentials are supplied **only** through `MONGO_URI` / `.env` — nothing is hardcoded in source.

### Client — `client/.env`

Copy `client/.env.example` to `client/.env`:

```
VITE_API_BASE_URL=http://localhost:5000/api
```

The frontend connects only to the real backend; no mode toggle exists.

---

## 🚀 Quick Start (Full Stack)

MERN monorepo — `client/` is the React frontend, `server/` is the Express + MongoDB API. From the repo root:

```bash
npm install            # installs the root orchestrator (concurrently)
npm run install:all    # installs client + server dependencies
npm run seed           # populates MongoDB ("skew") with demo data
npm run dev            # boots client (:5173) + server (:5000) together
```

Open http://localhost:5173 · API on http://localhost:5000

> **MongoDB must be running** before `npm run seed` or `npm run dev`.

### Frontend only

```bash
cd client
npm install
npm run dev
```

Open http://localhost:5173 (requires the backend + MongoDB running).

---

## 🗄 Backend (required)

The app is fully MongoDB-backed — the backend is not optional.

```bash
cd server
npm install
cp .env.example .env      # set MONGO_URI + JWT secrets
npm run seed              # creates the demo users + sample data in "skew"
npm run dev               # http://localhost:5000
```

On startup the server prints:

```
MongoDB Connected
Database Name: skew
Collections Found: 63
Connection Status: connected
Seed Status: ...
Server Status: running on http://localhost:5000
Real-time (Socket.IO) enabled
```

### Seed / reset data

```bash
npm run seed             # clears each collection and repopulates (idempotent)
# or drop the whole database, then re-seed:
mongosh "mongodb+srv://teammate282024_db_user:tB6s8YoI4vraB045@cluster0.rrxovbt.mongodb.net/Skew?appName=Cluster0" --eval "db.dropDatabase()"
```

### Connect to MongoDB

- **Compass:** `mongodb+srv://teammate282024_db_user:tB6s8YoI4vraB045@cluster0.rrxovbt.mongodb.net/Skew?appName=Cluster0`
- **Shell:** `mongosh "mongodb+srv://teammate282024_db_user:tB6s8YoI4vraB045@cluster0.rrxovbt.mongodb.net/Skew?appName=Cluster0"`

---

## 👤 Demo accounts (seeded MongoDB users)

These are **real login accounts stored in the `users` collection**, created by `npm run seed` (passwords bcrypt-hashed). Log in at http://localhost:5173.

| Role        | Email               | Password     |
|-------------|---------------------|--------------|
| Admin       | admin@skew.com      | admin123     |
| Admin       | admin2@skew.com     | admin123     |
| Admin       | admin3@skew.com     | admin123     |
| Manager     | hr@skew.com         | hr123        |
| Manager     | manager@skew.com    | manager123   |
| Manager     | sales@skew.com      | sales123     |
| Manager     | finance@skew.com    | finance123   |
| Employee    | employee@skew.com   | emp123       |
| Client      | client@skew.com     | client123    |
| Client      | client2@skew.com    | client123    |

> ⚠ Change these passwords and the JWT secrets before using this app for anything real.

---

## 🗂 Project Structure

```
skew-enterprise-hub/
├── package.json        # root orchestrator (concurrently) — dev/build/seed scripts
├── client/             # React 19 + Vite frontend
│   ├── index.html
│   ├── vite.config.js  # @ alias → client/src
│   ├── tailwind.config.js · postcss.config.js
│   └── src/
│       ├── api/        # axios client, services, react-query client
│       ├── components/ # ui/ (Button, Card, Modal, DataTable…), charts/, glass/
│       ├── constants/  # roles, nav config
│       ├── features/   # per-module logic — the real module code
│       │               #   (components, constants, schemas): admin, announcements,
│       │               #   attendance, calendar, crm, employees, files, finance,
│       │               #   hr, inventory, leave, notifications, projects, reports
│       ├── hooks/      # useAuth, useDebounce, usePagination, useTheme
│       ├── layouts/    # AuthLayout, DashboardLayout, Sidebar, Navbar
│       ├── pages/      # route-level page wrappers (thin) that compose features/
│       ├── redux/      # store, auth/ui slices (redux-persist)
│       ├── routes/     # router + ProtectedRoute
│       ├── styles/     # tailwind + theme tokens
│       └── utils/      # formatters, csv export
└── server/             # Express + MongoDB API
    └── src/
        ├── config/     # db connection
        ├── controllers/ middleware/ models/ repositories/
        ├── routes/ services/ utils/ validators/ realtime/
        └── seed.js     # generates the full enterprise dataset
```

> The `client/src/data` directory is intentionally absent — the frontend fetches everything from the REST API.

---

## 🎨 Theme

Primary `#2563EB` · Accent `#06B6D4` · Success `#10B981` · Warning `#F59E0B` · Danger `#EF4444` · 16px card radius · soft shadows.

## 📦 Scripts

Run from the repo root:

| Command               | Description                                   |
|-----------------------|-----------------------------------------------|
| `npm run install:all` | Install client + server dependencies          |
| `npm run dev`         | Start client (:5173) + server (:5000)         |
| `npm run dev:client`  | Start only the frontend                       |
| `npm run dev:server`  | Start only the backend                        |
| `npm run build`       | Production build of the client                |
| `npm run start`       | Start the server (production)                 |
| `npm run seed`        | Seed the `skew` database with demo data       |

---

© Skew Infotech Pvt. Ltd.
