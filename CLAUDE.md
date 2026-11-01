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

## Gateway account facts (verified 2026-11-01)

- The AI Gateway needs a valid card on file before it unlocks the US$5 monthly free credit. Do not buy credits and keep auto top-up off; set a budget on the API key.
- The free tier covers only a subset of models. `bfl/flux-kontext-pro` works on it; `meta/muse-image-1.0` and `google/gemini-nano-banana-2.1` do not.
- Every video model is refused unless the paid balance is at least US$10, so video is not available on the free credit.
