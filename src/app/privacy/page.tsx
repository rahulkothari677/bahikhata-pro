import { Metadata } from 'next'
import { Shield, Lock, Eye, Download, Trash2, FileText } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Privacy Policy — EkBook',
  description: 'How EkBook collects, uses, and protects your data.',
}

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8 lg:py-12">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex w-16 h-16 rounded-2xl bg-gradient-saffron items-center justify-center shadow-lg mb-4">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Last updated: June 2026 · Effective immediately
          </p>
        </div>

        {/* Quick Summary */}
        <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 rounded-2xl p-6 mb-8">
          <h2 className="font-bold text-emerald-900 dark:text-emerald-400 mb-3 flex items-center gap-2">
            <Lock className="w-5 h-5" /> Quick Summary (TL;DR)
          </h2>
          <ul className="space-y-2 text-sm text-emerald-800 dark:text-emerald-300">
            <li>✓ We collect <b>anonymous usage data</b> (which features you use)</li>
            <li>✓ We <b>never sell</b> your data to anyone</li>
            <li>✓ Your business data (transactions, customers) is <b>encrypted and private</b></li>
            <li>✓ You can <b>delete all your data</b> anytime from Settings</li>
            <li>✓ You can <b>download all your data</b> anytime (DPDP Act right)</li>
            <li>✓ We comply with <b>India's DPDP Act 2023</b> and GDPR</li>
          </ul>
        </div>

        <Section icon={Eye} title="1. What Data We Collect" color="text-blue-600 bg-blue-100">
          <p className="mb-3"><b>Anonymous Usage Data (with your consent):</b></p>
          <ul className="list-disc list-inside space-y-1 mb-4 text-sm">
            <li>Which features you use (sales, purchases, AI scans, reports)</li>
            <li>How often you use each feature</li>
            <li>App performance metrics (load time, errors, crashes)</li>
            <li>Your state/region (state-level only, NOT GPS)</li>
            <li>Device type (phone model, OS version — not personal identifiers)</li>
            <li>Signup source (organic, referral, advertisement)</li>
          </ul>
          <p className="mb-3"><b>Your Business Data (necessary for app function):</b></p>
          <ul className="list-disc list-inside space-y-1 text-sm">
            <li>Shop profile (name, owner name, GSTIN, address, phone)</li>
            <li>Products, inventory, and stock levels</li>
            <li>Customers and suppliers (names, phones, balances)</li>
            <li>Transactions (sales, purchases, income, expenses)</li>
            <li>Bill images uploaded for AI scanning (stored on Cloudinary)</li>
          </ul>
          <p className="text-sm mt-2 text-muted-foreground">
            This data is <b>encrypted at rest</b> (Neon PostgreSQL) and <b>in transit</b> (HTTPS/TLS).
            Only you can see your business data — it is never shared with other users.
          </p>
        </Section>

        <Section icon={Lock} title="2. What We NEVER Collect" color="text-rose-600 bg-rose-100">
          <ul className="list-disc list-inside space-y-1 text-sm">
            <li>Your GPS location (only state-level from IP)</li>
            <li>Your phone contacts</li>
            <li>Your browsing history outside the app</li>
            <li>Your customers' personal data (we store what you enter, but don't analyze it)</li>
            <li>Biometric data (fingerprint, face)</li>
            <li>SMS or call logs</li>
            <li>Personal data from other apps</li>
          </ul>
        </Section>

        <Section icon={FileText} title="3. How We Use Your Data" color="text-amber-600 bg-amber-100">
          <p className="mb-2"><b>Anonymous usage data is used to:</b></p>
          <ul className="list-disc list-inside space-y-1 mb-3 text-sm">
            <li>Understand which features are popular (prioritize improvements)</li>
            <li>Identify and fix bugs faster</li>
            <li>Measure app performance and optimize speed</li>
            <li>Track aggregate business metrics (total users, retention)</li>
          </ul>
          <p className="mb-2"><b>Your business data is used to:</b></p>
          <ul className="list-disc list-inside space-y-1 text-sm">
            <li>Display your dashboard, inventory, and reports</li>
            <li>Process AI bill scanning (sent to Groq for OCR, result returned)</li>
            <li>Generate GST reports and invoices</li>
            <li>Sync across your devices (when you log in elsewhere)</li>
          </ul>
        </Section>

        <Section icon={Eye} title="4. Who We Share Data With" color="text-violet-600 bg-violet-100">
          <p className="mb-3 text-sm">We <b>never sell</b> your data. We share only with these service providers (all GDPR/DPDP compliant):</p>
          <ul className="list-disc list-inside space-y-1 text-sm">
            <li><b>Neon (Database):</b> Stores your business data (encrypted)</li>
            <li><b>Vercel (Hosting):</b> Hosts the app and API</li>
            <li><b>Cloudinary (Images):</b> Stores bill images you upload</li>
            <li><b>Groq (AI):</b> Processes bill images for OCR (images deleted after processing)</li>
            <li><b>PostHog (Analytics):</b> Anonymous usage data only (with consent)</li>
            <li><b>Razorpay (Future):</b> Payment processing for subscriptions</li>
          </ul>
          <p className="text-sm mt-3 text-muted-foreground">
            We may share data with law enforcement <b>only if legally compelled</b> by a valid court order.
          </p>
        </Section>

        <Section icon={Download} title="5. Your Rights (DPDP Act + GDPR)" color="text-emerald-600 bg-emerald-100">
          <p className="mb-3 text-sm">Under India's DPDP Act 2023 and EU GDPR, you have these rights:</p>
          <ul className="list-disc list-inside space-y-1 text-sm">
            <li><b>Right to Access:</b> Download all your data anytime from Settings → Data Export</li>
            <li><b>Right to Deletion:</b> Delete your account and all data from Settings → Delete Account</li>
            <li><b>Right to Rectification:</b> Edit any incorrect data from Settings</li>
            <li><b>Right to Opt-Out:</b> Disable analytics tracking from Settings → Privacy</li>
            <li><b>Right to Data Portability:</b> Export data in JSON/CSV format</li>
            <li><b>Right to Withdraw Consent:</b> Revoke analytics consent anytime</li>
          </ul>
          <p className="text-sm mt-3">
            To exercise any right, email: <a href="mailto:privacy@ekbook.app" className="text-primary underline">privacy@ekbook.app</a>
          </p>
        </Section>

        <Section icon={Trash2} title="6. Data Retention" color="text-slate-600 bg-slate-100">
          <ul className="list-disc list-inside space-y-1 text-sm">
            <li><b>Active accounts:</b> Data kept until you delete it</li>
            <li><b>Deleted accounts:</b> All data permanently erased within 30 days</li>
            <li><b>Inactive accounts (no login for 24 months):</b> Data archived, then deleted</li>
            <li><b>Bill images:</b> Kept until transaction is deleted</li>
            <li><b>Analytics data:</b> Aggregated after 13 months, raw data deleted</li>
            <li><b>Audit logs:</b> Kept for 7 years (tax compliance requirement)</li>
          </ul>
        </Section>

        <Section icon={Shield} title="7. Security Measures" color="text-blue-600 bg-blue-100">
          <ul className="list-disc list-inside space-y-1 text-sm">
            <li>Passwords hashed with bcrypt (never stored in plain text)</li>
            <li>HTTPS/TLS encryption for all data in transit</li>
            <li>Database encryption at rest (Neon PostgreSQL)</li>
            <li>Rate limiting on authentication endpoints</li>
            <li>CSRF protection on all mutations</li>
            <li>Security headers (CSP, HSTS, X-Frame-Options)</li>
            <li>Weekly automated vulnerability scanning</li>
            <li>Multi-tenant data isolation (each user's data is separate)</li>
          </ul>
        </Section>

        <div className="bg-muted/50 rounded-2xl p-6 mt-8 text-center">
          <h2 className="font-bold mb-2">Questions about privacy?</h2>
          <p className="text-sm text-muted-foreground mb-3">
            We're here to help. Reach out anytime.
          </p>
          <a
            href="mailto:privacy@ekbook.app"
            className="inline-flex items-center gap-2 text-primary font-medium hover:underline"
          >
            privacy@ekbook.app
          </a>
          <p className="text-xs text-muted-foreground mt-4">
            Data Protection Officer: Rahul Kothari<br/>
            Response time: within 7 business days
          </p>
        </div>

        <div className="text-center mt-8 text-xs text-muted-foreground">
          <p>© 2026 EkBook. Made with love for Bharat.</p>
          <p className="mt-1">This policy may be updated. Users will be notified 30 days before changes take effect.</p>
        </div>
      </div>
    </div>
  )
}

function Section({ icon: Icon, title, color, children }: {
  icon: any
  title: string
  color: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-6">
      <h2 className="flex items-center gap-2 text-lg font-bold mb-3">
        <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5" />
        </span>
        {title}
      </h2>
      <div className="pl-10 text-foreground">{children}</div>
    </div>
  )
}
