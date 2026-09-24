import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { proto, type WAMessageContent } from '@whiskeysockets/baileys'
import type { Logger } from 'pino'

/**
 * Bounded cache of messages the bot has sent, keyed by message id, persisted
 * to disk so it survives restarts and deploys.
 *
 * WhatsApp/Signal occasionally can't decrypt a message on the first try and
 * asks the sender to resend it. Baileys handles that by calling `getMessage`,
 * which must return the original content to re-encrypt. If the content is gone
 * (e.g. an in-memory cache wiped by a restart), the recipient is stuck on
 * "Waiting for this message…" for good.
 *
 * Messages are stored protobuf-encoded (base64) — lossless for the Buffers and
 * Longs in media messages, unlike plain JSON.
 */
export const MAX_ENTRIES = 500
const FILE_VERSION = 1

type StoreLogger = Pick<Logger, 'info' | 'warn' | 'error'>

interface StoreFile {
  version: number
  entries: [string, string][]
}

export class SentMessageStore {
  private readonly entries = new Map<string, string>() // id -> base64 proto, insertion-ordered

  /** `path` undefined = memory only. */
  constructor(
    private readonly path?: string,
    private readonly logger?: StoreLogger,
    private readonly maxEntries = MAX_ENTRIES,
  ) {
    if (path) this.load(path)
  }

  get size(): number {
    return this.entries.size
  }

  remember(id: string, message: WAMessageContent): void {
    this.entries.delete(id) // re-insert as newest
    this.entries.set(id, Buffer.from(proto.Message.encode(message).finish()).toString('base64'))
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value // Map preserves insertion order
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    this.save()
  }

  recall(id: string): WAMessageContent | undefined {
    const encoded = this.entries.get(id)
    return encoded === undefined ? undefined : proto.Message.decode(Buffer.from(encoded, 'base64'))
  }

  private load(path: string): void {
    let raw: string
    try {
      raw = readFileSync(path, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger?.warn({ err, path }, 'could not read sent-message store; starting empty')
      }
      return
    }
    try {
      const file = JSON.parse(raw) as StoreFile
      if (file?.version !== FILE_VERSION || !Array.isArray(file.entries)) {
        throw new Error(`unsupported store format (version ${String(file?.version)})`)
      }
      for (const [id, encoded] of file.entries.slice(-this.maxEntries)) {
        if (typeof id === 'string' && typeof encoded === 'string') this.entries.set(id, encoded)
      }
    } catch (err) {
      this.entries.clear()
      this.logger?.warn({ err: (err as Error).message, path }, 'sent-message store unreadable; starting empty')
    }
  }

  /** Atomic write (tmp + rename). Errors are logged, never thrown: sending must not break. */
  private save(): void {
    if (!this.path) return
    const file: StoreFile = { version: FILE_VERSION, entries: [...this.entries] }
    const tmp = `${this.path}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(file))
      renameSync(tmp, this.path)
    } catch (err) {
      this.logger?.error({ err, path: this.path }, 'failed to persist sent-message store')
    }
  }
}

// Module-level singleton used by the app: memory-only until initStore() runs.
let store = new SentMessageStore()

/** Load (or create) the persistent store at `path`. Call once at startup. */
export function initStore(path: string, logger: StoreLogger): void {
  store = new SentMessageStore(path, logger)
  logger.info({ path, entries: store.size }, 'sent-message store loaded')
}

export function remember(id: string, message: WAMessageContent): void {
  store.remember(id, message)
}

export function recall(id: string): WAMessageContent | undefined {
  return store.recall(id)
}
