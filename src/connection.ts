import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  type WASocket,
  type BaileysEventMap,
} from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'
import type { Logger } from 'pino'
import { recall } from './store'

const AUTH_DIR = 'auth_state'

// Reconnect backoff: never hammer WhatsApp (rapid retry storms read as robotic
// and are bad for ban risk). Exponential from 2s up to 60s, capped attempts.
const BASE_RECONNECT_MS = 2_000
const MAX_RECONNECT_MS = 60_000
const MAX_RECONNECT_ATTEMPTS = 6

// Status codes where reconnecting won't help — the saved session is invalid or
// rejected. Stop and require a fresh pairing instead of looping.
const FATAL_STATUS = new Set<number>([
  DisconnectReason.loggedOut, // 401
  DisconnectReason.forbidden, // 403
  405, // connection failure / version mismatch — usually a stale/mismatched session
])

const VERSION_FETCH_TIMEOUT_MS = 10_000

export type MessageUpsertHandler = (
  arg: BaileysEventMap['messages.upsert'],
  sock: WASocket,
) => void | Promise<void>

export interface SockHandlers {
  /** Fired every time the connection reaches 'open' (initial + each reconnect). */
  onReady?: (sock: WASocket) => void | Promise<void>
  /** Fired for every messages.upsert event. */
  onMessage?: MessageUpsertHandler
}

/** Reject after `ms` so a hung network call can't stall startup silently. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ])
}

/**
 * Opens a Baileys socket with a persistent multi-file auth session.
 * - Renders the pairing QR manually from the connection.update `qr` field.
 * - Reconnects with exponential backoff on transient closes.
 * - Stops (and asks for a re-pair) on fatal statuses or too many attempts.
 * - Re-registers the same message handler across reconnects.
 */
export async function startSock(
  logger: Logger,
  handlers: SockHandlers = {},
  attempt = 0,
): Promise<WASocket> {
  // Baileys is extremely chatty at info/debug; give it its own quiet child so it
  // doesn't drown out our own status lines, which stay on the app `logger`.
  const waLogger = logger.child({ mod: 'baileys' })
  waLogger.level = 'warn'

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)

  // The WA-web version bundled with 6.7.23 (Nov 2025) is now rejected by
  // WhatsApp's servers with a 405 before pairing. fetchLatestBaileysVersion()
  // pulls the current advertised version so the handshake is accepted. If the
  // fetch fails we fall back to the bundled default (better than not starting).
  let version: [number, number, number] | undefined
  try {
    ;({ version } = await withTimeout(
      fetchLatestBaileysVersion(),
      VERSION_FETCH_TIMEOUT_MS,
      'fetchLatestBaileysVersion',
    ))
    logger.info({ version }, 'using WhatsApp Web version')
  } catch (err) {
    logger.warn({ err }, 'could not fetch latest WA version; using bundled default')
  }

  const sock = makeWASocket({
    version,
    auth: state,
    logger: waLogger,
    printQRInTerminal: false,
    browser: ['WA Keyword Monitor', 'Chrome', '1.0.0'],
    // Robustness against post-connect timeouts (408 on init queries / keep-alive):
    keepAliveIntervalMs: 30_000,
    defaultQueryTimeoutMs: 60_000,
    // Passive bot: don't announce presence and don't pull full history — both
    // add load to the fragile first minute after connecting.
    markOnlineOnConnect: false,
    syncFullHistory: false,
    // Resend support: when a recipient can't decrypt a message and asks for a
    // resend, Baileys calls this to re-encrypt the original. Without it the
    // recipient is stuck on "Waiting for this message…".
    getMessage: async (key) => (key.id ? recall(key.id) : undefined),
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      logger.info('scan this QR with the bot number (WhatsApp > Linked Devices)')
      qrcode.generate(qr, { small: true })
    }

    if (connection === 'open') {
      // Reset the backoff once we're genuinely connected.
      attempt = 0
      logger.info({ jid: sock.user?.id, name: sock.user?.name }, 'connection open')
      void handlers.onReady?.(sock)
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode as
        | number
        | undefined

      logger.warn({ statusCode }, 'connection closed')

      if (statusCode !== undefined && FATAL_STATUS.has(statusCode)) {
        logger.error(
          { statusCode },
          `unrecoverable close — delete the "${AUTH_DIR}" directory and restart to re-pair`,
        )
        return
      }

      const nextAttempt = attempt + 1
      if (nextAttempt > MAX_RECONNECT_ATTEMPTS) {
        logger.error(
          `gave up after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts — check network, then restart`,
        )
        return
      }

      const delay = Math.min(BASE_RECONNECT_MS * 2 ** attempt, MAX_RECONNECT_MS)
      logger.info({ nextAttempt, delayMs: delay }, 'reconnecting after backoff')
      setTimeout(() => void startSock(logger, handlers, nextAttempt), delay)
    }
  })

  if (handlers.onMessage) {
    const onMessage = handlers.onMessage
    sock.ev.on('messages.upsert', (arg) => onMessage(arg, sock))
  }

  return sock
}
