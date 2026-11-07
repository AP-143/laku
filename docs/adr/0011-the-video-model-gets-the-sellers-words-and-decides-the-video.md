# The video model gets the Seller's words and decides the whole video

Supersedes [0005](0005-the-planner-decides-how-the-video-sounds.md), [0006](0006-the-edit-adds-the-grade-not-the-text.md) and [0007](0007-music-is-chosen-and-designed-by-the-planner.md), and the clip prompt and the planner of [0008](0008-the-video-model-is-given-the-storyboard-picture-as-it-is.md).

The Seller wants the AI to decide how the video is made, from what they write in the chat: "buatkan video iklan 10 detik layaknya editan profesional dari storyboard ini" should give a 10 second video that the AI makes as it sees fit. Every instruction, prompt and rule the app wrote for the video is removed. The Video Feature (the sidebar entry, the attached picture, the Price question and the player) stays.

- **There is no video planner.** The text model is asked one thing about a video: whether the attached picture shows a product (the frame check, which gates the spend). It no longer decides the Length, the Voice-over, the Music bed, the colour grade or what each clip plays.
- **The video model gets the storyboard picture and the Seller's words exactly as typed**, and nothing of ours: no sentence about what the picture is, no direction, no rule. With no words, it gets the picture alone.
- **The video is one call of the Length asked for**, not clips joined together. The Length is the one the Seller's words name (found by the same fixed pattern as before: "10 detik", "30s", "20 sec", the nearest of 10, 20 or 30 that is not longer), otherwise 10. The video is kept as the model returned it, sound included.
- **The app adds nothing afterwards**: no joining, no colour grade or grain, no text-to-speech voice-over, no Lyria music, and no "change the voice" request. They all existed because the planner chose them, and there is no planner. The code for them (the speech and music models, the ffmpeg edit, the narration and the resume of a stopped video) is deleted.
- **The Price question is unchanged in spirit**: always asked first, for the Length the words name (US$0.10 per second, so US$1, US$2 or US$3), and a yes covers that price. A failed call gives its booking back, except one that timed out, which may still be billed.

## Consequences

- A video of 20 or 30 seconds in one call has not been tried on the real model: the longest length proven is a 6 second clip (a 10 second request used to be a 6 and a 4 second clip). If the model refuses it, nothing is billed and the Seller sees an error. Whether the result is good is only visible on a real run.
- A video that fails has nothing partial to keep, so it is retried whole, and the Seller is asked the price again.
- A browser or saved chat that still sends `sheet`, `resume`, `revise` or `videoChoice` has those fields ignored, and a saved card of a video that stopped part way is hidden.
- The bake-off script still has a voice sample ("--only=speech") as a manual tool; the app no longer uses speech.
