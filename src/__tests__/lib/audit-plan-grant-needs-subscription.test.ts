/**
 * 🔒 GRANTING A PLAN MEANS WRITING A SUBSCRIPTION.
 *
 * Phase 3, 2026-08-03. Found in TWO places, in two different repos.
 *
 * Since the V26 F3 expiry fix, `user.plan` is a CLAIM, not the answer.
 * getUserPlan() reads it, and for 'pro'/'elite' it then looks for an active,
 * non-expired Subscription row — returning 'free' when there is none:
 *
 *     const plan = user?.plan as Plan
 *     if (plan === 'pro' || plan === 'elite') {
 *       const activeSub = await db.subscription.findFirst({ ... })
 *       if (!activeSub) return 'free'
 *     }
 *
 * Both of these set `user.plan` and stopped:
 *
 *   main app  — /api/referral/apply: the referral reward AND the 7-day welcome
 *               trial. A shopkeeper who referred three friends was told
 *               "you earned 1 year of Pro" and stayed free. The trial message
 *               said "You got 7 days of Pro free 🎉" and granted nothing.
 *   admin app — /api/admin/bulk change_plan. Bulk-upgrading 100 shopkeepers
 *               reported "100 users changed to pro" and upgraded nobody.
 *
 * This is an INTERACTION bug: the expiry fix was right, and both grant paths
 * were right before it landed. Nothing in either file is wrong on its own,
 * which is why reading them individually would never have found it. That is
 * the argument for this test rather than a comment.
 */
import fs from 'fs'
import path from 'path'

const read = (abs: string) => fs.readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
const PRO = process.cwd()
const ADMIN = path.resolve(PRO, '../admin')

describe('the rule this test enforces still exists', () => {
  test('getUserPlan really does require an active Subscription', () => {
    // If this ever stops being true, every assertion below is pointless — and
    // should be deleted rather than left as reassuring decoration.
    const src = read(path.join(PRO, 'src/lib/usage-limits.ts'))
    const fn = src.slice(src.indexOf('export async function getUserPlan'))
    expect(fn).toMatch(/db\.subscription\.findFirst/)
    expect(fn).toMatch(/status: 'active'/)
    expect(fn).toMatch(/endDate: \{ gte: new Date\(\) \}/)
    expect(fn).toMatch(/return 'free'/)
  })
})

describe('main app: the referral grants are real', () => {
  const src = read(path.join(PRO, 'src/app/api/referral/apply/route.ts'))

  test('the reward writes a Subscription, not just user.plan', () => {
    expect(src).toMatch(/tx\.subscription\.create/)
    expect(src).toMatch(/paymentMode: REWARD_PAYMENT_MODE/)
  })

  test('the welcome trial writes one too', () => {
    expect(src).toMatch(/paymentMode: TRIAL_PAYMENT_MODE/)
    // Two grants => two subscription writes.
    expect((src.match(/tx\.subscription\.create/g) || []).length).toBe(2)
  })

  test('the whole redemption is one transaction', () => {
    // Was three separate writes: a crash after granting Pro but before marking
    // the referrals rewarded left them eligible, so the next completed
    // referral granted another year.
    expect(src).toMatch(/db\.\$transaction\(async \(tx\)/)
  })

  test('the code is claimed conditionally, so it cannot be redeemed twice', () => {
    // findFirst({status:'pending'}) + unconditional update let two concurrent
    // requests both redeem it. The status now lives in the WHERE of the write.
    expect(src).toMatch(/tx\.referral\.updateMany\(\{[\s\S]{0,120}status: 'pending'/)
    expect(src).toMatch(/claimed\.count === 0/)
  })

  test('the reward is marked before it is granted', () => {
    // Marking first, conditionally, is what makes a concurrent second grant
    // impossible: the loser's updateMany matches 0 rows.
    const markIdx = src.indexOf('rewardGiven: false')
    const grantIdx = src.indexOf('tx.subscription.create')
    expect(markIdx).toBeGreaterThan(-1)
    expect(markIdx).toBeLessThan(grantIdx)
    expect(src).toMatch(/marked\.count > 0/)
  })
})

/*
 * The admin app's half of this rule (POST /api/admin/bulk change_plan) is
 * enforced in the ADMIN repo, by the admin repo's own CI:
 *
 *     admin/tests/plan-grant-writes-subscription.test.ts
 *
 * It was originally asserted here, reading the sibling checkout across the
 * filesystem. That passed on a laptop with both repos side by side and could
 * never pass in CI, which checks out one repo — so it failed the main app's
 * build on every push while proving nothing about the admin app. A guarantee
 * has to be enforced in the repo that can actually break it.
 *
 * The check below is kept as a convenience for local runs where both repos
 * are present, and skips otherwise. Skipping is not a silent pass: the real
 * enforcement lives in the admin repo and runs there on every push.
 */
const adminBulkRoute = path.join(ADMIN, 'src/app/api/admin/bulk/route.ts')
const adminPresent = fs.existsSync(adminBulkRoute)

const describeIfAdmin = adminPresent ? describe : describe.skip

describeIfAdmin('admin app: bulk plan change is real (local cross-check)', () => {
  test('change_plan writes Subscription rows', () => {
    const src = read(adminBulkRoute)
    expect(src).toMatch(/tx\.subscription\.createMany/)
    expect(src).toMatch(/paymentMode: 'admin_grant'/)
  })

  test('it supersedes previous grants and runs atomically', () => {
    const src = read(adminBulkRoute)
    expect(src).toMatch(/tx\.subscription\.updateMany/)
    expect(src).toMatch(/status: 'expired'/)
    expect(src).toMatch(/db\.\$transaction\(async \(tx\)/)
  })
})
