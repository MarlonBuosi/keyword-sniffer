# WhatsApp Keyword Monitor

A small, always-on bot that watches a set of high-traffic WhatsApp **groups**,
matches every incoming message against a keyword list, and forwards the matches
to your **personal** WhatsApp DM in near real time — so you don't have to read
the firehose to catch the messages you care about.

Built on [Baileys](https://github.com/WhiskeySockets/Baileys) (the multi-device
WhatsApp Web protocol), TypeScript, and PM2.

---

## Features

- **Monitors specific groups only** — ignores every other chat.
- **Accent- & case-insensitive matching** — `promoção` also matches `promocao`,
  `PROMOÇÃO`, etc. (built for Portuguese).
- **DM delivery to your own number** — matches arrive as a formatted alert.
- **Media matches come through intact** — an image/video/PDF match is delivered
  as a single message (the media + a caption with the context and text).
- **Live keyword management** — DM the bot to `list` / `add` / `remove` keywords
  (bulk supported); changes apply instantly, no restart.
- **Config hot-reload** — edit `config.json` and it's picked up live.
- **Resilient** — auto-reconnects with backoff, persists its session across
  restarts, and honors decrypt-retry requests so messages aren't lost.
- **Runs unattended** — managed by PM2 (restart on crash, start on boot).

---

## How it works

```
WhatsApp groups ──▶ Baileys client ──▶ filter ──▶ notifier ──▶ your DM
                    (connection.ts)   (filter.ts) (notifier.ts)
                          │
                    auth_state/  +  config.json
                    (session)       (groups, keywords, owner)
```

Per incoming message the pipeline: skips non-monitored chats and the bot's own
messages → extracts text (plain / extended / media caption) → normalizes
(lowercase + strip accents) → matches keywords → on a hit, queues a jittered DM
to the owner.

### Source layout

| File | Responsibility |
|------|----------------|
| `src/index.ts` | Wiring: message pipeline, owner-command routing, hot-reload |
| `src/connection.ts` | Baileys socket, auth session, QR, reconnect/backoff |
| `src/config.ts` | Load + validate `config.json`, save, watch for changes |
| `src/filter.ts` | Text extraction, accent normalization, keyword matching |
| `src/notifier.ts` | Jittered alert queue, formatting, media re-send |
| `src/commands.ts` | Owner DM commands (help / list / add / remove) |
| `src/store.ts` | Cache of sent messages for decrypt-retry resends |
| `src/log-filter.ts` | Silences noisy libsignal `console` output |

---

## Prerequisites

- **Node.js ≥ 18** (developed on 24.x)
- A **dedicated/secondary WhatsApp number** for the bot (see [Safety & ToS](#safety--tos))
- The bot number must be a **member of the groups** you want to monitor

---

## Setup

```bash
git clone <your-repo-url> whatsapp-keyword-monitor
cd whatsapp-keyword-monitor
npm install

# create your config from the template
cp config.example.json config.json
# then edit config.json (see below)
```

### Configuration (`config.json`)

```json
{
  "monitoredGroups": [
    "1203630XXXXXXXXX@g.us",
    "1203630YYYYYYYYY@g.us",
    "1203630ZZZZZZZZZ@g.us"
  ],
  "keywords": ["keyword1", "promoção"],
  "ownerJid": "55XXXXXXXXXXX@s.whatsapp.net",
  "sendDelayMs": { "min": 2000, "max": 8000 },
  "forwardAll": false,
  "forwardAllLimit": 25
}
```

| Field | Meaning |
|-------|---------|
| `monitoredGroups` | Group JIDs to watch (each ends in `@g.us`). |
| `keywords` | Terms to match (case/accent-insensitive substring match). |
| `ownerJid` | Your personal number as `<countrycode><number>@s.whatsapp.net`. |
| `sendDelayMs` | Random delay range between DMs (jitter — keeps sends human-like). |
| `forwardAll` | **Test mode:** forward every message, ignore keywords. Ban-risky; keep brief. |
| `forwardAllLimit` | Safety cap: `forwardAll` auto-stops after this many sends. |

> **Finding group JIDs:** on first run the bot logs every group it belongs to
> (name + JID) — copy the ones you want into `monitoredGroups`.

`config.json`, `auth_state/`, `logs/`, and `dist/` are gitignored — no secrets
or session data are committed.

---

## Running

### Development
```bash
npm run dev      # tsx watch, pretty logs
```
On first run, scan the QR (terminal) from the **bot** phone:
**WhatsApp → Linked Devices → Link a Device**. The session is saved to
`auth_state/`, so subsequent starts reconnect without a QR.

### Production (PM2)
```bash
npm run build                    # compile to dist/
npm install -g pm2               # once
pm2 start ecosystem.config.js
pm2 save                         # freeze process list for reboot
pm2 startup                      # print a command to enable start-on-boot; run it
```

---

## Managing keywords (DM commands)

From your **owner** number, DM the bot:

| Command | Action |
|---------|--------|
| `help` (or `?`) | Show the command list |
| `list keywords` | Show current keywords |
| `add keyword <a>, <b>, …` | Add one or more (comma- or newline-separated) |
| `remove keyword <a>, <b>, …` | Remove one or more |

Changes are written to `config.json` and applied live (no restart). Multi-word
keywords are fine (e.g. `beach tennis`); only commas/newlines separate entries.

You can also just edit `config.json` directly — the bot hot-reloads it.

---

## Operations

### Useful PM2 commands
```bash
pm2 status                                   # is wa-monitor online?
pm2 logs wa-monitor --lines 50 --nostream    # recent logs
pm2 logs wa-monitor --raw | npx pino-pretty  # pretty-print prod JSON logs
pm2 restart wa-monitor                       # after `npm run build`
pm2 stop wa-monitor                          # to run `npm run dev` instead
```

### Session backup
`auth_state/` is the WhatsApp session — back it up so a disk loss means a
restart, not a re-pair:
```bash
./scripts/backup-auth-state.sh               # timestamped tarball, keeps last 14
```
Schedule nightly via cron:
```
0 3 * * * /absolute/path/to/scripts/backup-auth-state.sh
```

### Keeping the link alive
Linked devices are dropped if the bot phone stays offline ~14 days. Power the
bot phone on and let it reach WhatsApp every week or two, and keep its SIM/eSIM
active.

---

## Deploying to a cloud host

The bot is fully portable — all state is in `auth_state/` + `config.json`.

1. Provision a small Linux VPS (Node ≥ 18). A region near your account's usual
   location is preferable.
2. Copy the repo **plus `auth_state/` and `config.json`** to the server — copying
   the session means **no re-pairing** (the server inherits the linked device).
3. `npm install && npm run build`
4. `pm2 start ecosystem.config.js && pm2 save && pm2 startup` (systemd on Linux).
5. Re-add the backup cron; stop the old instance.

**Pairing on a headless box** (only if you don't copy `auth_state/`): run
`node dist/index.js` in the foreground over SSH and scan the ASCII QR from your
screen, then hand off to PM2. (A phone-number pairing-code flow can be added if
preferred.)

> `auth_state/` is a live credential — restrict access to it and lock the box
> down (SSH keys, firewall).

---

## Troubleshooting

| Symptom | Cause / Fix |
|---------|-------------|
| **405 before any QR** | The version bundled with Baileys is rejected by WhatsApp. The bot uses `fetchLatestBaileysVersion()` to avoid this — keep it. |
| **408 `unexpected error in 'init queries'`** | Benign — one auxiliary post-connect query timing out. The connection stays up; ignore. |
| **`failed to decrypt message` (groups)** | Normal right after joining/linking — the device lacks some senders' group keys yet. Tapers off as senders re-send; keep the bot connected. |
| **"Waiting for this message" on your phone** | Signal session desync (often after repeated re-pairs). Fix: on your phone, clear the chat with the bot, then send it one message to rebuild a clean session. |
| **515 right after pairing** | Expected — WhatsApp requires one reconnect after linking. The bot auto-reconnects. |
| **Needs re-pair** | Delete `auth_state/` and restart to show a fresh QR. |

---

## Safety & ToS

This project uses an **unofficial** WhatsApp library, which is against WhatsApp's
Terms of Service and carries a (low, for passive use) ban risk. To stay safe:

- **Run it on a dedicated secondary number**, never your primary.
- The bot is **passive** — it only reads groups and DMs you; it never posts.
- Sends are **rate-limited with jitter** to avoid robotic patterns.
- Install **only** the declared dependencies — no third-party "anti-ban"
  packages (a known malware vector).

For personal/educational use. You are responsible for how you use it.

---

## Tech stack

TypeScript · [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) `6.7.23` · pino · PM2
