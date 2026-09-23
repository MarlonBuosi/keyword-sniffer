import { describe, expect, it, vi } from 'vitest'
import type { Logger } from 'pino'
import type { WASocket } from '@whiskeysockets/baileys'
import { handleCommand, type CommandContext } from './commands'

const OWNER = '5511999999999@s.whatsapp.net'

/** A fake context: keywords live in a closure, replies are captured. */
function setup(initial: string[] = []) {
  let keywords = [...initial]
  const sendMessage = vi.fn(async () => undefined)
  const setKeywords = vi.fn((next: string[]) => {
    keywords = next
  })
  const ctx: CommandContext = {
    sock: { sendMessage } as unknown as WASocket,
    ownerJid: OWNER,
    getKeywords: () => keywords,
    setKeywords,
    logger: { info: vi.fn() } as unknown as Logger,
  }
  const run = async (text: string) => {
    sendMessage.mockClear()
    await handleCommand(text, ctx)
    expect(sendMessage).toHaveBeenCalledTimes(1)
    const [to, content] = sendMessage.mock.calls[0] as unknown as [string, { text: string }]
    expect(to).toBe(OWNER)
    return content.text
  }
  return { run, setKeywords, keywords: () => keywords }
}

describe('handleCommand', () => {
  it('replies with help for help, ?, and unknown text', async () => {
    const { run } = setup()
    for (const text of ['help', '?', 'commands', 'what is this']) {
      expect(await run(text)).toContain('Commands:')
    }
  })

  it('lists keywords', async () => {
    expect(await setup().run('list keywords')).toBe('No keywords set.')
    const reply = await setup(['bola', 'raquete']).run('list')
    expect(reply).toContain('Keywords (2)')
    expect(reply).toContain('• bola\n• raquete')
  })

  it('bulk-adds with commas and newlines, keeping multi-word keywords', async () => {
    const { run, keywords } = setup(['bola'])
    const reply = await run('add keywords raquete, beach tennis\nhead yonex')
    expect(keywords()).toEqual(['bola', 'raquete', 'beach tennis', 'head yonex'])
    expect(reply).toContain('Added 3')
    expect(reply).toContain('Now monitoring 4 keywords.')
  })

  it('skips duplicates case-insensitively, within the request too', async () => {
    const { run, keywords } = setup(['Bola'])
    const reply = await run('add keyword bola, rolo, ROLO')
    expect(keywords()).toEqual(['Bola', 'rolo'])
    expect(reply).toContain('Added 1: rolo')
    expect(reply).toContain('Already present: bola, ROLO')
  })

  it('does not save when nothing new is added', async () => {
    const { run, setKeywords } = setup(['bola'])
    await run('add keyword BOLA')
    expect(setKeywords).not.toHaveBeenCalled()
  })

  it('shows usage when the argument has no keywords', async () => {
    const { run, setKeywords } = setup()
    expect(await run('add keyword , ,')).toContain('Usage: add keyword')
    expect(await run('remove keyword ,')).toContain('Usage: remove keyword')
    expect(setKeywords).not.toHaveBeenCalled()
  })

  it('bulk-removes case-insensitively and reports misses', async () => {
    const { run, keywords } = setup(['bola', 'Raquete', 'rolo'])
    const reply = await run('remove keywords raquete, xyz')
    expect(keywords()).toEqual(['bola', 'rolo'])
    expect(reply).toContain('Removed 1: Raquete')
    expect(reply).toContain('Not found: xyz')
  })

  it('allows removing the last keyword', async () => {
    const { run, setKeywords } = setup(['bola'])
    expect(await run('remove keyword bola')).toContain('No keywords left.')
    expect(setKeywords).toHaveBeenCalledWith([])
  })

  it('does not save when nothing is removed', async () => {
    const { run, setKeywords } = setup(['bola'])
    await run('remove keyword xyz')
    expect(setKeywords).not.toHaveBeenCalled()
  })
})
