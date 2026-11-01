## Agent skills

### Issue tracker

Issues and specs live as GitHub Issues in AP-143/laku (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default triage vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Next.js

This version of Next.js has breaking changes: APIs, conventions, and file structure may differ from what you remember. Read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code, and heed deprecation notices.

## Models and the live bake-off

All model IDs live in `src/config/models.ts`. `npm run bakeoff -- --dry-run` prints the plan and estimated spend without calling any model; `npm run bakeoff` runs the live comparison (spends free-tier credit, capped by `--cap`, default US$2). Keep generated outputs under `storage/` (git-ignored).
