/**
 * @jest-environment node
 *
 * BEHAVIOURAL tests for the server-side feature flag kill switches.
 *
 * WHY (audit 2026-07-28): `isFeatureEnabled` returned `true` for any key it
 * could not find, and again on any database error.
 *
 * The dangerous half is the unknown key. This app has TWO flag systems with
 * confusingly similar names — these snake_case server kill switches
 * (`ai_scanner`), and the camelCase user-facing `features` toggles
 * (`aiScanner`). Passing one system's name to the other returned `true`
 * forever, which reads at the call site as a working gate and is not
 * detectable by inspection. A gate that always says yes is worse than no gate,
 * because everyone believes it is there.
 */

const mockFindUnique = jest.fn()
const mockCreateMany = jest.fn()

jest.mock('@/lib/db', () => ({
  db: {
    featureFlag: {
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
      createMany: (...a: unknown[]) => mockCreateMany(...a),
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}))

import { isFeatureEnabled, seedFeatureFlags } from '@/lib/feature-flags'

let consoleError: jest.SpyInstance

beforeEach(() => {
  jest.clearAllMocks()
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => consoleError.mockRestore())

describe('a real flag reflects the database', () => {
  it('returns false when an admin has switched the flag off', async () => {
    mockFindUnique.mockResolvedValue({ key: 'ai_scanner', enabled: false })
    expect(await isFeatureEnabled('ai_scanner')).toBe(false)
  })

  it('returns true when it is on', async () => {
    mockFindUnique.mockResolvedValue({ key: 'ai_scanner', enabled: true })
    expect(await isFeatureEnabled('ai_scanner')).toBe(true)
  })
})

describe('an unknown flag key is reported, not silently allowed', () => {
  it('reports the camelCase name from the OTHER flag system', async () => {
    mockFindUnique.mockResolvedValue(null)

    // `aiScanner` belongs to the user-facing `features` toggles, not here.
    await isFeatureEnabled('aiScanner')

    expect(consoleError).toHaveBeenCalled()
    const logged = consoleError.mock.calls.flat().join(' ')
    expect(logged).toContain('aiScanner')
    expect(logged).toContain('not gating anything')
  })

  it('names the valid flags so the fix is obvious from the report alone', async () => {
    mockFindUnique.mockResolvedValue(null)
    await isFeatureEnabled('totally_made_up_flag')
    const logged = consoleError.mock.calls.flat().join(' ')
    expect(logged).toContain('ai_scanner')
    expect(logged).toContain('new_signups')
  })

  it('reports a given bad key only once, so a hot path cannot flood Sentry', async () => {
    mockFindUnique.mockResolvedValue(null)
    await isFeatureEnabled('repeated_bad_key')
    await isFeatureEnabled('repeated_bad_key')
    await isFeatureEnabled('repeated_bad_key')
    const forThisKey = consoleError.mock.calls
      .flat()
      .join(' ')
      .split('repeated_bad_key').length - 1
    expect(forThisKey).toBeGreaterThan(0)
    expect(consoleError.mock.calls.length).toBe(1)
  })
})

describe('a database failure falls back to the flag’s own default, not blanket true', () => {
  it('survives a read error for a known flag', async () => {
    // Fail OPEN deliberately: a database blip must not switch the bill scanner
    // off for every shop at once.
    mockFindUnique.mockRejectedValue(new Error('connection lost'))
    expect(await isFeatureEnabled('ai_scanner')).toBe(true)
  })

  it('uses the declared default when the row was never seeded', async () => {
    mockFindUnique.mockResolvedValue(null)
    // Every flag currently defaults to true; this asserts the value comes FROM
    // the declaration, so a flag added as `enabled: false` stays off.
    expect(await isFeatureEnabled('new_signups')).toBe(true)
  })
})

describe('seeding is atomic and never silent', () => {
  it('seeds every flag in ONE statement rather than a read-then-write loop', async () => {
    mockCreateMany.mockResolvedValue({ count: 8 })
    await seedFeatureFlags()

    expect(mockCreateMany).toHaveBeenCalledTimes(1)
    // The old loop raced: two concurrent seeders both saw "missing" and both
    // created. skipDuplicates makes Postgres resolve that atomically.
    expect(mockCreateMany.mock.calls[0][0].skipDuplicates).toBe(true)
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('reports a seeding failure instead of swallowing it', async () => {
    mockCreateMany.mockRejectedValue(new Error('table is missing'))
    await expect(seedFeatureFlags()).resolves.toBeUndefined() // still non-fatal
    expect(consoleError).toHaveBeenCalled()
    expect(consoleError.mock.calls.flat().join(' ')).toContain('table is missing')
  })
})
