import { describe, expect, it } from 'vitest'
import { isFromOwner, jidUser } from './jid'

const OWNER = '554195400669@s.whatsapp.net'

describe('jidUser', () => {
  it('strips the server and any device suffix', () => {
    expect(jidUser('554195400669@s.whatsapp.net')).toBe('554195400669')
    expect(jidUser('554184775977:3@s.whatsapp.net')).toBe('554184775977')
    expect(jidUser('123456789@lid')).toBe('123456789')
  })

  it('returns "" for missing input', () => {
    expect(jidUser(undefined)).toBe('')
    expect(jidUser(null)).toBe('')
    expect(jidUser('')).toBe('')
  })
})

describe('isFromOwner', () => {
  it('matches the owner by remoteJid, ignoring device suffixes', () => {
    expect(isFromOwner({ remoteJid: OWNER }, OWNER)).toBe(true)
    expect(isFromOwner({ remoteJid: '554195400669:12@s.whatsapp.net' }, OWNER)).toBe(true)
  })

  it('matches by senderPn when remoteJid is a LID', () => {
    expect(
      isFromOwner({ remoteJid: '987654321@lid', senderPn: '554195400669@s.whatsapp.net' }, OWNER),
    ).toBe(true)
  })

  it('rejects anyone else', () => {
    expect(isFromOwner({ remoteJid: '5511000000000@s.whatsapp.net' }, OWNER)).toBe(false)
    expect(isFromOwner({ remoteJid: '987654321@lid', senderPn: null }, OWNER)).toBe(false)
    expect(isFromOwner({}, OWNER)).toBe(false)
  })

  // An empty owner must not match the "" of a missing senderPn (would let anyone in).
  it('never matches when the owner JID has no user part', () => {
    expect(isFromOwner({ remoteJid: '987654321@lid' }, '@s.whatsapp.net')).toBe(false)
    expect(isFromOwner({ remoteJid: undefined, senderPn: undefined }, '')).toBe(false)
  })
})
