# Music is designed by the planner, made by Lyria, and chosen by the Seller

An Ad video can get a music bed. It is the Seller's choice (a checkbox in the video panel, on by default), because it costs money and a yes to the Price question has to cover everything that is booked (ADR 0003): the price shown is US$1.04 for 10 seconds with music, not US$1.00.

When the Seller asks for music, the planner that looks at the Storyboard picture also designs the music like an editor choosing a track: a genre and mood for this product, its buyers and the art direction, a tempo in BPM picked so the cuts between Clips fall on a beat, the key, the instruments, a steady groove from the first beat (only the first seconds of the clip are used, so there is no long intro or big ending), no artist names and no vocals, and how loud it sits (quieter when someone speaks). That brief is the prompt of Lyria 3 Clip, which makes one 30 second instrumental MP3 for about US$0.04 on the Google key.

The music goes under the sound of the video before any narration: quieter by the planner's level, ducked while the sound is loud, with a short fade in and a longer fade out. The narration is then laid over it and ducks it again.

## Considered options

- **Free stock tracks.** Rejected for now: the choice is small, the tempo and mood cannot be matched to the video, and the licenses need attribution and a download.
- **Music made with ffmpeg synthesis.** Rejected: free and offline, but it sounds like plain synthesizer tones, not natural music.
- **Always add music.** Rejected: it spends money the Seller did not ask to spend, and the Price question would no longer be the whole price.

## Consequences

- The music is made after the Clips, so a stopped video that is remade still gets it, and the plan of the music is sent back with the resume. If the music fails the Seller still gets the video, and a rejected call is given back; one that timed out stays booked.
- Lyria is in preview and has no free tier. Every clip carries an inaudible SynthID watermark. The clip is always 30 seconds, so a video longer than that gets its music to the end with the fade.
- The tests check what is asked of the music model, that its sound is in the video and not otherwise, and the price. Whether the music suits the ad can only be judged by ear on real runs. The first measurements showed a ducking tuned too hard silenced the music; it now only reacts to loud speech and effects.
