#!/usr/bin/env node
/**
 * `next build` with throwaway env, on any OS.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * verify:build used to be a one-liner in package.json:
 *
 *   DATABASE_URL=... NEXTAUTH_SECRET=... npx next build
 *
 * That is POSIX shell syntax. npm runs scripts through cmd.exe on Windows,
 * where it is not a syntax error but a COMMAND — cmd looks for a program
 * called "DATABASE_URL", fails to find it, and exits non-zero. `npm run
 * verify` therefore stopped at the build step on Windows every single time,
 * without ever building anything.
 *
 * That matters because of what it repeats. `npm run verify` was created after
 * a non-compiling commit reached main: the old check ran `next lint`, which
 * Next 16 had removed, so it reported nothing and looked like a pass. Adding
 * the build to verify was the fix. A build step that cannot execute on the
 * machine the code is written on puts the hole straight back — the command
 * exits red, which is at least honest, but the temptation is to shrug at a
 * step that "never works locally" and push anyway.
 *
 * The values are deliberately fake. A production build only needs these to be
 * PRESENT and well-formed: Prisma parses DATABASE_URL at import time and
 * throws on a malformed one, and NextAuth refuses to initialise without a
 * secret. Nothing connects. Never point this at a real database.
 */

const { spawnSync } = require('child_process')
const path = require('path')

// Run Next's own CLI entry point with THIS node binary, rather than shelling
// out to `npx`. Two reasons, both Windows:
//   - npx is npx.cmd there, and since Node 18.20/20.12 spawning a .cmd without
//     shell:true throws EINVAL. Using shell:true instead would put us back in
//     cmd.exe, which is the thing that broke the original one-liner.
//   - resolving the binary ourselves means no PATH lookup and no quoting
//     rules to get wrong.
const nextBin = path.join(__dirname, '..', 'node_modules', 'next', 'dist', 'bin', 'next')

const result = spawnSync(
  process.execPath,
  [nextBin, 'build'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: 'postgresql://dummy:dummy@localhost:5432/dummy',
      NEXTAUTH_SECRET: 'ci-build-dummy-secret',
      NEXTAUTH_URL: 'http://localhost:3000',
    },
  },
)

if (result.error) {
  console.error('[verify:build] could not start next build:', result.error.message)
  process.exit(1)
}

// Surface a signal (SIGKILL from an OOM, say) as a failure rather than as the
// success that `status === null` would otherwise read as.
process.exit(result.status ?? 1)
