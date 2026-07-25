import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'

/**
 * GET /api/impersonate?token=<raw-token>
 *
 * 🐛 INTEGRATION PHASE D.3 (2026-07-25): Impersonation consumer endpoint.
 *
 * The separate bahikhata-admin app's POST /api/admin/impersonate endpoint
 * generates a 32-byte random token, stores its SHA-256 hash in the
 * ImpersonationToken table (shared DB), and returns a URL to this endpoint
 * with the raw token as a query param. The admin clicks the URL → their
 * browser navigates here → this endpoint:
 *
 *   1. Validates the token (SHA-256 hash lookup in ImpersonationToken table)
 *   2. Checks expiry (expiresAt > now)
 *   3. Checks single-use (usedAt IS NULL)
 *   4. Marks the token as used (usedAt = now()) — atomic, so a concurrent
 *      request can't redeem the same token twice
 *   5. Looks up the target user (targetUserId)
 *   6. Creates a NextAuth session for the target user with isImpersonated=true
 *   7. Redirects to / (dashboard) with the impersonated session active
 *
 * 🐛 ROUTING NOTE: This route is at /api/impersonate (NOT /api/auth/impersonate)
 * because the /api/auth/[...nextauth] catch-all in the main app captures ALL
 * /api/auth/* paths and would intercept a route at /api/auth/impersonate.
 * Moving to /api/impersonate avoids the catch-all while keeping the token-in-URL
 * security properties (single-use, 5-min expiry, 256-bit, HTTPS-only).
 *
 * SECURITY:
 *   - Token is 32 random bytes (256 bits) — unguessable
 *   - Only the hash is stored in the DB — DB compromise doesn't reveal tokens
 *   - 5-minute expiry (set by admin app)
 *   - Single-use (usedAt) — a redeemed token can't be replayed
 *   - Session is marked isImpersonated=true so the UI shows a yellow banner
 *   - The banner's "Exit" button calls signOut() → session revoked
 *   - All actions taken while impersonating are logged to AuditLog with the
 *     real user's id (the impersonated user) + the admin's email in metadata
 *
 * WHY GET (not POST):
 *   The admin app returns a URL that the admin clicks. Browsers navigate via
 *   GET. We can't use POST because the admin can't submit a form to a
 *   different origin without a CSRF token flow. The token-in-URL approach is
 *   safe because:
 *     - The token is single-use (replay impossible)
 *     - The token expires in 5 minutes
 *     - The token is 256 bits (unguessable)
 *     - The URL is only shown to the founder (admin app's UI)
 *     - HTTPS prevents interception
 *   After redemption, the token is useless (usedAt is set).
 *
 * See: download/Integration-Plan-BahiKhata-Pro-Admin.md (Phase D.3)
 */

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const rawToken = url.searchParams.get('token')

    if (!rawToken) {
      return NextResponse.json(
        { error: 'Missing token', message: 'No impersonation token provided.' },
        { status: 400 },
      )
    }

    // Hash the raw token to look it up in the DB.
    // We NEVER store the raw token — only its SHA-256 hash.
    const crypto = await import('crypto')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')

    // Look up the token. We need:
    //   - The row exists (valid token hash)
    //   - usedAt IS NULL (not yet redeemed — single-use)
    //   - expiresAt > now (not expired)
    // We do the usedAt check + update atomically (below) to prevent a race
    // where two concurrent requests both see usedAt IS NULL and both redeem.
    const tokenRow = await db.impersonationToken.findUnique({
      where: { tokenHash },
    })

    if (!tokenRow) {
      return NextResponse.json(
        { error: 'Invalid token', message: 'This impersonation link is not valid.' },
        { status: 404 },
      )
    }

    // Check expiry
    if (tokenRow.expiresAt < new Date()) {
      return NextResponse.json(
        {
          error: 'Token expired',
          message: 'This impersonation link has expired (5-minute window). Please request a new one from the admin panel.',
        },
        { status: 410 }, // 410 Gone — token existed but is no longer usable
      )
    }

    // Check single-use (defensive — the atomic update below is the real
    // enforcement, but this gives a clearer error if there's a race)
    if (tokenRow.usedAt) {
      return NextResponse.json(
        {
          error: 'Token already used',
          message: 'This impersonation link has already been redeemed. Please request a new one from the admin panel.',
        },
        { status: 410 },
      )
    }

    // 🔒 ATOMIC SINGLE-USE: Mark the token as used. The WHERE clause ensures
    // only one concurrent request can succeed — if two requests race, the
    // second's updateMany will affect 0 rows (because usedAt is no longer
    // null) and we'll detect it.
    const updateResult = await db.impersonationToken.updateMany({
      where: { tokenHash, usedAt: null },
      data: { usedAt: new Date() },
    })

    if (updateResult.count === 0) {
      // Race condition: another request redeemed this token between our
      // read and our update. Treat as already-used.
      return NextResponse.json(
        {
          error: 'Token already used',
          message: 'This impersonation link was redeemed by another request. Please request a new one.',
        },
        { status: 410 },
      )
    }

    // Look up the target user (the shopkeeper being impersonated).
    const targetUser = await db.user.findUnique({
      where: { id: tokenRow.targetUserId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        ownerId: true,
        permissions: true,
        tokenVersion: true,
      },
    })

    if (!targetUser) {
      // The target user was deleted between token creation and redemption.
      return NextResponse.json(
        {
          error: 'Target user not found',
          message: 'The user you are trying to impersonate no longer exists.',
        },
        { status: 404 },
      )
    }

    // Create a NextAuth session for the target user.
    // We use the JWT callback's "initial login" path by passing a `user`
    // object — but we need to set isImpersonated=true + impersonatedBy.
    // The cleanest way: encode a signed JWT directly with the impersonation
    // flag set, then redirect. NextAuth's jwt callback will see the flag
    // on subsequent requests and propagate it to the session.
    //
    // We use the same NEXTAUTH_SECRET to sign the JWT, so it's valid for
    // NextAuth's session callback.
    const { encode } = await import('next-auth/jwt')
    const jwtToken = await encode({
      token: {
        id: targetUser.id,
        email: targetUser.email,
        name: targetUser.name,
        role: targetUser.role || 'owner',
        ownerId: targetUser.ownerId,
        // permissions is Json? in Prisma, but the JWT type expects string | null.
        // The existing authorize() in src/lib/auth.ts handles this the same way
        // (casts via `as any` when returning the user object). We do the same.
        permissions: (targetUser.permissions as any) ?? null,
        tokenVersion: targetUser.tokenVersion,
        lastVersionCheck: Date.now(),
        // 🐛 INTEGRATION PHASE D.3: impersonation flags
        isImpersonated: true,
        impersonatedBy: tokenRow.adminEmail,
      },
      secret: process.env.NEXTAUTH_SECRET!,
    })

    // Log the impersonation start to the main app's AuditLog.
    try {
      await logAudit({
        userId: targetUser.id,
        action: 'impersonate_session_started',
        entityType: 'user',
        entityId: targetUser.id,
        req,
        metadata: {
          adminEmail: tokenRow.adminEmail,
          adminId: tokenRow.adminId,
          tokenHash, // for correlation with the admin app's AdminAction log
          targetUserEmail: targetUser.email,
          targetUserName: targetUser.name,
        },
      })
    } catch (auditError) {
      // Non-critical — the impersonation should still proceed even if the
      // audit log write fails. The admin app's AdminAction log is the
      // primary audit trail; this is a secondary one.
      console.error('[impersonate] Failed to log audit event:', auditError)
    }

    // Set the session cookie and redirect to the dashboard.
    // The cookie name is the NextAuth default
    // (`next-auth.session-token` in dev, `__Secure-next-auth.session-token`
    // in prod). We set it with the same options NextAuth would use.
    const isProduction = process.env.NODE_ENV === 'production'
    const cookieName = isProduction
      ? '__Secure-next-auth.session-token'
      : 'next-auth.session-token'

    const redirectUrl = new URL('/', url.origin)
    const response = NextResponse.redirect(redirectUrl)

    response.cookies.set({
      name: cookieName,
      value: jwtToken,
      httpOnly: true,
      sameSite: 'lax',
      secure: isProduction,
      path: '/',
      // Impersonated sessions expire in 1 hour (vs 7 days for normal
      // sessions). This limits the blast radius if an admin forgets to
      // exit. The admin can always start a new impersonation if needed.
      maxAge: 60 * 60, // 1 hour
    })

    return response
  } catch (error) {
    console.error('[impersonate] Error:', error)
    return NextResponse.json(
      { error: 'Impersonation failed', message: 'An unexpected error occurred. Please try again or contact support.' },
      { status: 500 },
    )
  }
}
