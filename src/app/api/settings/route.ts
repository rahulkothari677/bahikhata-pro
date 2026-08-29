import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAuthUserIdWithModule } from '@/lib/get-auth'
import { withCache, noStore } from '@/lib/cache'
import { apiError } from '@/lib/api-error'
import { VISIBILITY_TOGGLES } from '@/lib/invoice-visibility'
import { canEnterCompositionFrom, financialYearStart } from '@/lib/composition-window'

// GET /api/settings
export async function GET() {
  try {
    const { userId, error } = await getAuthUserIdWithModule('settings')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const setting = await db.setting.findUnique({ where: { userId } })
    // 🔒 AUDIT V25 FIX BUG-031 (Batch 5): Was withCache({ maxAge: 120, swr: 600 }).
    // Settings contain shopName, GSTIN, address, phone — all displayed on invoices.
    // A stale GSTIN on an invoice PDF is a compliance issue. Now noStore (always fresh).
    return noStore({ setting: setting || { shopName: 'My Shop' } })
  } catch (error) {
    // 🔒 V19-025 FIX: Return 500 on error, not 200 with fake defaults.
    // Previously: returned 200 + { shopName: 'My Shop' } on DB failure →
    // client thinks settings loaded successfully, shows wrong shop name.
    return apiError(error, 'Failed to load settings', 500)
  }
}

// PUT /api/settings
export async function PUT(req: NextRequest) {
  try {
    const { userId, error } = await getAuthUserIdWithModule('settings')
    if (error || !userId) return error || NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json()

    // 🔒 V26 H5 FIX: Validate inputs before storing. Was: raw body taken
    // with no length limits, no GSTIN format, no email format, no enum check.
    // Now: sanitize each field with length limits + format validation.
    const MAX_NAME = 200
    const MAX_TEXT = 2000
    const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/

    // 🔒 V26 R13 (Phase 5): Non-string fallthrough now rejects with 400.
    // Was: `typeof body.X === 'string' ? body.X.slice(0, N) : body.X` →
    // `{ shopName: 123 }` reached Prisma and 500'd. Now: return 400 with a
    // clear message so the client knows it sent a bad type.
    const sanitized: any = {}
    if (body.shopName !== undefined) {
      if (body.shopName !== null && typeof body.shopName !== 'string') {
        return NextResponse.json({ error: 'shopName must be text' }, { status: 400 })
      }
      sanitized.shopName = typeof body.shopName === 'string' ? body.shopName.slice(0, MAX_NAME) : body.shopName
    }
    if (body.ownerName !== undefined) {
      if (body.ownerName !== null && typeof body.ownerName !== 'string') {
        return NextResponse.json({ error: 'ownerName must be text' }, { status: 400 })
      }
      sanitized.ownerName = typeof body.ownerName === 'string' ? body.ownerName.slice(0, MAX_NAME) : body.ownerName
    }
    if (body.address !== undefined) {
      if (body.address !== null && typeof body.address !== 'string') {
        return NextResponse.json({ error: 'address must be text' }, { status: 400 })
      }
      sanitized.address = typeof body.address === 'string' ? body.address.slice(0, MAX_TEXT) : body.address
    }
    if (body.phone !== undefined) {
      if (body.phone !== null && typeof body.phone !== 'string') {
        return NextResponse.json({ error: 'phone must be text' }, { status: 400 })
      }
      sanitized.phone = typeof body.phone === 'string' ? body.phone.slice(0, 20) : body.phone
    }
    if (body.gstin !== undefined) {
      if (body.gstin !== null && body.gstin !== '' && typeof body.gstin !== 'string') {
        return NextResponse.json({ error: 'gstin must be text' }, { status: 400 })
      }
      if (body.gstin !== null && body.gstin !== '' && !GSTIN_REGEX.test(body.gstin)) {
        return NextResponse.json({ error: 'Invalid GSTIN format. Must be 15 characters (e.g. 27ABCDE1234F1Z5).' }, { status: 400 })
      }
      sanitized.gstin = body.gstin
    }
    if (body.state !== undefined) {
      if (body.state !== null && typeof body.state !== 'string') {
        return NextResponse.json({ error: 'state must be text' }, { status: 400 })
      }
      sanitized.state = typeof body.state === 'string' ? body.state.slice(0, 100) : body.state
    }
    if (body.email !== undefined) {
      if (body.email !== null && body.email !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
        return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
      }
      sanitized.email = body.email
    }
    if (body.hideProfit !== undefined) sanitized.hideProfit = !!body.hideProfit
    if (body.roundOffEnabled !== undefined) sanitized.roundOffEnabled = !!body.roundOffEnabled

    /*
     * e-invoicing declaration. null clears it back to "not answered", which is
     * a distinct state from false — see the schema comment.
     */
    if (body.eInvoiceApplicable !== undefined) {
      sanitized.eInvoiceApplicable =
        body.eInvoiceApplicable === null || body.eInvoiceApplicable === ''
          ? null
          : !!body.eInvoiceApplicable
    }

    /*
     * Composition scheme registration. NULL means the regular scheme.
     *
     * Only the four categories the law defines are accepted. A free string
     * would let a typo through, and the rate is looked up BY this value — an
     * unrecognised category would silently produce no tax at all, which is the
     * worst possible way for a typo to fail.
     */
    if (body.compositionCategory !== undefined) {
      const allowed = ['trader', 'manufacturer', 'restaurant', 'service']
      const v = body.compositionCategory
      if (v === null || v === '') {
        sanitized.compositionCategory = null
        sanitized.compositionFrom = null
        sanitized.compositionTo = null
      } else if (allowed.includes(v)) {
        /*
         * ENTRY IS PROSPECTIVE ONLY, AND THE APP SHOULD SAY SO.
         *
         * CMP-02 takes effect from the start of a financial year and must be
         * filed before that year begins (Rule 3). There is no mid-year opt-in,
         * which is why there was never a proration rule to invent for this
         * direction — the whole-quarter CMP-08 calculation is already right.
         *
         * A client MAY supply compositionFrom now (it used to be ignored and
         * stamped with today — see #42). If they do, it must be a 1 April.
         * Refused WITH THE REASON: a shopkeeper told only "not allowed"
         * assumes the app is limited rather than the law.
         *
         * A brand-new registration opting in at registration is the one real
         * exception, and it is not this path — that shop has no prior
         * regular-scheme turnover in the year to double-tax.
         */
        if (body.compositionFrom) {
          const requested = new Date(body.compositionFrom)
          if (Number.isNaN(requested.getTime())) {
            return NextResponse.json({ error: 'compositionFrom must be a date' }, { status: 400 })
          }
          const check = canEnterCompositionFrom(requested)
          if (!check.allowed) {
            return NextResponse.json({
              error: 'Composition cannot start mid-year',
              message: check.reason,
            }, { status: 400 })
          }
          sanitized.compositionFrom = requested
        }
        sanitized.compositionCategory = v
        /*
         * Defaults to the START OF THE FINANCIAL YEAR, not to today.
         *
         * It used to stamp `new Date()`, and that contradicted the check
         * directly above: the route REFUSES a client-supplied date that is not
         * 1 April, then quietly wrote today's date — the very value it had
         * just rejected — whenever the client sent none. A rule enforced on
         * one path and broken on the other is not a rule.
         *
         * It is also wrong in a way that costs turnover. Once
         * composition-window.ts began clamping CMP-08 to this column, a shop
         * switching the scheme on in August would have had its quarter start
         * on the day it toggled, silently dropping every sale earlier in the
         * quarter from the return.
         *
         * 1 April is the only date this can legally be: CMP-02 takes effect
         * from the start of a financial year and must be filed before that
         * year begins (Rule 3). A shop on composition today has been on it
         * since April, whenever it got round to telling us.
         *
         * (This comment previously said the column was "CURRENTLY UNUSED" —
         * true and honest when written, false the moment #42 landed. A note
         * describing behaviour the file no longer has is a claim the next
         * reader trusts without checking, which is how this column sat inert
         * for three weeks.)
         */
        if (sanitized.compositionFrom === undefined) {
          sanitized.compositionFrom = financialYearStart(new Date())
        }
      } else {
        return NextResponse.json({
          error: 'Invalid composition category',
          message: 'Choose trader, manufacturer, restaurant or service.',
        }, { status: 400 })
      }
    }

    /*
     * The date the shop LEFT composition. Unlike entry, exit is immediate and
     * mid-quarter — crossing ₹1.5 crore ends the scheme on the crossing date
     * itself. CMP-08 stops here; see lib/composition-window.ts.
     */
    if (body.compositionTo !== undefined) {
      if (body.compositionTo === null || body.compositionTo === '') {
        sanitized.compositionTo = null
      } else {
        const exit = new Date(body.compositionTo)
        if (Number.isNaN(exit.getTime())) {
          return NextResponse.json({ error: 'compositionTo must be a date' }, { status: 400 })
        }
        /*
         * An exit BEFORE the entry date has no legal meaning, and the failure
         * it causes is silent rather than loud: sliceForComposition correctly
         * finds no overlap for any quarter, so every CMP-08 answers "you were
         * not a composition dealer then" — while Settings still shows the
         * scheme switched on. The shopkeeper sees a contradiction with no
         * explanation and nothing to click.
         *
         * Refuse it here, where the date is entered and the person can still
         * see what they typed. A refusal at the point of entry costs one
         * correction; the same problem discovered at filing time costs a
         * return.
         */
        const entry = (sanitized.compositionFrom as Date | undefined)
          ?? (await db.setting.findUnique({
            where: { userId },
            select: { compositionFrom: true },
          }))?.compositionFrom
        if (entry && exit < entry) {
          return NextResponse.json({
            error: 'Exit date is before the start date',
            message: `You joined the composition scheme on ${entry.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}, so you cannot have left it before that. Check the date you typed.`,
          }, { status: 400 })
        }
        sanitized.compositionTo = exit
      }
    }

    /*
     * Declared previous-FY turnover, in RUPEES from the client.
     *
     * Stored as paise via the money extension, like every other money column —
     * the extension converts on write, so what arrives here must be rupees and
     * nothing may pre-multiply it. That is the discipline the 100x payment bug
     * came from getting wrong.
     *
     * null is meaningful and distinct from 0: null means "not declared, compute
     * it from my transactions", 0 means "I declare that I turned over nothing".
     * A shop genuinely in its first year needs to be able to say the second.
     */
    if (body.priorFyTurnover !== undefined) {
      if (body.priorFyTurnover === null || body.priorFyTurnover === '') {
        sanitized.priorFyTurnover = null
      } else {
        const n = Number(body.priorFyTurnover)
        if (!Number.isFinite(n) || n < 0) {
          return NextResponse.json(
            { error: 'Previous year turnover must be a number and cannot be negative' },
            { status: 400 },
          )
        }
        // Guard against a fat-fingered figure becoming a filing threshold.
        if (n > 1e12) {
          return NextResponse.json(
            { error: 'Previous year turnover looks too large — please check the figure' },
            { status: 400 },
          )
        }
        sanitized.priorFyTurnover = n
      }
    }
    if (body.scanLang !== undefined) {
      if (typeof body.scanLang !== 'string') {
        return NextResponse.json({ error: 'scanLang must be text' }, { status: 400 })
      }
      sanitized.scanLang = body.scanLang.slice(0, 20)
    }
    if (body.voiceLang !== undefined) {
      if (typeof body.voiceLang !== 'string') {
        return NextResponse.json({ error: 'voiceLang must be text' }, { status: 400 })
      }
      sanitized.voiceLang = body.voiceLang.slice(0, 20)
    }
    if (body.stockPolicy !== undefined) {
      if (!['block', 'allow'].includes(body.stockPolicy)) {
        return NextResponse.json({ error: 'stockPolicy must be "block" or "allow"' }, { status: 400 })
      }
      sanitized.stockPolicy = body.stockPolicy
    }
    if (body.upiId !== undefined) {
      if (body.upiId !== null && body.upiId !== '' && typeof body.upiId !== 'string') {
        return NextResponse.json({ error: 'upiId must be text' }, { status: 400 })
      }
      if (body.upiId !== null && body.upiId !== '' && !/^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/.test(body.upiId)) {
        return NextResponse.json({ error: 'Invalid UPI ID format (e.g. name@bank)' }, { status: 400 })
      }
      sanitized.upiId = body.upiId
    }
    // 🔒 PDF Redesign Spec Part 3 §2: logoUrl is set via /api/settings/logo
    // (Cloudinary upload), but we allow it to be passed through PUT too so a
    // normal Settings save doesn't accidentally clobber it. If body.logoUrl
    // is undefined, it's omitted from the update (Prisma treats undefined as
    // "don't touch"). If null, the logo is cleared.
    if (body.logoUrl !== undefined) {
      if (body.logoUrl !== null && typeof body.logoUrl !== 'string') {
        return NextResponse.json({ error: 'logoUrl must be a URL string or null' }, { status: 400 })
      }
      if (body.logoUrl !== null && !/^https?:\/\//.test(body.logoUrl)) {
        return NextResponse.json({ error: 'logoUrl must be an http(s) URL' }, { status: 400 })
      }
      sanitized.logoUrl = body.logoUrl
    }

    // 🐛 UI/UX Phase 2: Business card design + slug
    if (body.cardDesign !== undefined) {
      if (body.cardDesign !== null && typeof body.cardDesign !== 'string') {
        return NextResponse.json({ error: 'cardDesign must be a string or null' }, { status: 400 })
      }
      sanitized.cardDesign = body.cardDesign
    }
    if (body.cardSlug !== undefined) {
      if (body.cardSlug !== null && typeof body.cardSlug !== 'string') {
        return NextResponse.json({ error: 'cardSlug must be a string or null' }, { status: 400 })
      }
      sanitized.cardSlug = body.cardSlug
    }

    /*
     * 🎨 2026-08-04: the business card's own details.
     *
     * These are NOT the profile. The profile is the shop's legal identity — the
     * name and address that go on a GST invoice — and a shopkeeper registered as
     * "SHREE SIDDHIVINAYAK TRADING CO." who wants "Siddhivinayak Stores" on the
     * card must not have to falsify the invoice to get it. Rahul asked for the
     * toggle by name: "pre filled from profile or manual entry".
     *
     * Validated separately from their profile twins on purpose. GSTIN is the
     * clearest case: `gstin` above is rejected unless it matches the 15-character
     * format, because it is printed on tax invoices. `cardGstin` is decoration on
     * a visiting card, so it takes any short string — a shop mid-registration can
     * print "applied for" without being blocked. Reusing the strict check would
     * have made the card refuse text it never files with anyone.
     */
    if (body.cardMode !== undefined) {
      if (body.cardMode !== 'profile' && body.cardMode !== 'manual') {
        return NextResponse.json({ error: 'cardMode must be "profile" or "manual"' }, { status: 400 })
      }
      sanitized.cardMode = body.cardMode
    }
    if (body.invoiceTheme !== undefined) {
      // Validated against the registry rather than a second hand-written list,
      // so adding a theme cannot forget to allow it here.
      const { INVOICE_THEMES } = await import('@/lib/invoice-themes')
      if (!INVOICE_THEMES.some(t => t.id === body.invoiceTheme)) {
        return NextResponse.json({ error: 'Unknown invoice theme' }, { status: 400 })
      }
      sanitized.invoiceTheme = body.invoiceTheme
    }
    if (body.invoiceTemplate !== undefined) {
      // Same rule as the theme above: validated against the registry, never a
      // second hand-written list, so adding a template cannot forget to allow
      // it here. See src/lib/invoice-templates.ts.
      const { INVOICE_LAYOUTS } = await import('@/lib/invoice-layouts')
      if (!INVOICE_LAYOUTS.some(t => t.id === body.invoiceTemplate)) {
        return NextResponse.json({ error: 'Unknown invoice template' }, { status: 400 })
      }
      sanitized.invoiceTemplate = body.invoiceTemplate
    }
    /*
     * 📄 Phase 7d — THE STYLE and THE PRESET.
     *
     * 🐛 2026-08-16, and Rahul found it: "i don't see where you have added the
     * royal gold design?"
     *
     * He was right. I built ten layouts, six styles, fifteen palettes and ten
     * named presets, and shipped a screen offering TWO of those four. The
     * style and the preset were never accepted here, so even a picker would
     * have saved nothing — the classic "built but unreachable" defect, which
     * this codebase has now shipped four times.
     *
     * Registry-validated like everything above.
     */
    if (body.invoiceStyle !== undefined) {
      const { INVOICE_STYLES } = await import('@/lib/invoice-styles')
      if (body.invoiceStyle !== null && !INVOICE_STYLES.some(s => s.id === body.invoiceStyle)) {
        return NextResponse.json({ error: 'Unknown invoice style' }, { status: 400 })
      }
      sanitized.invoiceStyle = body.invoiceStyle
    }
    /*
     * A preset is a SHORTCUT: it writes the layout, style and palette itself.
     *
     * Expanded HERE rather than in the browser so the three settings can never
     * disagree with the name shown beside them — a client that wrote only the
     * preset id, or wrote two of the three and failed on the fourth request,
     * would leave the shop looking at "Royal Gold" on a bill that is not one.
     */
    if (body.invoicePreset !== undefined) {
      const { getInvoicePreset } = await import('@/lib/invoice-presets')
      if (body.invoicePreset === null) {
        sanitized.invoicePreset = null
      } else {
        const preset = getInvoicePreset(body.invoicePreset)
        if (!preset) {
          return NextResponse.json({ error: 'Unknown invoice design' }, { status: 400 })
        }
        sanitized.invoicePreset = preset.id
        sanitized.invoiceTemplate = preset.layoutId
        sanitized.invoiceStyle = preset.styleId
        sanitized.invoiceTheme = preset.themeId
      }
    }
    /*
     * Changing any ONE piece drops the preset name.
     *
     * At that point the honest answer to "which design am I on" is "none of
     * them, this is yours" — and a name that no longer describes the bill is
     * worse than no name. Only when the preset was not set in the same request.
     */
    if (body.invoicePreset === undefined
      && (body.invoiceTemplate !== undefined || body.invoiceStyle !== undefined
        || body.invoiceTheme !== undefined)) {
      sanitized.invoicePreset = null
    }
    if (body.invoicePaperSize !== undefined) {
      // Registry-validated, like the theme and template above.
      const { PAPER_SIZES } = await import('@/lib/invoice-paper')
      if (!PAPER_SIZES.some(p => p.id === body.invoicePaperSize)) {
        return NextResponse.json({ error: 'Unknown paper size' }, { status: 400 })
      }
      sanitized.invoicePaperSize = body.invoicePaperSize
    }

    /*
     * 📄 Phase 3 — what the shop puts on the bill.
     *
     * Text fields, length-capped like every other string here. Null and empty
     * string both clear the field, because a shopkeeper deleting the contents
     * of a box means 'remove this', not 'store nothing-shaped text'.
     */
    const TEXT_FIELDS: Array<[string, number]> = [
      ['invoicePrefix', 20], ['invoiceTerms', MAX_TEXT], ['invoiceThankYou', 200],
      ['bankName', MAX_NAME], ['bankAccountName', MAX_NAME],
      ['bankAccountNumber', 40], ['bankIfsc', 20], ['bankBranch', MAX_NAME],
      ['signatureUrl', 500],
    ]
    for (const [field, max] of TEXT_FIELDS) {
      if (body[field] === undefined) continue
      const v = body[field]
      if (v !== null && typeof v !== 'string') {
        return NextResponse.json({ error: `${field} must be text` }, { status: 400 })
      }
      sanitized[field] = v === null || v === '' ? null : v.slice(0, max)
    }

    if (body.invoiceNextNumber !== undefined) {
      /*
       * Rule 46(b): a consecutive serial number. A zero or negative next
       * number is not a preference, it is an invalid invoice — rejected rather
       * than quietly clamped, so the shopkeeper learns the rule.
       */
      const n = Number(body.invoiceNextNumber)
      if (!Number.isInteger(n) || n < 1) {
        return NextResponse.json(
          { error: 'The next bill number must be a whole number, 1 or more.' },
          { status: 400 },
        )
      }
      sanitized.invoiceNextNumber = n
    }

    if (body.invoiceDueDays !== undefined) {
      const v = body.invoiceDueDays
      if (v === null || v === '') {
        sanitized.invoiceDueDays = null
      } else {
        const n = Number(v)
        // A year is already generous for a shop bill; beyond that it is a typo.
        if (!Number.isInteger(n) || n < 0 || n > 365) {
          return NextResponse.json(
            { error: 'Payment days must be a whole number between 0 and 365.' },
            { status: 400 },
          )
        }
        sanitized.invoiceDueDays = n === 0 ? null : n
      }
    }

    /*
     * 📄 Phase 4 — every on/off switch that affects the bill, driven off the
     * ONE registry in lib/invoice-visibility rather than a hand-written list
     * that drifts from it. The two signature switches are in that registry,
     * so they are handled here too and no longer need lines of their own.
     *
     * A test proves each key is a real Setting column, so a typo here fails
     * the build rather than silently discarding a shopkeeper's choice.
     */
    for (const toggle of VISIBILITY_TOGGLES) {
      if (body[toggle.key] !== undefined) sanitized[toggle.key] = !!body[toggle.key]
    }
    if (body.docSendFormat !== undefined) {
      if (!['smart', 'image', 'pdf'].includes(body.docSendFormat)) {
        return NextResponse.json(
          { error: 'docSendFormat must be "smart", "image" or "pdf"' },
          { status: 400 },
        )
      }
      sanitized.docSendFormat = body.docSendFormat
    }
    /*
     * 🗑️ 2026-08-15: docShareLink is no longer accepted.
     *
     * The shareable bill link is gone (see send-bill.ts). The COLUMN stays, so
     * no shop's stored row is rewritten, but nothing can switch it on again —
     * a setting the app still saves and never reads is how a dead feature
     * comes back to life by accident.
     */
    if (body.cardMark !== undefined) {
      if (!['auto', 'logo', 'monogram'].includes(body.cardMark)) {
        return NextResponse.json(
          { error: 'cardMark must be "auto", "logo" or "monogram"' },
          { status: 400 },
        )
      }
      sanitized.cardMark = body.cardMark
    }
    // Length caps mirror the profile's so a card field can never be the reason a
    // row grows unbounded; `cardAddress` is shorter than the profile address
    // because it is printed in one slot on a 3.5-inch card.
    const CARD_FIELDS: Array<[string, number]> = [
      ['cardFontId', 60],
      ['cardShopFontId', 60],
      ['cardTaglineFontId', 60],
      ['cardContactFontId', 60],
      ['cardShopName', MAX_NAME],
      ['cardOwnerName', MAX_NAME],
      ['cardTagline', 120],
      ['cardPhone', 40],
      ['cardEmail', 200],
      ['cardAddress', 300],
      ['cardGstin', 40],
    ]
    for (const [field, max] of CARD_FIELDS) {
      if (body[field] === undefined) continue
      if (body[field] !== null && typeof body[field] !== 'string') {
        return NextResponse.json({ error: `${field} must be text or null` }, { status: 400 })
      }
      if (body[field] === null) {
        sanitized[field] = null
        continue
      }
      // Empty string is stored as NULL, not "". A blank field means "fall back
      // to the profile" — storing "" instead would print an empty line on the
      // card and there would be no way back to the profile value except
      // retyping it.
      const trimmed = (body[field] as string).trim().slice(0, max)
      sanitized[field] = trimmed === '' ? null : trimmed
    }

    const updateData: any = sanitized

    if (body.lockedUntil !== undefined) {
      if (body.lockedUntil === null) {
        // Explicit unlock — set to null
        updateData.lockedUntil = null
      } else {
        // Set lock — validate the date
        const lockDate = new Date(body.lockedUntil)
        if (isNaN(lockDate.getTime())) {
          return NextResponse.json({
            error: 'Invalid lock date',
            message: 'The period lock date could not be parsed. Please select a valid date.',
          }, { status: 400 })
        }
        updateData.lockedUntil = lockDate
      }
    }

    // Build create data — includes lockedUntil only if explicitly provided
    // (same conditional logic, so a first-time settings save doesn't lock).
    const createData: any = {
      userId,
      shopName: body.shopName || 'My Shop',
      ownerName: body.ownerName,
      address: body.address,
      phone: body.phone,
      gstin: body.gstin,
      state: body.state,
      email: body.email,
      hideProfit: body.hideProfit ?? false,
      roundOffEnabled: body.roundOffEnabled ?? false,  // 🔒 V12
      scanLang: body.scanLang || 'original',
      voiceLang: body.voiceLang || 'original',
      stockPolicy: body.stockPolicy || 'block',  // 🔒 V11: default block
      upiId: body.upiId,  // V17-Ext 5.4: UPI VPA for collection links
    }
    if (body.lockedUntil !== undefined) {
      createData.lockedUntil = body.lockedUntil === null ? null : new Date(body.lockedUntil)
    }

    const setting = await db.setting.upsert({
      where: { userId },
      update: updateData,
      create: createData,
    })

    /*
     * 🐛 2026-08-16 — "next bill number" has to MOVE THE COUNTER.
     *
     * Storing the number and leaving the counter where it was is the other
     * half of the same defect: the setting saved, the screen said "your next
     * bill will be RG/26-27/47", and the counter carried on from wherever it
     * happened to be.
     *
     * The counter is still what ALLOCATES the number — atomically, inside the
     * write transaction, because two tills issuing one invoice number is a
     * Rule 46(b) breach rather than an inconvenience. This only seeds it, so
     * the next allocation returns exactly what the shopkeeper asked for.
     *
     * NEVER MOVED BACKWARDS. Rewinding would re-issue numbers already on
     * bills a customer is holding, which is precisely what a consecutive
     * unique serial exists to prevent. A shopkeeper who asks for a lower
     * number is told, rather than silently ignored — see the response below.
     */
    let invoiceNumberWarning: string | null = null
    if (sanitized.invoiceNextNumber !== undefined) {
      const wanted = Number(sanitized.invoiceNextNumber)
      const counter = await db.invoiceCounter.findUnique({
        where: { userId }, select: { seq: true },
      })
      const current = counter?.seq ?? 0
      if (wanted > current) {
        await db.invoiceCounter.upsert({
          where: { userId },
          update: { seq: wanted - 1 },
          create: { userId, seq: wanted - 1 },
        })
      } else {
        invoiceNumberWarning =
          `Your bills have already reached ${current}. The next one will be ${current + 1} — `
          + 'going back would repeat a number that is already on a bill.'
      }
    }

    /*
     * 🔒 2026-08-03 (audit): carry the business name across to the default shop.
     *
     * The default Shop row is seeded ONCE from Setting.shopName (GET
     * /api/shops). Nothing kept them together afterwards and no rename existed,
     * so an owner who changed their business name here still saw the ORIGINAL
     * name on the Manage Shops card — permanently, with no way to correct it.
     * The app disagreed with itself about the name of the same shop.
     *
     * One direction only, and deliberately. Settings is the canonical business
     * profile, so the shop label follows it. The reverse does not hold:
     * renaming a shop must NOT rewrite Setting.shopName, because that name is
     * printed on invoices, GSTR-1 and e-invoice IRN payloads — changing a GST
     * document identity is not a side effect a rename box should have.
     *
     * Non-critical: a failure here leaves a stale label, which is what the
     * situation already was. It must never fail the settings save itself.
     */
    if (typeof sanitized.shopName === 'string' && sanitized.shopName.trim()) {
      try {
        await db.shop.updateMany({
          where: { userId, isDefault: true },
          data: { name: sanitized.shopName.trim() },
        })
      } catch (syncErr) {
        console.error('[settings] default shop name sync failed:', syncErr)
      }
    }

    // 🔒 V8 M1: Invalidate the shop-state cache so the next sale uses the
    // updated state for inter/intra-state GST derivation. Without this, the
    // cached old state would persist for 5 minutes → wrong CGST/SGST vs IGST.
    if (body.state !== undefined) {
      const { invalidateShopStateCache } = await import('@/lib/gst')
      invalidateShopStateCache(userId)
    }

    // 🔒 V19-026 FIX: Invalidate the HTTP cache on the GET response.
    // The GET handler uses withCache({ maxAge: 120 }) — without invalidation,
    // the next GET within 2 minutes returns the OLD settings.
    // Since we can't easily purge the HTTP cache from here, we add a
    // Cache-Control: no-cache header to the response so the client knows
    // to refetch. The React Query invalidateQueries on the client side
    // handles the rest.
    return NextResponse.json(
      // The warning rides along so the screen can SAY a number was refused,
      // rather than saving quietly and letting the shopkeeper discover it on
      // their next bill.
      { setting, invoiceNumberWarning },
      { headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' } }
    )
  } catch (error) {
    return apiError(error, 'Failed to update settings', 500)
  }
}
