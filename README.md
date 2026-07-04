# 🇮🇳 EkBook — India's Smartest Ledger App

A world-class ledger, inventory & GST management app built specifically for Indian shop owners. Track sales, purchases, profit, taxes & inventory effortlessly — with AI-powered bill scanning.

![EkBook](https://img.shields.io/badge/Built%20for-🇮🇳%20Bharat-saffron)
![Next.js 16](https://img.shields.io/badge/Next.js-16-black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)
![Prisma](https://img.shields.io/badge/Prisma-ORM-indigo)

## ✨ Features

### Core Modules
- **📊 Dashboard** — Visual overview with 7+ interactive charts, KPI cards, smart insights
- **🤖 AI Bill Scanner** — Snap a bill photo, AI extracts items/prices/GST automatically
- **🛒 Sales & Purchase Ledger** — Full-page entry with cascading category → product selection
- **📦 Inventory** — Smart stock cards with low-stock alerts & profit-per-unit preview
- **💰 Income & Expenses** — Track rent, salary, electricity with custom categories & payee info
- **👥 Parties** — Customer/supplier profiles with transaction history & running balances
- **📈 Reports** — P&L, GST slab-wise (GSTR-1 ready), stock valuation, party statements
- **⚙️ Settings** — Shop profile, theme customization, feature toggles

### Smart Features
- **🎨 6 Theme Colors** — Saffron, Emerald, Ocean Blue, Royal Violet, Rose Pink, Teal
- **🌙 Dark Mode** — Full dark theme support
- **⌨️ Keyboard Shortcuts** — N (new), S/I/D/R/A (navigation), Ctrl+K (search), / (focus)
- **🔍 Global Search** — Search products, parties & transactions from anywhere
- **📱 WhatsApp Invoice Sharing** — Send invoices to customers via WhatsApp
- **✨ Smart Insights** — AI-powered alerts for stock-out, dues, margin drops, dead stock
- **🎛️ Feature Toggles** — Turn any feature on/off in Settings
- **📅 Date Range Filters** — Today, Last 7/30 days, This Month/Quarter/Year, Custom
- **🖨️ Print & Download Invoices** — Generate printable HTML invoices

### Indian-First Design
- ₹ formatting with L/Cr compact mode
- Auto CGST/SGST (intra-state) / IGST (inter-state) split
- HSN codes, GST slabs (0/5/12/18/28%)
- UPI/cash/card/bank/credit payment modes
- dd/mm/yyyy date format
- Responsive: works on mobile (390px) → desktop (1440px+)

## 🛠️ Tech Stack

| Category | Technology |
|----------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 + shadcn/ui |
| Database | Prisma ORM (SQLite dev → Postgres prod) |
| Charts | Recharts |
| AI | z-ai-web-dev-sdk (VLM for bill scanning) |
| State | Zustand (persisted) + TanStack Query |
| Icons | Lucide React |
| Animations | Framer Motion |

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ 
- Bun (package manager)

### Installation

```bash
# Clone the repo
git clone https://github.com/rahulkothari677/bahikhata-pro.git
cd bahikhata-pro

# Install dependencies
bun install

# Set up the database
bun run db:push

# Start the dev server
bun run dev
```

Open `http://localhost:3000` and click **"Load Demo Data"** to explore with sample data.

## 📁 Project Structure

```
src/
├── app/
│   ├── api/              # API routes (dashboard, products, transactions, etc.)
│   ├── globals.css       # Theme variables & global styles
│   ├── layout.tsx        # Root layout with providers
│   └── page.tsx          # Main app shell
├── components/
│   ├── common/           # Reusable: DateRangePicker, GlobalSearch, etc.
│   ├── dashboard/        # Dashboard & SmartInsights
│   ├── income/           # Income/Expense module
│   ├── inventory/        # Inventory & ProductDialog
│   ├── layout/           # Sidebar, Header, Onboarding
│   ├── ledger/           # Sales/Purchase Ledger, TransactionDetail, TransactionEntry
│   ├── parties/          # Parties & PartyProfile
│   ├── providers/        # ThemeProvider
│   ├── reports/          # Reports (P&L, GST, Stock, Party)
│   ├── scanner/          # AI Bill Scanner
│   ├── settings/         # Settings & Feature Toggles
│   └── ui/               # shadcn/ui components
├── lib/                  # Utils, db client, seed data
├── store/                # Zustand app store
└── prisma/
    └── schema.prisma     # Database schema
```

## 🎨 Themes

The app supports 6 full theme palettes that change sidebar, buttons, charts & accents together:

| Theme | Description |
|-------|-------------|
| **Saffron** (default) | Warm Indian orange |
| **Emerald** | Fresh green |
| **Ocean Blue** | Professional blue |
| **Royal Violet** | Premium purple |
| **Rose Pink** | Warm pink |
| **Teal Cyan** | Modern teal |

Plus a **Dark Mode** toggle that works with any theme.

## 🔐 Production Deployment

For production, switch from SQLite to PostgreSQL:

1. Update `prisma/schema.prisma`: `provider = "postgresql"`
2. Set `DATABASE_URL` to your Neon/Supabase connection string
3. Run `bun run db:push`
4. Deploy to Vercel

See the [production hardening guide](docs/PRODUCTION.md) for auth, security & scaling.

## 📜 License

MIT License — Built with ❤️ for Bharat

## 🤝 Contributing

This is a personal project. Feel free to fork and customize for your own shop!
