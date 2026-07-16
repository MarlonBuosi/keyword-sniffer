import { readFileSync, writeFileSync, watchFile } from 'node:fs'
import { resolve } from 'node:path'
import type { Logger } from 'pino'

export interface AppConfig {
  monitoredGroups: string[]
  keywords: string[]
  ownerJid: string
  sendDelayMs: { min: number; max: number }
  /** TEST MODE: forward every message (ignore keywords). Ban-risky — keep brief. */
  forwardAll: boolean
  /** Safety cap for forwardAll: stop forwarding after this many sends. */
  forwardAllLimit: number
}

export const CONFIG_PATH = resolve(process.cwd(), 'config.json')

/** Read + parse + validate config.json. Throws with a clear message on any problem. */
export function loadConfig(): AppConfig {
  let raw: string
  try {
    raw = readFileSync(CONFIG_PATH, 'utf8')
  } catch (err) {
    throw new Error(`could not read ${CONFIG_PATH}: ${(err as Error).message}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new Error(`config.json is not valid JSON: ${(err as Error).message}`)
  }

  return validateConfig(parsed)
}

export function validateConfig(input: unknown): AppConfig {
  const c = input as Record<string, unknown>
  const errors: string[] = []

  const groups = c.monitoredGroups
  if (!Array.isArray(groups) || groups.length === 0) {
    errors.push('monitoredGroups must be a non-empty array')
  } else if (!groups.every((g) => typeof g === 'string' && g.endsWith('@g.us'))) {
    errors.push('every monitoredGroups entry must be a string ending in "@g.us"')
  }

  const keywords = c.keywords
  if (!Array.isArray(keywords) || keywords.length === 0) {
    errors.push('keywords must be a non-empty array')
  } else if (!keywords.every((k) => typeof k === 'string' && k.trim().length > 0)) {
    errors.push('every keyword must be a non-empty string')
  }

  const ownerJid = c.ownerJid
  if (typeof ownerJid !== 'string' || !ownerJid.endsWith('@s.whatsapp.net')) {
    errors.push('ownerJid must be a string ending in "@s.whatsapp.net"')
  } else if (/X{2,}/i.test(ownerJid)) {
    errors.push('ownerJid still contains placeholder "X"s — set your real number')
  }

  const delay = c.sendDelayMs as Record<string, unknown> | undefined
  if (
    !delay ||
    typeof delay.min !== 'number' ||
    typeof delay.max !== 'number' ||
    delay.min < 0 ||
    delay.max < delay.min
  ) {
    errors.push('sendDelayMs must be { min, max } numbers with 0 <= min <= max')
  }

  if (c.forwardAll !== undefined && typeof c.forwardAll !== 'boolean') {
    errors.push('forwardAll, if present, must be a boolean')
  }
  if (
    c.forwardAllLimit !== undefined &&
    (typeof c.forwardAllLimit !== 'number' || c.forwardAllLimit < 1)
  ) {
    errors.push('forwardAllLimit, if present, must be a number >= 1')
  }

  if (errors.length > 0) {
    throw new Error('invalid config.json:\n  - ' + errors.join('\n  - '))
  }

  return {
    monitoredGroups: groups as string[],
    keywords: keywords as string[],
    ownerJid: ownerJid as string,
    sendDelayMs: {
      min: (delay as { min: number }).min,
      max: (delay as { max: number }).max,
    },
    forwardAll: c.forwardAll === true,
    forwardAllLimit: typeof c.forwardAllLimit === 'number' ? c.forwardAllLimit : 25,
  }
}

/** Persist config back to config.json (pretty-printed). Used by DM commands. */
export function saveConfig(cfg: AppConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
}

/**
 * Watch config.json and invoke `onReload` with the fresh config whenever it
 * changes on disk. Uses watchFile (mtime polling) so it survives atomic saves
 * from editors. A malformed edit is logged and the previous config is kept.
 */
export function watchConfig(onReload: (cfg: AppConfig) => void, logger: Logger): void {
  watchFile(CONFIG_PATH, { interval: 1000 }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return
    try {
      const cfg = loadConfig()
      onReload(cfg)
      logger.info(
        { keywords: cfg.keywords.length, groups: cfg.monitoredGroups.length, forwardAll: cfg.forwardAll },
        'config.json reloaded',
      )
    } catch (err) {
      logger.error(
        { err: (err as Error).message },
        'config reload failed — keeping previous config',
      )
    }
  })
}
