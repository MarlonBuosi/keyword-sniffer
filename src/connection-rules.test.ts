import { describe, expect, it } from 'vitest'
import {
  MAX_RECONNECT_ATTEMPTS,
  decideOnClose,
  isAbandonedPairing,
  isValidPairPhone,
} from './connection-rules'

describe('decideOnClose', () => {
  it.each([401, 403, 405])('treats %i as fatal (session rejected)', (status) => {
    expect(decideOnClose(status, 0)).toEqual({ kind: 'fatal' })
  })

  it.each([undefined, 408, 428, 500, 515])('retries on %s', (status) => {
    expect(decideOnClose(status, 0)).toEqual({ kind: 'retry', nextAttempt: 1, delayMs: 2_000 })
  })

  it('backs off exponentially, capped at 60s', () => {
    const delays = Array.from({ length: MAX_RECONNECT_ATTEMPTS }, (_, attempt) => {
      const d = decideOnClose(undefined, attempt)
      return d.kind === 'retry' ? d.delayMs : d.kind
    })
    expect(delays).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000])
  })

  // Regression: giving up used to leave a zombie process; the caller now exits.
  it('gives up after the max attempts', () => {
    expect(decideOnClose(undefined, MAX_RECONNECT_ATTEMPTS)).toEqual({ kind: 'give-up' })
  })

  it('stays fatal regardless of attempt count', () => {
    expect(decideOnClose(401, MAX_RECONNECT_ATTEMPTS)).toEqual({ kind: 'fatal' })
  })
})

describe('isValidPairPhone', () => {
  it.each(['554184775977', '5541984775977', '1234567890', '123456789012345'])('accepts %s', (s) => {
    expect(isValidPairPhone(s)).toBe(true)
  })

  it.each(['', '123456789', '1234567890123456', '+554184775977', '55 41 8477 5977', '5541abc75977'])(
    'rejects %j',
    (s) => {
      expect(isValidPairPhone(s)).toBe(false)
    },
  )
})

describe('isAbandonedPairing', () => {
  const me = { id: '554184775977@s.whatsapp.net', name: '~' }
  const phone = '554184775977'

  it('is true for `me` left behind by an unentered pairing code', () => {
    expect(isAbandonedPairing({ me, registered: false }, phone)).toBe(true)
  })

  // Regression: the cleanup must never wipe a completed pairing.
  it('is false once pairing completed (code flow sets registered)', () => {
    expect(isAbandonedPairing({ me, registered: true }, phone)).toBe(false)
  })

  it('is false for a QR-paired session (account set, registered false)', () => {
    expect(isAbandonedPairing({ me, registered: false, account: {} }, phone)).toBe(false)
  })

  it('is false with no `me` or when not in pairing-code mode', () => {
    expect(isAbandonedPairing({ registered: false }, phone)).toBe(false)
    expect(isAbandonedPairing({ me, registered: false }, undefined)).toBe(false)
  })
})
