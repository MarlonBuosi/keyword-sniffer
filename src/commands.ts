import type { WASocket } from '@whiskeysockets/baileys'
import type { Logger } from 'pino'

export interface CommandContext {
  sock: WASocket
  ownerJid: string
  getKeywords: () => string[]
  /** Persist + apply a new keyword list (writes config.json, updates memory). */
  setKeywords: (keywords: string[]) => void
  logger: Logger
}

const HELP = [
  'Commands:',
  '• help',
  '• list keywords',
  '• add keyword <text>[, <text>, …]',
  '• remove keyword <text>[, <text>, …]',
  '',
  'Separate multiple keywords with commas or new lines.',
].join('\n')

/** Split a command argument into keywords on commas/newlines; trims + drops empties. */
function splitKeywords(arg: string): string[] {
  return arg
    .split(/[,\n]/)
    .map((k) => k.trim())
    .filter((k) => k.length > 0)
}

/**
 * Handle a DM from the owner as a command. Supports list, and bulk add/remove
 * (comma- or newline-separated). Anything else returns the help text.
 */
export async function handleCommand(text: string, ctx: CommandContext): Promise<void> {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()
  const reply = (msg: string) =>
    ctx.sock.sendMessage(ctx.ownerJid, { text: msg, linkPreview: null })

  if (lower === 'help' || lower === '?' || lower === 'commands') {
    await reply(HELP)
    return
  }

  if (lower === 'list' || lower === 'list keywords') {
    const kw = ctx.getKeywords()
    await reply(
      kw.length > 0
        ? `🔑 Keywords (${kw.length}):\n• ${kw.join('\n• ')}`
        : 'No keywords set.',
    )
    return
  }

  const addMatch = /^add keywords?\s+([\s\S]+)/i.exec(trimmed)
  if (addMatch) {
    const requested = splitKeywords(addMatch[1])
    if (requested.length === 0) {
      await reply('Usage: add keyword <text>[, <text>, …]')
      return
    }
    const current = ctx.getKeywords()
    const seen = new Set(current.map((k) => k.toLowerCase()))
    const next = [...current]
    const added: string[] = []
    const skipped: string[] = []
    for (const kw of requested) {
      const key = kw.toLowerCase()
      if (seen.has(key)) {
        skipped.push(kw)
        continue
      }
      seen.add(key)
      next.push(kw)
      added.push(kw)
    }
    if (added.length > 0) {
      ctx.setKeywords(next)
      ctx.logger.info({ added }, 'keywords added via DM command')
    }
    const parts: string[] = []
    if (added.length > 0) parts.push(`✅ Added ${added.length}: ${added.join(', ')}`)
    if (skipped.length > 0) parts.push(`⏭️ Already present: ${skipped.join(', ')}`)
    parts.push(`Now monitoring ${next.length} keywords.`)
    await reply(parts.join('\n'))
    return
  }

  const removeMatch = /^remove keywords?\s+([\s\S]+)/i.exec(trimmed)
  if (removeMatch) {
    const requested = splitKeywords(removeMatch[1])
    if (requested.length === 0) {
      await reply('Usage: remove keyword <text>[, <text>, …]')
      return
    }
    const current = ctx.getKeywords()
    const requestedLower = new Set(requested.map((k) => k.toLowerCase()))
    const removed = current.filter((k) => requestedLower.has(k.toLowerCase()))
    const next = current.filter((k) => !requestedLower.has(k.toLowerCase()))
    const notFound = requested.filter(
      (r) => !current.some((k) => k.toLowerCase() === r.toLowerCase()),
    )
    if (removed.length > 0) {
      ctx.setKeywords(next)
      ctx.logger.info({ removed }, 'keywords removed via DM command')
    }
    const parts: string[] = []
    if (removed.length > 0) parts.push(`🗑️ Removed ${removed.length}: ${removed.join(', ')}`)
    if (notFound.length > 0) parts.push(`❔ Not found: ${notFound.join(', ')}`)
    parts.push(
      next.length > 0
        ? `🔑 Now monitoring ${next.length}:\n• ${next.join('\n• ')}`
        : 'No keywords left.',
    )
    await reply(parts.join('\n'))
    return
  }

  await reply(HELP)
}
