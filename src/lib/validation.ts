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
/**
 * Rule 46(b) invoice number.
 *
 * A tax invoice number is not free text. CGST Rule 46(b) requires a consecutive
 * serial number, not exceeding SIXTEEN characters, made only of alphanumerics,
 * hyphen and slash, unique within a financial year.
 *
 * This accepted `z.string().max(100)` — a hundred characters of anything. A
 * real generated GSTR-1 for August 2026 carried an invoice numbered
 * "qnip535d" sitting among INV-0041…INV-0075: a random-looking string filed as
 * a legal document number. The transactions route takes the client's value in
 * preference to its own series (`invoiceNo || generated`), so whatever is sent
 * becomes the number of record.
 *
 * Left permissive enough for the legitimate case this override exists for —
 * a shopkeeper continuing an existing paper series like "2026/RG/001", or
 * recording a supplier's own bill number on a purchase. Tightened only to what
 * the rule actually says, so nothing legal is refused and nothing illegal is
 * accepted.
 */
export const invoiceNoSchema = z
  .string()
  .trim()
  .max(16, 'Invoice number cannot exceed 16 characters (GST Rule 46)')
  .regex(
    /^[A-Za-z0-9/-]+$/,
    'Invoice number may contain only letters, numbers, hyphen and slash (GST Rule 46)',
  )

export const transactionItemSchema = z.object({
  productId: z.string().nullable().optional(),
  productName: z.string().min(1, 'Product name is required').max(200, 'Product name too long'),
  quantity: z.coerce.number().positive('Quantity must be positive').max(1000000, 'Quantity too large'),
  unitPrice: z.coerce.number().min(0, 'Unit price cannot be negative').max(10000000, 'Unit price too large'),
  gstRate: z.coerce.number().min(0).max(100).optional().default(0),
  /*
   * HSN/SAC for a line with no product behind it.
   *
   * Zod strips what it does not declare, so a code sent on a free-text line was
   * being discarded here — before line-items.ts ever saw it. The line then
   * stored no HSN, could not reach GSTR-1 Table 12, and (because a missing code
   * reads as "goods") raised a false e-way bill warning on every free-text
   * service over ₹50,000.
   *
   * Product-linked lines ignore this and keep using the product's own code.
   */
  hsn: z.string().max(20).nullable().optional(),
  /*
   * 📄 Phase 5 — the shop's own columns on this line, raw:
   * { batch: "A-118", expiry: "2027-03-12" }.
   *
   * DECLARED HERE OR IT NEVER ARRIVES. Zod strips what it does not know, and
   * the note on `hsn` above is this exact bug already having happened once:
   * a code sent on a free-text line was discarded before line-items.ts ever
   * saw it. Typing and coercion happen server-side against the shop's own
   * definitions (snapshotCustomValues); this layer only lets them through.
   */
  customCols: z.record(z.string(), z.unknown()).optional(),
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
  /** 📄 Phase 5 — the shop's own fields on the BILL (PO number, vehicle no). */
  customFields: z.record(z.string(), z.unknown()).optional(),
  discountAmount: z.coerce.number().min(0).optional(),
  paymentMode: z.enum(['cash', 'upi', 'card', 'bank', 'credit']).optional().default('cash'),
  notes: z.string().max(5000, 'Notes too long').nullable().optional(),
  invoiceNo: invoiceNoSchema.nullable().optional(),
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
  /*
   * Reverse charge (RCM) on a PURCHASE: the buyer pays the GST directly to the
   * government instead of the supplier collecting it. Common for transport
   * (GTA), legal services, and buying from unregistered dealers.
   *
   * The column has existed since V17-Ext and GSTR-3B reads it in six places —
   * it drives section 3.1(d), the tax owed, and the matching ITC in 4(A)(3).
   * It was simply never accepted here, so nothing could ever set it and 3.1(d)
   * reported zero for every shop, forever.
   */
  isReverseCharge: z.coerce.boolean().optional().default(false),
  /*
   * Section 17(5): why credit on this purchase cannot be claimed. Null/absent
   * means it can. A reason rather than a boolean, because "blocked" alone tells
   * a CA nothing at assessment and the shopkeeper will not remember why.
   */
  itcBlockedReason: z
    .enum(['personal', 'staffWelfare', 'motorVehicle', 'construction', 'lostOrFree', 'compositionSupplier', 'other'])
    .nullable()
    .optional(),
  /*
   * On a PURCHASE, write each line's price back to the product as its new cost.
   *
   * Deliberately a boolean and not a list of prices: the server already has the
   * line items and recomputes the costs itself. A client-supplied {productId,
   * price} list would be an unauthenticated way to rewrite what every product
   * costs, which is the number stock valuation and every future profit figure
   * are built on.
   */
  updateProductCosts: z.coerce.boolean().optional().default(false),
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
  invoiceNo: invoiceNoSchema.nullable().optional(),
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
  /*
   * The manufacturer's barcode — distinct from `sku`, the shop's own code.
   * Max 64: the longest common symbology (GS1-128) tops out well under that,
   * and a longer string is a scan error rather than a code.
   */
  barcode: z.string().max(64).nullable().optional(),
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
  // False = a SERVICE: no stock, no low-stock alert, no valuation, and above
  // all no "not enough stock" refusal on the shop's first ever invoice.
  // Defaulted by the ROUTE from the HSN/SAC code (99xx ⇒ service) rather than
  // here, so that an explicit `false` from the form is never overwritten by a
  // zod default. See app/api/products/route.ts.
  tracksInventory: z.coerce.boolean().optional(),
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
  /** 📄 Phase 5 — the shop's own fields on this customer (FSSAI, route code). */
  customFields: z.record(z.string(), z.unknown()).optional(),
})

// 🔒 AUDIT FIX V7 M4: Product update schema — all fields optional, but
// any field that IS provided must pass the same validation as create
// (no negative prices, no empty name, etc.).
export const updateProductSchema = z.object({
  name: z.string().min(1, 'Product name cannot be empty').max(200).optional(),
  sku: z.string().max(100).nullable().optional(),
  /*
   * The manufacturer's barcode — distinct from `sku`, the shop's own code.
   * Max 64: the longest common symbology (GS1-128) tops out well under that,
   * and a longer string is a scan error rather than a code.
   */
  barcode: z.string().max(64).nullable().optional(),
  hsn: z.string().max(20).nullable().optional(),
  category: z.string().max(200).nullable().optional(),
  unit: z.string().max(20).optional(),
  // 🔒 FIX: z.coerce.number() — same reason as createProductSchema.
  purchasePrice: z.coerce.number().min(0, 'Purchase price cannot be negative').optional(),
  salePrice: z.coerce.number().min(0, 'Sale price cannot be negative').optional(),
  mrp: z.coerce.number().min(0, 'MRP cannot be negative').nullable().optional(),
  gstRate: z.coerce.number().min(0, 'GST rate cannot be negative').max(100, 'GST rate cannot exceed 100%').optional(),
  openingStock: z.coerce.number().min(0, 'Opening stock cannot be negative').optional(),
  // Optional on update; if omitted, unchanged. Editing a product must never
  // silently flip goods into a service or back.
  tracksInventory: z.coerce.boolean().optional(),
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
  // 🔒 AUDIT C5 phase 4: explicit bill allocation.
  //
  // OMITTED (the normal case) → the server allocates oldest-first. That keeps
  // the common flow one field long: the shopkeeper types an amount and saves.
  //
  // SUPPLIED → the shopkeeper chose the bills, and the server honours it. This
  // is what makes "clear the current bill, leave the old one pending" possible
  // — a real request (disputed old bill, warranty on the newest one) that
  // oldest-first cannot express.
  //
  // Every entry is still validated against that bill's remaining due, so
  // choosing manually can never over-settle a bill or reach another party's.
  allocations: z.array(z.object({
    transactionId: z.string().min(1),
    amount: z.coerce.number().min(0.01, 'Allocation must be greater than 0'),
  })).max(200).optional(),
  /*
   * GST rate on a service advance. Omit (the normal case) and no tax is due.
   *
   * Advances for goods are exempt (Notification 66/2017); advances for services
   * are taxable on receipt and go into GSTR-1 Table 11A, then 11B when the
   * invoice is raised. Only the rates GST actually uses are accepted — a typo
   * like 1.8 would understate the liability by a factor of ten and nothing
   * downstream would question it.
   */
  advanceGstRate: z.union([z.literal(5), z.literal(12), z.literal(18), z.literal(28)])
    .nullable().optional(),
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

/*
 * Shop rename schema (PATCH /api/shops).
 *
 * Name only, deliberately. A shop's GSTIN, address and state feed GST
 * derivation and appear on filings, so changing them is a different action
 * with different consequences and belongs behind its own review — not folded
 * into a rename because the fields happen to sit in the same row.
 */
export const renameShopSchema = z.object({
  id: z.string().min(1, 'id is required').max(100),
  name: z.string().trim().min(1, 'Shop name cannot be empty').max(200),
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
