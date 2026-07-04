'use client'

import { useState } from 'react'
import { BookOpenText, ScanLine, Mic, BarChart3, Package, Users, Wallet, FileBarChart, Crown, Check, ArrowRight, Star, Zap, Shield, Smartphone, Wifi, TrendingUp, IndianRupee, Menu, X } from 'lucide-react'

export default function LandingPage() {
  const [email, setEmail] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    // Store email in localStorage for now (will connect to email service later)
    const emails = JSON.parse(localStorage.getItem('bahikhata-waitlist') || '[]')
    emails.push({ email, date: new Date().toISOString() })
    localStorage.setItem('bahikhata-waitlist', JSON.stringify(emails))
    setSubmitted(true)
  }

  return (
    <div className="min-h-screen bg-background">
      {/* ── NAV BAR ─────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-6xl mx-auto px-4 lg:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-saffron flex items-center justify-center">
              <BookOpenText className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg">BahiKhata Pro</span>
          </div>
          <div className="hidden md:flex items-center gap-6">
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground">Features</a>
            <a href="#pricing" className="text-sm text-muted-foreground hover:text-foreground">Pricing</a>
            <a href="#faq" className="text-sm text-muted-foreground hover:text-foreground">FAQ</a>
            <a href="/" className="text-sm font-medium text-primary hover:underline">Open App →</a>
          </div>
          <button className="md:hidden p-2" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="md:hidden border-t border-border px-4 py-3 space-y-3 bg-background">
            <a href="#features" onClick={() => setMenuOpen(false)} className="block text-sm">Features</a>
            <a href="#pricing" onClick={() => setMenuOpen(false)} className="block text-sm">Pricing</a>
            <a href="#faq" onClick={() => setMenuOpen(false)} className="block text-sm">FAQ</a>
            <a href="/" className="block text-sm font-medium text-primary">Open App →</a>
          </div>
        )}
      </nav>

      {/* ── HERO ────────────────────────────────────────────────────── */}
      <section className="pt-32 pb-20 px-4 lg:px-6 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-20 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        </div>
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
            <Zap className="w-4 h-4" />
            India's first AI-powered ledger app
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Run your shop <span className="text-primary">smarter</span>,<br />not harder.
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            BahiKhata Pro is the complete business management app for Indian shop owners.
            AI bill scanning, GST filing, inventory, voice entry — all in one app.
            Works offline. Free to start.
          </p>

          {/* Email capture */}
          {!submitted ? (
            <form onSubmit={handleSubmit} className="flex gap-2 max-w-md mx-auto mb-4">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                required
                className="flex-1 px-4 py-3 rounded-xl border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                type="submit"
                className="px-6 py-3 rounded-xl bg-gradient-saffron text-white font-medium text-sm flex items-center gap-2 hover:opacity-90 transition whitespace-nowrap"
              >
                Get Started
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          ) : (
            <div className="max-w-md mx-auto mb-4 p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400 flex items-center gap-2 justify-center">
                <Check className="w-4 h-4" />
                You're on the list! We'll notify you at launch.
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">No credit card needed. Free forever plan available.</p>

          {/* Trust badges */}
          <div className="flex flex-wrap items-center justify-center gap-6 mt-8 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5"><Wifi className="w-4 h-4 text-emerald-500" /> Works offline</span>
            <span className="flex items-center gap-1.5"><Shield className="w-4 h-4 text-emerald-500" /> Bank-grade security</span>
            <span className="flex items-center gap-1.5"><Smartphone className="w-4 h-4 text-emerald-500" /> Mobile + Desktop</span>
            <span className="flex items-center gap-1.5"><Star className="w-4 h-4 text-amber-500" /> Made in India</span>
          </div>
        </div>
      </section>

      {/* ── FEATURES ────────────────────────────────────────────────── */}
      <section id="features" className="py-20 px-4 lg:px-6 bg-muted/30">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4">Everything your shop needs</h2>
          <p className="text-muted-foreground text-center mb-12 max-w-2xl mx-auto">
            From billing to GST filing, BahiKhata Pro replaces 5+ apps with one smart platform.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard icon={ScanLine} title="AI Bill Scanner" desc="Snap a photo of any bill or handwritten note. Our AI extracts products, prices, and GST automatically. No manual entry." color="text-violet-600 bg-violet-100" />
            <FeatureCard icon={Mic} title="Voice Entry" desc="Just speak: 'Rahul ko 500 rupaye ki Atta bechi.' We create the sale entry automatically. Hindi & English supported." color="text-amber-600 bg-amber-100" />
            <FeatureCard icon={BarChart3} title="Dashboard & Reports" desc="Real-time revenue, profit, top products, low stock alerts. GST summary. All updated instantly." color="text-rose-600 bg-rose-100" />
            <FeatureCard icon={Package} title="Smart Inventory" desc="Track stock levels, get low-stock alerts, auto-calculate stock value. Never run out of products." color="text-blue-600 bg-blue-100" />
            <FeatureCard icon={Users} title="Customer & Supplier Ledger" desc="Track who owes you, who you owe. Send WhatsApp payment reminders. Complete party management." color="text-emerald-600 bg-emerald-100" />
            <FeatureCard icon={FileBarChart} title="GSTR-1 Export" desc="Generate GST returns in portal format. One click export. Stop paying accountants ₹2,000 per quarter." color="text-indigo-600 bg-indigo-100" />
            <FeatureCard icon={Wallet} title="Income & Expense" desc="Track rent, salary, electricity. Know your real profit, not just sales. Category-wise breakdown." color="text-teal-600 bg-teal-100" />
            <FeatureCard icon={Wifi} title="Works Offline" desc="No internet? No problem. Create sales, add products, check inventory — everything works offline. Syncs when online." color="text-cyan-600 bg-cyan-100" />
            <FeatureCard icon={Shield} title="Secure & Private" desc="Your data is encrypted, never sold. DPDP Act compliant. Delete your data anytime. You own your data." color="text-slate-600 bg-slate-100" />
          </div>
        </div>
      </section>

      {/* ── STATS BAND ──────────────────────────────────────────────── */}
      <section className="py-16 px-4 lg:px-6 bg-gradient-saffron">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center text-white">
          <div><p className="text-3xl md:text-4xl font-bold">50M+</p><p className="text-sm text-white/80">Indian shops</p></div>
          <div><p className="text-3xl md:text-4xl font-bold">₹14B</p><p className="text-sm text-white/80">Market size</p></div>
          <div><p className="text-3xl md:text-4xl font-bold">90%</p><p className="text-sm text-white/80">Profit margin</p></div>
          <div><p className="text-3xl md:text-4xl font-bold">₹0</p><p className="text-sm text-white/80">To get started</p></div>
        </div>
      </section>

      {/* ── PRICING ─────────────────────────────────────────────────── */}
      <section id="pricing" className="py-20 px-4 lg:px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4">Simple, honest pricing</h2>
          <p className="text-muted-foreground text-center mb-12">Start free. Upgrade when you grow. Cancel anytime.</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Free */}
            <div className="bg-card rounded-2xl border border-border p-6">
              <h3 className="text-lg font-bold text-slate-600 mb-2">Free</h3>
              <p className="text-3xl font-bold mb-1">₹0</p>
              <p className="text-xs text-muted-foreground mb-4">Free forever</p>
              <a href="/" className="block w-full py-2.5 rounded-lg border border-border text-center text-sm font-medium hover:bg-muted transition">Get Started</a>
              <div className="mt-4 space-y-2 text-sm">
                <PricingItem text="50 transactions/month" />
                <PricingItem text="50 products" />
                <PricingItem text="3 AI bill scans (total)" />
                <PricingItem text="1 shop" />
                <PricingItem text="Basic dashboard" />
              </div>
            </div>

            {/* Pro */}
            <div className="bg-card rounded-2xl border-2 border-primary shadow-lg p-6 relative md:scale-105">
              <div className="absolute top-0 right-0 bg-gradient-saffron text-white text-xs font-bold px-3 py-1 rounded-bl-lg rounded-tr-2xl">POPULAR</div>
              <h3 className="text-lg font-bold text-primary mb-2">Pro</h3>
              <p className="text-3xl font-bold mb-1">₹99<span className="text-sm font-normal text-muted-foreground">/month</span></p>
              <p className="text-xs text-muted-foreground mb-4">or ₹999/year (save 16%)</p>
              <a href="/" className="block w-full py-2.5 rounded-lg bg-gradient-saffron text-white text-center text-sm font-medium hover:opacity-90 transition">Upgrade to Pro</a>
              <div className="mt-4 space-y-2 text-sm">
                <PricingItem text="Unlimited transactions" />
                <PricingItem text="Unlimited products" />
                <PricingItem text="100 AI scans/month" />
                <PricingItem text="Voice entry" />
                <PricingItem text="GSTR-1 export" />
                <PricingItem text="WhatsApp sharing" />
                <PricingItem text="Smart insights" />
              </div>
            </div>

            {/* Business */}
            <div className="bg-card rounded-2xl border border-border p-6">
              <h3 className="text-lg font-bold text-violet-600 mb-2">Business</h3>
              <p className="text-3xl font-bold mb-1">₹299<span className="text-sm font-normal text-muted-foreground">/month</span></p>
              <p className="text-xs text-muted-foreground mb-4">or ₹2,999/year (save 16%)</p>
              <a href="/" className="block w-full py-2.5 rounded-lg border border-border text-center text-sm font-medium hover:bg-muted transition">Upgrade to Business</a>
              <div className="mt-4 space-y-2 text-sm">
                <PricingItem text="Everything in Pro" />
                <PricingItem text="Unlimited AI scans" />
                <PricingItem text="3 shops" />
                <PricingItem text="5 staff accounts" />
                <PricingItem text="Advanced reports" />
                <PricingItem text="Priority support" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────────── */}
      <section id="faq" className="py-20 px-4 lg:px-6 bg-muted/30">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">Frequently Asked Questions</h2>
          <div className="space-y-6">
            <FAQItem q="Is BahiKhata Pro really free?" a="Yes! The Free plan is free forever — 50 transactions/month, 50 products, 3 AI scans. No credit card needed. Upgrade to Pro only when you need more." />
            <FAQItem q="Does it work without internet?" a="Yes! BahiKhata Pro works completely offline. You can create sales, add products, check inventory — everything works without internet. Data syncs automatically when you reconnect." />
            <FAQItem q="Is my data safe?" a="Absolutely. Your data is encrypted, stored securely on cloud servers, and never sold. We comply with India's DPDP Act 2023. You can delete all your data anytime from Settings." />
            <FAQItem q="Can I use it on my phone and computer?" a="Yes! BahiKhata Pro works on any device — mobile, tablet, desktop. It's a Progressive Web App (PWA), so you can install it on your phone like a native app." />
            <FAQItem q="Do I need to know accounting?" a="No! BahiKhata Pro is designed for shop owners, not accountants. Just record your sales and purchases — we handle the math, GST, profit calculation, and reports automatically." />
            <FAQItem q="What if I need help?" a="We're here for you. Email us at support@bahikhata.pro, and we'll respond within 24 hours. Pro and Business plan users get priority support." />
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────── */}
      <section className="py-20 px-4 lg:px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to digitize your shop?</h2>
          <p className="text-muted-foreground mb-8">Join thousands of Indian shop owners growing their business with BahiKhata Pro.</p>
          <a href="/" className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-gradient-saffron text-white font-bold text-lg hover:opacity-90 transition shadow-lg">
            Start Free Now
            <ArrowRight className="w-5 h-5" />
          </a>
          <p className="text-xs text-muted-foreground mt-4">No credit card. Free forever plan. 2-minute setup.</p>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────── */}
      <footer className="border-t border-border py-8 px-4 lg:px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-saffron flex items-center justify-center">
              <BookOpenText className="w-4 h-4 text-white" />
            </div>
            <span className="font-medium">BahiKhata Pro</span>
          </div>
          <div className="flex gap-6">
            <a href="/privacy" className="hover:text-foreground">Privacy Policy</a>
            <a href="/" className="hover:text-foreground">Open App</a>
            <a href="mailto:support@bahikhata.pro" className="hover:text-foreground">Contact</a>
          </div>
          <p>Made with love for Bharat</p>
        </div>
      </footer>
    </div>
  )
}

// ─── Helper Components ────────────────────────────────────────────────

function FeatureCard({ icon: Icon, title, desc, color }: any) {
  return (
    <div className="bg-card rounded-2xl border border-border p-6 hover:shadow-lg transition">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color} mb-4`}>
        <Icon className="w-6 h-6" />
      </div>
      <h3 className="font-bold text-lg mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  )
}

function PricingItem({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2">
      <Check className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
      <span>{text}</span>
    </div>
  )
}

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full p-4 flex items-center justify-between text-left"
      >
        <span className="font-medium">{q}</span>
        <span className="text-muted-foreground text-xl">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed">
          {a}
        </div>
      )}
    </div>
  )
}
