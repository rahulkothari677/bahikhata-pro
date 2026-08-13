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
  /**
   * What to ask when this one is picked.
   *
   * 🔒 B2. Picking used to be hard-coded to `${name} ka kitna baaki hai`,
   * because the only thing that ever offered choices was two customers with
   * the same name. P5.1b then started offering SCREENS the same way, so
   * picking "P&L Statement" asked "P&L Statement ka kitna baaki hai" — live,
   * and nonsense. A choice now carries its own follow-through; the party
   * phrasing stays the default so the disambiguation path is unchanged.
   */
  ask?: string
}

/**
 * THE NEXT STEP, ON THE ANSWER ITSELF.
 *
 * Knowing Ramesh owes ₹1,025 is not the job. Chasing it is. Every other
 * assistant stops at the sentence and leaves you to go and find the screen;
 * ours puts the actual button on the answer, because the shopkeeper asked the
 * question for a reason and we already know what it was.
 *
 * NOTHING HERE PERFORMS THE ACTION. An action carries an intent and the ids it
 * needs, and the client hands it to the SAME screen the rest of the app uses —
 * Settle for a payment, the existing WhatsApp reminder endpoint for a chase.
 * No second implementation of anything that touches money, which is the only
 * way the figure on the answer and the figure on the screen stay equal.
 *
 * `remind` is the one exception that leaves the app, and it still does not
 * send: it opens WhatsApp with the message prepared, so the shopkeeper presses
 * send. We never message a customer on their behalf without them seeing it.
 */
export interface AskAction {
  /**
   * 'open-screen' was nearly added as a SECOND array (`navigateActions`) beside
   * this one, which would have been two mechanisms for "a button on an answer".
   * That is the drift shape behind four bugs already fixed. One list.
   */
  kind: 'remind' | 'settle' | 'open-party' | 'open-screen'
  label: string
  /** Required for the party actions; absent for 'open-screen'. */
  partyId?: string
  /** nav-registry destination id, for 'open-screen'. */
  destinationId?: string
  /** Settle a specific bill rather than the running balance, when we know it. */
  transactionId?: string
  invoiceNo?: string | null
  amount?: number
}

export interface AskAnswerPayload {
  answered: boolean
  understoodAs?: string
  headline?: string
  detail?: string
  message?: string
  examples?: readonly string[]
  choices?: AskChoice[]
  /**
   * The name the shopkeeper actually typed, when this answer is a "which one?"
   * question about a party.
   *
   * 🔒 C2c: needed so that picking one can TEACH the app. It was only ever in
   * the display string ("2 matches for 'anil'"), and parsing a sentence back
   * into data is how the two drift apart the first time the wording changes.
   */
  searchedFor?: string
  sources?: AskSource[]
  actions?: AskAction[]
  /**
   * Where to take the shopkeeper, when they asked to be taken somewhere.
   *
   * EXECUTED ONCE, AT ASK TIME — never on render. A restored conversation
   * re-renders every card it contains, and navigating from render would
   * teleport someone out of their own history the moment they opened it.
   * AskChat performs this in the send handler, which restoring never calls.
   */
  navigate?: {
    kind: 'screen' | 'record'
    /** nav-registry destination id, for kind 'screen'. */
    destinationId?: string
    /** Transaction id, for kind 'record'. */
    transactionId?: string
    label: string
    /**
     * The period asked for, when one was — "pichhle mahine ki P&L".
     *
     * Dates, not a preset name. Which preset (if any) is EXACTLY this range is
     * decided on the client, where the picker's own definitions live: "this
     * week" and "this financial year" match none of them, and forcing them
     * onto last7/thisYear would show a different period than was asked for.
     */
    period?: string
    from?: string
    to?: string
  }
}

export type AskMessage =
  | { id: string; role: 'user'; text: string; at: number; viaVoice?: boolean }
  | { id: string; role: 'answer'; payload: AskAnswerPayload; at: number }
  | { id: string; role: 'thinking'; at: number }

/**
 * MANY CONVERSATIONS, NOT ONE.
 *
 * The first version kept a single running thread, so history was a list of
 * past QUESTIONS and tapping one re-asked it. That is wrong twice over:
 * re-asking costs a round trip to say something already on screen, and it
 * loses the thing you actually wanted — the conversation that question was
 * part of, with its answer, its receipts and whatever you asked next.
 *
 * So the unit of history is a CONVERSATION. "New chat" files the current one
 * away exactly as ChatGPT does; opening one from the drawer RESTORES it
 * rather than replaying it. Nothing is re-fetched, and a stored answer keeps
 * its original timestamp because a balance from Tuesday is not a claim about
 * today.
 */
export interface AskConversation {
  id: string
  /** Taken from the first question asked — the only title anyone would write. */
  title: string
  messages: AskMessage[]
  createdAt: number
  updatedAt: number
}

const STORE_KEY = 'ekbook:ask-conversations'
const LEGACY_KEY = 'ekbook:ask-thread'
/** Enough to scroll back through weeks; small enough to stay fast. */
const MAX_MESSAGES = 100
const MAX_CONVERSATIONS = 50

export function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function isMessage(m: unknown): m is AskMessage {
  const x = m as AskMessage
  return !!x && typeof x === 'object' && 'role' in x && 'id' in x
}

/** First question, trimmed to something that fits a drawer row. */
export function titleFor(messages: AskMessage[]): string {
  const first = messages.find(m => m.role === 'user')
  if (!first || first.role !== 'user') return 'New conversation'
  const t = first.text.trim()
  return t.length > 42 ? `${t.slice(0, 42)}…` : t
}

export function loadConversations(): AskConversation[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return []
      return parsed
        .filter(c => c && Array.isArray(c.messages) && c.id)
        .map(c => ({ ...c, messages: c.messages.filter(isMessage) }))
        .sort((a, b) => b.updatedAt - a.updatedAt)
    }
    /*
     * MIGRATE THE OLD SINGLE THREAD rather than dropping it. Someone who has
     * been using this since yesterday should not lose their questions because
     * the storage shape changed underneath them.
     */
    const legacy = window.localStorage.getItem(LEGACY_KEY)
    if (legacy) {
      const msgs = (JSON.parse(legacy) as unknown[]).filter(isMessage)
      window.localStorage.removeItem(LEGACY_KEY)
      if (msgs.length) {
        const conv: AskConversation = {
          id: newId(), title: titleFor(msgs), messages: msgs,
          createdAt: msgs[0].at, updatedAt: msgs[msgs.length - 1].at,
        }
        saveConversations([conv])
        return [conv]
      }
    }
    return []
  } catch {
    return []
  }
}

export function saveConversations(list: AskConversation[]): void {
  if (typeof window === 'undefined') return
  try {
    const durable = list
      .map(c => ({
        ...c,
        // 'thinking' is transient UI, never history — storing it would restore
        // a spinner that can never resolve.
        messages: c.messages.filter(m => m.role !== 'thinking').slice(-MAX_MESSAGES),
      }))
      .filter(c => c.messages.length > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CONVERSATIONS)
    window.localStorage.setItem(STORE_KEY, JSON.stringify(durable))
  } catch {
    /* Storage full or blocked (private mode). The conversation still works for
       this session; losing history is better than losing the answer. */
  }
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
