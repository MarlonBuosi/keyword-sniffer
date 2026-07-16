# Future Enhancements

Ideas and planned improvements for the WhatsApp Keyword Monitor. Add new
sections here as they come up.

---

## Cloud Hosting

**Goal:** run the bot on an always-on cloud server so it no longer depends on a
personal machine being awake/online.

### Why it's low-effort
All state lives in two places — `auth_state/` (the WhatsApp session) and
`config.json`. Copying `auth_state/` to the new host means the server **inherits
the existing linked device — no re-pairing / QR scan required**. Everything else
(PM2, the backup script, the build) transfers unchanged; only the boot mechanism
differs (`systemd` on Linux instead of macOS `launchd`, handled automatically by
`pm2 startup`).

### Migration steps
1. Provision a small Linux VPS (Node.js ≥ 18).
2. Copy the repo **plus `auth_state/` and `config.json`** to the server
   (`scp` / `rsync`).
3. `npm install && npm run build`
4. `pm2 start ecosystem.config.js && pm2 save && pm2 startup`
5. Re-add the nightly backup cron; stop the old (Mac) instance.

Estimated effort: ~1 hour, mostly `npm install`.

### Host options
| Option | Cost | Notes |
|--------|------|-------|
| Oracle Cloud Free Tier | $0 | Always-free ARM VM; has a São Paulo (GRU) region — good IP geography. Sign-up can be fiddly. |
| Hetzner / small VPS | ~$4–5/mo | Rock-solid, simplest setup. EU/US regions. |
| Fly.io / Railway | $0–5 | Only viable with a **persistent volume** — the default ephemeral filesystem would wipe `auth_state/` on redeploy and force a re-pair. |

### Considerations
- **IP reputation:** a datacenter IP is a marginally worse signal to WhatsApp
  than a residential one. Passive read-only bots run fine on VPS in practice;
  pick a region near the account's usual location (e.g. São Paulo) to keep the
  session geography consistent.
- **Headless pairing (only if not copying `auth_state/`):** run
  `node dist/index.js` in the foreground over SSH and scan the ASCII QR from the
  screen, then hand off to PM2. Alternatively, add Baileys' **pairing-code**
  flow (`sock.requestPairingCode(number)` → type an 8-char code into
  WhatsApp → Linked Devices) — cleaner for a server, ~10 lines to implement.
- **Security:** `auth_state/` is a live credential — anyone with those files can
  impersonate the bot. Lock the box down (SSH keys only, firewall, keep patched)
  and restrict access to the folder.
- **The ~14-day rule still applies:** the bot phone must reach WhatsApp at least
  once every couple weeks, regardless of where the bot is hosted.

### Recommendation
After a clean burn-in: **Oracle free tier in São Paulo** (best cost + geography),
or **Hetzner** for zero-friction setup at ~$5/mo. Avoid container PaaS unless
you're comfortable wiring up a persistent volume.
