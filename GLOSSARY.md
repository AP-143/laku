# LAKU

A chatbot for small online sellers in Indonesia. From one amateur photo of a product it makes a studio photo, and a storyboard of ad scenes that can become an ad video.

## Language

### People and inputs

**Seller**:
The owner of a small online shop who uses LAKU to make pictures and videos of what they sell.
_Avoid_: User, customer, buyer

**Product photo**:
The amateur photo of the product that the Seller attaches. Everything LAKU makes starts from it.
_Avoid_: Original, raw photo, source image

**Product check**:
The test every photo and every Storyboard picture passes before anything paid happens: it must show a product that could be sold, not a person, a selfie, a document or a landscape. A Storyboard picture is asked a looser question, because a person using the product is a normal ad picture: only the product has to be clearly there.
_Avoid_: Moderation, validation

### Features

**Feature**:
One of the two things LAKU makes: a Studio photo, or a Storyboard & Video.
_Avoid_: Mode, tool

**Studio photo**:
The Product photo redone with a clean backdrop, a colour, or a lifestyle setting. The product itself (shape, colour, logo, text) never changes.
_Avoid_: Edited photo, render, mockup

**Style**:
The look the Seller asks for in a Studio photo: a preset (clean white, solid colour, lifestyle) or their own words.
_Avoid_: Filter, theme, template

**Storyboard & Video**:
The Feature that turns a Product photo into an Ad video in steps: asking for a Storyboard makes its Storyboard picture straight away, and then the Ad video is made from that picture.
_Avoid_: Storyboard (for the Feature as a whole), Video (as a Feature of its own)

### Storyboard and video

**Storyboard**:
Six Scenes that together tell one short ad for the product (opening, product, detail, enjoying it, why it is good, closing), planned from a Product photo and drawn as one picture.
_Avoid_: Script, plan, shot list

**Scene**:
The text of one of the six moments of a Storyboard: what is seen, and the Caption written on its panel. The planner writes it and the Storyboard picture is drawn from it; the Seller does not read or edit it, and the video planner uses it to share the story over the Clips.
_Avoid_: Shot, slide (a panel is the Scene as drawn in the Storyboard picture)

**Art direction**:
The look of one ad, written by the planner for this product, its buyers and its story: mood, colour grade, light, the graphic style of labels and accents, and the effects, transitions and text animations that fit. It is chosen like a professional editor would, not taken from one fixed recipe, and the Storyboard picture is made in it. The video model is not given it again: it sees the look in the picture and decides the rest itself. The Seller does not see or edit it.
_Avoid_: Style (that is the Studio photo Style), theme, template

**Brief**:
The Seller's first request, kept as they wrote it (at most 400 characters, never a summary written by a model). Everything the Seller said in it also shapes the Scenes and the Art direction. The brief travels with the Storyboard to the video planner, which reads it together with any words typed with the video request (the newer words win). What the Seller asked of the Length, a Voice-over or Music is done as asked, and only what they did not mention is the planner's choice. A Length written as "10 detik", "30s" or "20 sec" is found by a fixed pattern and is the Length of the video (a number between the options is the nearest one that is not longer): the planner is told so, asked once more if it still chooses another, and then its plan is fitted to that Length. A request that names nothing leaves the planner free. The Seller does not edit it.
_Avoid_: Prompt, instructions, requirements

**Storyboard picture**:
The whole Storyboard as one tall vertical image: a grid of six panels, each with its numbered title and the Caption of its Scene (those are its only text; it carries no words about itself), made from the Product photo so the product stays the same in every panel. It is made in the same request as the Seller asks for the Storyboard (no approval of the Scenes in between), costs one image and can be made again from the same Scenes.
_Avoid_: Frame, sheet (in the UI), scene image, thumbnail

**Ad video**:
A vertical video made from the Storyboard picture of a Storyboard, 10, 20 or 30 seconds long, with or without a Voice-over and a Music bed. The Seller only presses Generate: the planner decides the Length, the Voice-over and the Music bed. Its style, the text it shows (the Captions of the Scenes), its effects and the emotion of the person follow the Storyboard picture, and the video model decides how they look on screen; the app draws no text of its own.
_Avoid_: Reel, clip (a Clip is only a piece of it)

**Length**:
How long the Ad video runs: 10, 20 or 30 seconds, chosen by the planner for the story (a typed request may say what the Seller wants). All six Scenes are always in the video; a text model shares them over the Clips, so a short Length moves fast and a long one lingers.
_Avoid_: Duration, any other number of seconds

**Clip**:
One piece of an Ad video, 4 to 8 seconds, made from the Storyboard picture and a direction that tells the story of its part as a film scene, with the Caption words of the Scenes it plays; the video model is told only that the picture is a plan to film, not footage, and decides how it looks, moves, sounds and how the text shows. Several Clips are joined into the Ad video; if one fails, the finished ones are kept and only the rest is made again.
_Avoid_: Segment, shot

**Voice-over**:
A narrator read over an Ad video while the person in it stays silent. The planner writes one line for each Clip about what the person feels at that part of the story, with a delivery note (the emotion) and the second where the line starts; each line is read with its own emotion at its moment and mixed over the sound the Clips came with. A change of voice keeps the lines and does not make the video again.
_Avoid_: Dubbing, audio track, narrator

**Music bed**:
Instrumental background music under an Ad video, only when the planner decides the ad needs it (it is part of the Price question). The planner designs it for the ad (genre, tempo so the cuts fall on a beat, mood, how loud) and Lyria makes a 30 second clip, which is mixed under the Sound with ducking and fades.
_Avoid_: Soundtrack, jingle, song

**Sound**:
How an Ad video sounds: the Clips keep whatever sound the video model made, and a Voice-over and a Music bed can be added. When one of them is added the model is told to leave it out of the Clip (the person does not speak; no background music). The app does not direct the rest.
_Avoid_: Audio, soundtrack

### Conversation

**Session**:
One saved conversation: its own messages and results, listed in the sidebar and labelled with the Feature of its first result. It stays in the browser it was made in.
_Avoid_: Chat, thread, conversation, history (history is the list of Sessions)

### Money

**Price question**:
The question that tells the Seller what an Ad video will cost, and what the planner chose (Length, Voice-over, Music bed), and asks before any of it is spent. A yes covers exactly that price and that plan, which comes back with the yes so it is made as it was shown; a plan that would cost more asks again.
_Avoid_: Confirmation, checkout, payment

**Usage meter**:
The estimated spend of the month shown to the Seller. It only counts; it stops nothing, because LAKU sets no spend limit (the monthly budget and the daily limit were removed): the balance on Google's side is the only stop. It is an estimate and can run a little below what Google really bills.
_Avoid_: Balance, saldo, quota
