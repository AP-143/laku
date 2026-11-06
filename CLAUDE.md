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

All model IDs live in `src/config/models.ts`. Every model runs directly on the Google AI Studio key (`GOOGLE_GENERATIVE_AI_API_KEY`), never through the Vercel AI Gateway: text on `gemini-3.5-flash-lite`, studio photos and storyboard frames on `gemini-nano-banana-2.1`. Video on `gemini-omni-1.1-flash`, voice-over on Gemini TTS and background music on Lyria (all in `src/config/models.ts`). Inside the app, only `src/server/model-client.ts` talks to models (the manual bake-off script is the exception). `npm run bakeoff -- --dry-run` prints the plan and estimated spend without calling any model; `npm run bakeoff` runs the live comparison, spends the prepaid balance, and refuses to start above `--cap` (default US$1.2). Narrow a run with `--only`, `--use-case` and `--models`. Keep generated outputs under `storage/` (git-ignored).

## Google account facts (verified 2026-11-02)

- Image and video models have no free tier: billing must be enabled on the project that owns the key. The account is meant to use a small prepaid balance with auto-reload off, so the balance is the hard stop (check the billing page: it is not enforced by this app). Google has no balance API: check AI Studio before and after a bake-off run.
- The app sets **no spend limit** of its own: the monthly limit and then the daily one were removed (2026-11-05 and 2026-11-06) on the owner's request, and the usage meter only shows the month's estimated spend. The only stops are the balance and any spend cap on Google's side, so keep a cap set in AI Studio. A bug or a loop can now spend without any app-side stop. A storyboard picture costs about US$0.034 and the longest video the panel offers (30 seconds with a voice-over) about US$3.01.
- Veo 3.1 was shut down in the Gemini API on 2026-10-22. Video uses Gemini Omni Flash (`gemini-omni-1.1-flash`) through the Interactions API, about US$0.10 per second; its clips come with an audio track.
- The old gateway experiments are kept only as history in `BAKEOFF_NOTES`.

## Tests

`npm test` runs the automated tests (Node's built-in runner through tsx). They sit at one seam, the chat API boundary: they send a request to the chat handler and read the event stream, with the model faked by `src/server/testing/fake-models.ts`, so they cost nothing and call no real model. Add new behaviour as a test at that seam first.

## Before any public deployment

The chat API is bounded per request (body size, message count, message length, reply tokens) but has no authentication and no per-IP or per-session rate limit, because the prototype only runs on localhost. Add both before the app is exposed publicly, otherwise anyone can spend the model quota.
