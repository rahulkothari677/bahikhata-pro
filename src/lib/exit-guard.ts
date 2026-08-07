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

/*
 * A STACK, not a single slot.
 *
 * The first version of this was one slot, on the reasoning that two screens are
 * never leavable at once. That was wrong, and the barcode scanner proved it: it
 * opens as a full-screen overlay ON TOP of the sale form, which already has a
 * guard registered. With one slot the scanner's guard overwrote the form's, and
 * unregistering on close set it to null — leaving the form underneath with no
 * guard at all until it happened to re-register.
 *
 * Overlays nest. The stack lets the innermost one answer, and popping restores
 * whatever was beneath it, which is the behaviour the DOM already implies.
 */
const stack: ExitGuard[] = []

/**
 * Register a guard for as long as the caller is mounted.
 *
 * Returns its own unregister function rather than taking `null` later, so a
 * caller cannot accidentally clear somebody else's guard — the only thing it
 * can remove is the one it added.
 */
export function registerExitGuard(guard: ExitGuard): () => void {
  stack.push(guard)
  return () => {
    const i = stack.lastIndexOf(guard)
    if (i !== -1) stack.splice(i, 1)
  }
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
  const top = stack[stack.length - 1]
  if (!top) return true
  try {
    return await top()
  } catch {
    return true
  }
}
