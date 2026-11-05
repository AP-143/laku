# The edit adds the captions and the colour grade, not the video model

Generated video gives itself away in a few ways, and a professional editor fixes each of them in the edit, so LAKU does too. The clips come from the video model; everything below is done by the app, in the same ffmpeg pass that joins the clips, so the picture is encoded once.

- **Captions are drawn by the app.** The video model is told to draw no text. A model that draws its own text writes garbled words and changes the style from clip to clip (the sample videos made on Google Flow have both). The planner writes the captions of each clip with when they show; the app draws them in one font (Geist, kept in `src/server/fonts/`), one size and one outline, with a short fade in and out.
- **One colour grade over every clip.** The planner chooses a contrast, a saturation, a warmth, a little film grain and a vignette for the ad's art direction, within bounds that always look natural, and the same grade is applied to every clip so they match. A little grain takes away the plastic look.
- **The picture is kept.** The joined video is encoded at CRF 17. The first version used the default and kept about 40% of the detail of the clips.
- **Cuts, not morphs.** When a clip plays more than one panel, the model is told to cut between them like an editor, not dissolve one into the next.

## Considered options

- **Let the video model draw the captions.** The first design. Rejected: garbled words, and a different style in every clip.
- **Burn the captions in a second pass.** Rejected: a second encode loses quality; one pass does the grade, the grain and the captions.
- **A fixed grade for every ad.** Rejected: a gadget and a plate of food do not want the same grade; the planner picks it, and bounds keep a bad answer from ruining the picture.

## Consequences

- The captions, the grade and the clip lengths are sent back when a stopped video is remade, so the finished video matches the first try.
- Without the font file the video is still made, without captions.
- The tests measure the pixels of the video that comes out (a caption is on screen only in its window; a more saturated grade is more colourful). Whether the result looks professional is judged by eye on real runs.
- Still open: a music bed, 1080p, and a cleaner reference picture per clip than the small sheet (the faces in it are small, so a person can drift a little from clip to clip).
