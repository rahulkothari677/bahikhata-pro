/**
 * Declared prior-FY turnover is money, and is registered as such.
 *
 * WHY THIS TEST EXISTS (2026-08-08). Setting.priorFyTurnover is an Int PAISE
 * column. prisma-money-extension.ts states the rule in its own docblock: a new
 * money column MUST be added to MONEY_COLUMNS. An unregistered one reads back
 * as raw paise and gets mixed with rupee values — which is precisely the 100x
 * class of bug that file exists to prevent, and which already cost this app ten
 * corrupt Payment rows.
 *
 * A turnover figure that reads back 100x too large would push a shop over the
 * ₹5 crore HSN threshold and the e-invoicing threshold, so the app would start
 * demanding six-digit HSN and e-invoices from a business that owes neither.
 * Registration is not a formality here; it decides what the app asks of a user.
 */
import fs from 'fs'
import path from 'path'
import { __testing } from '@/lib/prisma-money-extension'

const EXTENSION = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/prisma-money-extension.ts'), 'utf8',
)
const SCHEMA = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf8')

describe('priorFyTurnover is wired as a money column', () => {
  it('exists on Setting as a BigInt — a year of paise passes the ₹2.15 crore INTEGER limit (#335)', () => {
    const setting = /model Setting \{([\s\S]*?)\n\}/.exec(SCHEMA)![1]
    expect(setting).toMatch(/priorFyTurnover\s+BigInt\?/)
  })

  it('is registered in MONEY_COLUMNS, so it converts paise to rupees on read', () => {
    // Without this line the value reads back as raw paise — a ₹50,00,000
    // turnover would present as ₹50,00,00,000 and silently cross two
    // regulatory thresholds.
    expect(EXTENSION).toMatch(/Setting:\s*\[[^\]]*'priorFyTurnover'/)
  })

  it('is nullable, because "not declared" and "declared as zero" differ', () => {
    // null → compute from the app's own transactions.
    // 0    → the shopkeeper states they turned over nothing last year.
    // Collapsing them would silently overwrite a genuine zero.
    const setting = /model Setting \{([\s\S]*?)\n\}/.exec(SCHEMA)![1]
    expect(setting).toMatch(/priorFyTurnover\s+BigInt\?/)
    expect(setting).not.toMatch(/priorFyTurnover\s+BigInt\s+@default/)
  })
})

describe('#335: a turnover above ₹2.15 crore survives the round trip', () => {
  const { convertDataOnWrite, convertRowOnRead } = __testing

  it('₹6 crore is written as 6,00,00,00,000 paise — past INTEGER, inside BIGINT', () => {
    const paise = convertDataOnWrite('Setting', { priorFyTurnover: 6_00_00_000 }).priorFyTurnover
    expect(paise).toBe(6_000_000_000)
    expect(paise).toBeGreaterThan(2_147_483_647)
  })

  it('reads a BIGINT back as rupees, a plain number (JSON-safe)', () => {
    const row = convertRowOnRead('Setting', { priorFyTurnover: BigInt(6_000_000_000) })
    expect(row.priorFyTurnover).toBe(6_00_00_000)
    expect(typeof row.priorFyTurnover).toBe('number')
    expect(() => JSON.stringify(row)).not.toThrow()
  })

  it('null stays null — "not declared" is not zero', () => {
    expect(convertRowOnRead('Setting', { priorFyTurnover: null }).priorFyTurnover).toBeNull()
  })

  it('the migration widens the column without touching values', () => {
    const dir = path.join(process.cwd(), 'prisma/migrations')
    const sql = fs.readdirSync(dir).filter((d) => d.includes('prior_fy_turnover_bigint'))
      .map((d) => fs.readFileSync(path.join(dir, d, 'migration.sql'), 'utf8')).join('\n')
    expect(sql).toMatch(/ALTER COLUMN "priorFyTurnover" SET DATA TYPE BIGINT/)
    expect(sql).not.toMatch(/DROP|UPDATE/i)
  })
})
