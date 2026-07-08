#!/usr/bin/env node
/**
 * warmup-neon.mjs
 *
 * TCP-probes the Neon database host:port until it accepts a connection.
 * Used by migrate-with-retry.sh BEFORE running `prisma migrate deploy`.
 *
 * WHY: Neon's free tier auto-pauses the compute after 5 min of inactivity.
 * The first inbound TCP packet triggers the wake-up, but the wake itself
 * can take 20-40 seconds (sometimes longer if the project hasn't been
 * touched in days). Prisma's own connection timeout is shorter than that,
 * so `prisma migrate deploy` fails with P1001 before Neon finishes waking.
 *
 * This script decouples the wake-up from the migration:
 *   1. Parse the host:port from DATABASE_URL (or DIRECT_URL if set).
 *   2. Open a TCP socket, retry every 5s for up to 90s.
 *   3. Exit 0 on first successful connect (Neon is now warm).
 *   4. Exit 1 if no connect after 90s — caller will still try migrate
 *      and let its own retry loop handle the rest. We don't fail the
 *      build here; we just tried to give Neon a head start.
 *
 * No external dependencies (pure Node net module). Works on Vercel's
 * build image (Node 20+).
 *
 * Usage:
 *   node scripts/warmup-neon.mjs
 *
 * Exit codes:
 *   0 — TCP connect succeeded (Neon is awake)
 *   1 — TCP connect never succeeded within timeout (caller should still
 *       try migrate — its own retry loop may catch Neon mid-wake)
 *   2 — Config error (no DATABASE_URL / DIRECT_URL set, or URL malformed)
 */

import net from 'node:net'
import { URL } from 'node:url'

const TOTAL_TIMEOUT_MS = 90_000   // 90s total budget
const PROBE_INTERVAL_MS = 5_000   // try every 5s
const CONNECT_TIMEOUT_MS = 4_000  // each TCP connect attempt times out after 4s

function parseHostPort(envVarName, connStr) {
  if (!connStr) return null
  try {
    // Postgres URLs are postgresql://user:pass@host:port/db?params
    // The WHATWG URL parser handles this if we use the postgres protocol.
    const u = new URL(connStr)
    const host = u.hostname
    const port = u.port || '5432'
    if (!host) return null
    return { host, port: Number(port), source: envVarName }
  } catch {
    return null
  }
}

function tryConnect(host, port) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const cleanup = (ok) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(CONNECT_TIMEOUT_MS)
    socket.once('connect', () => cleanup(true))
    socket.once('timeout', () => cleanup(false))
    socket.once('error', () => cleanup(false))
    socket.connect(port, host)
  })
}

async function probe(host, port, label) {
  const start = Date.now()
  let attempt = 0
  while (Date.now() - start < TOTAL_TIMEOUT_MS) {
    attempt++
    const ok = await tryConnect(host, port)
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    if (ok) {
      console.log(`[warmup-neon] ✅ TCP connect to ${host}:${port} succeeded on attempt ${attempt} (${elapsed}s) — Neon is awake.`)
      return true
    }
    process.stdout.write(`[warmup-neon] attempt ${attempt} failed (${elapsed}s) — retrying in ${PROBE_INTERVAL_MS / 1000}s...\n`)
    await new Promise((r) => setTimeout(r, PROBE_INTERVAL_MS))
  }
  console.error(`[warmup-neon] ❌ Could not reach ${host}:${port} (${label}) within ${TOTAL_TIMEOUT_MS / 1000}s.`)
  return false
}

async function main() {
  // Prefer DIRECT_URL for the probe — it's the non-pooler host, which is
  // the one Neon suspends. If only DATABASE_URL is set, probe that host.
  const directUrl = process.env.DIRECT_URL
  const databaseUrl = process.env.DATABASE_URL

  const directParsed = parseHostPort('DIRECT_URL', directUrl)
  const dbParsed = parseHostPort('DATABASE_URL', databaseUrl)

  if (!directParsed && !dbParsed) {
    console.error('[warmup-neon] ❌ Neither DIRECT_URL nor DATABASE_URL is set (or both are unparseable).')
    console.error('[warmup-neon]    On Vercel: Project → Settings → Environment Variables.')
    console.error('[warmup-neon]    DIRECT_URL must be the NON-pooler host (no -pooler in hostname).')
    console.error('[warmup-neon]    DATABASE_URL must be the -pooler host (with &pgbouncer=true&connection_limit=1).')
    process.exit(2)
  }

  // Warn about common misconfiguration loudly.
  if (dbParsed && !dbParsed.host.includes('-pooler')) {
    console.warn('[warmup-neon] ⚠️  DATABASE_URL is NOT using the -pooler host.')
    console.warn('[warmup-neon]    This is the most common cause of cold-start failures on Vercel + Neon.')
    console.warn('[warmup-neon]    Get the pooled connection string from Neon Console → Dashboard → "Pooled connection".')
  }
  if (!directParsed) {
    console.warn('[warmup-neon] ⚠️  DIRECT_URL is not set.')
    console.warn('[warmup-neon]    Prisma migrations REQUIRE the direct (non-pooler) connection — PgBouncer rejects DDL.')
    console.warn('[warmup-neon]    Get it from Neon Console → Dashboard → "Direct connection".')
  } else if (directParsed.host.includes('-pooler')) {
    console.warn('[warmup-neon] ⚠️  DIRECT_URL is using the -pooler host — this defeats its purpose.')
    console.warn('[warmup-neon]    Migrations will fail with P3006 / advisory-lock errors.')
  }

  // Probe DIRECT_URL first (the one migrations actually use), fall back to DATABASE_URL.
  const target = directParsed ?? dbParsed
  console.log(`[warmup-neon] Probing ${target.host}:${target.port} (source: ${target.source}) for up to ${TOTAL_TIMEOUT_MS / 1000}s...`)

  const ok = await probe(target.host, target.port, target.source)
  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  console.error('[warmup-neon] Unexpected error:', err)
  process.exit(1)
})
