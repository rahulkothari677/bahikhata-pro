import '@testing-library/jest-dom'

// 🔒 AUDIT PASS-1 M7: give the unit-test run a syntactically-valid DATABASE_URL.
//
// THE PROBLEM: src/lib/db.ts constructs `new PrismaClient({ datasources: { db:
// { url: process.env.DATABASE_URL } } })` at MODULE LOAD time. Any suite that
// transitively imports db.ts (subscription, profit-visibility, the route
// sweeps — 11 suites) therefore threw
//   PrismaClientConstructorValidationError: Invalid value undefined for
//   datasource "db"
// before a single test ran. Jest reports that as "failed to run", NOT as a
// failing assertion — so on a machine or CI runner without DATABASE_URL you
// silently lose 11 suites of regression cover. That is the dangerous shape:
// coverage disappearing without anyone noticing it disappeared.
//
// These are PURE UNIT TESTS — they mock Prisma and never open a socket. They
// need the constructor to accept a well-formed string, nothing more. Pointing
// at a nonexistent local database is deliberate: if a test ever DOES try to
// reach the network it fails loudly with a connection error, instead of
// quietly talking to something real.
//
// An explicitly-set DATABASE_URL always wins, so a developer or CI job that
// points the suite at a real test database keeps working unchanged.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://jest:jest@127.0.0.1:1/jest_unit_tests_no_db'
}
if (!process.env.DIRECT_URL) {
  process.env.DIRECT_URL = process.env.DATABASE_URL
}
