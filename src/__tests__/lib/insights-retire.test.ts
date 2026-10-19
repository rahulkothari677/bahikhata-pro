/**
 * 🔒 GUARD: the Smart Insights and Business Analytics cards are retired, and
 * nothing they offered is lost (Phase 5c-4; #238, #239, #240 — one engine).
 *
 * The menu/search entry that jumped to the old card now opens Home on
 * Insights; Top lists' "More" opens Insights → Items; a device that had hidden
 * the old sections keeps working; Profit is never offered to staff who may
 * not see it.
 */
import { describe, test, expect } from '@jest/globals'
import * as fs from 'fs'
import * as path from 'path'
import { getById } from '@/lib/nav-registry'
import { handleNavAction } from '@/lib/handle-nav-action'
import { useAppStore } from '@/store/app-store'
import { parseHidden, HOME_SECTIONS } from '@/lib/home-sections'
import { visibleSections } from '@/lib/insights-view'
import { readCode } from '@/test-support/read-source'

describe('retired cards', () => {
  test('gone from Home and from the code', () => {
    for (const f of ['SmartInsights.tsx', 'AnalyticsInsights.tsx']) {
      expect({ f, exists: fs.existsSync(path.join(process.cwd(), 'src/components/dashboard', f)) }).toEqual({ f, exists: false })
    }
    const home = readCode('src/components/dashboard/Dashboard.tsx')
    expect(home).not.toMatch(/SmartInsights|AnalyticsInsights|business-analytics/)
    expect(HOME_SECTIONS.map((s) => s.id)).not.toEqual(expect.arrayContaining(['insights']))
  })
  test('a device that had hidden the old sections keeps its other choices', () => {
    expect(parseHidden(JSON.stringify(['insights', 'analytics', 'tiles']))).toEqual(['tiles'])
  })
})

describe('the ways in now open Insights', () => {
  test('"Insights" in More / menu / search opens Home on the Insights view', () => {
    const dest = getById('smart-insights')!
    expect({ kind: dest.actionKind, view: dest.view, homeView: dest.actionParams?.homeView, label: dest.label })
      .toEqual({ kind: 'navigate', view: 'dashboard', homeView: 'insights', label: 'Insights' })
    useAppStore.setState({ homeView: 'overview', currentView: 'more' } as never)
    handleNavAction(dest)
    expect([useAppStore.getState().currentView, useAppStore.getState().homeView]).toEqual(['dashboard', 'insights'])
  })
  test('Top lists\' "More in Insights" opens Insights on Items', () => {
    expect(readCode('src/components/dashboard/Dashboard.tsx')).toMatch(/onSeeAnalytics=\{\(\) => \{ setInsightSection\('items'\); setHomeView\('insights'\)/)
  })
  test('Profit is offered only to those who may see profit', () => {
    expect(visibleSections(false)).toContain('profit')
    expect(visibleSections(true)).not.toContain('profit')
    expect(visibleSections(true)).toEqual(['sales', 'items', 'customers', 'udhaar'])
  })
})
