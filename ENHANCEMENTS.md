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

## ~~Automated Tests + CI~~ — done

Vitest suite (`src/*.test.ts`, offline) covering keyword filtering, DM
commands, config validation, the owner check, and the reconnect / pairing
decisions — including regression tests for past incidents. CI
(`.github/workflows/ci.yml`, job `quality`) runs typecheck → tests → build on
PRs and pushes to `main`.

Remaining test gaps (need a mocked Baileys socket):
- **`notifier.ts`** — queue order, jitter between sends, `linkPreview: null`,
  media path vs text fallback. Mock `sock.sendMessage`, use fake timers.
- **`connection.ts` wiring** — the decisions are tested in
  `connection-rules.ts`; the socket/event plumbing around them isn't.

When Biome lands, add `npx biome ci src` to the `quality` job.

---

## ~~Automatic Deploys (GitHub Actions → AWS SSM)~~ — done

Merges to `main` deploy after CI passes: job `deploy` → OIDC → SSM document
`wa-monitor-deploy` → `deploy/update.sh <sha>` (isolated build, swap, restart,
reconnect check). The role trusts GitHub's immutable OIDC subject
(owner/repo IDs + `refs/heads/main`). `main` is protected with `quality` required (admin bypass).
See [deploy/AWS.md §7](deploy/AWS.md#7-automatic-deploys).

Possible follow-ups:
- **Close SSH (port 22)** — SSM Session Manager provides a shell from the AWS
  console, so the security-group rule could go.
- **Automatic rollback** — `update.sh` fails the run and prints the rollback
  command; it could redeploy the previous SHA by itself instead.
