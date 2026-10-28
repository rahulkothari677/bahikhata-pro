import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * #286 (Phase 7h): where a slow first load comes from. Live, the first request after
 * ~20 idle minutes took 12.1 s and every later one 0.3–0.8 s — but from the browser
 * the server code starting and the database waking look the same. This route answers
 * with two numbers only: whether this server instance had already served a request
 * (`warm`), and how long one trivial query took (`dbMs`; a sleeping database shows
 * here). No sign-in and no shop data, so it can be timed from anywhere.
 */
const startedAt = Date.now()
let served = 0

export const dynamic = 'force-dynamic'

export async function GET() {
  const warm = served > 0
  served++
  const t = Date.now()
  let dbOk = true
  try {
    await db.$queryRaw`SELECT 1`
  } catch {
    dbOk = false
  }
  const dbMs = Date.now() - t
  return NextResponse.json(
    { warm, instanceAgeMs: Date.now() - startedAt, dbMs, dbOk },
    { headers: { 'Cache-Control': 'no-store', 'Server-Timing': `db;dur=${dbMs}` } },
  )
}
