import { z } from 'zod'
import { isCountUnit } from './units'

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
  // 🔒 V18 BUG-010: Removed the per-item `discountAmount` input. It was
  // accepted here but NEVER read by computeLineItems — the discount is entered
  // at the ORDER level and distributed proportionally across items. Accepting a
  // per-item value that silently does nothing is a misleading API that invites
  // a future "why isn't my line discount applying?" bug. (Extra keys sent by
  // older clients are ignored by Zod, so this is backward-compatible.)
  // 🔒 V12: the unit the quantity is expressed in (kg, gm, ltr, pcs, ...).
  unit: z.string().max(20).optional().default('pcs'),
  // 🔒 V12: whether unitPrice is inclusive of GST for this line (MRP pricing).
  priceIncludesGst: z.coerce.boolean().optional().default(false),
}).refine(
  // 🔒 V17 Audit Phase 10: Reject decimal quantities for count-family units
  // (pcs, dozen, box, packet, bag). You can't sell 22.02 pieces of milk.
  // Weight/volume/length units (kg, gm, ltr, ml, m, cm) CAN have decimals.
  (data) => {
    if (isCountUnit(data.unit) && !Number.isInteger(data.quantity)) {
      return false
    }
    return true
  },
  {
    message: 'Quantity must be a whole number for count units (pcs, dozen, box). Use kg/gm/ltr/ml for fractional quantities.',
    path: ['quantity'],
  }
)

// Transaction create schema
// 🔒 V11 §2.4: z.coerce.number() for all numeric fields.
export const createTransactionSchema = z.object({
  type: z.enum(['sale', 'purchase', 'income', 'expense', 'credit-note', 'debit-note', 'estimate']),
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
  // V17-Ext Tier 3: Credit/Debit Notes fields
  originalTransactionId: z.string().nullable().optional(),
  noteType: z.enum(['C', 'D']).optional(),
  noteReason: z.enum(['post-sale-discount', 'deficiency', 'return', 'price-revision', 'other']).optional(),
  affectsStock: z.coerce.boolean().optional().default(false),
})

// Transaction update schema (same but all fields optional)
// 🔒 V11 §2.4: z.coerce.number() for all numeric fields.
export const updateTransactionSchema = z.object({
  type: z.enum(['sale', 'purchase', 'income', 'expense', 'credit-note', 'debit-note', 'estimate']),
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
  // V17-Ext Tier 3: Credit/Debit Notes fields
  // 🔒 R11-4 (Round 11): NO default on affectsStock/noteReason/noteType/
  // originalTransactionId for the UPDATE schema. The edit dialog omits these
  // fields (they're set at creation time), so they arrive as undefined.
  // The server falls back to the EXISTING values when undefined — this is the
  // fix for the silent-stock-corruption bug where editing a credit note with
  // affectsStock=true would reset it to false (zod default) → stock reversal
  // logic computes the wrong net change → corrupted stock.
  // The CREATE schema above KEEPS the .default(false) because new
  // transactions need a concrete value.
  originalTransactionId: z.string().nullable().optional(),
  noteType: z.enum(['C', 'D']).optional(),
  noteReason: z.enum(['post-sale-discount', 'deficiency', 'return', 'price-revision', 'other']).optional(),
  affectsStock: z.coerce.boolean().optional(),
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
  // 🔒 V17 Audit §4.2: GST treatment — distinguishes nil-rated (0% GST but
  // taxable supply), exempt (no GST, not taxable), non-GST (outside GST scope),
  // and taxable (default). Used by GSTR-3B 3.1(c) to break out nil/exempt/non-GST.
  // Enum validation prevents arbitrary strings from being stored.
  gstTreatment: z.enum(['taxable', 'nil', 'exempt', 'nonGst']).optional().default('taxable'),
  // 🔒 V17 Audit Phase 1 P1.5: Reject contradictory gstRate + gstTreatment combos.
  // 'exempt' and 'nonGst' products must have gstRate=0 (they're not taxable).
  // 'taxable' and 'nil' can have any gstRate (nil is 0% but still taxable).
}).refine(
  (data) => {
    if ((data.gstTreatment === 'exempt' || data.gstTreatment === 'nonGst') && data.gstRate > 0) {
      return false  // exempt/nonGst with a non-zero GST rate is contradictory
    }
    return true
  },
  {
    message: 'Exempt and Non-GST products must have GST rate 0%. Change the GST rate to 0% or set GST Treatment to Taxable/Nil-rated.',
    path: ['gstRate'],
  }
)

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
  // 🔒 V17 Audit §4.2: GST treatment (optional on update; if omitted, unchanged).
  gstTreatment: z.enum(['taxable', 'nil', 'exempt', 'nonGst']).optional(),
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

// ═══════════════════════════════════════════════════════════════════════════
// 🔒 V18 ZOD VALIDATION: Additional schemas for previously-unvalidated routes
// ═══════════════════════════════════════════════════════════════════════════

// Payment create schema
export const createPaymentSchema = z.object({
  partyId: z.string().min(1, 'Party ID is required'),
  amount: z.coerce.number().min(0.01, 'Amount must be greater than 0').max(100000000, 'Amount too large'),
  type: z.enum(['received', 'paid']),
  date: z.string().optional(),
  mode: z.enum(['cash', 'upi', 'card', 'bank']).optional().default('cash'),
  notes: z.string().max(5000).nullable().optional(),
})

// Payment update schema (for editing/deleting)
export const updatePaymentSchema = z.object({
  amount: z.coerce.number().min(0.01, 'Amount must be greater than 0').max(100000000).optional(),
  type: z.enum(['received', 'paid']).optional(),
  date: z.string().optional(),
  mode: z.enum(['cash', 'upi', 'card', 'bank']).optional(),
  notes: z.string().max(5000).nullable().optional(),
})

// Staff create schema
export const createStaffSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  email: z.string().email('Valid email is required').max(200),
  password: z.string().min(6, 'Password must be at least 6 characters').max(200),
  role: z.enum(['staff', 'ca']).optional().default('staff'),
  permissions: z.record(z.string(), z.boolean()).optional(),
})

// Staff update schema
export const updateStaffSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  password: z.string().min(6, 'Password must be at least 6 characters').max(200).optional(),
  permissions: z.record(z.string(), z.boolean()).optional(),
  active: z.boolean().optional(),
})

// Auth register schema
export const registerSchema = z.object({
  email: z.string().email('Valid email is required').max(200),
  password: z.string().min(6, 'Password must be at least 6 characters').max(200),
  name: z.string().min(1, 'Name is required').max(200).optional(),
})

// Auth password reset request schema
export const resetRequestSchema = z.object({
  email: z.string().email('Valid email is required').max(200),
})

// Auth password reset confirm schema
export const resetConfirmSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: z.string().min(6, 'Password must be at least 6 characters').max(200),
})

// Party update schema (for PUT /api/parties/[id])
export const updatePartySchema = z.object({
  name: z.string().min(1, 'Name cannot be empty').max(200).optional(),
  type: z.enum(['customer', 'supplier', 'both']).optional(),
  phone: z.string().max(20).nullable().optional(),
  email: z.string().email('Invalid email').max(200).nullable().optional().or(z.literal('')),
  gstin: z.string().max(15).nullable().optional(),
  address: z.string().max(1000).nullable().optional(),
  state: z.string().max(100).nullable().optional(),
  openingBalance: z.coerce.number()
    .refine((v) => !isNaN(v), 'Opening balance must be a valid number')
    .optional(),
})

// Referral apply schema
export const applyReferralSchema = z.object({
  code: z.string().min(1, 'Referral code is required').max(50),
})

// Payment order creation schema (Razorpay)
export const createOrderSchema = z.object({
  planId: z.enum(['pro_monthly', 'pro_yearly', 'elite_monthly', 'elite_yearly']),
  billingCycle: z.enum(['monthly', 'yearly']).optional(),
})

// Payment verification schema (Razorpay)
export const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
  planId: z.enum(['pro_monthly', 'pro_yearly', 'elite_monthly', 'elite_yearly']),
  billingCycle: z.enum(['monthly', 'yearly']).optional(),
})

// Upload bill schema
export const uploadBillSchema = z.object({
  imageBase64: z.string().min(100, 'Image data is required').max(15 * 1024 * 1024, 'Image too large (max 15MB)'),
})

// GSTR-3B file/save schema
export const fileGstr3bSchema = z.object({
  monthYear: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format'),
  lateFee: z.coerce.number().min(0).optional().default(0),
  interest: z.coerce.number().min(0).optional().default(0),
  tdsTcsAdjustment: z.coerce.number().optional().default(0),
})

// 🔒 V26 R13 (Phase 5): Shape-only schemas for routes the auditor flagged as
// having no validation. These are minimal — they enforce types + lengths but
// don't change existing behavior. The manual checks in each route stay as the
// authoritative validation; these schemas just add a first-pass 400 for
// malformed payloads instead of letting bad types reach Prisma (500).

// Document upload schema (POST /api/documents)
export const createDocumentSchema = z.object({
  name: z.string().min(1, 'name is required').max(200),
  category: z.string().max(100).optional(),
  fileType: z.string().min(1, 'fileType is required').max(50),
  fileData: z.string().min(100, 'fileData is required'),
  notes: z.string().max(2000).optional(),
  tags: z.array(z.string().max(100)).max(20).optional(),
})

// Shop create schema (POST /api/shops)
export const createShopSchema = z.object({
  name: z.string().min(1, 'name is required').max(200),
  gstin: z.string().max(15).optional(),
  address: z.string().max(2000).optional(),
  phone: z.string().max(20).optional(),
  state: z.string().max(100).optional(),
  isDefault: z.boolean().optional(),
})

// Bank-recon transaction PATCH schema (PATCH /api/bank-recon/transaction/[id])
// The route takes { action: 'unmatch' | 'match', transactionId?, paymentId? }.
export const updateBankReconTxnSchema = z.object({
  action: z.enum(['unmatch', 'match'], { message: 'action must be "unmatch" or "match"' }),
  transactionId: z.string().max(100).optional(),
  paymentId: z.string().max(100).optional(),
})

// E-invoice IRN schema (POST /api/e-invoice/irn)
export const createIrnSchema = z.object({
  transactionId: z.string().min(1, 'transactionId is required').max(100),
  irn: z.string().min(1, 'irn is required').max(100),
  signedQR: z.string().max(10000).optional(),
})
