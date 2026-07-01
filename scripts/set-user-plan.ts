/**
 * Set a user's plan to Pro (or Elite) — for testing without Razorpay.
 *
 * Usage:
 *   npx tsx scripts/set-user-plan.ts <email> <plan>
 *
 * Example:
 *   npx tsx scripts/set-user-plan.ts rahulkothari677@gmail.com pro
 *   npx tsx scripts/set-user-plan.ts rahulkothari677@gmail.com elite
 *   npx tsx scripts/set-user-plan.ts rahulkothari677@gmail.com free   # reset to free
 *
 * This script connects to your PRODUCTION database via DATABASE_URL env var.
 * Run it locally — it will use the .env file's DATABASE_URL.
 *
 * To target production DB, temporarily set DATABASE_URL to your Neon/Vercel
 * Postgres connection string before running.
 */

import { PrismaClient } from '@prisma/client'

const email = process.argv[2]
const plan = process.argv[3] as 'free' | 'pro' | 'elite'

if (!email || !plan) {
  console.error('Usage: npx tsx scripts/set-user-plan.ts <email> <plan>')
  console.error('  plan: free | pro | elite')
  process.exit(1)
}

if (!['free', 'pro', 'elite'].includes(plan)) {
  console.error(`Invalid plan: ${plan}. Must be: free | pro | elite`)
  process.exit(1)
}

async function main() {
  const prisma = new PrismaClient()

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, plan: true },
    })

    if (!user) {
      console.error(`❌ User not found with email: ${email}`)
      console.error('')
      console.error('Available users in this database:')
      const users = await prisma.user.findMany({ select: { email: true, name: true, plan: true } })
      users.forEach(u => console.error(`  ${u.email} (${u.name || 'no name'}) — current plan: ${u.plan}`))
      process.exit(1)
    }

    console.log(`Found user: ${user.email} (${user.name || 'no name'})`)
    console.log(`Current plan: ${user.plan}`)

    const updated = await prisma.user.update({
      where: { email },
      data: {
        plan,
        // Set renewal date 1 year from now so the plan doesn't appear "expired"
        renewsAt: plan === 'free' ? null : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        cancelledAt: null,
      },
      select: { email: true, plan: true, renewsAt: true },
    })

    console.log('')
    console.log(`✅ Updated successfully!`)
    console.log(`   Email: ${updated.email}`)
    console.log(`   Plan: ${updated.plan}`)
    if (updated.renewsAt) {
      console.log(`   Renews at: ${updated.renewsAt.toISOString()}`)
    }
    console.log('')
    console.log(`The user can now use all ${plan} plan features.`)
    console.log(`(They may need to log out and log back in for the change to take effect.)`)
  } catch (error) {
    console.error('❌ Error updating user:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
