# Future Enhancements

Ideas and planned improvements for the WhatsApp Keyword Monitor. Add new
sections here as they come up.

---

## ~~Cloud Hosting~~ — done

Moved off PM2 on a personal machine to an EC2 `t4g.micro` in São Paulo under
systemd, with daily EBS snapshots and pairing-code login for headless setup.
See [deploy/AWS.md](deploy/AWS.md).

Possible follow-ups:
- **Down alerting** — e.g. a healthchecks.io ping while connected (plus a
  `/fail` ping on a fatal exit), so a logged-out bot doesn't go unnoticed.
- **Session in a database** — Baileys recommends against its file-based
  `useMultiFileAuthState` in production; a DB-backed store (e.g. Postgres)
  would make the server disposable without relying on disk snapshots.

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
