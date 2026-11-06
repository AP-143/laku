# Storyboard and video are two features again, and the storyboard stops at its picture

Supersedes [0001](0001-storyboard-and-video-are-one-feature.md).

The Seller wants the Storyboard to be about the Storyboard only, and the Ad video to be its own Feature with its own Sessions. So the sidebar has three Features (Studio photo, Storyboard, Video). A Storyboard ends with its one picture; the Video Feature takes a Storyboard picture that the Seller attaches to the chat and makes the Ad video from it, with nothing carried over from a Storyboard Session.

0001 chose one Feature because a video can only be made from a Storyboard picture. That is still true, but the Seller reached the picture by attaching it, and the hand-off between the two (a video panel under the picture, a storyboard borrowed from another chat) tied the Features together more than the Seller wanted.

- **The Video Feature needs an attached picture.** Without one the bot asks for it. A video guessed by the router from a typed message, without the Feature picked, is sent to the Video Feature too: only the Feature makes a video.
- **The attached picture gets the looser Product check** of a Storyboard picture (a person using the product is a normal ad picture), and the video job still asks it before anything is paid.
- **The price is always asked first**, whatever the Length. The Generate button used to guarantee it; now the Feature does.
- **The video planner reads the scenes and the look from the picture itself**, plus any words the Seller types with the request. The Storyboard no longer keeps or sends the Seller's first request (the old Brief), its scenes or its art direction to a video: it keeps the scenes and the art direction only to draw the picture again on a retry.
- **A Length the Seller types with the video request is the Length**, found by the same fixed pattern as before ("10 detik", "30s", "20 sec").

## Considered options

- **Keep the "Buat video iklan" panel under the Storyboard picture as a shortcut.** Rejected by the Seller: the Storyboard should be about the Storyboard.
- **Keep borrowing the newest Storyboard of another Session when nothing is attached.** Rejected: it is the hand-off this decision removes, and it made the video use a picture the Seller did not pick.

## Consequences

- A Session whose first result is an Ad video, or a video that stopped part way, is a Video Session; one whose first result is a Storyboard stays a Storyboard Session even if a video follows.
- The reply after a Storyboard points to the Video Feature. The old reply that pointed at the panel is kept as an obsolete reply, so saved chats do not show it.
- A "yes" to a priced video and a remake of the missing Clips still work as before; a remake sends the picture it was made from.
- A browser or saved chat that still sends the old fields (`video`, `scenes`, `artDirection`, `brief` at the top of the request, or a `brief` in a retry) has them ignored.
