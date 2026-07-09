import { z } from 'zod'

/**
 * 🔒 AUDIT FIX H7 (v2 audit): Zod validation schemas for API routes.
 *
 * Was: routes did `await req.json()` then `parseFloat(...)` — malformed input
 * (items not array, missing productName, negative qty, NaN prices, 10MB notes)
 * caused 500s or stored garbage.
 *
 * Now: validate with zod before touching the DB. Return 400 with field errors.
 *
 * Start with the most critical routes (transactions POST/PUT). Other routes
 * can adopt these patterns incrementally.
 */

// Transaction item schema (used in both POST and PUT)
// 🔒 V11 §2.4: Use z.coerce.number() for all numeric fields so string values
// from HTML inputs are auto-converted. Same defensive fix as products.
export const transactionItemSchema = z.object({
  productId: z.string().nullable().optional(),
  productName: z.string().min(1, 'Product name is required').max(200, 'Product name too long'),
  quantity: z.coerce.number().positive('Quantity must be positive').max(1000000, 'Quantity too large'),
  unitPrice: z.coerce.number().min(0, 'Unit price cannot be negative').max(10000000, 'Unit price too large'),
  gstRate: z.coerce.number().min(0).max(100).optional().default(0),
  discountAmount: z.coerce.number().min(0).optional().default(0),
  // 🔒 V12: the unit the quantity is expressed in (kg, gm, ltr, pcs, ...).
  unit: z.string().max(20).optional().default('pcs'),
  // 🔒 V12: whether unitPrice is inclusive of GST for this line (MRP pricing).
  priceIncludesGst: z.coerce.boolean().optional().default(false),
})

// Transaction create schema
// 🔒 V11 §2.4: z.coerce.number() for all numeric fields.
export const createTransactionSchema = z.object({
  type: z.enum(['sale', 'purchase', 'income', 'expense']),
  partyId: z.string().nullable().optional(),
  date: z.string().optional(),
  items: z.array(transactionItemSchema).optional(),
  discountAmount: z.coerce.number().min(0).optional(),
  paymentMode: z.enum(['cash', 'upi', 'card', 'bank', 'credit']).optional().default('cash'),
  notes: z.string().max(5000, 'Notes too long').nullable().optional(),
  invoiceNo: z.string().max(100).nullable().optional(),
  category: z.string().max(200).nullable().optional(),
  paidAmount: z.coerce.number().min(0).optional(),
  payeeName: z.string().max(200).nullable().optional(),
  payeePhone: z.string().max(20).nullable().optional(),
  totalAmount: z.coerce.number().min(0, 'Amount cannot be negative').max(100000000, 'Amount too large').optional(), // for income/expense only — 🔒 N9: validated
})

// Transaction update schema (same but all fields optional)
// 🔒 V11 §2.4: z.coerce.number() for all numeric fields.
export const updateTransactionSchema = z.object({
  type: z.enum(['sale', 'purchase', 'income', 'expense']),
  partyId: z.string().nullable().optional(),
  date: z.string().optional(),
  items: z.array(transactionItemSchema),
  discountAmount: z.coerce.number().min(0).optional(),
  paymentMode: z.enum(['cash', 'upi', 'card', 'bank', 'credit']).optional().default('cash'),
  notes: z.string().max(5000, 'Notes too long').nullable().optional(),
  invoiceNo: z.string().max(100).nullable().optional(),
  category: z.string().max(200).nullable().optional(),
  paidAmount: z.coerce.number().min(0).optional(),
  payeeName: z.string().max(200).nullable().optional(),
  payeePhone: z.string().max(20).nullable().optional(),
  totalAmount: z.coerce.number().min(0, 'Amount cannot be negative').max(100000000, 'Amount too large').optional(), // for income/expense — 🔒 FIX M5
})

// Product create schema (🔒 V7 M4: enhanced with clearer error messages)
export const createProductSchema = z.object({
  name: z.string().min(1, 'Product name is required').max(200),
  sku: z.string().max(100).nullable().optional(),
  hsn: z.string().max(20).nullable().optional(),
  category: z.string().max(200).nullable().optional(),
  unit: z.string().max(20).optional().default('pcs'),
  // 🔒 FIX: Use z.coerce.number() so string values from HTML inputs
  // (e.g., "95") are automatically converted to numbers. Without this,
  // any product create/update from the UI fails with 400 because the
  // form sends strings but z.number() rejects them.
  purchasePrice: z.coerce.number().min(0, 'Purchase price cannot be negative').optional().default(0),
  salePrice: z.coerce.number().min(0, 'Sale price cannot be negative').optional().default(0),
  mrp: z.coerce.number().min(0, 'MRP cannot be negative').nullable().optional(),
  gstRate: z.coerce.number().min(0, 'GST rate cannot be negative').max(100, 'GST rate cannot exceed 100%').optional().default(0),
  openingStock: z.coerce.number().min(0, 'Opening stock cannot be negative').optional().default(0),
  lowStockThreshold: z.coerce.number().min(0, 'Low stock threshold cannot be negative').optional().default(5),
  notes: z.string().max(5000).nullable().optional(),
  // 🔒 V12: MRP / GST-inclusive pricing flag.
  priceIncludesGst: z.coerce.boolean().optional().default(false),
})

// Party create schema
// 🔒 V11 §2.4: z.coerce.number() for openingBalance.
// 🔒 V17-Ext §2.3: Added refine to reject NaN (e.g., "abc" coerces to NaN).
//   Was: z.coerce.number() alone accepts NaN, which would store NaN as the
//   opening balance. Now: NaN is rejected with a clear error.
export const createPartySchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  type: z.enum(['customer', 'supplier', 'both']).optional().default('customer'),
  phone: z.string().max(20).nullable().optional(),
  email: z.string().email('Invalid email').max(200).nullable().optional().or(z.literal('')),
  gstin: z.string().max(15).nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  openingBalance: z.coerce.number()
    .refine((v) => !isNaN(v), 'Opening balance must be a valid number')
    .optional()
    .default(0),
})

// 🔒 AUDIT FIX V7 M4: Product update schema — all fields optional, but
// any field that IS provided must pass the same validation as create
// (no negative prices, no empty name, etc.).
export const updateProductSchema = z.object({
  name: z.string().min(1, 'Product name cannot be empty').max(200).optional(),
  sku: z.string().max(100).nullable().optional(),
  hsn: z.string().max(20).nullable().optional(),
  category: z.string().max(200).nullable().optional(),
  unit: z.string().max(20).optional(),
  // 🔒 FIX: z.coerce.number() — same reason as createProductSchema.
  purchasePrice: z.coerce.number().min(0, 'Purchase price cannot be negative').optional(),
  salePrice: z.coerce.number().min(0, 'Sale price cannot be negative').optional(),
  mrp: z.coerce.number().min(0, 'MRP cannot be negative').nullable().optional(),
  gstRate: z.coerce.number().min(0, 'GST rate cannot be negative').max(100, 'GST rate cannot exceed 100%').optional(),
  openingStock: z.coerce.number().min(0, 'Opening stock cannot be negative').optional(),
  lowStockThreshold: z.coerce.number().min(0, 'Low stock threshold cannot be negative').optional(),
  notes: z.string().max(5000).nullable().optional(),
  // 🔒 V12: MRP / GST-inclusive pricing flag.
  priceIncludesGst: z.coerce.boolean().optional(),
})

/**
 * Validate a request body against a zod schema.
 * Returns { success: true, data } or { success: false, error }
 */
export function validateBody<T>(schema: z.ZodSchema<T>, body: unknown):
  | { success: true; data: T }
  | { success: false; error: string } {
  const result = schema.safeParse(body)
  if (result.success) {
    return { success: true, data: result.data }
  }
  // Format errors as a readable string
  const errorMessages = result.error.issues
    .map(i => `${i.path.join('.')}: ${i.message}`)
    .join('; ')
  return { success: false, error: errorMessages }
}
