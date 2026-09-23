import { describe, expect, it } from 'vitest'
import type { WAMessageContent } from '@whiskeysockets/baileys'
import { extractText, hasMedia, matchKeywords, normalize } from './filter'

const msg = (m: object) => m as WAMessageContent

describe('normalize', () => {
  it('strips accents and lowercases', () => {
    expect(normalize('Promoção')).toBe('promocao')
    expect(normalize('PROMOÇÃO')).toBe('promocao')
    expect(normalize('Raquete Têniş')).toBe('raquete tenis')
  })
})

describe('matchKeywords', () => {
  const keywords = ['promoção', 'Head Yonex', 'bola']

  it('matches case- and accent-insensitively, returning the original spelling', () => {
    expect(matchKeywords('Grande PROMOCAO hoje', keywords)).toEqual(['promoção'])
  })

  it('matches substrings and multi-word keywords', () => {
    expect(matchKeywords('raquete head yonex nova', keywords)).toEqual(['Head Yonex'])
    expect(matchKeywords('bolas de tênis', keywords)).toEqual(['bola'])
  })

  it('returns every hit in keyword order', () => {
    expect(matchKeywords('bola + promoção', keywords)).toEqual(['promoção', 'bola'])
  })

  it('returns [] for no match, empty text, or no keywords', () => {
    expect(matchKeywords('nada aqui', keywords)).toEqual([])
    expect(matchKeywords('', keywords)).toEqual([])
    expect(matchKeywords('bola', [])).toEqual([])
  })

  it('ignores keywords that normalize to empty', () => {
    expect(matchKeywords('qualquer texto', ['', '́'])).toEqual([])
  })
})

describe('extractText', () => {
  it('reads plain and extended text', () => {
    expect(extractText(msg({ conversation: 'oi' }))).toBe('oi')
    expect(extractText(msg({ extendedTextMessage: { text: 'link aqui' } }))).toBe('link aqui')
  })

  it('reads media captions', () => {
    expect(extractText(msg({ imageMessage: { caption: 'foto' } }))).toBe('foto')
    expect(extractText(msg({ videoMessage: { caption: 'vídeo' } }))).toBe('vídeo')
    expect(extractText(msg({ documentMessage: { caption: 'pdf' } }))).toBe('pdf')
    expect(
      extractText(
        msg({ documentWithCaptionMessage: { message: { documentMessage: { caption: 'doc' } } } }),
      ),
    ).toBe('doc')
  })

  it('unwraps ephemeral and view-once wrappers', () => {
    expect(
      extractText(msg({ ephemeralMessage: { message: { conversation: 'efêmera' } } })),
    ).toBe('efêmera')
    expect(
      extractText(msg({ viewOnceMessage: { message: { imageMessage: { caption: 'uma vez' } } } })),
    ).toBe('uma vez')
  })

  it('returns "" for empty or textless messages', () => {
    expect(extractText(null)).toBe('')
    expect(extractText(undefined)).toBe('')
    expect(extractText(msg({ stickerMessage: {} }))).toBe('')
  })
})

describe('hasMedia', () => {
  it('detects forwardable media', () => {
    for (const m of [
      { imageMessage: {} },
      { videoMessage: {} },
      { documentMessage: {} },
      { audioMessage: {} },
      { stickerMessage: {} },
      { documentWithCaptionMessage: { message: { documentMessage: {} } } },
      { ephemeralMessage: { message: { imageMessage: {} } } },
    ]) {
      expect(hasMedia(msg(m))).toBe(true)
    }
  })

  it('is false for text-only or empty messages', () => {
    expect(hasMedia(msg({ conversation: 'oi' }))).toBe(false)
    expect(hasMedia(null)).toBe(false)
  })
})
