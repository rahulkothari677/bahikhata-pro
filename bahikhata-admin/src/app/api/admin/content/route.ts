import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-auth'

/**
 * GET /api/admin/content — list all content pages
 * PUT /api/admin/content — update content page
 *   Body: { key, title, content }
 *
 * Content pages stored as FeatureFlag entries with key 'content_KEY'
 * For production, create a dedicated ContentPage model.
 *
 * Default content pages:
 * - help_faq: Help & FAQ
 * - terms: Terms of Service
 * - privacy: Privacy Policy (supplements the /privacy page)
 * - about: About page
 */

// In-memory content store
const contentPages = new Map<string, { key: string, title: string, content: string, updatedAt: string }>([
  ['help_faq', {
    key: 'help_faq',
    title: 'Help & FAQ',
    content: `# Frequently Asked Questions

## How do I create my first sale?
1. Tap "New Sale" (orange button at top right or center of bottom nav)
2. Select products from the list (or search by name/SKU)
3. Choose a customer (optional)
4. Select payment mode (Cash/UPI/Card)
5. Tap "Save Sale"

## How does AI Bill Scanner work?
1. Tap "Scan Bill" 
2. Take a photo of any bill, invoice, or handwritten note
3. Our AI extracts products, prices, and GST automatically
4. Review and save

## Can I use the app offline?
Yes! BahiKhata Pro works completely offline. Your data syncs automatically when you reconnect to the internet.

## How do I export GST returns?
Go to Reports → GSTR-1 Export. Download in CSV format, ready for the GST portal.

## Is my data safe?
Yes. Your data is encrypted, stored securely, and never shared. You can delete all your data anytime from Settings.`,
    updatedAt: new Date().toISOString(),
  }],
  ['terms', {
    key: 'terms',
    title: 'Terms of Service',
    content: `# Terms of Service

## 1. Acceptance
By using BahiKhata Pro, you agree to these terms.

## 2. Service
BahiKhata Pro is a digital ledger application for shop owners in India.

## 3. Your Account
You are responsible for maintaining the security of your account.

## 4. Acceptable Use
You agree not to misuse the service or attempt to access other users' data.

## 5. Privacy
See our Privacy Policy for how we handle your data.

## 6. Subscriptions
Paid plans (Pro, Business) are billed monthly or yearly. Cancel anytime.

## 7. Limitation of Liability
BahiKhata Pro is provided "as is". We are not liable for data loss or business decisions made based on app data.

## 8. Contact
Email: support@bahikhata.pro`,
    updatedAt: new Date().toISOString(),
  }],
])

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  return NextResponse.json({
    pages: Array.from(contentPages.values()),
  })
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    const { key, title, content } = await req.json()

    if (!key || !title || !content) {
      return NextResponse.json({ error: 'key, title, and content required' }, { status: 400 })
    }

    const existing = contentPages.get(key) || { key, title, content, updatedAt: new Date().toISOString() }
    contentPages.set(key, {
      ...existing,
      title,
      content,
      updatedAt: new Date().toISOString(),
    })

    await db.auditLog.create({
      data: {
        userId: auth.userId,
        action: 'admin.content.update',
        entityType: 'content',
        entityId: key,
        metadata: { title },
      },
    }).catch(() => {})

    return NextResponse.json({ success: true, page: contentPages.get(key) })
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export { contentPages }
