// 🔒 V21-009: NextAuth type augmentation — adds `id` to the session user.
// Without this, `session.user.id` fails TypeScript checks because the
// default NextAuth Session user type only has name, email, and image.
// The admin auth callback sets session.user.id = token.id (auth.ts:123),
// but TypeScript doesn't know about it without this declaration.

import { DefaultSession } from 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string
  }
}
