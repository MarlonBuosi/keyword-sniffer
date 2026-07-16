import {
  downloadMediaMessage,
  normalizeMessageContent,
  type WASocket,
  type WAMessage,
} from '@whiskeysockets/baileys'
import type { Logger } from 'pino'

export interface Alert {
  groupName: string
  sender: string
  keyword: string
  text: string
  /** Original message, when it carries media to re-send with the caption. */
  mediaMsg?: WAMessage
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Delivers keyword-match alerts to the owner's DM, one at a time, with a
 * randomized delay between sends. The jitter keeps the send pattern from
 * looking robotic (a fixed cadence is exactly what abuse detection flags).
 *
 * Media matches are delivered as a SINGLE message: the image/video/doc is
 * re-sent with a caption containing the context header + promo text (no
 * duplicate text, no separate forward). Falls back to a text-only alert if the
 * media can't be downloaded.
 *
 * The socket and owner/delay config are swapped in live (setSock / configure)
 * so reconnects and config hot-reloads are picked up without a restart.
 */
export class Notifier {
  private queue: Alert[] = []
  private draining = false

  constructor(
    private sock: WASocket,
    private ownerJid: string,
    private delay: { min: number; max: number },
    private readonly logger: Logger,
  ) {}

  setSock(sock: WASocket): void {
    this.sock = sock
  }

  configure(ownerJid: string, delay: { min: number; max: number }): void {
    this.ownerJid = ownerJid
    this.delay = delay
  }

  enqueue(alert: Alert): void {
    this.queue.push(alert)
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      while (this.queue.length > 0) {
        const alert = this.queue.shift()!
        await this.send(alert)
        if (this.queue.length > 0) await sleep(this.jitterMs())
      }
    } finally {
      this.draining = false
    }
  }

  /** Build the single caption/body: context header + promo text. */
  private formatBody(a: Alert): string {
    const header = a.keyword ? `🔔 ${a.groupName}` : `📩 ${a.groupName}`
    const meta = a.keyword ? `👤 ${a.sender} · 🔑 ${a.keyword}` : `👤 ${a.sender}`
    return [header, meta, '─────────────', a.text].join('\n')
  }

  private async send(a: Alert): Promise<void> {
    const body = this.formatBody(a)
    try {
      const sentAsMedia = a.mediaMsg ? await this.sendAsMedia(a.mediaMsg, body) : false
      if (!sentAsMedia) {
        // Text-only match, or media fallback. linkPreview: null skips the
        // optional link-preview package + outbound fetch.
        await this.sock.sendMessage(this.ownerJid, { text: body, linkPreview: null })
      }
      this.logger.info(
        { group: a.groupName, keyword: a.keyword, media: sentAsMedia },
        'alert sent',
      )
    } catch (err) {
      // Most likely the socket is mid-reconnect. Drop this one and keep going.
      this.logger.error({ err, group: a.groupName }, 'failed to send alert')
    }
  }

  /**
   * Re-send the message's media with `caption` as a single message. Returns
   * false (so the caller falls back to text) for unsupported/uncaptionable
   * media or if the download fails.
   */
  private async sendAsMedia(msg: WAMessage, caption: string): Promise<boolean> {
    const content = normalizeMessageContent(msg.message)
    if (!content) return false
    try {
      const buffer = (await downloadMediaMessage(
        msg,
        'buffer',
        {},
        {
          logger: this.logger as never,
          reuploadRequest: this.sock.updateMediaMessage,
        },
      )) as Buffer

      if (content.imageMessage) {
        await this.sock.sendMessage(this.ownerJid, { image: buffer, caption })
      } else if (content.videoMessage) {
        await this.sock.sendMessage(this.ownerJid, { video: buffer, caption })
      } else if (content.documentMessage || content.documentWithCaptionMessage) {
        const doc =
          content.documentMessage ??
          content.documentWithCaptionMessage?.message?.documentMessage
        await this.sock.sendMessage(this.ownerJid, {
          document: buffer,
          mimetype: doc?.mimetype ?? 'application/octet-stream',
          fileName: doc?.fileName ?? doc?.title ?? 'file',
          caption,
        })
      } else {
        return false // audio/sticker/etc.: no caption support → text fallback
      }
      return true
    } catch (err) {
      this.logger.warn({ err, group: caption.slice(0, 40) }, 'media send failed; using text')
      return false
    }
  }

  private jitterMs(): number {
    const { min, max } = this.delay
    return min + Math.floor(Math.random() * (max - min + 1))
  }
}
