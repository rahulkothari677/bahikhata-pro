# BahiKhata Pro — Admin Dashboard

Separate admin app for BahiKhata Pro. Built as a separate Next.js app for security isolation.

## Why Separate App?

- **Security**: If main app is hacked, admin app stays safe
- **Performance**: Admin code doesn't bloat user app bundle
- **Independent scaling**: Admin needs 1 server, user app needs many
- **Different auth**: Admin uses separate NextAuth with shorter sessions (1 hour)
- **IP whitelisting**: Optional IP-based access control

## Setup

### 1. Install dependencies
```bash
cd bahikhata-admin
bun install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env with your values:
# - DATABASE_URL (same Neon DB as main app)
# - NEXTAUTH_SECRET (generate NEW one — different from main app!)
# - ADMIN_EMAILS (comma-separated admin emails)
# - MAIN_APP_URL (link back to user app)
```

### 3. Generate Prisma client
```bash
bunx prisma generate
```

### 4. Run dev server
```bash
bun run dev
# Open http://localhost:3001
```

## Deploy to Vercel

1. Go to https://vercel.com/new
2. Import the `bahikhata-admin` folder (or create separate GitHub repo)
3. Set environment variables (from .env.example)
4. Deploy
5. (Optional) Add custom domain: `admin.bahikhata.pro`

## Security Features

- Only emails in `ADMIN_EMAILS` env var can login
- Session expires in 1 hour (vs 30 days for user app)
- Separate `NEXTAUTH_SECRET` from main app
- All API routes check `requireAdmin()` first
- `robots: noindex` — admin pages never appear in search engines
- Optional IP whitelist (`ALLOWED_IPS` env var)

## Tech Stack

- Next.js 16
- TypeScript
- Tailwind CSS 4
- Prisma (PostgreSQL — same DB as main app, read-only recommended)
- Recharts (dashboard charts)
- NextAuth (separate from user app)
- TanStack Query (data fetching)
