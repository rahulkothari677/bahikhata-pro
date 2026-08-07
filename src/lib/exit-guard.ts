'use client'

/**
 * A way for one screen to say "ask me before you leave".
 *
 * WHY IT IS A REGISTRY AND NOT A PROP
 *
 * Leaving a screen happens in places that know nothing about the screen being
 * left: the app header's back arrow, and the Android hardware back button in
 * CapacitorBridge. Neither can reasonably be taught about half-written sales.
 *
 * It also cannot live inside `setView`, which is synchronous — it changes the
 * store and returns. A confirmation is a question with an answer that arrives
 * later, so the decision has to be taken BEFORE the navigation call, by
 * whoever is about to make it.
 *
 * So the screen registers a guard while it is mounted, the exits consult it,
 * and nothing in between has to know anything.
 *
 * WHAT IT PROTECTS AGAINST
 *
 * Not data loss — autosave has already written the draft. What it protects is
 * the user's understanding: previously a half-written sale vanished silently
 * on back, and finding it again meant knowing that "Drafts" existed and that
 * the work had gone there. Nothing on screen said so.
 */

/** Resolve true to allow the navigation, false to stay put. */
type ExitGuard = () => Promise<boolean>

let current: ExitGuard | null = null

/**
 * Register (or clear, with null) the guard for the mounted screen.
 *
 * Deliberately single-slot: two screens are never mounted and leavable at the
 * same time, and a stack would only invite a stale guard to outlive its screen
 * and block navigation from somewhere else entirely.
 */
export function registerExitGuard(guard: ExitGuard | null) {
  current = guard
}

/**
 * Ask the mounted screen whether it is willing to be left.
 *
 * Returns true when there is no guard, so every existing caller that has not
 * been taught about this keeps working unchanged. A guard that throws is
 * treated as "yes" — a broken confirmation must never trap someone on a
 * screen they are trying to leave.
 */
export async function confirmExit(): Promise<boolean> {
  if (!current) return true
  try {
    return await current()
  } catch {
    return true
  }
}
