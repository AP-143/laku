# The edit adds the colour grade and keeps the quality; the text on screen is the video model's

Generated video gives itself away in a few ways, and a professional editor fixes some of them in the edit, so LAKU does too. The clips come from the video model; the edit joins them and adds the grade in one ffmpeg pass, so the picture is encoded once. The edit draws nothing on the picture.

- **The text on screen is the video model's.** The storyboard picture holds the style of the ad: its captions, checklist, call to action, colours and effects. The video model reads it and decides how the text looks on screen (ADR 0008). The planner only says which captions of the storyboard show in which clip, word for word, and never invents other words. An earlier version had the app draw the captions (a font, bubbles, a palette, doodles); the Seller wanted the style to come from the storyboard and the AI, not from fixed choices of the app, so that code is gone.
- **One colour grade over every clip.** The planner chooses a contrast, a saturation, a warmth, a little film grain and a vignette for the ad's art direction, within bounds that always look natural, and the same grade is applied to every clip so they match. A little grain takes away the plastic look.
- **The picture is kept.** The joined video is encoded at CRF 17. The first version used the default and kept about 40% of the detail of the clips.

## Considered options

- **Draw the captions in the edit with the app's own font and bubbles.** The second design. Rejected by the Seller: it replaces the style of the storyboard with the app's, and the AI should decide how text and effects look.
- **Burn extra text in a second pass.** Rejected: a second encode loses quality.
- **A fixed grade for every ad.** Rejected: a gadget and a plate of food do not want the same grade; the planner picks it, and bounds keep a bad answer from ruining the picture.

## Consequences

- The grade and the clip lengths are sent back when a stopped video is remade, so the finished video matches the first try.
- The tests measure what comes out of the edit (a more saturated grade is more colourful, grain is capped) and what the prompts say. Whether the text the video model draws is spelled right and looks like the storyboard can only be judged on real runs; a model can garble text, which is the cost of this choice.
- Music is ADR 0007. Still open: 1080p.
