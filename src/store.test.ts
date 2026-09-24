import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WAMessageContent } from '@whiskeysockets/baileys'
import { SentMessageStore } from './store'

const text = (s: string) => ({ conversation: s }) as WAMessageContent
const media = {
  imageMessage: {
    caption: '🔔 alerta',
    mediaKey: Buffer.from([1, 2, 3, 250, 255]),
    fileLength: 123456,
    mimetype: 'image/jpeg',
  },
} as WAMessageContent

const fakeLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })

let dir: string
let path: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sent-store-'))
  path = join(dir, 'sent-messages.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('SentMessageStore', () => {
  it('round-trips text and media content, including binary fields', () => {
    const store = new SentMessageStore(path)
    store.remember('a', text('oi'))
    store.remember('b', media)
    expect(store.recall('a')?.conversation).toBe('oi')
    const img = store.recall('b')?.imageMessage
    expect(img?.caption).toBe('🔔 alerta')
    expect(Buffer.from(img!.mediaKey!)).toEqual(Buffer.from([1, 2, 3, 250, 255]))
    expect(Number(img?.fileLength)).toBe(123456)
    expect(store.recall('missing')).toBeUndefined()
  })

  // Regression: an in-memory-only store lost everything on restart, so retry
  // requests for earlier messages left the recipient on "Waiting…" forever.
  it('survives a restart (new instance on the same file)', () => {
    new SentMessageStore(path).remember('before-restart', media)
    const reopened = new SentMessageStore(path)
    expect(reopened.size).toBe(1)
    expect(reopened.recall('before-restart')?.imageMessage?.caption).toBe('🔔 alerta')
  })

  it('evicts the oldest entries beyond the cap, also on disk', () => {
    const store = new SentMessageStore(path, undefined, 3)
    for (const id of ['1', '2', '3', '4', '5']) store.remember(id, text(id))
    expect(store.recall('1')).toBeUndefined()
    expect(store.recall('2')).toBeUndefined()
    expect(store.recall('5')?.conversation).toBe('5')
    const reopened = new SentMessageStore(path, undefined, 3)
    expect(reopened.size).toBe(3)
    expect(JSON.parse(readFileSync(path, 'utf8')).entries.map((e: string[]) => e[0])).toEqual(['3', '4', '5'])
  })

  it('re-remembering an id refreshes it instead of duplicating', () => {
    const store = new SentMessageStore(path, undefined, 2)
    store.remember('a', text('1'))
    store.remember('b', text('2'))
    store.remember('a', text('1 again'))
    store.remember('c', text('3')) // evicts b, the oldest
    expect(store.recall('b')).toBeUndefined()
    expect(store.recall('a')?.conversation).toBe('1 again')
  })

  it('starts empty without a file, and quietly', () => {
    const logger = fakeLogger()
    expect(new SentMessageStore(path, logger).size).toBe(0)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it.each([
    ['corrupt JSON', '{not json'],
    ['unknown version', JSON.stringify({ version: 99, entries: [] })],
    ['wrong shape', JSON.stringify({ version: 1, entries: 'nope' })],
  ])('starts empty with a warning on %s', (_name, content) => {
    writeFileSync(path, content)
    const logger = fakeLogger()
    const store = new SentMessageStore(path, logger)
    expect(store.size).toBe(0)
    expect(logger.warn).toHaveBeenCalledOnce()
  })

  it('keeps working in memory when the file cannot be written', () => {
    const logger = fakeLogger()
    const store = new SentMessageStore(join(dir, 'no-such-dir', 'store.json'), logger)
    expect(() => store.remember('a', text('oi'))).not.toThrow()
    expect(logger.error).toHaveBeenCalledOnce()
    expect(store.recall('a')?.conversation).toBe('oi')
  })

  it('memory-only mode writes nothing', () => {
    const store = new SentMessageStore()
    store.remember('a', text('oi'))
    expect(store.recall('a')?.conversation).toBe('oi')
  })
})
