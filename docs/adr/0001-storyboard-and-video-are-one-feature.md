# Storyboard and video are one feature

Superseded by [0009](0009-storyboard-and-video-are-two-features-again.md).

An Ad video is only ever made from the picture of a Storyboard, so offering them as two separate Features (and a Video shortcut that cannot work without a Storyboard) made the Seller guess what to press first. They are one Feature, **Storyboard & Video**, with steps: the Storyboard picture (made straight from the Seller's request), then a video panel under it with a Generate button.

## Considered options

- **Three separate Features (studio photo, storyboard, video), each with its own history.** The first design. Rejected: the video needs the Frames of a storyboard, so it kept reaching into another Feature's history, and Sellers pressed Video with nothing to make it from.
- **One Feature, but still asking in chat for the video** ("video 10 detik"). Rejected as the main path: the Seller has to know the words. It stays as a fallback for typed requests.

## Consequences

- A Session whose first result is a Storyboard, an Ad video, or a video that stopped part way counts as the same Feature in the sidebar.
- The server still understands a typed request for a video, so older habits and chats keep working.
