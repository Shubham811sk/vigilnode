# VigilNode — Automated Multi-Protocol Service Availability Telemetry & Live Incident Status Portal

**MCA Capstone Project • Project Owner: Shubham Bind**

VigilNode is a full-stack service monitoring, incident triage, alert dispatch, and public status portal supporting **HTTP, HTTPS, TCP, DNS, and SSL/TLS** probes with real-time WebSocket updates and strict two-role RBAC (`ADMIN` and `READ_ONLY_MAINTAINER`).

---

## Architecture & Environment Adaptation

The original specification outlined FastAPI + PostgreSQL + Redis + Celery/APScheduler. Because this AI Studio runtime provisions **Node.js 22 (Express + Vite + React 19 + WebSockets)** on port `3000` without PostgreSQL, Redis, or Docker daemons pre-installed, VigilNode is engineered as an integrated TypeScript full-stack platform:

- **Backend API & Scheduler**: Express 4 (`server.ts`, `/server/*`) with `ws` WebSocket telemetry hub (`/ws/telemetry`) and a built-in async probe scheduler with concurrency limits and duplicate-check guards.
- **Database Persistence**: `better-sqlite3` (WAL mode + foreign keys) with normalized relational schema (`users`, `monitors`, `monitor_checks`, `incidents`, `incident_notes`, `maintenance_windows`, `maintenance_monitors`, `notification_channels`, `alert_rules`, `notification_logs`, `status_subscribers`, `system_settings`, `audit_logs`).
- **Frontend SPA**: React 19 + TypeScript + Vite + Tailwind CSS v4 + React Router implementing the approved Google Stitch **Obsidian Telemetry** theme across all **11 pages** plus the JWT Login screen.

---

## Implemented Pages

1. **Admin Dashboard (`/`)**: Live KPIs, overall uptime, fleet mix, P50/P95 response charts, protocol distribution, SSL warnings, active incidents, and live probe stream.
2. **Monitor Management (`/monitors`)**: Search, status/protocol filters, sorting, pagination, bulk Pause/Resume/Check/Delete, manual checks, CSV export.
3. **Add / Edit Monitor (`/monitors/new`, `/monitors/:id/edit`)**: Full protocol-specific validation (`HTTP`, `HTTPS`, `TCP`, `DNS`, `SSL`), SSRF guard, and live pre-save **Test Connection**.
4. **Monitor Details (`/monitors/:id`, `/monitor-details`)**: Availability across `24h`/`7d`/`30d`/`90d`, SVG latency trend chart, 90-day daily heartbeat strip, X.509 SSL certificate inspection, Check/Error/Incident tabs, CSV export.
5. **Incident Management (`/incidents`)**: Strict backend-validated lifecycle (`Investigating → Identified → Monitoring → Resolved`), investigation notes, MTTA/MTTR, declare incident modal.
6. **Scheduled Maintenance (`/maintenance`)**: List & UTC calendar grid, alert suppression without deleting check telemetry, start/edit/cancel/delete, CSV export.
7. **Alerts & Integrations (`/alerts`)**: Real **Gmail SMTP** (`nodemailer`), **Telegram Bot API**, **Discord Webhook**, and **Slack Webhook** configuration, real test dispatch, dry-run simulator, alert rules, and delivery logs with retry.
8. **Public Status Page (`/status`)**: Unauthenticated public portal exposing only `is_public = 1` monitors with private targets/IPs stripped, 90-day bars, incidents, maintenance, subscriptions, **Share UI** (Copy Link, Web Share API, WhatsApp, Email), and Admin brand customizer.
9. **Analytics (`/analytics`)**: Rolling `24h`/`7d`/`30d`/`90d` SLA windows, P50/P95 percentiles, protocol breakdown, flapping endpoint detector, CSV export, and printable report.
10. **Settings (`/settings`)**: 7 persistent configuration categories (`General`, `Monitoring Engine`, `Incident Rules`, `Notifications`, `Public Status`, `Security & Auth`, `Data Retention`), Reset to Defaults, and password update.
11. **User Management (`/users`)**: Strict 2-role RBAC (`ADMIN`, `READ_ONLY_MAINTAINER`), CRUD, status toggle, password reset, Last-Admin & Root-Admin protection, and Audit Log CSV export.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment variables (optional overrides)
cp .env.example .env

# 3. Start development server (Express API + WebSockets + Vite on port 3000)
npm run dev

# 4. Run automated test suite
npm test

# 5. Build production frontend & typecheck
npm run build && npm run lint
```

## Demo Operator Credentials (Seeded on First Boot)

- **Administrator (`ADMIN`)**: `shubham.bind@vigilnode.local` / `Admin@1234`
- **Maintainer (`READ_ONLY_MAINTAINER`)**: `maintainer@vigilnode.local` / `Viewer@1234`

> Public Status Portal (`/status`) does not require authentication.

## Docker Deployment

```bash
docker compose up --build -d
```
