# LAKU

A chatbot for small online sellers in Indonesia. From one amateur photo of a product it makes:

- a **studio photo** (clean backdrop, solid colour or lifestyle setting; the product never changes), and
- a **storyboard and ad video**: scenes drawn as one picture (numbered panels, caption bubbles, a different shot per panel; the AI chooses how many panels the ad needs), then a vertical ad video made from that picture. In the Video feature the seller attaches the storyboard picture and says in their own words what video they want (for example "video iklan 10 detik layaknya editan profesional"). The words and the picture go to the video model as they are, the model decides how the video looks, moves and sounds, and the seller says yes to the exact price first. The length is 10, 20 or 30 seconds, the one the words name (10 when they name none). The app writes no instructions for the video and adds nothing to it afterwards.

The chat talks to the seller in Bahasa Indonesia. The code, comments and docs are in English.

For each product the planner also writes an art direction (mood, colour grade, effects, graphic style), so a gadget does not get the same look as a plate of food. The storyboard picture is made in it, and the video model takes the look from that picture.

## How it works

Every model runs directly on a Google AI Studio key (no gateway):

| Job | Model |
| --- | --- |
| Chat, product check, planning | `gemini-3.5-flash-lite` |
| Studio photos and the storyboard picture | `gemini-nano-banana-2.1` |
| Video | `gemini-omni-1.1-flash` (Interactions API) |

All model IDs and estimated prices live in `src/config/models.ts`. Only `src/server/model-client.ts` talks to models.

Read `GLOSSARY.md` for the domain words and `docs/adr/` for why things are the way they are.

## Run it

You need Node.js 22 or later, and a Google AI Studio API key **with billing enabled** (image and video models have no free tier).

```bash
npm install
echo "GOOGLE_GENERATIVE_AI_API_KEY=your-key" > .env.local
npm run dev
```

Open http://localhost:3000/chat. Generated files go under `storage/` (git-ignored).

## Cost

Real runs spend real money: about US$0.03 per studio photo or storyboard picture, about US$0.10 per second of video (US$1 for 10 seconds). A pop-up (the Price question) shows the price and waits for a yes before each one, and again on every retry. The app has no usage meter or spend limit, so a bug or a loop can spend until your balance ends: set a spend cap on the Google billing side.

## Test

```bash
npm test          # automated tests: fake models, no network, no cost
npm run typecheck
npm run lint
npm run bakeoff -- --dry-run   # prints the plan and estimated spend of the live model comparison
```

The tests sit at one seam, the chat API: they send a request to the chat handler and read the event stream, with the models faked by `src/server/testing/`. They cannot tell how good a picture or a video looks; that is judged on real runs.

## Before you put it on the internet

The prototype runs on localhost only. The chat API is bounded per request but has **no authentication and no rate limit**: add both before exposing it, or anyone can spend your model quota.

## License

[MIT](LICENSE)
