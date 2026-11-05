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
The Feature that turns a Product photo into an Ad video in steps: a Storyboard is planned, the Seller gives Approval, its Storyboard picture is made, and then the Ad video is made from it.
_Avoid_: Storyboard (for the Feature as a whole), Video (as a Feature of its own)

### Storyboard and video

**Storyboard**:
Six Scenes that together tell one short ad for the product (opening, product, detail, enjoying it, why it is good, closing), planned from a Product photo and drawn as one picture.
_Avoid_: Script, plan, shot list

**Scene**:
The text of one of the six moments of a Storyboard: what is seen, and the Caption written on its panel. The Seller can change it before Approval.
_Avoid_: Shot, slide (a panel is the Scene as drawn in the Storyboard picture)

**Art direction**:
The look of one ad, written by the planner for this product, its buyers and its story: mood, colour grade, light, the graphic style of labels and accents, and the effects, transitions and text animations that fit. It is chosen like a professional editor would, not taken from one fixed recipe, and the Storyboard picture and every Clip are made in it. The Seller does not see or edit it.
_Avoid_: Style (that is the Studio photo Style), theme, template

**Approval**:
The Seller's yes to the Scenes of a Storyboard. Nothing is drawn before it, so no image is paid for on a plan the Seller does not want.
_Avoid_: Confirmation (that is the Price question), sign-off

**Storyboard picture**:
The whole Storyboard as one vertical image: a grid of six panels, each with its numbered title and the Caption of its Scene, made from the Product photo so the product stays the same in every panel. It costs one image and can be made again.
_Avoid_: Frame, sheet (in the UI), scene image, thumbnail

**Ad video**:
A vertical video made from the Storyboard picture of an approved Storyboard, 10, 20 or 30 seconds long, with or without a Voice-over.
_Avoid_: Reel, clip (a Clip is only a piece of it)

**Length**:
How long the Ad video runs: 10, 20 or 30 seconds. All six Scenes are always in the video; a text model shares them over the Clips, so a short Length moves fast and a long one lingers.
_Avoid_: Duration, any other number of seconds

**Clip**:
One piece of an Ad video, 4 to 8 seconds, made from the Storyboard picture and a direction that says which part of the story it plays. Several Clips are joined into the Ad video; if one fails, the finished ones are kept and only the rest is made again.
_Avoid_: Segment, shot

**Voice-over**:
A spoken narration laid over an Ad video, written from the Scenes to fit its Length. It can be changed without making the video again.
_Avoid_: Dubbing, audio track, narrator

### Conversation

**Session**:
One saved conversation: its own messages and results, listed in the sidebar and labelled with the Feature of its first result. It stays in the browser it was made in.
_Avoid_: Chat, thread, conversation, history (history is the list of Sessions)

### Money

**Price question**:
The question that tells the Seller what an Ad video will cost and asks before any of it is spent. A yes covers exactly that price, narration included; a video that would cost more asks again.
_Avoid_: Confirmation, checkout, payment

**Daily limit**:
The most estimated spend LAKU allows itself in one UTC day, sized so one whole Storyboard and the longest Ad video fit in a day. It is the only limit LAKU sets for itself: there is no monthly one, because the prepaid balance on Google's side is the real hard stop.
_Avoid_: Daily cap, daily quota, Monthly budget (it was removed)

**Usage meter**:
The estimated spend of the month shown to the Seller. It only counts; it stops nothing. It is an estimate and can run a little below what Google really bills.
_Avoid_: Balance, saldo, quota
