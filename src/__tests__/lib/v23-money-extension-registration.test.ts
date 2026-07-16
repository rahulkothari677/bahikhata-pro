/**
 * 🔒 AUDIT V23 FIX §8.1: Behavioral registration test for money extension.
 *
 * The existing v20-money-extension-regression.test.ts greps the extension's
 * source text — it can't detect a MISSING handler for a model×operation the
 * codebase actually calls. This test takes the opposite approach:
 *
 * 1. Scans src/ for all db.<model>.<operation> call sites
 * 2. For models in MONEY_COLUMNS, asserts the extension defines a handler
 *    for each operation that's actually called
 *
 * This is the guard that should have caught BUG-020 (TransactionItem missing
 * aggregate handler) before it reached production.
 */

import fs from 'fs'
import path from 'path'

// Models that have money columns (must match MONEY_COLUMNS in prisma-money-extension.ts)
const MONEY_MODELS = ['Transaction', 'TransactionItem', 'Payment', 'BankStatement', 'GstReturn', 'Gstr1Snapshot']

// Operations that Prisma's $extends intercepts
// Note: delete/deleteMany return a count (not rows), so they don't need
// money conversion. We only check operations that return money-bearing data.
const INTERCEPTABLE_OPS = [
  'findMany', 'findFirst', 'findUnique', 'create', 'createMany',
  'update', 'updateMany', 'aggregate', 'groupBy', 'upsert',
]

// Extract registered handlers from the extension source
function getRegisteredHandlers(): Record<string, string[]> {
  const extPath = path.join(process.cwd(), 'src', 'lib', 'prisma-money-extension.ts')
  const source = fs.readFileSync(extPath, 'utf8')

  const handlers: Record<string, string[]> = {}
  const modelCamelMap: Record<string, string> = {
    Transaction: 'transaction',
    TransactionItem: 'transactionItem',
    Payment: 'payment',
    BankStatement: 'bankStatement',
    GstReturn: 'gstReturn',
    Gstr1Snapshot: 'gstr1Snapshot',
  }

  // generateModelHandlers produces: findMany, findFirst, findUnique, create,
  // createMany, update, updateMany, aggregate, groupBy, upsert, delete, deleteMany
  const GENERATED_OPS = [
    'findMany', 'findFirst', 'findUnique', 'create', 'createMany',
    'update', 'updateMany', 'aggregate', 'groupBy', 'upsert', 'delete', 'deleteMany',
  ]

  for (const model of MONEY_MODELS) {
    const camelName = modelCamelMap[model]
    const ops = new Set<string>()

    // Check 1: Is this model in a generateModelHandlers call?
    // Pattern: generateModelHandlers('ModelName', 'camelName')
    const genRegex = new RegExp(`generateModelHandlers\\(['"]${model}['"]`, 'i')
    if (genRegex.test(source)) {
      GENERATED_OPS.forEach(op => ops.add(op))
    }

    // Check 2: Is there a hand-written block for this model?
    const blockRegex = new RegExp(`${camelName}:\\s*\\{([\\s\\S]*?)\\n\\s{6}\\}`, 'g')
    const match = blockRegex.exec(source)
    if (match) {
      const block = match[1]
      for (const op of INTERCEPTABLE_OPS) {
        const opRegex = new RegExp(`async ${op}\\(`)
        if (opRegex.test(block)) {
          ops.add(op)
        }
      }
    }

    handlers[model] = Array.from(ops)
  }

  return handlers
}

// Scan src/ for all db.<model>.<operation> call sites
function getCalledOperations(): Record<string, Set<string>> {
  const srcDir = path.join(process.cwd(), 'src')
  const called: Record<string, Set<string>> = {}

  for (const model of MONEY_MODELS) {
    called[model] = new Set<string>()
  }

  const modelCamelMap: Record<string, string> = {
    Transaction: 'transaction',
    TransactionItem: 'transactionItem',
    Payment: 'payment',
    BankStatement: 'bankStatement',
    GstReturn: 'gstReturn',
    Gstr1Snapshot: 'gstr1Snapshot',
  }

  function scanDir(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        scanDir(fullPath)
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        const content = fs.readFileSync(fullPath, 'utf8')
        for (const model of MONEY_MODELS) {
          const camelName = modelCamelMap[model]
          for (const op of INTERCEPTABLE_OPS) {
            // Match db.<camelName>.<op>( or db.<camelName>.<op>.
            const callRegex = new RegExp(`db\\.${camelName}\\.${op}\\b`)
            if (callRegex.test(content)) {
              called[model].add(op)
            }
          }
        }
      }
    }
  }

  scanDir(srcDir)
  return called
}

describe('V23 §8.1 — Money extension behavioral registration test', () => {
  const registered = getRegisteredHandlers()
  const called = getCalledOperations()

  for (const model of MONEY_MODELS) {
    describe(`${model}`, () => {
      it('has handlers for every operation the codebase calls', () => {
        const missing: string[] = []
        for (const op of called[model]) {
          if (!registered[model].includes(op)) {
            missing.push(op)
          }
        }
        if (missing.length > 0) {
          throw new Error(
            `${model}: the codebase calls db.${model}.{${missing.join(', ')}} ` +
            `but the money extension does not register handlers for these operations. ` +
            `This means those operations will return raw paise instead of rupees (100× bug). ` +
            `Fix: add the missing handlers to the ${model} block in prisma-money-extension.ts. ` +
            `Registered: [${registered[model].join(', ')}]  Called: [${Array.from(called[model]).join(', ')}]`
          )
        }
      })

      it('registers aggregate + groupBy (the §1 bug class)', () => {
        // Even if the codebase doesn't call them today, they must exist
        // to prevent the next caller from hitting the same trap.
        const required = ['aggregate', 'groupBy']
        const missing = required.filter(op => !registered[model].includes(op))
        if (missing.length > 0) {
          throw new Error(
            `${model}: missing ${missing.join(', ')} handler(s) in the money extension. ` +
            `These are required for parity — the next caller that uses db.${model}.aggregate() ` +
            `or db.${model}.groupBy() would get raw paise (100× bug).`
          )
        }
      })
    })
  }
})
