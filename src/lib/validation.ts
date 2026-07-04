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
export const transactionItemSchema = z.object({
  productId: z.string().nullable().optional(),
  productName: z.string().min(1, 'Product name is required').max(200, 'Product name too long'),
  quantity: z.number().positive('Quantity must be positive').max(1000000, 'Quantity too large'),
  unitPrice: z.number().min(0, 'Unit price cannot be negative').max(10000000, 'Unit price too large'),
  gstRate: z.number().min(0).max(100).optional().default(0),
  discountAmount: z.number().min(0).optional().default(0),
})

// Transaction create schema
export const createTransactionSchema = z.object({
  type: z.enum(['sale', 'purchase', 'income', 'expense']),
  partyId: z.string().nullable().optional(),
  date: z.string().optional(),
  items: z.array(transactionItemSchema).optional(),
  discountAmount: z.number().min(0).optional(),
  paymentMode: z.enum(['cash', 'upi', 'card', 'bank', 'credit']).optional().default('cash'),
  notes: z.string().max(5000, 'Notes too long').nullable().optional(),
  invoiceNo: z.string().max(100).nullable().optional(),
  category: z.string().max(200).nullable().optional(),
  paidAmount: z.number().min(0).optional(),
  payeeName: z.string().max(200).nullable().optional(),
  payeePhone: z.string().max(20).nullable().optional(),
  totalAmount: z.number().optional(), // for income/expense only
})

// Transaction update schema (same but all fields optional)
export const updateTransactionSchema = z.object({
  type: z.enum(['sale', 'purchase', 'income', 'expense']),
  partyId: z.string().nullable().optional(),
  date: z.string().optional(),
  items: z.array(transactionItemSchema),
  discountAmount: z.number().min(0).optional(),
  paymentMode: z.enum(['cash', 'upi', 'card', 'bank', 'credit']).optional().default('cash'),
  notes: z.string().max(5000, 'Notes too long').nullable().optional(),
  invoiceNo: z.string().max(100).nullable().optional(),
  category: z.string().max(200).nullable().optional(),
  paidAmount: z.number().min(0).optional(),
  payeeName: z.string().max(200).nullable().optional(),
  payeePhone: z.string().max(20).nullable().optional(),
})

// Product create schema
export const createProductSchema = z.object({
  name: z.string().min(1, 'Product name is required').max(200),
  sku: z.string().max(100).nullable().optional(),
  hsn: z.string().max(20).nullable().optional(),
  category: z.string().max(200).nullable().optional(),
  unit: z.string().max(20).optional().default('pcs'),
  purchasePrice: z.number().min(0).optional().default(0),
  salePrice: z.number().min(0).optional().default(0),
  mrp: z.number().min(0).nullable().optional(),
  gstRate: z.number().min(0).max(100).optional().default(0),
  openingStock: z.number().min(0).optional().default(0),
  lowStockThreshold: z.number().min(0).optional().default(5),
  notes: z.string().max(5000).nullable().optional(),
})

// Party create schema
export const createPartySchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  type: z.enum(['customer', 'supplier', 'both']).optional().default('customer'),
  phone: z.string().max(20).nullable().optional(),
  email: z.string().email('Invalid email').max(200).nullable().optional().or(z.literal('')),
  gstin: z.string().max(15).nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  openingBalance: z.number().optional().default(0),
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
