import { DisconnectReason } from '@whiskeysockets/baileys'

/**
 * Pure decisions behind src/connection.ts (no socket, no side effects), kept
 * separate so they can be unit-tested. connection.ts does the logging, exits
 * and timers.
 */

// Reconnect backoff: never hammer WhatsApp (rapid retry storms read as robotic
// and are bad for ban risk). Exponential from 2s up to 60s, capped attempts.
export const BASE_RECONNECT_MS = 2_000
export const MAX_RECONNECT_MS = 60_000
export const MAX_RECONNECT_ATTEMPTS = 6

// Status codes where reconnecting won't help — the saved session is invalid or
// rejected. Stop and require a fresh pairing instead of looping.
export const FATAL_STATUS = new Set<number>([
  DisconnectReason.loggedOut, // 401
  DisconnectReason.forbidden, // 403
  405, // connection failure / version mismatch — usually a stale/mismatched session
])

// Exit codes. Returning without exiting would leave a zombie process that the
// supervisor still reports as running (the config watcher keeps the event loop
// alive). EXIT_FATAL is listed in deploy/wa-monitor.service
// `RestartPreventExitStatus`, so systemd stays down instead of restart-looping
// a dead session against WhatsApp.
export const EXIT_RETRY = 1
export const EXIT_FATAL = 2

export type CloseDecision =
  | { kind: 'fatal' }
  | { kind: 'give-up' }
  | { kind: 'retry'; nextAttempt: number; delayMs: number }

/** What to do when the socket closes, given the status code and attempts so far. */
export function decideOnClose(statusCode: number | undefined, attempt: number): CloseDecision {
  if (statusCode !== undefined && FATAL_STATUS.has(statusCode)) return { kind: 'fatal' }
  const nextAttempt = attempt + 1
  if (nextAttempt > MAX_RECONNECT_ATTEMPTS) return { kind: 'give-up' }
  const delayMs = Math.min(BASE_RECONNECT_MS * 2 ** attempt, MAX_RECONNECT_MS)
  return { kind: 'retry', nextAttempt, delayMs }
}

/** PAIR_PHONE must be the bot number: digits only, with country code. */
export const isValidPairPhone = (s: string): boolean => /^\d{10,15}$/.test(s)

/**
 * requestPairingCode() persists `creds.me`, and Baileys sends a *login* (not a
 * registration) whenever `me` is set. If a previous socket requested a code
 * that was never entered, the next connect would log in as a device that
 * doesn't exist, get a 401, and exit fatally — instead of emitting a QR event
 * and requesting a fresh code. A completed pairing sets `registered` (code
 * flow) or `account` (QR flow), so `me` without either is leftover.
 */
export function isAbandonedPairing(
  creds: { me?: unknown; registered?: boolean; account?: unknown },
  pairPhone: string | undefined,
): boolean {
  return Boolean(pairPhone && creds.me && !creds.registered && !creds.account)
}
