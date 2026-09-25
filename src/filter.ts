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
 * The form a keyword is compared in: normalized, trimmed, inner whitespace
 * collapsed. Keywords with the same key match exactly the same messages, so
 * this is also the duplicate check for the DM commands.
 */
export const keywordKey = (kw: string): string => normalize(kw).trim().replace(/\s+/g, ' ')

// What counts as "inside a word" for keyword boundaries: letters, digits, and
// marks (vowel signs in e.g. Thai or Devanagari, which normalize() keeps).
const WORD_CHAR = '[\\p{L}\\p{M}\\p{N}]'
const STARTS_WITH_WORD_CHAR = new RegExp(`^${WORD_CHAR}`, 'u')
const ENDS_WITH_WORD_CHAR = new RegExp(`${WORD_CHAR}$`, 'u')

const escapeRegExp = (s: string) => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')

/**
 * Whole-word pattern for a non-empty keyword key: "raquete" matches "vendo
 * raquete!" but not "raqueteira" or "raquetes". The boundary is only enforced
 * on an edge that is itself a word character, so "50%" still matches "50%off".
 * Spaces inside a keyword match any run of whitespace.
 */
function wordPattern(key: string): RegExp {
  const body = key.split(' ').map(escapeRegExp).join('\\s+')
  const start = STARTS_WITH_WORD_CHAR.test(key) ? `(?<!${WORD_CHAR})` : ''
  const end = ENDS_WITH_WORD_CHAR.test(key) ? `(?!${WORD_CHAR})` : ''
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
    const key = keywordKey(kw)
    if (key && wordPattern(key).test(haystack)) hits.push(kw)
  }
  return hits
}
