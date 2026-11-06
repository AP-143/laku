# The Storyboard is one picture, and the story is paced to the Length

A Storyboard is made as **one picture** with six panels (each with a numbered title and the caption of its Scene), like the sheet a Seller would draw by hand or get from Google Flow. The Ad video is made from that one picture: every Clip starts from the same picture and is told which part of the story to play. The planner chooses 10, 20 or 30 seconds (or follows what the Seller wrote), and a text model shares **all six Scenes** over the Clips of that Length, so a short video moves fast and a long one lingers. A request for a Storyboard goes straight to this picture: the Scenes are planned and the picture is drawn in the same request, with no step where the Seller reads and approves the Scenes as text first. The Scenes are kept as data for the video planner and for drawing the picture again, and are not shown. This replaces ADR 0002.

## Considered options

- **One picture per Scene (four, then six Frames).** The first design. Rejected: it cost six images, the Seller could not read the whole story at a glance, and the Clips were made from separate pictures, so the person and the setting drifted from Clip to Clip.
- **Keep the opening and closing Scene when the Length is short (ADR 0002).** Rejected: with one picture there is nothing to leave out, and the Seller's own examples (a 10 second video that walks through every panel) show the whole story fits a short video when it is paced.
- **One long video request for the whole Length.** Rejected for now: the video model's Clips run 4 to 8 seconds, so 20 and 30 seconds need several Clips anyway. Clips are as few and as long as that allows (10 s is 6+4, 20 s is 8+6+6, 30 s is 8+8+8+6).

## Consequences

- The Storyboard costs one image instead of four.
- The bake-off of 2026-11-02 found that a contact sheet made each panel small and could drop items of a product set. The picture is vertical (9:16) and a Seller can ask for it again, but how well the panels read and how well the video model follows them is judged by eye on real runs, not by the automated tests.
- The video model is told never to show the grid, the panel numbers or the label boxes. Whether it obeys is also only visible on a real run.
- The planner's directions are sent back to the server when a stopped video is remade, so the remade Clips still fit the ones that were kept.
- The layout of the picture is the same for every product (numbered pill labels, caption bubbles, a call to action), but its look is not: the planner writes an art direction for each product (neon and glitch for a gadget, steam and warm light for food, soft light for skincare) and the picture and every Clip are made in it. Keeping it in the Storyboard means a video made later, or a remade Clip, still matches. Whether the planner chooses well is judged by eye.
- Sessions saved with the old four-Scene, per-Frame Storyboard cannot be continued: those cards are left out when the chat is loaded.
