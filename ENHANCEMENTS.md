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

---

## Linting & Formatting (Biome)

**Goal:** enforce consistent style and catch lint issues automatically. Right
now the only quality gate is TypeScript's `strict` typecheck (`tsc --noEmit`) —
there's no linter or formatter.

**Why [Biome](https://biomejs.dev):** a single fast (Rust) tool that replaces
both ESLint and Prettier, with near-zero config and one dependency instead of
the usual ESLint plugin sprawl.

### Setup
```bash
npm install -D --save-exact @biomejs/biome
npx biome init          # creates biome.json
```

Add scripts to `package.json`:
```json
{
  "scripts": {
    "lint": "biome check src",
    "format": "biome format --write src",
    "check": "biome check --write src"
  }
}
```

### Notes
- Run `biome format --write src` once to normalize the existing code, then
  review the diff in its own commit.
- Optional: add a pre-commit hook (e.g. via `lefthook` or `husky`) to run
  `biome check` on staged files.
- Optional: a CI step (GitHub Actions) running `biome ci src` + `tsc --noEmit`
  on push/PR.
- Keep it advisory at first — don't let formatting churn bury the meaningful
  diffs while the project is still evolving.

---

## Automated Tests

**Goal:** a real, committed test suite. Currently there are none — the pure
logic was validated with throwaway scripts during development, but nothing
persists.

**Recommended runner:** [Vitest](https://vitest.dev) (fast, TS-native, zero
config) — or Node's built-in `node:test` if you'd rather avoid a dependency.

### Setup (Vitest)
```bash
npm install -D vitest
```
Add to `package.json`:
```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### What to cover first (highest value, easiest)
- **`filter.ts`** — `normalize` (accent/case stripping), `matchKeywords`
  (single, substring, multi-hit, no-match, empty), `extractText` (plain /
  extended / caption / ephemeral-wrapped), `hasMedia`.
- **`commands.ts`** — `handleCommand` with a mocked context: bulk add (dedupe +
  already-present), newline/comma splitting, multi-word keywords, bulk remove +
  not-found, `list`, `help`, unknown → help. (These mirror the throwaway
  `_cmd.test.ts` that already passed — port them into `src/commands.test.ts`.)

### Harder (needs a mocked Baileys socket)
- **`notifier.ts`** — queue drains in order, jitter delay between sends,
  `linkPreview: null` on text, media path vs text fallback. Mock `sock` with a
  `sendMessage` spy.
- **`connection.ts`** — reconnect/backoff decisions and the `FATAL_STATUS`
  handling. Extract the "should reconnect / how long / fatal?" logic into a pure
  function so it can be unit-tested without a real socket.

### Notes
- Keep tests **offline** — never hit WhatsApp. All suites should run against
  pure functions or mocks.
- Colocate as `src/<name>.test.ts` (Vitest picks them up by default).

---

## CI Pipeline (GitHub Actions)

**Goal:** every push / PR automatically runs the same quality gates locally
expected — typecheck, lint, tests, build — so regressions are caught before
merge.

Create `.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx tsc --noEmit          # typecheck
      - run: npx biome ci src          # lint + format check (see Biome section)
      - run: npm test                  # unit tests (see Automated Tests section)
      - run: npm run build             # ensure it compiles to dist/
```

### Notes
- Order matters least-expensive-first (typecheck → lint → test → build) so it
  fails fast.
- `biome ci` is check-only (no writes) — the CI-appropriate mode.
- Add a branch-protection rule on `main` requiring the `quality` check to pass
  before merge, once the suite is trustworthy.
- Depends on the **Biome** and **Automated Tests** sections above being set up
  first; until then, comment out the `biome`/`npm test` lines so CI still runs
  typecheck + build.
- No secrets needed — nothing here touches WhatsApp or `auth_state/`.
