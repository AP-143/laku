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
The test every photo and every Frame passes before anything paid happens: it must show a product that could be sold, not a person, a selfie, a document or a landscape.
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
The Feature that turns a Product photo into an Ad video in steps: a Storyboard is planned, the Seller gives Approval, its Frames are made, and then the Ad video is made from them.
_Avoid_: Storyboard (for the Feature as a whole), Video (as a Feature of its own)

### Storyboard and video

**Storyboard**:
Four Scenes that together tell one short ad for the product, planned from a Product photo.
_Avoid_: Script, plan, shot list

**Scene**:
The text of one of the four moments of a Storyboard. The Seller can change it before Approval.
_Avoid_: Shot, slide, panel

**Approval**:
The Seller's yes to the Scenes of a Storyboard. Nothing is drawn before it, so no image is paid for on a plan the Seller does not want.
_Avoid_: Confirmation (that is the Price question), sign-off

**Frame**:
The picture made from one Scene, starting from the Product photo so the product stays the same in all four.
_Avoid_: Scene image, thumbnail, picture of a scene

**Ad video**:
A vertical video made from the Frames of an approved Storyboard, 10, 20 or 30 seconds long, with or without a Voice-over.
_Avoid_: Reel, clip (a Clip is only a piece of it)

**Length**:
How long the Ad video runs: 10, 20 or 30 seconds. The Scenes are fitted to the Length, never the Length to the Scenes; when a Length is too short for all four, the opening and the closing Scene are kept.
_Avoid_: Duration, any other number of seconds

**Clip**:
One piece of an Ad video, made from one Frame. Several Clips are joined into the Ad video; if one fails, the finished ones are kept and only the rest is made again.
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

**Monthly budget**:
The most estimated spend LAKU allows itself in a month, set to the prepaid balance. It is the hard stop.
_Avoid_: Quota, credit, balance (the real balance only exists on Google's side)

**Daily limit**:
The most estimated spend LAKU allows itself in one UTC day, sized so one whole Storyboard and the longest Ad video fit in a day. When a request passes both it and the Monthly budget, the one with less room left is the one named.
_Avoid_: Daily cap, daily quota

**Usage meter**:
The estimated spend of the month shown to the Seller against the Monthly budget. It is an estimate; it can run a little below what Google really bills.
_Avoid_: Balance, saldo
