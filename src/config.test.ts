import { describe, expect, it } from 'vitest'
import { validateConfig } from './config'

const valid = {
  monitoredGroups: ['120363000000000001@g.us'],
  keywords: ['bola'],
  ownerJid: '5511999999999@s.whatsapp.net',
  sendDelayMs: { min: 2000, max: 8000 },
}

describe('validateConfig', () => {
  it('accepts a valid config and fills defaults', () => {
    expect(validateConfig(valid)).toEqual({ ...valid, forwardAll: false, forwardAllLimit: 25 })
  })

  it('keeps explicit forwardAll settings', () => {
    const cfg = validateConfig({ ...valid, forwardAll: true, forwardAllLimit: 3 })
    expect(cfg.forwardAll).toBe(true)
    expect(cfg.forwardAllLimit).toBe(3)
  })

  // Regression: `remove keyword` can empty the list; rejecting it bricked the next startup.
  it('accepts an empty keyword list', () => {
    expect(validateConfig({ ...valid, keywords: [] }).keywords).toEqual([])
  })

  it.each([
    ['monitoredGroups missing', { monitoredGroups: undefined }, 'monitoredGroups must be a non-empty array'],
    ['monitoredGroups empty', { monitoredGroups: [] }, 'monitoredGroups must be a non-empty array'],
    ['group without @g.us', { monitoredGroups: ['123@s.whatsapp.net'] }, 'ending in "@g.us"'],
    ['keywords not an array', { keywords: 'bola' }, 'keywords must be an array'],
    ['blank keyword', { keywords: ['bola', '  '] }, 'every keyword must be a non-empty string'],
    ['ownerJid wrong server', { ownerJid: '5511999999999@g.us' }, 'ownerJid must be a string ending in "@s.whatsapp.net"'],
    ['ownerJid placeholder', { ownerJid: '5511XXXXXXXXX@s.whatsapp.net' }, 'placeholder "X"s'],
    ['ownerJid without a number', { ownerJid: '@s.whatsapp.net' }, 'digits only before'],
    ['ownerJid with a device suffix', { ownerJid: '5511999999999:2@s.whatsapp.net' }, 'digits only before'],
    ['delay min > max', { sendDelayMs: { min: 5, max: 1 } }, 'sendDelayMs must be'],
    ['delay negative', { sendDelayMs: { min: -1, max: 1 } }, 'sendDelayMs must be'],
    ['delay missing', { sendDelayMs: undefined }, 'sendDelayMs must be'],
    ['forwardAll not boolean', { forwardAll: 'yes' }, 'forwardAll, if present, must be a boolean'],
    ['forwardAllLimit < 1', { forwardAllLimit: 0 }, 'forwardAllLimit, if present, must be a number >= 1'],
  ])('rejects %s', (_name, override, message) => {
    expect(() => validateConfig({ ...valid, ...override })).toThrow(message)
  })

  it('reports every problem at once', () => {
    let error = ''
    try {
      validateConfig({ ...valid, monitoredGroups: [], ownerJid: 'nope' })
    } catch (err) {
      error = (err as Error).message
    }
    expect(error).toContain('monitoredGroups')
    expect(error).toContain('ownerJid')
  })

  it.each([null, [], 'text', 42])('rejects non-object input %j', (input) => {
    expect(() => validateConfig(input)).toThrow('must be a JSON object')
  })
})
