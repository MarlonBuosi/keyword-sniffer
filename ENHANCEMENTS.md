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

## ~~Linting & Formatting (Biome)~~ — done

[Biome](https://biomejs.dev) lints and formats `src/` plus the root JSON
configs, matching the existing style (single quotes, no semicolons, trailing
commas, 100 columns) with sorted imports. `npm run lint` checks and
`npm run lint:fix` applies; config is in `biome.json`. CI's `lint` check runs
`npx biome ci`, so a lint or format failure blocks the merge and the deploy.

Possible follow-ups:
- **Pre-commit hook** — e.g. `lefthook` running `biome check` on staged files,
  if CI failures on formatting become a nuisance.

---

## ~~Automated Tests + CI~~ — done

Vitest suite (`src/*.test.ts`, offline) covering keyword filtering, DM
commands, config validation, the owner check, and the reconnect / pairing
decisions — including regression tests for past incidents. CI
(`.github/workflows/ci.yml`) runs `deps`, `lint`, `typecheck`, `test`, `build`
and `shellcheck` as separate parallel checks on PRs and pushes to `main`.

Remaining test gaps (need a mocked Baileys socket):
- **`notifier.ts`** — queue order, jitter between sends, `linkPreview: null`,
  media path vs text fallback. Mock `sock.sendMessage`, use fake timers.
- **`connection.ts` wiring** — the decisions are tested in
  `connection-rules.ts`; the socket/event plumbing around them isn't.

---

## ~~Automatic Deploys (GitHub Actions → AWS SSM)~~ — done

Merges to `main` deploy after CI passes: job `deploy` → OIDC → SSM document
`wa-monitor-deploy` → `deploy/update.sh <sha>` (isolated build, swap, restart,
reconnect check). The role trusts GitHub's immutable OIDC subject
(owner/repo IDs + `refs/heads/main`). `main` is protected with all six CI checks required (admin bypass).
See [deploy/AWS.md §7](deploy/AWS.md#7-automatic-deploys).

Possible follow-ups:
- **Close SSH (port 22)** — SSM Session Manager provides a shell from the AWS
  console, so the security-group rule could go.
- **Automatic rollback** — `update.sh` fails the run and prints the rollback
  command; it could redeploy the previous SHA by itself instead.
