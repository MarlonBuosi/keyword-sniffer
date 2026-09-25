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

/** Letters and digits: what counts as "inside a word" for keyword boundaries. */
const WORD_CHAR = /[\p{L}\p{N}]/u
const NOT_AFTER_WORD = '(?<![\\p{L}\\p{N}])'
const NOT_BEFORE_WORD = '(?![\\p{L}\\p{N}])'

const escapeRegExp = (s: string) => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')

/**
 * Whole-word pattern for a normalized, non-empty keyword: "raquete" matches
 * "vendo raquete!" but not "raqueteira" or "raquetes". The boundary is only
 * enforced on an edge that is itself a letter/digit, so "50%" still matches
 * "50%off". Spaces inside a keyword match any run of whitespace.
 */
function wordPattern(needle: string): RegExp {
  const body = needle.split(/\s+/).map(escapeRegExp).join('\\s+')
  const start = WORD_CHAR.test(needle[0]) ? NOT_AFTER_WORD : ''
  const end = WORD_CHAR.test(needle[needle.length - 1]) ? NOT_BEFORE_WORD : ''
  return new RegExp(start + body + end, 'u')
}

/**
 * Return the keywords (original spelling) found in `text` as whole words,
 * after normalizing both sides. Empty array = no match.
 */
export function matchKeywords(text: string, keywords: string[]): string[] {
  const haystack = normalize(text)
  if (!haystack) return []
  const hits: string[] = []
  for (const kw of keywords) {
    const needle = normalize(kw).trim()
    if (needle && wordPattern(needle).test(haystack)) hits.push(kw)
  }
  return hits
}
