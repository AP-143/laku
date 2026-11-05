# LAKU

A chatbot for small online sellers in Indonesia. From one amateur photo of a product it makes:

- a **studio photo** (clean backdrop, solid colour or lifestyle setting; the product never changes), and
- a **storyboard and ad video**: six scenes drawn as one picture (numbered titles, caption bubbles, a different shot per panel), then a vertical ad video of 10, 20 or 30 seconds made from that picture, with an optional Indonesian voice-over.

The chat talks to the seller in Bahasa Indonesia. The code, comments and docs are in English.

For each product the planner also writes an art direction (mood, colour grade, effects, graphic style), so a gadget does not get the same look as a plate of food. The storyboard picture and every video clip are made in it.

## How it works

Every model runs directly on a Google AI Studio key (no gateway):

| Job | Model |
| --- | --- |
| Chat, product check, planning | `gemini-3.5-flash-lite` |
| Studio photos and the storyboard picture | `gemini-nano-banana-2.1` |
| Video clips | `gemini-omni-1.1-flash` (Interactions API) |
| Voice-over | `gemini-3.8-flash-lite-tts` |

All model IDs and estimated prices live in `src/config/models.ts`. Only `src/server/model-client.ts` talks to models.

Nothing paid happens by guesswork: the seller approves the scenes before the picture is drawn, and pressing the video button always shows the price first.

Read `GLOSSARY.md` for the domain words and `docs/adr/` for why things are the way they are.

## Run it

You need Node.js 22 or later, `ffmpeg` on your PATH (videos are joined and the voice is laid over with it), and a Google AI Studio API key **with billing enabled** (image and video models have no free tier).

```bash
npm install
echo "GOOGLE_GENERATIVE_AI_API_KEY=your-key" > .env.local
npm run dev
```

Open http://localhost:3000/chat. Generated files go under `storage/` (git-ignored).

## Cost

Real runs spend real money: about US$0.03 for a studio photo or a storyboard picture, and about US$0.10 per second of video (US$1 for 10 seconds). The app keeps a local estimate of this month's spend (the usage meter) and refuses to pass a **daily limit** (`COSTS.dailyBudgetUsd`). That limit is an estimate and the only one the app sets: set a spend cap on the Google billing side as well.

## Test

```bash
npm test          # automated tests: fake models, no network, no cost
npm run typecheck
npm run lint
npm run bakeoff -- --dry-run   # prints the plan and estimated spend of the live model comparison
```

The tests sit at one seam, the chat API: they send a request to the chat handler and read the event stream, with the models faked by `src/server/testing/`. They cannot tell how good a picture or a video looks; that is judged on real runs.

## Before you put it on the internet

This is a prototype made to run on localhost. The chat API is bounded per request (body size, message count and length, reply tokens) but has **no authentication and no per-IP or per-session rate limit**. Add both before exposing it publicly, otherwise anyone can spend your model quota.

## License

[MIT](LICENSE)
