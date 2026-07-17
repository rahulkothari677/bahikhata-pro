/**
 * 🔒 AUDIT V23 FIX §13.9e: Single source of truth for the app version string.
 *
 * Before this, the app had two disagreeing version strings:
 *   - AccountScreen footer: "EkBook v1.0 · Made with love for Bharat 🇮🇳"
 *   - About page:            "EkBook v1.0.0 (Beta)"
 *
 * The auditor flagged this in §13.9e. Now every surface reads from this one
 * constant. Bump it here and every page updates.
 *
 * Why env-var override: lets Vercel inject a build-specific version
 * (e.g. commit SHA short hash) at build time without code changes.
 */

export const APP_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0-beta'

export const APP_VERSION_LABEL = `EkBook v${APP_VERSION} (Beta)`
