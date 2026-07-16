import { installConsoleFilter } from './log-filter'
installConsoleFilter() // silence libsignal console noise before anything logs

import pino from 'pino'
import type { WASocket } from '@whiskeysockets/baileys'
import { startSock } from './connection'
import { loadConfig, saveConfig, watchConfig, type AppConfig } from './config'
import { extractText, matchKeywords, hasMedia } from './filter'
import { handleCommand } from './commands'
import { Notifier } from './notifier'
import { remember } from './store'

const isProd = process.env.NODE_ENV === 'production'

const logger = pino(
  isProd
    ? { level: process.env.LOG_LEVEL ?? 'info' }
    : {
        level: process.env.LOG_LEVEL ?? 'debug',
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss' },
        },
      },
)

// ---- Live-updatable state (config hot-reload swaps these) -------------------
let config: AppConfig = loadConfig()
let monitored = new Set(config.monitoredGroups)
let notifier: Notifier | null = null
let listedGroups = false
let forwardCount = 0 // forwardAll test-mode counter (capped by forwardAllLimit)

function applyConfig(next: AppConfig): void {
  config = next
  monitored = new Set(next.monitoredGroups)
  notifier?.configure(next.ownerJid, next.sendDelayMs)
}

// ---- Helpers ----------------------------------------------------------------
const jidUser = (jid?: string | null): string =>
  jid ? jid.split('@')[0].split(':')[0] : ''

/** Is this 1:1 message from the owner? Matches remoteJid or senderPn (LID-safe). */
function isFromOwner(
  key: { remoteJid?: string | null; senderPn?: string | null },
  ownerJid: string,
): boolean {
  const owner = jidUser(ownerJid)
  return jidUser(key.remoteJid) === owner || jidUser(key.senderPn) === owner
}

const groupNameCache = new Map<string, string>()
async function resolveGroupName(sock: WASocket, jid: string): Promise<string> {
  const cached = groupNameCache.get(jid)
  if (cached) return cached
  try {
    const meta = await sock.groupMetadata(jid)
    groupNameCache.set(jid, meta.subject)
    return meta.subject
  } catch {
    return jid
  }
}

// ---- Main -------------------------------------------------------------------
async function main() {
  logger.info(
    { groups: config.monitoredGroups.length, keywords: config.keywords },
    'starting WhatsApp keyword monitor (Phase 4: hot-reload + DM commands + media)',
  )

  if (config.forwardAll) {
    logger.warn(
      { limit: config.forwardAllLimit },
      '⚠️  FORWARD-ALL TEST MODE: forwarding EVERY message (keywords ignored). ' +
        `Ban-risky for the bot number — auto-stops after ${config.forwardAllLimit} sends.`,
    )
  }

  // Hot-reload: edits to config.json take effect live.
  watchConfig(applyConfig, logger)

  await startSock(logger, {
    onReady: async (sock) => {
      if (!notifier) {
        notifier = new Notifier(sock, config.ownerJid, config.sendDelayMs, logger)
      } else {
        notifier.setSock(sock)
      }

      if (!listedGroups) {
        listedGroups = true
        try {
          const groups = await sock.groupFetchAllParticipating()
          for (const jid of config.monitoredGroups) {
            const name = groups[jid]?.subject
            if (name) {
              groupNameCache.set(jid, name)
              logger.info({ jid, name }, 'monitoring group')
            } else {
              logger.warn({ jid }, "monitored group NOT found among the bot's groups")
            }
          }
        } catch (err) {
          logger.error({ err }, 'failed to verify monitored groups')
        }
      }
    },

    onMessage: async ({ messages, type }, sock) => {
      for (const msg of messages) {
        // Remember our own outgoing messages so getMessage() can resend them
        // on a decrypt-retry request. Do this regardless of upsert type.
        if (msg.key.fromMe) {
          if (msg.key.id && msg.message) remember(msg.key.id, msg.message)
          continue // self-message guard (no loops)
        }

        if (type !== 'notify') continue // incoming: real-time only, skip history

        const jid = msg.key.remoteJid
        if (!jid) continue

        // ---- 1:1 chats: possible owner command ----
        if (!jid.endsWith('@g.us')) {
          const key = msg.key as { remoteJid?: string; senderPn?: string }
          if (isFromOwner(key, config.ownerJid)) {
            const text = extractText(msg.message)
            logger.info({ preview: text.slice(0, 60) }, 'owner DM received')
            if (text && notifier) {
              await handleCommand(text, {
                sock,
                ownerJid: config.ownerJid,
                getKeywords: () => config.keywords,
                setKeywords: (keywords) => {
                  const next = { ...config, keywords }
                  saveConfig(next) // persist (also triggers the watcher)
                  applyConfig(next) // apply immediately (no reload lag)
                },
                logger,
              })
            }
          }
          continue
        }

        // ---- Group messages: keyword filter ----
        if (!monitored.has(jid)) continue

        const text = extractText(msg.message)
        if (!text) continue

        const hits = matchKeywords(text, config.keywords)
        logger.debug(
          { jid, matched: hits, preview: text.slice(0, 100) },
          'group message read',
        )

        if (config.forwardAll) {
          if (forwardCount >= config.forwardAllLimit) continue // safety cap
          forwardCount++
          if (forwardCount === config.forwardAllLimit) {
            logger.warn(
              { limit: config.forwardAllLimit },
              'forward-all cap reached — no more forwards until restart/config change',
            )
          }
        } else if (hits.length === 0) {
          continue
        }

        const groupName = await resolveGroupName(sock, jid)
        const pkey = msg.key as { participant?: string; participantPn?: string }
        const sender =
          msg.pushName ||
          jidUser(pkey.participantPn) ||
          jidUser(pkey.participant) ||
          'unknown'

        logger.info(
          { jid, groupName, keywords: hits, sender, forwardAll: config.forwardAll },
          config.forwardAll ? 'forwarding (test mode)' : 'keyword match',
        )
        notifier?.enqueue({
          groupName,
          sender,
          keyword: config.forwardAll ? '' : hits.join(', '),
          text,
          mediaMsg: hasMedia(msg.message) ? msg : undefined,
        })
      }
    },
  })
}

main().catch((err) => {
  logger.error({ err }, 'fatal error on startup')
  process.exit(1)
})
