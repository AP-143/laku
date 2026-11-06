# The planner chooses how many panels a Storyboard has

A Storyboard is no longer always six panels. The planner reads the Seller's request (for example "storyboard for a 10 second video ad") and decides how many Scenes the ad needs: fewer for a short video, more for a long one, and the number the Seller names if they name one. The fixed panel titles and the fixed kind of shot per panel are gone: the planner writes each Scene with its own shot, the first Scene is the opening, one Scene before the last gives the benefits, and the last asks to buy. The panels of the picture carry their number and the Caption only. This changes ADR 0004, where the picture always had six panels.

## Considered options

- **A fixed number per Length (for example 4 panels for 10 seconds).** Rejected: the Seller can ask for a number, and the story decides more than the seconds do.
- **Keep six titles and cut or repeat them.** Rejected: eight panels would get repeated titles, and a four panel ad would lose its closing.
- **No upper limit.** Rejected: one picture can only hold so many readable panels. The limit is 20 (`MAX_SCENES`), applied to the planner's answer and to a retry of a picture alike, so a picture the planner made can always be drawn again.

## Consequences

- An odd number of panels is drawn with the last one across the full width of the bottom row; whether the image model keeps that layout is judged by eye on real runs, not by the automated tests.
- The video planner is not told how many Scenes there are: it reads them from the picture, and how well the video model follows a picture with many small panels is also only visible on a real run.
- A Storyboard saved with six panels still works; its Scenes are kept as they were.
