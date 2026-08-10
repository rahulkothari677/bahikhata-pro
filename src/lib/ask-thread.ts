/**
 * The conversation — what was asked, what came back, in order.
 *
 * WHY A THREAD AND NOT A SEARCH BOX. A single question with a single answer is
 * a lookup. A thread is what lets the next question mean something in terms of
 * the last one — "aur pichhle mahine?" is only answerable if we remember we
 * were talking about Ramesh. That follow-up behaviour is Phase 2.4; this file
 * is the container it will need, built now so the shape is right.
 *
 * IT ALSO ANSWERS "WHAT DID I ASK LAST WEEK?" A shopkeeper who checks their
 * receivables every Monday morning should not retype it every Monday morning.
 *
 * WHERE IT LIVES, HONESTLY. localStorage, per user, on this device. That is
 * the right MVP and the wrong long-term answer: it does not follow them to a
 * second phone, and clearing browser data loses it. Server-side history is a
 * later phase — but the shape below is deliberately serialisable so moving it
 * is a change of storage, not a change of model.
 *
 * NOTHING SENSITIVE IS INVENTED HERE. A stored answer is a snapshot of what
 * was true when it was asked, and it is labelled with its timestamp for
 * exactly that reason — a balance from Tuesday is not a claim about Friday.
 */

export interface AskSource {
  kind: 'transaction' | 'party' | 'product'
  id: string
  label: string
  amount?: number
  quantity?: number
  unit?: string
  date?: string
}

/** A person the answer could have meant, when more than one matched. */
export interface AskChoice {
  id: string
  name: string
  phone?: string | null
  balance?: number
  lastActivity?: string | null
  lastInvoiceNo?: string | null
}

export interface AskAnswerPayload {
  answered: boolean
  understoodAs?: string
  headline?: string
  detail?: string
  message?: string
  examples?: readonly string[]
  choices?: AskChoice[]
  sources?: AskSource[]
}

export type AskMessage =
  | { id: string; role: 'user'; text: string; at: number; viaVoice?: boolean }
  | { id: string; role: 'answer'; payload: AskAnswerPayload; at: number }
  | { id: string; role: 'thinking'; at: number }

const KEY = 'ekbook:ask-thread'
/** Enough to scroll back through a week of asking; small enough to stay fast. */
const MAX_MESSAGES = 100

export function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function loadThread(): AskMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // A half-written or hand-edited entry must not break the screen: drop
    // anything that does not look like a message rather than throwing.
    return parsed.filter((m: unknown) => {
      const x = m as AskMessage
      return x && typeof x === 'object' && 'role' in x && 'id' in x
    })
  } catch {
    return []
  }
}

export function saveThread(messages: AskMessage[]): void {
  if (typeof window === 'undefined') return
  try {
    // 'thinking' is a transient UI state, never history — persisting it would
    // restore a spinner that can never resolve.
    const durable = messages.filter(m => m.role !== 'thinking').slice(-MAX_MESSAGES)
    window.localStorage.setItem(KEY, JSON.stringify(durable))
  } catch {
    /* Storage full or blocked (private mode). The conversation still works for
       this session; losing history is better than losing the answer. */
  }
}

export function clearThread(): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(KEY) } catch { /* see above */ }
}

/** Distinct questions, most recent first — for the history drawer. */
export function recentQuestions(messages: AskMessage[], limit = 20): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'user') continue
    const key = m.text.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(m.text)
    if (out.length >= limit) break
  }
  return out
}

/**
 * "3:42 pm" / "Yesterday" / "9 Aug" — a stored answer must carry WHEN, because
 * a balance from Tuesday is not a claim about today.
 */
export function whenLabel(at: number): string {
  const d = new Date(at)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
