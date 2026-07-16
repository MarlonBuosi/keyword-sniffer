import type { WAMessageContent } from '@whiskeysockets/baileys'

/**
 * Small bounded cache of messages the bot has sent, keyed by message id.
 *
 * WhatsApp/Signal occasionally can't decrypt a message on the first try and
 * asks the sender to resend it. Baileys handles that by calling `getMessage`,
 * which must return the original content to re-encrypt. Without this store the
 * recipient is stuck showing "Waiting for this message…".
 */
const MAX_ENTRIES = 1000
const store = new Map<string, WAMessageContent>()

export function remember(id: string, message: WAMessageContent): void {
  store.set(id, message)
  if (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value // Map preserves insertion order
    if (oldest !== undefined) store.delete(oldest)
  }
}

export function recall(id: string): WAMessageContent | undefined {
  return store.get(id)
}
