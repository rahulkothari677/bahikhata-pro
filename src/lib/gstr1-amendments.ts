/**
 * Correcting an invoice after the return has been filed.
 *
 * WHY THIS EXISTS (2026-08-09). Once GSTR-1 is filed, an invoice in it cannot
 * simply be edited. A wrong GSTIN, value or date is corrected by declaring an
 * AMENDMENT in a later period's return — tables 9A (B2B/B2CL) and 9C — which
 * carry the ORIGINAL invoice number and date alongside the corrected details,
 * so the portal can find what is being replaced.
 *
 * The app had none of this. Editing an old bill silently changed what the next
 * return said, so the figures no longer matched what had actually been filed,
 * and nothing anywhere recorded that a correction had happened. For a buyer
 * this is not cosmetic: their input credit comes from the seller's filed
 * invoice, so a correction that never reaches the portal leaves them unable to
 * claim.
 *
 * WHAT COUNTS AS AN AMENDMENT, and why it is a comparison rather than a flag:
 * the honest question is "does this invoice still say what we told the
 * department it said?". A flag set on edit would miss every other route by
 * which a total can move — a line deleted, a product's price corrected, a
 * discount applied later. So the filed return is compared against the books as
 * they stand, and any invoice whose declared figures have moved is amended.
 *
 * ONLY FILED PERIODS PRODUCE AMENDMENTS. A draft can still be corrected in
 * place, and amending something never filed would declare a correction to a
 * return the department has never seen.
 */
import { roundMoney } from '@/lib/money'
import { toAmendmentRow, zeroedRow, type DocSection } from '@/lib/gstr1-builder'

export type { DocSection }

/*
 * ── PHASE 8c (#103 #104 #340), 31 Oct 2026 ─────────────────────────────────
 *
 * Three things were wrong with the first version, all fixed here:
 *
 *  #340  The rows could not be uploaded. GSTN's Save GSTR1 schema (v4.1/v5.0)
 *        requires an amended B2B invoice to carry rchrg, inv_typ and its line
 *        items, and notes to use nt_num/nt_dt/ont_num/ont_dt — and forbids any
 *        other field. Ours carried none of those and an extra `changes`. Now the
 *        corrected document is written by the SAME builder as the original
 *        (documentRow), then re-keyed by toAmendmentRow.
 *  #104  It compared against the ORIGINAL filing. An invoice corrected once and
 *        edited again must be compared with the LAST version filed — which may
 *        itself be an amendment — while still naming the original number and
 *        date, the portal's key for the document. See latestVersions.
 *  #103  Every correction went into the next return automatically. An edit made
 *        for an internal reason must never become a filed amendment without the
 *        shopkeeper's (or CA's) say. Each correction now carries a fingerprint;
 *        the route includes only those switched on whose fingerprint still
 *        matches — edit the bill again and the switch turns itself off.
 */

/** One VERSION of a document as a filed return declared it — the original, or a later amendment. */
export interface FiledVersion {
  section: DocSection
  /** ctin (b2b, cdnr) or pos (b2cl) the version was filed under; '' for cdnur. */
  group: string
  /** The FIRST filing's number and date: the portal's key for the document, however often corrected. */
  original: { num: string; dt: string }
  /** As this version declared it. */
  num: string
  dt: string
  val: number
  pos: string
  /** Filing period of this version (MMYYYY). */
  fp: string
  /** This version's row exactly as filed — re-declared at nil if the document is cancelled. */
  row: Record<string, any>
}

/** Pull every document version a filed return declared — originals AND its amendments — out of its stored JSON. */
export function filedVersionsFrom(rawJson: unknown, fp: string): FiledVersion[] {
  const g = rawJson as any
  if (!g || typeof g !== 'object') return []
  const out: FiledVersion[] = []
  const v = (section: DocSection, group: string, num: string, dt: string, original: { num: string; dt: string }, row: any, pos: string) =>
    out.push({ section, group, original, num: String(num), dt: String(dt), val: Number(row.val) || 0, pos: String(pos ?? ''), fp, row })

  for (const p of g.b2b || []) for (const r of p.inv || []) v('b2b', p.ctin, r.inum, r.idt, { num: String(r.inum), dt: r.idt }, r, r.pos)
  for (const p of g.b2cl || []) for (const r of p.inv || []) v('b2cl', p.pos, r.inum, r.idt, { num: String(r.inum), dt: r.idt }, r, p.pos)
  for (const p of g.cdnr || []) for (const r of p.nt || []) v('cdnr', p.ctin, r.nt_num, r.nt_dt, { num: String(r.nt_num), dt: r.nt_dt }, r, r.pos)
  for (const r of g.cdnur || []) v('cdnur', '', r.nt_num, r.nt_dt, { num: String(r.nt_num), dt: r.nt_dt }, r, r.pos)

  // Amended versions. Before 8c notes were stored with invoice keys (inum/oinum), so both are read.
  for (const p of g.b2ba || []) for (const r of p.inv || []) v('b2b', p.ctin, r.inum, r.idt, { num: String(r.oinum), dt: r.oidt }, r, r.pos)
  for (const p of g.b2cla || []) for (const r of p.inv || []) v('b2cl', p.pos, r.inum, r.idt, { num: String(r.oinum), dt: r.oidt }, r, p.pos)
  for (const p of g.cdnra || []) for (const r of p.nt || []) {
    v('cdnr', p.ctin, r.nt_num ?? r.inum, r.nt_dt ?? r.idt, { num: String(r.ont_num ?? r.oinum), dt: r.ont_dt ?? r.oidt }, r, r.pos)
  }
  for (const r of g.cdnura || []) {
    v('cdnur', '', r.nt_num ?? r.inum, r.nt_dt ?? r.idt, { num: String(r.ont_num ?? r.oinum), dt: r.ont_dt ?? r.oidt }, r, r.pos)
  }
  return out
}

const keyOf = (section: DocSection, originalNum: string) => `${section}:${originalNum}`
/** MMYYYY → YYYYMM, so periods sort as numbers. */
const order = (fp: string) => Number(fp.slice(2) + fp.slice(0, 2))

/** A document's latest filed version (#104), and the period it was FIRST filed in (which sets its deadline). */
export interface LatestVersion extends FiledVersion {
  key: string
  firstFp: string
}

/**
 * #104: the version to compare against is the LAST one filed. Every version of
 * one document shares its section and original number; the latest period wins.
 */
export function latestVersions(versions: FiledVersion[]): LatestVersion[] {
  const byKey = new Map<string, LatestVersion>()
  for (const ver of versions) {
    const key = keyOf(ver.section, ver.original.num)
    const seen = byKey.get(key)
    const firstFp = seen && order(seen.firstFp) < order(ver.fp) ? seen.firstFp : ver.fp
    if (!seen || order(ver.fp) >= order(seen.fp)) byKey.set(key, { ...ver, key, firstFp })
    else seen.firstFp = firstFp
  }
  return [...byKey.values()]
}

/** The same document as the books hold it today. */
export interface CurrentDoc {
  /** false: cancelled (deleted) after it was filed. */
  exists: boolean
  /** Where it lands today, from documentRow; null when it is no longer a GSTR-1 document of its own. */
  placed: { section: DocSection; group: string; row: Record<string, any> } | null
}

/** One correction to a filed document, ready for the shopkeeper to switch on (#103). */
export interface Correction {
  key: string
  section: DocSection
  /** The ctin / pos it was filed under — where the portal looks for it. */
  group: string
  original: { num: string; dt: string }
  firstFp: string
  /** The filed version this corrects (#104). */
  lastFp: string
  filedVal: number
  nowVal: number
  /** What changed, in words — for the screen only, never in the file. */
  changes: string[]
  /** The row for the amendment table; null when the app cannot write it (see problem). */
  row: Record<string, unknown> | null
  problem: string | null
  /** Changes whenever the row would change, so a switch set on an older version lapses. */
  fingerprint: string
}

/**
 * A rupee is the unit both returns are filed in, so anything smaller cannot be
 * declared and is not a difference worth amending for.
 */
const MATERIAL = 1

const NAMES: Record<DocSection, string> = {
  b2b: 'sales to GST customers', b2cl: 'large sales to other states', cdnr: 'notes to GST customers', cdnur: 'notes to other customers',
}

/** Fields each amendment row must carry (GSTN Save GSTR1 v4.1/v5.0, the rate-row variant). */
const REQUIRED: Record<DocSection, string[]> = {
  b2b: ['inum', 'idt', 'oinum', 'oidt', 'val', 'pos', 'rchrg', 'inv_typ', 'itms'],
  b2cl: ['inum', 'idt', 'oinum', 'oidt', 'val', 'itms'],
  cdnr: ['nt_num', 'nt_dt', 'ont_num', 'ont_dt', 'ntty', 'pos', 'rchrg', 'inv_typ', 'val', 'itms'],
  cdnur: ['typ', 'nt_num', 'nt_dt', 'ont_num', 'ont_dt', 'ntty', 'val', 'itms'],
}
export function amendmentRowProblems(section: DocSection, row: Record<string, unknown>): string[] {
  const missing = REQUIRED[section].filter((k) => row[k] === undefined || row[k] === null || row[k] === '')
  if (!Array.isArray(row.itms) || row.itms.length === 0) missing.push('itms (empty)')
  return missing
}

/**
 * Compare each document's LAST filed version with the books as they stand.
 *
 * @param latest  latestVersions() of every earlier FILED return
 * @param current the same documents today, keyed by document number
 */
export function buildCorrections(latest: LatestVersion[], current: Map<string, CurrentDoc>): Correction[] {
  const out: Correction[] = []
  for (const f of latest) {
    const now = current.get(f.num) ?? current.get(f.original.num)
    let changes: string[] = []
    let row: Record<string, unknown> | null = null
    let problem: string | null = null
    let nowVal = 0

    if (!now || !now.exists) {
      /*
       * Cancelled after filing. A real amendment — the portal must be told the
       * value is now nil, or the buyer keeps claiming credit on a bill that no
       * longer exists — declared as the last filed row with every amount at nil.
       */
      changes = ['This was cancelled after the return was filed']
      row = toAmendmentRow(f.section, zeroedRow(f.row), f.original)
    } else if (!now.placed || now.placed.section !== f.section) {
      nowVal = now.placed ? roundMoney(Number(now.placed.row.val) || 0) : 0
      problem = now.placed
        ? `This now belongs with ${NAMES[now.placed.section]}, not ${NAMES[f.section]} where it was filed — a correction cannot move it. Ask your CA.`
        : 'This is no longer a separate document in GSTR-1 (for example, it is now all exempt). Ask your CA how to correct it.'
      changes = [problem]
    } else {
      const r = now.placed.row
      nowVal = roundMoney(Number(r.val) || 0)
      const dt = String(r.idt ?? r.nt_dt ?? '')
      const pos = String(r.pos ?? now.placed.group ?? '')
      if (Math.abs(nowVal - roundMoney(f.val)) >= MATERIAL) changes.push(`Value changed from ₹${roundMoney(f.val)} to ₹${nowVal}`)
      if (dt !== f.dt) changes.push(`Date changed from ${f.dt} to ${dt}`)
      if (pos !== f.pos) changes.push(`Place of supply changed from ${f.pos} to ${pos}`)
      /*
       * A changed GSTIN is the most consequential: the credit went to the wrong
       * buyer entirely, and neither the right one nor the wrong one can fix it
       * from their side.
       */
      const gstinChanged = (f.section === 'b2b' || f.section === 'cdnr') && !!now.placed.group && !!f.group && now.placed.group !== f.group
      if (gstinChanged) changes.push(`Customer GSTIN changed from ${f.group} to ${now.placed.group}`)
      // #105: a rate or a nil/exempt move at the SAME total is still a change — the lines are compared, not just val.
      // When the total moved too, only a rate change adds news; "taxable value changed" would repeat it.
      const valueMoved = changes.some((c) => c.startsWith('Value changed'))
      changes.push(...lineChanges(f.row, r).filter((c) => !valueMoved || c.startsWith('Tax rate')))
      if (changes.length === 0) continue
      if (gstinChanged) {
        /*
         * #100 (8c-3): NOT impossible — but not a 9A row the app writes either.
         * GSTN's 9A row has no field for a new GSTIN: the group's ctin is how the
         * portal finds the ORIGINAL ("GSTIN of the receiver does not match the
         * original invoice records"), so a row would keep the old GSTIN and look
         * like a fix. Whether the portal lets 9A change it is disputed (GSTN FAQ:
         * "only through GSTR 1 of the following tax periods"; offline-tool guides:
         * not editable) — logged for the CA, #345. The route every source accepts
         * is a credit note and a fresh bill.
         */
        problem = GSTIN_CORRECTION_ROUTE
      } else {
        row = toAmendmentRow(f.section, r, f.original)
      }
    }

    if (row) {
      const missing = amendmentRowProblems(f.section, row)
      if (missing.length) {
        problem = 'The filed record of this document is in an older format the app cannot correct automatically. Ask your CA.'
        row = null
      }
    }

    out.push({
      key: f.key, section: f.section, group: f.group, original: f.original,
      firstFp: f.firstFp, lastFp: f.fp,
      filedVal: roundMoney(f.val), nowVal,
      changes, row, problem,
      fingerprint: fingerprint({ key: f.key, group: f.group, row }),
    })
  }
  return out
}

/** Per rate: taxable value and tax, summed over a row's items. */
function byRate(row: Record<string, any>): Map<number, { txval: number; tax: number }> {
  const m = new Map<number, { txval: number; tax: number }>()
  for (const it of Array.isArray(row?.itms) ? row.itms : []) {
    const d = it.itm_det || {}
    const rt = Number(d.rt) || 0
    const cur = m.get(rt) || { txval: 0, tax: 0 }
    cur.txval = roundMoney(cur.txval + (Number(d.txval) || 0))
    cur.tax = roundMoney(cur.tax + (Number(d.iamt) || 0) + (Number(d.camt) || 0) + (Number(d.samt) || 0) + (Number(d.csamt) || 0))
    m.set(rt, cur)
  }
  return m
}

/**
 * #105 (Phase 8c-3, CA review Q1.4): changes the total cannot show. A rate
 * corrected from 18% to 5%, or a line moved between taxable and nil/exempt,
 * can leave the bill total exactly where it was — and still change what the
 * return declares. Compared line by line, by rate.
 */
export function lineChanges(filedRow: Record<string, any>, nowRow: Record<string, any>): string[] {
  const a = byRate(filedRow)
  const b = byRate(nowRow)
  const rates = (m: Map<number, unknown>) => [...m.keys()].sort((x, y) => x - y)
  const list = (r: number[]) => r.map((x) => `${x}%`).join(' + ') || 'none'
  const ra = rates(a)
  const rb = rates(b)
  if (ra.join() !== rb.join()) return [`Tax rate changed from ${list(ra)} to ${list(rb)}`]
  const sum = (m: Map<number, { txval: number }>) => roundMoney([...m.values()].reduce((s, v) => s + v.txval, 0))
  const out: string[] = []
  if (Math.abs(sum(b) - sum(a)) >= MATERIAL) out.push(`Taxable value changed from ₹${sum(a)} to ₹${sum(b)}`)
  else if (ra.some((rt) => Math.abs(a.get(rt)!.txval - b.get(rt)!.txval) >= MATERIAL || Math.abs(a.get(rt)!.tax - b.get(rt)!.tax) >= MATERIAL)) {
    out.push('Value split between tax rates changed')
  }
  return out
}

/**
 * #100: how a wrong customer GSTIN is put right. Shown on the correction itself
 * and by GSTR-1A, so both say the same thing.
 */
export const GSTIN_CORRECTION_ROUTE =
  'Customer GSTIN changed: raise a credit note on this bill and a fresh bill to the right GSTIN — the route the portal always accepts. A Table 9A change of GSTIN is disputed between sources; ask your CA before trying it.'

/** The same advice in the few words a row has room for; the sentence above goes behind ⓘ. */
export const GSTIN_CORRECTION_SHORT = 'Fix with a credit note and a fresh bill to the right GSTIN'

/** The portal's four amendment tables, from the corrections that are going in. */
export interface AmendmentTables {
  /** Table 9A — amended B2B invoices, grouped by the GSTIN they were filed under. */
  b2ba: Array<{ ctin: string; inv: Record<string, unknown>[] }>
  /** Table 9A — amended large inter-state B2C invoices, grouped by place of supply. */
  b2cla: Array<{ pos: string; inv: Record<string, unknown>[] }>
  /** Table 9C — amended notes against a REGISTERED buyer. */
  cdnra: Array<{ ctin: string; nt: Record<string, unknown>[] }>
  /** Table 9C — amended notes against an unregistered buyer. */
  cdnura: Record<string, unknown>[]
}

export function amendmentTables(corrections: Correction[]): AmendmentTables {
  const b2ba = new Map<string, Record<string, unknown>[]>()
  const b2cla = new Map<string, Record<string, unknown>[]>()
  const cdnra = new Map<string, Record<string, unknown>[]>()
  const cdnura: Record<string, unknown>[] = []
  for (const c of corrections) {
    if (!c.row) continue
    if (c.section === 'b2b') push(b2ba, c.group, c.row)
    else if (c.section === 'b2cl') push(b2cla, c.group, c.row)
    else if (c.section === 'cdnr') push(cdnra, c.group, c.row)
    else cdnura.push(c.row)
  }
  return {
    b2ba: [...b2ba.entries()].map(([ctin, inv]) => ({ ctin, inv })),
    b2cla: [...b2cla.entries()].map(([pos, inv]) => ({ pos, inv })),
    cdnra: [...cdnra.entries()].map(([ctin, nt]) => ({ ctin, nt })),
    cdnura,
  }
}

function push<T>(m: Map<string, T[]>, key: string, v: T) {
  if (!m.has(key)) m.set(key, [])
  m.get(key)!.push(v)
}

/** Stable text of a value: object keys sorted, so the same row always prints the same. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as any)[k])}`).join(',')}}`
  return JSON.stringify(v)
}

/** FNV-1a over the stable text — short, deterministic, enough to notice a changed row. */
export function fingerprint(v: unknown): string {
  let h = 0x811c9dc5
  for (const ch of stable(v)) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** The corrections switched on for a return: key → fingerprint, as stored on its snapshot. */
export type IncludedCorrections = Record<string, string>

/** #103: only what was switched on AND still matches — an edit after switching on turns it off. */
export function includedCorrections(all: Correction[], included: IncludedCorrections | null | undefined): Correction[] {
  const on = included || {}
  return all.filter((c) => c.row && on[c.key] === c.fingerprint)
}

/* ══════════════════════════════════════════════════════════════════════════
 * WHAT CAN STILL BE CORRECTED, AND HOW (#89, #90)
 *
 * Everything above answers "has this invoice changed since we filed it?".
 * These answer the two questions that follow, which the app never asked:
 * is it too late, and is this particular change even allowed?
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * A CUSTOMER'S GSTIN — what can and cannot fix it (#90, CORRECTED by #100 in 8c-3).
 *
 * This block used to say a GSTIN "cannot be amended in ANY period". That was
 * wrong (#100): the GSTN GSTR-1A FAQ says a GSTIN can be changed "only through
 * GSTR 1 of the following tax periods" — it is GSTR-1A that refuses it. But
 * whether Table 9A really accepts a new GSTIN is disputed (offline-tool guides
 * call the field not editable, and the portal finds the original BY its GSTIN),
 * and GSTN's 9A row has no field for a new one. So: GSTR-1A blocks it; the
 * later-month route is not written by the app (buildCorrections shows the
 * reason, GSTIN_CORRECTION_ROUTE, instead of a row); the credit note + fresh
 * bill route is the one every source accepts. Open question for the CA: #345.
 *
 * ONE DEFINITION, used by both correction routes — two GSTIN rules would be
 * the drift class that caused four earlier bugs.
 *
 * @param changes the `changes` array buildCorrections produces
 */
export function gstinChanged(changes: string[]): boolean {
  return changes.some(c => /gstin/i.test(c))
}

/** GSTR-1A's answer (#100): not here — and how instead. */
export const GSTIN_GSTR1A_REMEDY =
  'GSTR-1A cannot change a customer’s GSTIN. ' + GSTIN_CORRECTION_ROUTE

export interface AmendmentDeadline {
  /** 30 November following the end of that financial year. */
  novemberCutoff: Date
  /** Whichever applies: the cutoff, or the annual return if filed earlier. */
  effectiveDeadline: Date
  daysLeft: number
  /** True once nothing more can be corrected for that period. */
  expired: boolean
  /** Why it expired — the annual return, or the calendar. */
  closedBy: 'annual-return' | 'november-cutoff' | null
  message: string
}

/**
 * How long is left to correct a filed period.
 *
 * THE RULE. A mistake cannot be corrected forever. The cut-off is **30 November
 * following the end of the financial year the invoice belongs to, OR the date
 * the annual return for that year is filed — WHICHEVER IS EARLIER.**
 *
 * The "whichever is earlier" half is the part that catches people, and it is
 * the half a calendar cannot tell you: file the annual return in August and the
 * door shuts in August, three months before the date everyone remembers.
 *
 * WHY THIS MATTERS HERE. Our amendment screen lists corrections with no
 * deadline at all. A shopkeeper can see "this bill needs amending" every month
 * for a year and reasonably assume it will keep waiting for them. It will not,
 * and when it stops waiting nothing tells them — the row simply becomes
 * permanent.
 *
 * @param fp        filing period of the ORIGINAL invoice, MMYYYY
 * @param asOn      today
 * @param annualReturnFiledOn  when GSTR-9 for that FY was filed, if it was
 */
export function amendmentDeadline(
  fp: string,
  asOn: Date = new Date(),
  annualReturnFiledOn?: Date | string | null,
): AmendmentDeadline {
  const month = Number(fp.slice(0, 2))
  const year = Number(fp.slice(2))

  /*
   * The financial year runs April to March, so Jan–Mar belong to the year
   * BEFORE their calendar year. An invoice from February 2026 is in FY 2025-26,
   * whose deadline is 30 November 2026 — not November 2027. Getting this
   * backwards would give someone a year they do not have.
   */
  const fyStartYear = month >= 4 ? year : year - 1
  const novemberCutoff = new Date(fyStartYear + 1, 10, 30)   // 30 Nov, month index 10

  const annual = annualReturnFiledOn
    ? (annualReturnFiledOn instanceof Date ? annualReturnFiledOn : new Date(annualReturnFiledOn))
    : null
  const annualValid = annual && !Number.isNaN(annual.getTime()) ? annual : null

  const effectiveDeadline = annualValid && annualValid < novemberCutoff ? annualValid : novemberCutoff
  const closedBy: AmendmentDeadline['closedBy'] =
    annualValid && annualValid < novemberCutoff ? 'annual-return' : 'november-cutoff'

  const a = Date.UTC(asOn.getFullYear(), asOn.getMonth(), asOn.getDate())
  const b = Date.UTC(effectiveDeadline.getFullYear(), effectiveDeadline.getMonth(), effectiveDeadline.getDate())
  const daysLeft = Math.round((b - a) / 86_400_000)
  const expired = daysLeft < 0

  const dateText = effectiveDeadline.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })

  return {
    novemberCutoff,
    effectiveDeadline,
    daysLeft,
    expired,
    closedBy: expired ? closedBy : null,
    message: expired
      ? (closedBy === 'annual-return'
        ? `Too late to correct this. You filed the annual return for that year on ${dateText}, which closes corrections for it — earlier than the usual 30 November date.`
        : `Too late to correct this. The deadline for that year was ${dateText}.`)
      : (closedBy === 'annual-return'
        ? `You have ${daysLeft} days. Filing the annual return for that year will close this even sooner.`
        : `You have ${daysLeft} days — until ${dateText}. Filing the annual return for that year would close it sooner.`),
  }
}
