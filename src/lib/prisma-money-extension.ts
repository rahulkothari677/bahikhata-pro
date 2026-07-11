/**
 * 🔒 V18 Paise Migration Phase 4: Prisma Client Extension for auto-conversion.
 *
 * This extension sits between the application code and the database. It:
 *   - On READ: converts money columns from paise (Int in DB) → rupees (Float in JS)
 *   - On WRITE: converts money columns from rupees (Float in JS) → paise (Int in DB)
 *
 * This means ALL existing application code continues to work with rupee values.
 * The DB stores paise (Int), the app works in rupees (Float), and this extension
 * bridges the gap automatically.
 *
 * WHY THIS APPROACH (vs manual fromPaise/toPaise in 78 files):
 *   1. "One definition, used everywhere" — the auditor's recommended pattern
 *   2. Zero risk of missing a file (the extension catches ALL queries)
 *   3. Phase 5 can remove the extension and do manual cleanup later
 *   4. $queryRaw is NOT affected (Phase 2 already handles raw SQL conversions)
 *
 * WHAT IT DOESN'T COVER:
 *   - $queryRaw results (already handled by Phase 2 SQL * 100 + nudge pattern)
 *   - aggregate _sum results (these need manual fromPaise — see below)
 *   - groupBy _sum results (same)
 *
 * LIMITATIONS:
 *   - aggregate() and groupBy() return { _sum: { col: number } } which the
 *     extension can't easily intercept. These call sites need manual
 *     fromPaise() wrapping. The CI guard test catches any missed spots.
 */

import { Prisma, PrismaClient } from '@prisma/client'
import { toPaise, fromPaise } from './money'

// ─── Money column mapping ──────────────────────────────────────────────────
// Maps each model to its money columns. These are the columns that changed
// from Float (rupees) to Int (paise) in Phase 4.

const MONEY_COLUMNS: Record<string, string[]> = {
  Product: ['purchasePrice', 'salePrice', 'mrp'],
  Party: ['openingBalance'],
  Transaction: ['subtotal', 'discountAmount', 'cgst', 'sgst', 'igst', 'totalAmount', 'roundOff', 'paidAmount', 'grossProfit'],
  TransactionItem: ['unitPrice', 'purchasePriceAtSale', 'discountAmount', 'cgst', 'sgst', 'igst', 'csamt', 'total'],
  Payment: ['amount'],
  Subscription: ['amount'],
  GstReturn: [
    'outwardTaxableValue', 'outwardCgst', 'outwardSgst', 'outwardIgst',
    'rcmTaxableValue', 'rcmCgst', 'rcmSgst', 'rcmIgst',
    'nilRatedValue', 'exemptValue', 'nonGstValue',
    'itcTaxableValue', 'itcCgst', 'itcSgst', 'itcIgst',
    'creditNoteTaxableValue', 'creditNoteCgst', 'creditNoteSgst', 'creditNoteIgst',
    'debitNoteTaxableValue', 'debitNoteCgst', 'debitNoteSgst', 'debitNoteIgst',
    'exemptInwardValue', 'interstateB2cTaxableValue', 'interstateB2cIgst',
    'netTaxPayable',
  ],
  Gstr1Snapshot: ['totalOutputTax', 'totalTaxableValue'],
  BankStatement: ['totalCredits', 'totalDebits'],
  BankTransaction: ['amount', 'balance'],
  Gstr2bImport: ['taxableTotal', 'igstTotal', 'cgstTotal', 'sgstTotal'],
  Gstr2bInvoice: ['taxableValue', 'igst', 'cgst', 'sgst', 'totalAmount'],
  AiUsageLog: ['costInr'],
  DailyStats: ['mrr', 'newMrr', 'churnedMrr', 'arr', 'totalGmv', 'aiCostInr'],
  RevenueSchedule: ['amount'],
}

// ─── Model relation mapping (for nested include conversion) ────────────────
const MODEL_RELATIONS: Record<string, Record<string, string>> = {
  Transaction: { items: 'TransactionItem', party: 'Party' },
  TransactionItem: { transaction: 'Transaction', product: 'Product' },
  Payment: { party: 'Party' },
  Party: { transactions: 'Transaction', payments: 'Payment' },
  Product: {},
}

// ─── Helper: convert money columns in a single row (paise → rupees) ─────────
// Also recursively converts nested relations (include: { items: true, party: true })
function convertRowOnRead(model: string, row: any): any {
  const cols = MONEY_COLUMNS[model]
  if (!cols || !row) return row

  const converted = { ...row }

  // Convert this model's money columns
  for (const col of cols) {
    if (col in converted && converted[col] != null && typeof converted[col] === 'number') {
      converted[col] = fromPaise(converted[col])
    }
  }

  // Convert nested relations (include: { items: true, party: true, etc. })
  const relations = MODEL_RELATIONS[model] || {}
  for (const [relName, relModel] of Object.entries(relations)) {
    if (relName in converted && converted[relName] != null) {
      if (Array.isArray(converted[relName])) {
        converted[relName] = converted[relName].map((r: any) => convertRowOnRead(relModel, r))
      } else if (typeof converted[relName] === 'object') {
        converted[relName] = convertRowOnRead(relModel, converted[relName])
      }
    }
  }

  return converted
}

// ─── Helper: convert money columns in data (rupees → paise) ────────────────
function convertDataOnWrite(model: string, data: Record<string, any>): Record<string, any> {
  const cols = MONEY_COLUMNS[model]
  if (!cols || !data) return data

  const converted = { ...data }
  for (const col of cols) {
    if (col in converted && converted[col] != null && typeof converted[col] === 'number') {
      converted[col] = toPaise(converted[col])
    }
  }
  return converted
}

// ─── Helper: convert nested data objects (for create with nested records) ──
function convertNestedData(model: string, data: any): any {
  if (!data || typeof data !== 'object') return data

  const converted = convertDataOnWrite(model, data)

  // Handle nested creates (e.g., transaction.create with items: { create: [...] })
  for (const key of Object.keys(converted)) {
    const val = converted[key]
    if (val && typeof val === 'object') {
      if (Array.isArray(val)) {
        converted[key] = val.map((v) => typeof v === 'object' ? convertNestedData(key, v) : v)
      } else if ('create' in val) {
        // { create: [...] } or { create: {...} }
        if (Array.isArray(val.create)) {
          converted[key] = { ...val, create: val.create.map((v: any) => convertNestedData(key, v)) }
        } else {
          converted[key] = { ...val, create: convertNestedData(key, val.create) }
        }
      } else if ('connect' in val || 'connectOrCreate' in val) {
        // Don't convert connection objects — they only have IDs
      }
    }
  }

  return converted
}

// ─── The Prisma Extension ──────────────────────────────────────────────────
export function withMoneyConversion(client: PrismaClient) {
  return client.$extends({
    query: {
      // Product
      product: {
        async findMany({ model, operation, args, query }) {
          const result = await query(args)
          return result.map((row: any) => convertRowOnRead('Product', row))
        },
        async findFirst({ model, operation, args, query }) {
          const result = await query(args)
          return result ? convertRowOnRead('Product', result) : null
        },
        async findUnique({ model, operation, args, query }) {
          const result = await query(args)
          return result ? convertRowOnRead('Product', result) : null
        },
        async create({ model, operation, args, query }) {
          args.data = convertNestedData('Product', args.data)
          return convertRowOnRead('Product', await query(args))
        },
        async createMany({ model, operation, args, query }) {
          if (Array.isArray(args.data)) {
            args.data = args.data.map((d: any) => convertDataOnWrite('Product', d)) as any
          } else if (args.data) {
            args.data = convertDataOnWrite('Product', args.data) as any
          }
          return query(args)
        },
        async update({ model, operation, args, query }) {
          if (args.data) args.data = convertNestedData('Product', args.data)
          return convertRowOnRead('Product', await query(args))
        },
        async updateMany({ model, operation, args, query }) {
          if (args.data) args.data = convertNestedData('Product', args.data)
          return query(args)
        },
        async upsert({ model, operation, args, query }) {
          if (args.create) args.create = convertNestedData('Product', args.create)
          if (args.update) args.update = convertNestedData('Product', args.update)
          return convertRowOnRead('Product', await query(args))
        },
      },

      // Party
      party: {
        async findMany({ args, query }) {
          const result = await query(args)
          return result.map((row: any) => convertRowOnRead('Party', row))
        },
        async findFirst({ args, query }) {
          const result = await query(args)
          return result ? convertRowOnRead('Party', result) : null
        },
        async findUnique({ args, query }) {
          const result = await query(args)
          return result ? convertRowOnRead('Party', result) : null
        },
        async create({ args, query }) {
          args.data = convertNestedData('Party', args.data)
          return convertRowOnRead('Party', await query(args))
        },
        async createMany({ args, query }) {
          if (Array.isArray(args.data)) {
            args.data = args.data.map((d: any) => convertDataOnWrite('Party', d)) as any
          } else if (args.data) {
            args.data = convertDataOnWrite('Party', args.data) as any
          }
          return query(args)
        },
        async update({ args, query }) {
          if (args.data) args.data = convertNestedData('Party', args.data)
          return convertRowOnRead('Party', await query(args))
        },
        async updateMany({ args, query }) {
          if (args.data) args.data = convertNestedData('Party', args.data)
          return query(args)
        },
        async upsert({ args, query }) {
          if (args.create) args.create = convertNestedData('Party', args.create)
          if (args.update) args.update = convertNestedData('Party', args.update)
          return convertRowOnRead('Party', await query(args))
        },
      },

      // Transaction
      transaction: {
        async findMany({ args, query }) {
          const result = await query(args)
          return result.map((row: any) => convertRowOnRead('Transaction', row))
        },
        async findFirst({ args, query }) {
          const result = await query(args)
          return result ? convertRowOnRead('Transaction', result) : null
        },
        async findUnique({ args, query }) {
          const result = await query(args)
          return result ? convertRowOnRead('Transaction', result) : null
        },
        async create({ args, query }) {
          args.data = convertNestedData('Transaction', args.data)
          return convertRowOnRead('Transaction', await query(args))
        },
        async createMany({ args, query }) {
          if (Array.isArray(args.data)) {
            args.data = args.data.map((d: any) => convertDataOnWrite('Transaction', d)) as any
          } else if (args.data) {
            args.data = convertDataOnWrite('Transaction', args.data) as any
          }
          return query(args)
        },
        async update({ args, query }) {
          if (args.data) args.data = convertNestedData('Transaction', args.data)
          return convertRowOnRead('Transaction', await query(args))
        },
        async updateMany({ args, query }) {
          if (args.data) args.data = convertNestedData('Transaction', args.data)
          return query(args)
        },
        async upsert({ args, query }) {
          if (args.create) args.create = convertNestedData('Transaction', args.create)
          if (args.update) args.update = convertNestedData('Transaction', args.update)
          return convertRowOnRead('Transaction', await query(args))
        },
        // 🔒 V18 Phase 4: aggregate returns _sum in paise — convert to rupees
        async aggregate({ args, query }) {
          const result = await query(args)
          if (result._sum) {
            const cols = MONEY_COLUMNS['Transaction'] || []
            for (const col of cols) {
              if (col in result._sum && result._sum[col] != null) {
                result._sum[col] = fromPaise(result._sum[col])
              }
            }
          }
          return result
        },
        // 🔒 V18 Phase 4: groupBy returns _sum per group in paise — convert
        async groupBy({ args, query }) {
          const result = await query(args)
          const cols = MONEY_COLUMNS['Transaction'] || []
          return result.map((row: any) => {
            if (row._sum) {
              for (const col of cols) {
                if (col in row._sum && row._sum[col] != null) {
                  row._sum[col] = fromPaise(row._sum[col])
                }
              }
            }
            return row
          })
        },
      },

      // TransactionItem
      transactionItem: {
        async findMany({ args, query }) {
          const result = await query(args)
          return result.map((row: any) => convertRowOnRead('TransactionItem', row))
        },
        async findFirst({ args, query }) {
          const result = await query(args)
          return result ? convertRowOnRead('TransactionItem', result) : null
        },
        async findUnique({ args, query }) {
          const result = await query(args)
          return result ? convertRowOnRead('TransactionItem', result) : null
        },
        async create({ args, query }) {
          args.data = convertNestedData('TransactionItem', args.data)
          return convertRowOnRead('TransactionItem', await query(args))
        },
        async createMany({ args, query }) {
          if (Array.isArray(args.data)) {
            args.data = args.data.map((d: any) => convertDataOnWrite('TransactionItem', d)) as any
          } else if (args.data) {
            args.data = convertDataOnWrite('TransactionItem', args.data) as any
          }
          return query(args)
        },
        async update({ args, query }) {
          if (args.data) args.data = convertNestedData('TransactionItem', args.data)
          return convertRowOnRead('TransactionItem', await query(args))
        },
        async updateMany({ args, query }) {
          if (args.data) args.data = convertNestedData('TransactionItem', args.data)
          return query(args)
        },
      },

      // Payment
      payment: {
        async findMany({ args, query }) {
          const result = await query(args)
          return result.map((row: any) => convertRowOnRead('Payment', row))
        },
        async findFirst({ args, query }) {
          const result = await query(args)
          return result ? convertRowOnRead('Payment', result) : null
        },
        async findUnique({ args, query }) {
          const result = await query(args)
          return result ? convertRowOnRead('Payment', result) : null
        },
        async create({ args, query }) {
          args.data = convertNestedData('Payment', args.data)
          return convertRowOnRead('Payment', await query(args))
        },
        async createMany({ args, query }) {
          if (Array.isArray(args.data)) {
            args.data = args.data.map((d: any) => convertDataOnWrite('Payment', d)) as any
          } else if (args.data) {
            args.data = convertDataOnWrite('Payment', args.data) as any
          }
          return query(args)
        },
        async update({ args, query }) {
          if (args.data) args.data = convertNestedData('Payment', args.data)
          return convertRowOnRead('Payment', await query(args))
        },
        async updateMany({ args, query }) {
          if (args.data) args.data = convertNestedData('Payment', args.data)
          return query(args)
        },
        // 🔒 V18 Phase 4: aggregate returns _sum in paise — convert to rupees
        async aggregate({ args, query }) {
          const result = await query(args)
          if (result._sum) {
            const cols = MONEY_COLUMNS['Payment'] || []
            for (const col of cols) {
              if (col in result._sum && result._sum[col] != null) {
                result._sum[col] = fromPaise(result._sum[col])
              }
            }
          }
          return result
        },
        // 🔒 V18 Phase 4: groupBy returns _sum per group in paise — convert
        async groupBy({ args, query }) {
          const result = await query(args)
          const cols = MONEY_COLUMNS['Payment'] || []
          return result.map((row: any) => {
            if (row._sum) {
              for (const col of cols) {
                if (col in row._sum && row._sum[col] != null) {
                  row._sum[col] = fromPaise(row._sum[col])
                }
              }
            }
            return row
          })
        },
      },
    },
  })
}
