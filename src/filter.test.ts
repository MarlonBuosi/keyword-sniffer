import { describe, expect, it } from 'vitest'
import type { WAMessageContent } from '@whiskeysockets/baileys'
import { extractText, hasMedia, keywordKey, matchKeywords, normalize } from './filter'

const msg = (m: object) => m as WAMessageContent

describe('normalize', () => {
  it('strips accents and lowercases', () => {
    expect(normalize('Promoção')).toBe('promocao')
    expect(normalize('PROMOÇÃO')).toBe('promocao')
    expect(normalize('Raquete Têniş')).toBe('raquete tenis')
  })
})

describe('keywordKey', () => {
  it('normalizes, trims, and collapses inner whitespace', () => {
    expect(keywordKey('  Promoção ')).toBe('promocao')
    expect(keywordKey('Head \n  Yonex')).toBe('head yonex')
  })
})

describe('matchKeywords', () => {
  const keywords = ['promoção', 'Head Yonex', 'bola']

  it('matches case- and accent-insensitively, returning the original spelling', () => {
    expect(matchKeywords('Grande PROMOCAO hoje', keywords)).toEqual(['promoção'])
  })

  it('matches whole words only, not words that contain the keyword', () => {
    for (const text of ['raquete', 'Vendo RAQUETE!', 'nova raquete.', '(raquete)', 'raquete🎾', 'x\nraquete\ny']) {
      expect(matchKeywords(text, ['raquete'])).toEqual(['raquete'])
    }
    for (const text of ['raqueteira', 'raquetes', 'minirraquete', 'raquete2']) {
      expect(matchKeywords(text, ['raquete'])).toEqual([])
    }
    expect(matchKeywords('bolas de tênis', keywords)).toEqual([])
  })

  it('matches multi-word keywords across any whitespace, still as whole words', () => {
    expect(matchKeywords('raquete head yonex nova', keywords)).toEqual(['Head Yonex'])
    expect(matchKeywords('head  yonex', keywords)).toEqual(['Head Yonex'])
    expect(matchKeywords('head\nyonex', keywords)).toEqual(['Head Yonex'])
    expect(matchKeywords('headyonex', keywords)).toEqual([])
    expect(matchKeywords('head yonexx', keywords)).toEqual([])
  })

  it('treats digits as part of a word', () => {
    expect(matchKeywords('iphone 15 pro', ['iphone 15'])).toEqual(['iphone 15'])
    expect(matchKeywords('iphone 150', ['iphone 15'])).toEqual([])
  })

  it('only enforces a boundary on keyword edges that are letters or digits', () => {
    expect(matchKeywords('desconto de 50% hoje', ['50%'])).toEqual(['50%'])
    expect(matchKeywords('50%off', ['50%'])).toEqual(['50%'])
    expect(matchKeywords('150%', ['50%'])).toEqual([])
  })

  it('enforces boundaries for keywords whose edges are astral-plane letters', () => {
    // 𝐫 (U+1D42B) is a letter encoded as a surrogate pair
    expect(matchKeywords('abc𝐫xyz', ['𝐫'])).toEqual([])
    expect(matchKeywords('a 𝐫 b', ['𝐫'])).toEqual(['𝐫'])
  })

  it('treats marks that normalize() keeps as part of a word', () => {
    // Thai: ไม้ ends in a tone mark; either way เทนนิส is glued to another word
    expect(matchKeywords('ขายเทนนิส', ['เทนนิส'])).toEqual([])
    expect(matchKeywords('ขายไม้เทนนิส', ['เทนนิส'])).toEqual([])
    expect(matchKeywords('ขาย เทนนิส', ['เทนนิส'])).toEqual(['เทนนิส'])
    // Devanagari: की ends in a vowel sign, so its end boundary is enforced
    expect(matchKeywords('कीमत', ['की'])).toEqual([])
  })

  it('treats regex characters in keywords literally', () => {
    expect(matchKeywords('versão 3.0 chegou', ['3.0'])).toEqual(['3.0'])
    expect(matchKeywords('versão 3x0 chegou', ['3.0'])).toEqual([])
    expect(matchKeywords('c++ (novo)', ['c++', '(novo)'])).toEqual(['c++', '(novo)'])
  })

  it('ignores surrounding whitespace in a keyword', () => {
    expect(matchKeywords('bola nova', [' bola '])).toEqual([' bola '])
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
