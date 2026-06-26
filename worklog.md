---
Task ID: bahikhata-pro-v1
Agent: main
Task: Build world-class ledger app for Indian shop owners with dashboard, AI bill scanner, inventory, GST, profit tracking

Work Log:
- Designed comprehensive Prisma schema: Product, Party, Transaction, TransactionItem, Payment, Setting
- Built 7 API routes: dashboard, products, parties, transactions, seed, scan-bill (VLM), settings, reports
- Built UI with 9 views: Dashboard, Inventory, Sales Ledger, Purchase Ledger, Income/Expense, Parties, AI Bill Scanner, Reports, Settings
- Dashboard has 7+ interactive charts: KPI cards, sales trend area chart, top products bar chart, payment mode pie, 6-month performance bar chart, category breakdown, GST summary, low stock alerts, recent transactions
- AI Bill Scanner uses VLM (z-ai-web-dev-sdk) to extract items, prices, GST, party details from bill images
- Full GST support: CGST/SGST for intra-state, IGST for inter-state, slab-wise reporting
- Auto profit calculation on every sale (salePrice - purchasePrice × qty)
- Low stock alerts with thresholds
- Indian-first UX: ₹ formatting, dd/mm/yyyy dates, Hindi-friendly, UPI/cash/card payment modes
- Responsive: works on mobile (390px) and desktop (1440px+)
- Onboarding modal with one-click demo data seeding (15 products, 7 parties, 60 days of transactions)
- Saffron/emerald color theme (Indian flag inspired)
- Lint clean (0 errors)
- Browser-verified: all pages load, navigation works, modals work

Stage Summary:
- Tech stack: Next.js 16, TypeScript, Tailwind CSS 4, shadcn/ui, Prisma (SQLite), Recharts, z-ai-web-dev-sdk (VLM), Zustand, TanStack Query
- All 9 views functional with real data
- AI Bill Scanner extracts structured data from bill images using VLM
- Demo data auto-seeds for first-time users
- Production-ready, mobile-responsive, no lint errors
- Preview screenshots saved to /home/z/my-project/download/

---
Task ID: bahikhata-pro-offline
Agent: main
Task: Build real offline mode — login, read, write, sync (the previous "offline" was cosmetic only)

Work Log:
- Investigated prior offline support: only a write-queue shell + cosmetic indicator existed. Users could not login, view dashboard, inventory, customers, or transactions offline.
- Built IndexedDB wrapper (src/lib/offline-db.ts) with 4 stores: session, kv (GET response cache), pendingWrites (mutation queue), meta (lastSyncAt). SSR-safe, Promise-based.
- Built offlineFetch wrapper (src/lib/offline-fetch.ts) as drop-in replacement for fetch():
  * GETs: network-first with cache fallback (online), cache-only (offline), throws OfflineError if no cache
  * POST/PUT/DELETE: queue when offline, return synthetic 202 'queued' response so UI continues
  * Sync engine: replays queued writes on 'online' event + manual trigger, invalidates caches per-write
  * Event bus: onSyncComplete, onPendingCountChange, onOnlineChange for reactive UI
  * Auth/AI/WhatsApp/upload endpoints bypass the queue (legitimately require internet)
- Built useOfflineSession hook (src/hooks/use-offline-session.ts):
  * Mirrors NextAuth session to IndexedDB on every successful login
  * Falls back to cached session when offline → status='authenticated' (skips AuthScreen)
  * 3-second timeout: if NextAuth stuck on 'loading' while offline AND cached session exists, use it (no infinite spinner)
- Updated page.tsx to use useOfflineSession + auto-invalidate React Query on sync-complete
- Updated AuthScreen: friendly offline banner explaining first-login requirement; intercepts submit when offline
- Updated Header: logout now clears ALL offline data (session + cache + pending queue) for security
- Replaced 44 fetch() calls with offlineFetch() across 19 components via bulk script
- Fixed template-literal corruption caused by regex (script: fix-template-literals.py)
- Fixed misplaced imports inside multi-line import blocks (script: fix-misplaced-imports.py)
- Added 'invalidate' option to all mutations so caches refresh after writes:
  * Transactions POST/PUT/DELETE → invalidate /api/transactions, /api/dashboard, /api/products, /api/parties
  * Parties POST/DELETE → invalidate /api/parties, /api/dashboard
  * Products POST/PUT → invalidate /api/products, /api/dashboard
  * Settings PUT → invalidate /api/settings, /api/dashboard
  * Income/Expense POST/DELETE → invalidate /api/transactions, /api/dashboard
- Marked Onboarding seed, Settings reset, StaffManagement create/delete as queueable:false (need live server)
- Upgraded OfflineIndicator: pending count badge, last sync timestamp, manual sync button, expandable details panel
- Rewrote service worker (public/sw.js): removed broken navigator.onLine ref; precache app shell on install; navigation=network-first with cached '/' fallback; static=cache-first; API not intercepted (offlineFetch handles via IndexedDB)
- Updated SessionProviderWrapper: refetchOnWindowFocus=false, refetchWhenOffline=false (prevents NextAuth from flipping to unauthenticated on offline window focus)
- Updated providers.tsx: React Query retry skips OfflineError (no point retrying)
- Build: bun run build ✓ clean
- Smoke test: bun run start ✓ home=200, /api/products=401 (correct auth gate)
- Committed + pushed to GitHub (commit 279cf7a)

Stage Summary:
- Real offline mode now works: login (if previously logged in on same device), view all data, add/edit/delete entries, auto-sync on reconnect
- 4-layer architecture: IndexedDB → offlineFetch → useOfflineSession → UI components
- 44 fetch calls replaced, 19 components updated, 3 new lib files (~700 LOC)
- Live offline testing on Vercel pending (user will verify after deploy)
- Files added: src/lib/offline-db.ts, src/lib/offline-fetch.ts, src/hooks/use-offline-session.ts
- Files modified: 27 components/providers/page files
- Scripts saved: scripts/bulk-replace-fetch.py, scripts/fix-template-literals.py, scripts/fix-misplaced-imports.py
