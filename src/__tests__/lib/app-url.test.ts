/**
 * 🔒 A LINK WE SEND A USER MUST POINT AT OUR OWN APP.
 *
 * Found 2026-08-03 by reading a live response, not the code:
 *
 *     "shareUrl": "NEXTAUTH_URL/?ref=RAHUL997"
 *
 * NEXTAUTH_URL's value in the deployment environment is the literal string
 * "NEXTAUTH_URL", and `||` only rejects an EMPTY value — never a wrong one.
 * The fallback behind it was a hardcoded 'https://ekbook-pro.vercel.app',
 * which returns 404 and is not the deployment. On Vercel an unclaimed
 * *.vercel.app name can be registered by anyone, and auth/reset-request used
 * that same fallback for a link carrying a password-reset TOKEN.
 */
import { appUrlFrom } from '@/lib/app-url'

const reqWith = (headers: Record<string, string>) =>
  ({ headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } } as unknown as Request)

describe('appUrlFrom prefers the host that actually served the request', () => {
  test('uses the Origin header when present', () => {
    expect(appUrlFrom(reqWith({ origin: 'https://bahikhata-pro.vercel.app' })))
      .toBe('https://bahikhata-pro.vercel.app')
  })

  test('falls back to forwarded host + proto for clients that send no Origin', () => {
    expect(appUrlFrom(reqWith({ 'x-forwarded-host': 'ekbook.in', 'x-forwarded-proto': 'https' })))
      .toBe('https://ekbook.in')
  })

  test('a trailing slash never doubles up in the built link', () => {
    expect(appUrlFrom(reqWith({ origin: 'https://ekbook.in/' }))).toBe('https://ekbook.in')
  })

  test('localhost stays http so local development works', () => {
    expect(appUrlFrom(reqWith({ host: 'localhost:3000' }))).toBe('http://localhost:3000')
  })
})

describe('a misconfigured env var can never poison a link', () => {
  const saved = { pub: process.env.NEXT_PUBLIC_APP_URL, auth: process.env.NEXTAUTH_URL }
  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = saved.pub
    process.env.NEXTAUTH_URL = saved.auth
  })

  test('the exact production fault: value is the variable NAME', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    process.env.NEXTAUTH_URL = 'NEXTAUTH_URL'
    // Not "NEXTAUTH_URL", and not a hardcoded foreign domain either.
    expect(appUrlFrom(null)).toBeNull()
  })

  test('other non-URL junk is rejected too', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    for (const junk of ['', 'undefined', 'your-domain.com', 'ftp://x.test']) {
      process.env.NEXTAUTH_URL = junk
      expect(appUrlFrom(null)).toBeNull()
    }
  })

  test('a valid env var is still honoured when there is no request', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    process.env.NEXTAUTH_URL = 'https://ekbook.in'
    expect(appUrlFrom(null)).toBe('https://ekbook.in')
  })

  test('a broken env var loses to a good request', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'NEXTAUTH_URL'
    expect(appUrlFrom(reqWith({ origin: 'https://bahikhata-pro.vercel.app' })))
      .toBe('https://bahikhata-pro.vercel.app')
  })
})

describe('callers refuse to send a link they cannot trust', () => {
  const fs = jest.requireActual('fs') as typeof import('fs')
  const path = jest.requireActual('path') as typeof import('path')
  const read = (rel: string) =>
    fs.readFileSync(path.join(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n')

  test('the password-reset link is never built on a guessed host', () => {
    const src = read('src/app/api/auth/reset-request/route.ts')
    expect(src).toMatch(/const origin = appUrlFrom\(req\)/)
    // A reset that never arrives is recoverable; a token sent to the wrong
    // host is not. So it must bail rather than improvise.
    expect(src).toMatch(/if \(!origin\)/)
    expect(src).toMatch(/status: 503/)
  })

  test('no hardcoded foreign domain remains in either caller', () => {
    for (const rel of ['src/app/api/referral/code/route.ts', 'src/app/api/auth/reset-request/route.ts']) {
      const code = read(rel)
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
      expect(code).not.toContain('ekbook-pro.vercel.app')
    }
  })
})
