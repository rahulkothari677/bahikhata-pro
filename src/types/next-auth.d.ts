import 'next-auth'
import 'next-auth/jwt'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      name?: string | null
      image?: string | null
      role: string
      ownerId: string | null
      permissions: string | null
      tokenVersion: number
      // 🐛 INTEGRATION PHASE D.3: Impersonation flag.
      // true when this session was created via /api/auth/impersonate (admin
      // impersonating a shopkeeper). The UI shows a yellow banner when this
      // is true. signOut() revokes the session.
      isImpersonated?: boolean
      // The admin's email (for the "Impersonating as {adminEmail}" banner).
      impersonatedBy?: string
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    role?: string
    ownerId?: string | null
    permissions?: string | null
    tokenVersion?: number
    // 🐛 INTEGRATION PHASE D.3: Impersonation flag (propagated to session).
    isImpersonated?: boolean
    impersonatedBy?: string
  }
}
