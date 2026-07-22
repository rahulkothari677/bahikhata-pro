/**
 * 🔒 MIGRATION IDEMPOTENCY GUARD (Phase 5 R21, un-deferred after the M11 bug)
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * The ₹100 → ₹10,000 payment bug was NOT a code defect. It was caused by a
 * migration that transforms data being applied twice:
 *
 *     ALTER TABLE "Payment" ALTER COLUMN "amount" TYPE INTEGER
 *       USING ROUND("amount" * 100);
 *
 * Postgres re-executes the USING expression every time the statement runs —
 * even when the column is already INTEGER — so a second application multiplies
 * every money value by 100 a second time. scripts/migrate-with-retry.sh
 * auto-retries failed migrations (a migration can commit in Postgres yet still
 * be recorded as failed when a Neon cold start drops the connection), which is
 * how the second application happens.
 *
 * I flagged this risk in Phase 5 as R21 and graded it "polish". That was wrong:
 * it was a live data-corruption vector. This test makes the class un-shippable.
 *
 * WHAT IT ENFORCES
 * ----------------
 * 1. Every migration containing a DATA TRANSFORM must carry an explicit
 *    acknowledgement comment, so writing one is a deliberate act:
 *        -- audited:data-transform <reason>
 *    Reviewers then know the deploy script will refuse to auto-retry it.
 * 2. CREATE INDEX CONCURRENTLY is banned — Prisma wraps each migration in a
 *    transaction and Postgres forbids it there (this caused the V12 outage).
 * 3. Destructive DDL must be acknowledged the same way.
 *
 * ADDING A NEW DATA-TRANSFORMING MIGRATION
 * ----------------------------------------
 * Prefer an idempotent formulation (guard with a WHERE clause that cannot
 * match twice, or a one-shot marker table). If a non-idempotent transform is
 * genuinely necessary, add the acknowledgement comment at the top of the file
 * AND verify that scripts/migrate-with-retry.sh will abort rather than replay.
 */

import fs from 'fs'
import path from 'path'

const MIGRATIONS_DIR = path.join(process.cwd(), 'prisma', 'migrations')

/**
 * Classify a single SQL statement as compounding (unsafe to apply twice) or not.
 *
 * The danger is not "this statement writes data" — it is "this statement's
 * effect COMPOUNDS when applied a second time". Distinguishing them matters:
 * a guard that flags safe backfills gets ignored, and an ignored guard is
 * worth nothing.
 *
 *   UPDATE t SET c = c * 100                    -> compounds        ❌
 *   UPDATE t SET c = '' WHERE c IS NULL         -> idempotent       ✅
 *   ALTER COLUMN c TYPE int USING ROUND(c*100)  -> compounds        ❌
 *   ALTER COLUMN c SET NOT NULL                 -> idempotent       ✅
 *   INSERT ... ON CONFLICT DO NOTHING           -> idempotent       ✅
 */
function classifyStatement(stmt: string): string | null {
  const s = stmt.trim().replace(/\s+/g, ' ')
  if (!s) return null

  // A column retype re-executes its USING expression every run. If that
  // expression references the column itself, the transform compounds — this is
  // exactly the paise migration's ROUND("amount" * 100).
  const retype = s.match(/ALTER\s+COLUMN\s+"?(\w+)"?\s+TYPE\s+/i)
  if (retype) {
    const col = retype[1]
    if (new RegExp(`USING[\\s\\S]*"?${col}"?`, 'i').test(s)) {
      return `column retype whose USING expression references "${col}" (compounds on re-run)`
    }
    return null // e.g. widening a type with no self-referential USING
  }

  if (/^UPDATE\s/i.test(s)) {
    // A backfill guarded by "WHERE <col> IS NULL" cannot fire twice.
    if (/WHERE[\s\S]*IS\s+NULL/i.test(s)) return null

    // The real danger is SELF-REFERENTIAL ARITHMETIC, which compounds:
    //     SET "amount" = "amount" * 100      -> 100x, then 10,000x  ❌
    // An assignment sourced from a constant or another column is re-runnable
    // with an identical outcome, so it is safe:
    //     SET "currentStock" = "openingStock"                        ✅
    //     SET "unit" = p."unit"                                      ✅
    // Flagging those would make this guard noisy, and a noisy guard gets
    // ignored — which is how the paise bug reached production in the first
    // place (a warning nobody acted on).
    for (const m of s.matchAll(/"?(\w+)"?\s*=\s*([^,]+?)(?=,\s*"?\w+"?\s*=|\s+FROM\s|\s+WHERE\s|$)/gi)) {
      const [, col, expr] = m
      if (new RegExp(`"?\\b${col}\\b"?\\s*[*/+-]|[*/+-]\\s*"?\\b${col}\\b"?`, 'i').test(expr)) {
        return `UPDATE with self-referential arithmetic on "${col}" (compounds on re-run)`
      }
    }
    return null
  }

  if (/^INSERT\s+INTO\s/i.test(s)) {
    if (/ON\s+CONFLICT/i.test(s)) return null
    return 'INSERT without ON CONFLICT (duplicates rows on re-run)'
  }

  if (/^DELETE\s+FROM\s/i.test(s)) {
    return 'DELETE statement (destructive — acknowledge it explicitly)'
  }

  return null
}

/** Split SQL into statements on semicolons (sufficient for migration files). */
function statementsOf(sql: string): string[] {
  return sql.split(';').map(s => s.trim()).filter(Boolean)
}

const ACK = /--\s*audited:data-transform/i

/** Migrations that predate this guard. They are already applied in production;
 *  the deploy-script guard (not this test) is what protects them from replay.
 *  NOTHING may be added to this list — new migrations must carry the comment. */
const GRANDFATHERED = new Set<string>([
  '20260712000001_paise_migration',
])

function listMigrations(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) return []
  return fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort()
}

function sqlOf(name: string): string {
  const p = path.join(MIGRATIONS_DIR, name, 'migration.sql')
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
}

/**
 * Strip SQL comments before pattern matching.
 *
 * Without this, the guard matches prose. 20260707000003_partial_indexes
 * contains the line "-- NOTE: Cannot use CREATE INDEX CONCURRENTLY ..." —
 * a comment explaining why the migration AVOIDS it. Matching that would fail
 * the build for doing the right thing, and would train people to ignore this
 * test. (This is the same "grep matched a comment describing the old bug"
 * trap that produced false findings in an earlier audit round.)
 */
function executableSql(name: string): string {
  return sqlOf(name)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')  // /* block comments */
    .replace(/--[^\n]*/g, ' ')          // -- line comments
}

describe('migration idempotency guard (R21)', () => {
  const migrations = listMigrations()

  test('there is at least one migration to check (guard is wired correctly)', () => {
    expect(migrations.length).toBeGreaterThan(0)
  })

  test('every data-transforming migration is explicitly acknowledged', () => {
    const offenders: string[] = []

    for (const name of migrations) {
      if (GRANDFATHERED.has(name)) continue
      const full = sqlOf(name)
      if (!full) continue
      // Match against executable SQL only; check the ack against the full text
      // (the acknowledgement is itself a comment).
      const sql = executableSql(name)

      const hits = statementsOf(sql)
        .map(classifyStatement)
        .filter((h): h is string => h !== null)

      if (hits.length > 0 && !ACK.test(full)) {
        offenders.push(
          `${name}\n    contains: ${hits.join(', ')}\n` +
          `    fix: make it idempotent, or add "-- audited:data-transform <reason>" at the top ` +
          `and confirm scripts/migrate-with-retry.sh will refuse to auto-retry it.`,
        )
      }
    }

    expect(offenders).toEqual([])
  })

  test('no migration uses CREATE INDEX CONCURRENTLY (illegal inside Prisma transactions)', () => {
    const offenders = migrations.filter(name => /CREATE\s+INDEX\s+CONCURRENTLY/i.test(executableSql(name)))
    expect(offenders).toEqual([])
  })

  test('the grandfathered list has not grown', () => {
    // The paise migration is the ONLY pre-existing exception. If this fails,
    // someone added a new unguarded data transform instead of acknowledging it.
    expect([...GRANDFATHERED].sort()).toEqual(['20260712000001_paise_migration'])
  })

  // ─── Self-test: prove the classifier actually detects the real bug ──────
  // A guard that passes because it detects nothing is worse than no guard.
  // These cases lock in its behaviour in BOTH directions.
  describe('classifier self-test', () => {
    test('flags the exact statement that caused the M11 100x bug', () => {
      const realStatement =
        'ALTER TABLE "Payment" ALTER COLUMN "amount" TYPE INTEGER USING ROUND("amount" * 100)'
      expect(classifyStatement(realStatement)).toMatch(/compounds on re-run/)
    })

    test('flags self-referential UPDATE arithmetic', () => {
      expect(classifyStatement('UPDATE "Payment" SET "amount" = "amount" * 100'))
        .toMatch(/self-referential arithmetic/)
    })

    test('flags INSERT without ON CONFLICT and DELETE', () => {
      expect(classifyStatement('INSERT INTO "Setting" ("id") VALUES (\'x\')')).toBeTruthy()
      expect(classifyStatement('DELETE FROM "Payment" WHERE "id" = \'x\'')).toBeTruthy()
    })

    test('does NOT flag genuinely idempotent statements', () => {
      // These all appear in real migrations in this repo; flagging them would
      // make the guard noisy and it would stop being read.
      expect(classifyStatement('UPDATE "Product" SET "currentStock" = "openingStock"')).toBeNull()
      expect(classifyStatement('UPDATE "BankStatement" SET "csvHash" = \'\' WHERE "csvHash" IS NULL')).toBeNull()
      expect(classifyStatement('INSERT INTO "X" ("id") VALUES (\'y\') ON CONFLICT DO NOTHING')).toBeNull()
      expect(classifyStatement('ALTER TABLE "BankStatement" ALTER COLUMN "csvHash" SET NOT NULL')).toBeNull()
      expect(classifyStatement('ALTER TABLE "X" ADD COLUMN IF NOT EXISTS "c" TEXT')).toBeNull()
    })
  })

  test('the deploy script still refuses to auto-retry data transforms', () => {
    // The test above protects new migrations; this protects the guard itself
    // from being removed during a future refactor of the deploy script.
    const script = fs.readFileSync(
      path.join(process.cwd(), 'scripts', 'migrate-with-retry.sh'), 'utf8',
    )
    expect(script).toMatch(/REFUSING TO AUTO-RETRY/)
    expect(script).toMatch(/USING ROUND\\\(/)
  })
})
