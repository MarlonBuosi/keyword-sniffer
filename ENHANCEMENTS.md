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

## Automatic Deploys (GitHub Actions → AWS SSM)

**Goal:** a merge to `main` deploys by itself, only after `quality` passes.

- Add a `deploy` job to `ci.yml`: `needs: quality`, only on `push` to `main`.
- Authenticate with **GitHub OIDC** (no stored AWS keys); IAM role trust
  limited to `repo:MarlonBuosi/keyword-sniffer:ref:refs/heads/main`, permission
  limited to `ssm:SendCommand` on this instance.
- Run `sudo /opt/wa-monitor/deploy/update.sh` via SSM Run Command (the SSM
  agent ships with Ubuntu AMIs; the instance needs a role with
  `AmazonSSMManagedInstanceCore`). No inbound ports, no SSH key in GitHub.
- First make `update.sh` build before swapping, so a failed build never
  replaces the running version.
- Afterwards SSH (port 22) can be closed entirely — SSM also provides a shell.
