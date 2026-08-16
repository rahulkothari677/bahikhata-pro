/**
 * Phase 6: a preset may not lie about the law.
 *
 * 📄 docs/INVOICE-ENGINE-PLAN.md Phase 6.
 *
 * THE FAILURE THIS GUARDS is not a crash. It is a shopkeeper believing
 * something. A preset that marks a convention as a legal requirement makes a
 * jeweller print a field they do not need and distrust the next thing the app
 * tells them; one that marks a legal requirement as optional lets a chemist
 * skip the batch number a Drug Inspector will ask for.
 *
 * So the `law` claims are pinned here, by name, and adding a new one fails
 * this test until somebody writes down which rule it comes from. That is the
 * point: the check is a place where a claim about the law has to be defended.
 *
 * I got this wrong myself while writing it — I believed HUID on the invoice
 * was mandatory, checked, and found it is voluntary. The app now says so, and
 * this test is what stops the belief coming back.
 */

import { readCode } from '@/test-support/read-source'
import {
  TRADE_PRESETS,
  getTradePreset,
  hasLegalFields,
  type TradePreset,
} from '@/lib/trade-presets'
import { reservedLabelError, keyFromLabel, MAX_FIELDS_PER_ENTITY } from '@/lib/custom-fields'

describe('what the app claims the law requires', () => {
  /**
   * Every field marked `law`, as label + preset. If this list changes, someone
   * is making a new legal claim and must say where it comes from.
   */
  const legalClaims = TRADE_PRESETS.flatMap(p =>
    p.fields.filter(f => f.basis === 'law').map(f => `${p.id}:${f.label}`),
  ).sort()

  it('is exactly the two I could substantiate', () => {
    /*
     * Batch and expiry for medicines: Drugs and Cosmetics Rules, and Drug
     * Inspectors cross-reference billing records against them.
     *
     * NOTHING ELSE. Not HUID — hallmarking is mandatory, printing the HUID on
     * the invoice is voluntary. Not the vehicle number — it is needed for an
     * e-way bill, not on the invoice itself.
     */
    expect(legalClaims).toEqual(['pharmacy:Batch No.', 'pharmacy:Expiry'])
  })

  it('every legal field explains itself by naming the rule', () => {
    for (const p of TRADE_PRESETS) {
      for (const f of p.fields.filter(x => x.basis === 'law')) {
        expect({ field: f.label, namesRule: /Drugs and Cosmetics/i.test(f.why) })
          .toEqual({ field: f.label, namesRule: true })
      }
    }
  })

  it('says plainly when something is NOT the law', () => {
    // The jeweller case, because it is the one I got wrong.
    const huid = getTradePreset('jewellery')!.fields.find(f => f.label === 'HUID')!
    expect(huid.basis).toBe('practice')
    expect(huid.why).toMatch(/not|voluntary/i)
  })

  it('marks only legal fields as required', () => {
    /*
     * A required field BLOCKS a sale. Doing that for a convention would stop a
     * shopkeeper billing a customer over a field nobody asked them for.
     */
    for (const p of TRADE_PRESETS) {
      for (const f of p.fields) {
        if (f.required) {
          expect({ preset: p.id, field: f.label, basis: f.basis })
            .toEqual({ preset: p.id, field: f.label, basis: 'law' })
        }
      }
    }
  })

  it('hasLegalFields tells the two kinds apart', () => {
    // Runnable both ways, on inputs the test controls.
    expect(hasLegalFields(getTradePreset('pharmacy')!)).toBe(true)
    expect(hasLegalFields(getTradePreset('textile')!)).toBe(false)
    const empty = { id: 'x', label: 'x', examples: '', fields: [] } as TradePreset
    expect(hasLegalFields(empty)).toBe(false)
  })
})

describe('presets obey the Phase 5 rules', () => {
  it('no preset field forges a Rule 46 particular', () => {
    // The reserved check would refuse them at the API, but a preset that
    // silently dropped half its fields is worse than one that never shipped.
    for (const p of TRADE_PRESETS) {
      for (const f of p.fields) {
        expect({ field: f.label, error: reservedLabelError(f.label) })
          .toEqual({ field: f.label, error: null })
      }
    }
  })

  it('no preset exceeds the per-entity cap', () => {
    for (const p of TRADE_PRESETS) {
      for (const entity of ['item', 'invoice', 'party']) {
        const n = p.fields.filter(f => f.entity === entity).length
        expect({ preset: p.id, entity, withinCap: n <= MAX_FIELDS_PER_ENTITY })
          .toEqual({ preset: p.id, entity, withinCap: true })
      }
    }
  })

  it('no two fields in one preset collide on a key', () => {
    // Two definitions on one key would fight over one slot in stored JSON.
    for (const p of TRADE_PRESETS) {
      const keys = p.fields.map(f => `${f.entity}:${keyFromLabel(f.label)}`)
      expect({ preset: p.id, unique: new Set(keys).size === keys.length })
        .toEqual({ preset: p.id, unique: true })
    }
  })

  it('every field says why it exists', () => {
    for (const p of TRADE_PRESETS) {
      for (const f of p.fields) {
        expect({ field: f.label, explained: f.why.trim().length > 20 })
          .toEqual({ field: f.label, explained: true })
      }
    }
  })
})

describe('applying a preset is ordinary and repeatable', () => {
  const route = readCode('src/app/api/custom-fields/preset/route.ts')

  it('creates ordinary fields, through the same rules', () => {
    // A private write path would be a second vocabulary for "a field this shop
    // has", and the two would disagree the first time one changed.
    expect(route).toContain('db.customFieldDef.create')
    expect(route).toContain('reservedLabelError')
    expect(route).toContain('MAX_FIELDS_PER_ENTITY')
  })

  it('applying twice adds nothing the second time', () => {
    // Tapping a trade twice must not produce two Batch No. columns.
    expect(route).toContain('skipped')
    expect(route).toContain('clash')
  })

  it('never overwrites a field the shopkeeper already has', () => {
    /*
     * They may have renamed it, stopped printing it, or made it required.
     * A preset re-run that reset those would undo deliberate choices.
     */
    const live = route.slice(route.indexOf('if (clash && !clash.deletedAt)'))
    expect(live.slice(0, 200)).toContain('continue')
  })
})
