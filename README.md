# BulkMailer - Production Bulk Email Sending Platform

A full-featured, production-ready bulk email sending platform built with the PERN stack (PostgreSQL, Express, React, Node.js). Designed for sending school invitation emails at scale with proper deliverability, tracking, and analytics.

## Features

### Email Sending
- **Dual Provider Support** - Switch between Gmail SMTP and AWS SES from the dashboard
- **Throttled Sending** - Configurable emails/sec and emails/hr to avoid spam flags
- **Email Scheduling** - Schedule campaigns for specific date/time with throttled delivery
- **File Attachments** - Attach PDFs, images, documents to campaigns (up to 10 files, 25MB each)
- **Deliverability Headers** - List-Unsubscribe (RFC 8058), Feedback-ID, proper From/Reply-To

### Tracking & Analytics
- **Open Tracking** - 1x1 transparent pixel with cache-busting headers
- **Click Tracking** - Link rewriting with 302 redirects, per-link tracking
- **Bounce Detection** - SMTP error classification + Gmail IMAP bounce checker + AWS SNS webhooks
- **Complaint Handling** - AWS SNS complaint notifications with contact status updates
- **Dashboard** - Real-time stats: send volume, open/click rates, bounce rates, contact health

### Contact Management
- **Contact Lists** - Create multiple lists (e.g., "Goa Schools", "Delhi Schools")
- **CSV Import/Export** - Bulk import with duplicate detection, proper CSV parsing
- **Contact History** - Full event timeline per contact across all campaigns
- **Filtering** - Filter by status, list, send count, search by email/name

### Template Management
- **Monaco Code Editor** - Syntax-highlighted HTML editor with live preview
- **Template Variables** - Handlebars syntax `{{school_name}}`, `{{email}}` with auto-detection
- **Version History** - Browse and restore previous versions
- **Test Email** - Send test before launching campaign

### Campaign Management
- **4-Step Wizard** - Details > Template > Schedule > Review with confirmation dialog
- **Live Progress** - Real-time progress bar during sending with auto-refresh
- **Pause/Resume** - Pause active campaigns and resume later

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Recharts, Monaco Editor |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL 16 |
| Queue | Redis 7, BullMQ |
| Email | Nodemailer (Gmail SMTP), AWS SES SDK v3 |
| Proxy | Nginx |
| CI/CD | GitHub Actions, Docker Compose |

## Quick Start

```bash
# Clone the repo
git clone https://github.com/pulkitpareek18/Bulk-Email-Sender.git
cd Bulk-Email-Sender

# Copy environment file
cp .env.example .env.development

# Start all services (dev mode with hot reload)
docker compose up --build

# Run database migrations
docker compose exec server npx node-pg-migrate up \
  --tsconfig tsconfig.json \
  --migration-file-language ts \
  --migrations-dir src/db/migrations

# Seed admin user
docker compose exec server npx ts-node src/db/seeds/001_admin-user.ts
```

**Access:** http://localhost:5173 | Login: `admin` / `admin123`

## Architecture

```
[Nginx :80/:443]
    ├── [React SPA]          - Dashboard, campaign wizard, template editor
    ├── [Express API :3001]  - REST API with JWT auth
    │       ├── PostgreSQL   - 11 tables with JSONB
    │       └── Redis        - BullMQ job queues
    └── [Tracking]           - Open pixels, click redirects, unsubscribe

[Worker Process]
    ├── Campaign Dispatch    - Loads contacts, enqueues individual sends
    ├── Email Send           - Renders template, injects tracking, sends
    ├── Event Processing     - Processes SNS bounce/complaint webhooks
    ├── Campaign Scheduler   - Checks scheduled campaigns every 60s
    └── Gmail Bounce Checker - Polls inbox via IMAP every 5 min
```

## Deployment

The app auto-deploys to the VPS via GitHub Actions on push to `main`. See `.github/workflows/deploy.yml`.

### DNS Records Required

| Type | Name | Value |
|------|------|-------|
| A | yeb.mail | `<VPS_IP>` |
| TXT | yeb.mail | `v=spf1 include:amazonses.com include:_spf.google.com ~all` |
| TXT | _dmarc.yeb.mail | `v=DMARC1; p=none; rua=mailto:dmarc@intellimix.online` |

## Environment Variables

See [`.env.example`](.env.example) for all configuration options.

## License

Private - All rights reserved.
