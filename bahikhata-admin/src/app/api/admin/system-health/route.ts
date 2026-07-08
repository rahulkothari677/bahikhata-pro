import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/admin-auth'

/**
 * GET /api/admin/system-health
 *
 * Returns:
 * - Database stats (table counts, estimated storage)
 * - AI usage vs budget (monthly cost, % of budget used)
 * - Recent errors from audit log
 * - API response health (from Vercel Analytics — future)
 */

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.error

  try {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    // Table counts
    const [
      userCount, productCount, partyCount, transactionCount,
      paymentCount, settingCount, auditLogCount,
      subscriptionCount, usageTrackingCount,
      featureFlagCount, announcementCount,
    ] = await Promise.all([
      db.user.count().catch(() => 0),
      db.product.count().catch(() => 0),
      db.party.count().catch(() => 0),
      db.transaction.count().catch(() => 0),
      db.payment.count().catch(() => 0),
      db.setting.count().catch(() => 0),
      db.auditLog.count().catch(() => 0),
      db.subscription.count().catch(() => 0),
      db.usageTracking.count().catch(() => 0),
      db.featureFlag.count().catch(() => 0),
      db.announcement.count().catch(() => 0),
    ])

    // AI usage this month (from audit log)
    const aiScansThisMonth = await db.auditLog.count({
      where: {
        action: 'ai.scan_attempt',
        createdAt: { gte: monthStart },
      },
    }).catch(() => 0)

    const voiceParsesThisMonth = await db.auditLog.count({
      where: {
        action: 'ai.voice_attempt',
        createdAt: { gte: monthStart },
      },
    }).catch(() => 0)

    // AI cost calculation
    const COST_PER_SCAN = 0.10 // ₹0.10 per scan
    const COST_PER_VOICE = 0.05 // ₹0.05 per voice parse
    const MONTHLY_AI_BUDGET = 5000 // ₹5000/month budget
    const totalAICost = (aiScansThisMonth * COST_PER_SCAN) + (voiceParsesThisMonth * COST_PER_VOICE)
    const budgetUsedPercent = MONTHLY_AI_BUDGET > 0 ? (totalAICost / MONTHLY_AI_BUDGET) * 100 : 0

    // Recent errors (from audit log — login failures, scan failures)
    const recentErrors = await db.auditLog.findMany({
      where: {
        OR: [
          { action: 'ai.scan_failure' },
          { action: 'auth.login.failure' },
        ],
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // last 24h
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        action: true,
        ip: true,
        metadata: true,
        createdAt: true,
        userId: true,
      },
    }).catch(() => [])

    // Old audit logs count (for cleanup suggestion)
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    const oldAuditLogs = await db.auditLog.count({
      where: { createdAt: { lt: oneYearAgo } },
    }).catch(() => 0)

    // Estimate DB storage (rough — each row ~1KB average)
    const totalRows = userCount + productCount + partyCount + transactionCount +
      paymentCount + settingCount + auditLogCount + subscriptionCount +
      usageTrackingCount + featureFlagCount + announcementCount
    const estimatedStorageKB = totalRows * 1 // ~1KB per row estimate

    return NextResponse.json({
      database: {
        tables: [
          { name: 'Users', count: userCount },
          { name: 'Products', count: productCount },
          { name: 'Parties', count: partyCount },
          { name: 'Transactions', count: transactionCount },
          { name: 'Payments', count: paymentCount },
          { name: 'Settings', count: settingCount },
          { name: 'Audit Logs', count: auditLogCount },
          { name: 'Subscriptions', count: subscriptionCount },
          { name: 'Usage Tracking', count: usageTrackingCount },
          { name: 'Feature Flags', count: featureFlagCount },
          { name: 'Announcements', count: announcementCount },
        ],
        totalRows,
        estimatedStorageKB,
        estimatedStorageReadable: estimatedStorageKB > 1024
          ? `${(estimatedStorageKB / 1024).toFixed(1)} MB`
          : `${estimatedStorageKB} KB`,
      },
      ai: {
        scansThisMonth: aiScansThisMonth,
        voiceParsesThisMonth: voiceParsesThisMonth,
        costThisMonth: totalAICost,
        monthlyBudget: MONTHLY_AI_BUDGET,
        budgetUsedPercent: budgetUsedPercent,
        costPerScan: COST_PER_SCAN,
        costPerVoice: COST_PER_VOICE,
        budgetRemaining: MONTHLY_AI_BUDGET - totalAICost,
        status: budgetUsedPercent > 80 ? 'critical' : budgetUsedPercent > 50 ? 'warning' : 'healthy',
      },
      errors: {
        last24h: recentErrors.length,
        recent: recentErrors.map(e => ({
          action: e.action,
          ip: e.ip,
          time: e.createdAt,
          userId: e.userId,
        })),
      },
      cleanup: {
        oldAuditLogs: oldAuditLogs,
        suggestion: oldAuditLogs > 1000 ? 'Consider cleaning up audit logs older than 1 year' : 'No cleanup needed',
      },
      generatedAt: now.toISOString(),
    })
  } catch (error) {
    console.error('[admin/system-health] Error:', error)
    return NextResponse.json({ error: 'Failed to load system health' }, { status: 500 })
  }
}
