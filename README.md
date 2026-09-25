# WhatsApp Keyword Monitor

[![CI](https://github.com/MarlonBuosi/keyword-sniffer/actions/workflows/ci.yml/badge.svg)](https://github.com/MarlonBuosi/keyword-sniffer/actions/workflows/ci.yml)

A small, always-on bot that watches a set of high-traffic WhatsApp **groups**,
matches every incoming message against a keyword list, and forwards the matches
to your **personal** WhatsApp DM in near real time — so you don't have to read
the firehose to catch the messages you care about.

Built on [Baileys](https://github.com/WhiskeySockets/Baileys) (the multi-device
WhatsApp Web protocol) and TypeScript, deployed to AWS EC2 under systemd.

---

## Features

- **Monitors specific groups only** — ignores every other chat.
- **Accent- & case-insensitive matching** — `promoção` also matches `promocao`,
  `PROMOÇÃO`, etc. (built for Portuguese).
- **Whole-word matching** — `raquete` matches "vendo raquete!" but not
  `raqueteira` or `raquetes`; add plurals/variants as their own keywords.
- **DM delivery to your own number** — matches arrive as a formatted alert.
- **Media matches come through intact** — an image/video/PDF match is delivered
  as a single message (the media + a caption with the context and text).
- **Live keyword management** — DM the bot to `list` / `add` / `remove` keywords
  (bulk supported); changes apply instantly, no restart.
- **Config hot-reload** — edit `config.json` and it's picked up live.
- **Resilient** — auto-reconnects with backoff, persists its session across
  restarts, and answers decrypt-retry requests from a sent-message store kept
  on disk (see the "Waiting for this message" note in Troubleshooting).
- **Runs unattended** — systemd service on a small EC2 instance (restart on crash, start on boot).

---

## How it works

```
WhatsApp groups ──▶ Baileys client ──▶ filter ──▶ notifier ──▶ your DM
                    (connection.ts)   (filter.ts) (notifier.ts)
                          │
            auth_state/  +  config.json  +  sent-messages.json
            (session)       (groups,        (recent sends, for
                             keywords,       decrypt-retry resends)
                             owner)
```

Per incoming message the pipeline: skips non-monitored chats and the bot's own
messages → extracts text (plain / extended / media caption) → normalizes
(lowercase + strip accents) → matches keywords → on a hit, queues a jittered DM
to the owner.

### Source layout

| File | Responsibility |
|------|----------------|
| `src/index.ts` | Wiring: message pipeline, owner-command routing, hot-reload |
| `src/connection.ts` | Baileys socket, auth session, QR/pairing code, reconnect/backoff |
| `src/connection-rules.ts` | Pure decisions: close → fatal / give up / retry, pairing checks |
| `src/jid.ts` | JID helpers and the owner check for DM commands |
| `src/config.ts` | Load + validate `config.json`, save, watch for changes |
| `src/filter.ts` | Text extraction, accent normalization, keyword matching |
| `src/notifier.ts` | Jittered alert queue, formatting, media re-send |
| `src/commands.ts` | Owner DM commands (help / list / add / remove) |
| `src/store.ts` | Sent-message store on disk (last 500) for decrypt-retry resends |
| `src/log-filter.ts` | Silences noisy libsignal `console` output |

---

## Prerequisites

- **Node.js ≥ 22.12** (Baileys needs ≥ 20, Vitest ≥ 22.12; the server and CI run 24.x)
- A **dedicated/secondary WhatsApp number** for the bot (see [Safety & ToS](#safety--tos))
- The bot number must be a **member of the groups** you want to monitor

---

## Setup

```bash
git clone https://github.com/MarlonBuosi/keyword-sniffer.git
cd keyword-sniffer
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
| `keywords` | Terms to match as whole words (case/accent-insensitive). |
| `ownerJid` | Your personal number as `<countrycode><number>@s.whatsapp.net`. |
| `sendDelayMs` | Random delay range between DMs (jitter — keeps sends human-like). |
| `forwardAll` | **Test mode:** forward every message, ignore keywords. Ban-risky; keep brief. |
| `forwardAllLimit` | Safety cap: `forwardAll` auto-stops after this many sends. |

> **Checking group JIDs:** on startup the bot logs the name of each group in
> `monitoredGroups`, or a warning if the bot number isn't a member of it.

`config.json`, `auth_state/`, `sent-messages.json`, `.env`, and `dist/` are
gitignored — no secrets or session data are committed.

---

## Running

### Development
```bash
npm run dev      # tsx watch, pretty logs
```
On first run, scan the QR (terminal) from the **bot** phone:
**WhatsApp → Linked Devices → Link a Device**. The session is saved to
`auth_state/`, so subsequent starts reconnect without a QR.

To pair with a code instead of a QR (handy on a server), set the **bot's**
number, digits only: `PAIR_PHONE=5511912345678 npm run dev`, then on the bot
phone use **Link a Device → Link with phone number instead** and type the code
from the logs.

### Tests
```bash
npm test             # run once (Vitest)
npm run test:watch   # re-run on change
npm run typecheck    # tsc over src/ including tests
```
Tests live next to the code as `src/*.test.ts` and run fully offline (no
WhatsApp). CI runs typecheck → tests → build on every PR and push to `main`
(`.github/workflows/ci.yml`); the production build excludes test files
(`tsconfig.build.json`).

### Production (AWS EC2 + systemd)
Runs as the `wa-monitor` systemd service on an EC2 instance in São Paulo.
First-time setup (console checklist, server bootstrap, pairing) is in
**[deploy/AWS.md](deploy/AWS.md)**.

**Deploys are automatic:** merging to `main` runs CI, and if the `quality` job
passes, the `deploy` job ships that commit to the server via AWS SSM (no SSH,
no stored keys), then fails the run if the bot doesn't reconnect. Redeploy
from the Actions tab (*CI → Run workflow*). Setup: [deploy/AWS.md
§7](deploy/AWS.md#7-automatic-deploys). Manual fallback:
```bash
ssh wa-monitor 'sudo /opt/wa-monitor/deploy/update.sh'          # latest main
ssh wa-monitor 'sudo /opt/wa-monitor/deploy/update.sh <sha>'    # a specific main commit (rollback)
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
Keywords match whole words, so add plurals/variants as separate entries. `add`
and `remove` ignore case, accents and extra spaces (`promocao` is the same
keyword as `promoção`).

You can also just edit `config.json` directly — the bot hot-reloads it.

---

## Operations

### Service commands (on the server)
```bash
systemctl status wa-monitor                  # running? last exit status?
sudo systemctl restart wa-monitor            # or stop / start
journalctl -u wa-monitor -f -o cat | /opt/wa-monitor/node_modules/.bin/pino-pretty   # live logs
```
Code is in `/opt/wa-monitor`; state (`config.json`, `auth_state/`,
`sent-messages.json`) is in `/var/lib/wa-monitor`, set via the `CONFIG_PATH` /
`AUTH_DIR` / `SENT_STORE_PATH` env vars in the unit (locally they default to
the working directory). Optional settings live in `/etc/wa-monitor.env`:
`LOG_LEVEL`, `BAILEYS_LOG_LEVEL` (e.g. `debug` while troubleshooting),
`PAIR_PHONE` (only while pairing). More in [deploy/AWS.md](deploy/AWS.md#day-to-day).

### Session backup
`auth_state/` is the WhatsApp session — back it up so a disk loss means a
restart, not a re-pair. On AWS, a Lifecycle Manager policy takes **daily EBS
snapshots** of the whole disk (see [deploy/AWS.md](deploy/AWS.md)). For an ad
hoc local tarball:
```bash
./scripts/backup-auth-state.sh               # timestamped tarball, keeps last 14
```

### Keeping the link alive
Linked devices are dropped if the bot phone stays offline ~14 days. Power the
bot phone on and let it reach WhatsApp every week or two, and keep its SIM/eSIM
active.

---

## Troubleshooting

| Symptom | Cause / Fix |
|---------|-------------|
| **405 before any QR** | The version bundled with Baileys is rejected by WhatsApp. The bot uses `fetchLatestBaileysVersion()` to avoid this — keep it. |
| **408 `unexpected error in 'init queries'`** | Benign — one auxiliary post-connect query timing out. The connection stays up; ignore. |
| **`failed to decrypt message` (groups)** | Normal right after joining/linking — the device lacks some senders' group keys yet. Tapers off as senders re-send; keep the bot connected. |
| **"Waiting for this message" on your phone** | Your phone couldn't decrypt a message from the bot and asked it to resend. The bot keeps its last 500 sent messages on disk, so it can answer across restarts; check with `journalctl -u wa-monitor -o cat \| grep "resend requested"` (`found: true` = resent). **Known limitation:** when your account uses WhatsApp's newer LID addressing (resend requests come from `…@lid`), some messages stay stuck even after a successful resend — an open Baileys issue ([#1767](https://github.com/WhiskeySockets/Baileys/issues/1767), [#2297](https://github.com/WhiskeySockets/Baileys/issues/2297)), mostly affecting iPhones. If a chat gets bad, clear the chat with the bot on your phone and send it one message to reset the session. |
| **515 right after pairing** | Expected — WhatsApp requires one reconnect after linking. The bot auto-reconnects. |
| **Needs re-pair** | Delete the contents of `auth_state/` and restart to pair again (QR, or code with `PAIR_PHONE`). On the server, see [deploy/AWS.md](deploy/AWS.md#day-to-day). |
| **`systemctl status` shows `failed` with `status=2`** | The session was rejected (401/403/405) and the bot exited with code 2, which the unit is configured not to restart (`RestartPreventExitStatus=2`). Re-pair as above. |
| **Frequent restarts during outages** | Expected — after 6 failed reconnects (~2 min) the bot exits and systemd restarts it fresh. |

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

TypeScript · [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys) `6.7.23` · pino · Vitest ·
GitHub Actions (CI + OIDC → AWS SSM deploys) · systemd on AWS EC2
