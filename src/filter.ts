import { normalizeMessageContent, type WAMessageContent } from '@whiskeysockets/baileys'

/**
 * Extract user-visible text from a WhatsApp message. Handles plain text,
 * extended text (links/replies), and captions on image/video/document media.
 * Unwraps ephemeral / view-once wrappers first (common in these groups).
 */
export function extractText(message: WAMessageContent | null | undefined): string {
  const content = normalizeMessageContent(message)
  if (!content) return ''
  return (
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    content.documentWithCaptionMessage?.message?.documentMessage?.caption ??
    ''
  )
}

/** True if the message carries forwardable media (image/video/doc/audio/sticker). */
export function hasMedia(message: WAMessageContent | null | undefined): boolean {
  const content = normalizeMessageContent(message)
  if (!content) return false
  return Boolean(
    content.imageMessage ||
      content.videoMessage ||
      content.documentMessage ||
      content.audioMessage ||
      content.stickerMessage ||
      content.documentWithCaptionMessage,
  )
}

/**
 * Normalize for matching: strip diacritics then lowercase, so "Promoção",
 * "PROMOÇÃO" and "promocao" all compare equal (important for Portuguese).
 */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * Return the keywords (original spelling) found in `text`, using a normalized
 * substring match. Empty array = no match.
 */
export function matchKeywords(text: string, keywords: string[]): string[] {
  const haystack = normalize(text)
  if (!haystack) return []
  const hits: string[] = []
  for (const kw of keywords) {
    const needle = normalize(kw)
    if (needle && haystack.includes(needle)) hits.push(kw)
  }
  return hits
}
