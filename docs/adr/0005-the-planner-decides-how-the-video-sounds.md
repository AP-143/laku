# The planner decides how the video sounds, and the clips keep their sound

The first Ad videos threw away the sound the video model made and laid one text-to-speech narration over the picture. People on screen moved their mouths to words nobody heard, the narration was read on one note, and one fixed voice was used whatever the person looked like. Now the planner looks at the Storyboard picture, thinks, and decides.

- **The clips keep their own sound**: sound effects in sync with the action, a room tone, and the speech when the person talks. Clips are joined with levelled loudness. Music is a separate choice of the Seller (ADR 0007).
- **When the Seller asks for a voice, the planner picks the mode.** `on_camera`: the person speaks short Indonesian lines taken from the captions, with lip movement that matches, in one voice described in every clip so the person sounds the same all through. `narration`: a narrator is read over the video, nobody speaks on camera (the mouths stay closed), and the narration is mixed over the clips' sound, which ducks while the narrator speaks. When no voice was asked for, nobody speaks and only the sound effects remain.
- **The narration is directed, not just read.** The script writer thinks first about the mood of each moment, writes spoken Indonesian with pauses (`<short pause>`, `<breath>`), and writes a delivery note ("warm and upbeat, building excitement at the reveal, slowing on the call to buy") that is sent to the speech model as its style instructions. The voice (female or male) and its description come from the planner, which saw the person.
- **The clips are directed like a real shoot**: natural micro-expressions, breathing, small movements, never a frozen pose.

## Considered options

- **Always lay a narration over the video (the first design).** Rejected: the mouths and the voice disagree, and one voice fits no one.
- **Always let the person speak.** Rejected: a video where the product is the star, or a person who only reacts, sounds forced when they talk; the planner chooses per ad.
- **Narrate each clip on its own, aligned to the clip.** Not done: more speech calls and a voice that can drift between calls. One narration over the whole video is mixed instead.

## Consequences

- The Voice-over (narration) price is only booked when the planner chose a narration; speech on camera is part of the video price.
- A remade clip keeps its words and the way the video is mixed, because both are sent back on a resume.
- Whether the speech is really in sync with the mouths, how natural it sounds, and whether the effects land on the right frames can only be judged on real runs; the automated tests check what is asked of the models and what comes out of the mix.
