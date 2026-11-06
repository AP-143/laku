# The actor is silent and a narrator speaks to the acting; the clips keep their other sound

The first Ad videos threw away the sound the video model made and laid one text-to-speech narration over the picture. Then the person on screen was allowed to speak on camera, but lip-sync in a generated clip is unreliable, the voice drifted from clip to clip, and the speech was never the emotion the reference ad had. Now the actor never speaks and a narrator carries the feeling.

- **The person is silent when the planner chose a voice-over.** Then, and only then, every direction sent to the video model ends with "The person does not speak (a narrator is added later)", so there is nothing to lip-sync and nothing to drift. How the person acts is the model's own choice.
- **The clips keep the sound the video model made**, whatever it chose (effects, room tone, breathing). The app does not direct it (ADR 0008). Clips are joined with levelled loudness. Music is a separate choice of the planner (ADR 0007).
- **The planner decides whether there is a voice-over (the Seller has no checkbox for it), and then writes one narration line for each clip.** The planner looks at the Storyboard picture and its story, then writes a short Indonesian line about what the person feels at that part, a delivery note for it ("whispering, amazed", "bright and excited, then slower on the call to buy") and the second of the clip where the line starts. The one voice (female or male, with a description) is chosen once, from the person it saw.
- **Each line is read with its own emotion and placed at its moment.** The delivery note, with the voice description, is sent to the speech model as its style instructions. The line starts at that second, is sped up a little (never more than 15 percent) if it would run over its clip, and the last line is over before the closing seconds. The narration is mixed over the clips' sound, which ducks while the narrator speaks.
- When the planner chooses no voice-over, nobody is told anything about speech and the video keeps whatever sound the model made.

## Considered options

- **Always lay one narration over the video (the first design).** Rejected: one voice read on one note, not tied to what is on screen.
- **Let the person speak on camera (the second design).** Rejected: lip-sync and a steady voice cannot be trusted from a generated clip, and a spoken line forces the acting to wait for words.
- **One narration script for the whole video.** Replaced by a line for each clip: each line can be timed to its acting and carry its own emotion, and a remade voice keeps every line.

## Consequences

- The Voice-over price is booked only when the planner chose a voice-over, is shown in the Price question, and is counted on the length of the video.
- A change of voice keeps every line with its delivery and its moment; new words become one line read from the start.
- A remade clip keeps its lines, because they are sent back on a resume.
- Whether the lines land on the right moments and sound moved can only be judged on real runs; the automated tests check what is asked of the models, where each line starts, and what comes out of the mix.
