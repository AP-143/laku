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
One of the three things LAKU makes, each picked on its own in the sidebar and with its own Sessions: a Studio photo, a Storyboard, or an Ad video.
_Avoid_: Mode, tool

**Studio photo**:
The Product photo redone with a clean backdrop, a colour, or a lifestyle setting. The product itself (shape, colour, logo, text) never changes.
_Avoid_: Edited photo, render, mockup

**Style**:
The look the Seller asks for in a Studio photo: a preset (clean white, solid colour, lifestyle) or their own words.
_Avoid_: Filter, theme, template

**Storyboard (Feature)**:
Turns a Product photo into a Storyboard: asking for it makes its Storyboard picture straight away, and it stops there. The reply points the Seller to the Video Feature; there is no button under the picture.
_Avoid_: Storyboard & Video (the two used to be one Feature)

**Video (Feature)**:
Turns a Storyboard picture the Seller attaches to the chat into an Ad video, with no Storyboard made in that Session first. Only the attached picture is used: nothing is carried over from a Storyboard Session. It gets the looser Product check of a Storyboard picture, and the Price question is always asked first, whatever the Length. What the Seller types ("buatkan video iklan 10 detik layaknya editan profesional dari storyboard ini") goes to the video model exactly as they wrote it, together with the picture, and the video model decides how the video is made. The app writes no instruction of its own for the video. A Length written as "10 detik", "30s" or "20 sec" is found by a fixed pattern and is the Length of the video (a number between the options is the nearest one that is not longer; with none, the shortest).
_Avoid_: Reel maker, Storyboard & Video

### Storyboard and video

**Storyboard**:
The Scenes that together tell one short ad for the product (an opening first, a closing that asks to buy last), planned from a Product photo and drawn as one picture. The planner decides how many Scenes the ad needs from the Seller's request (a short video has fewer, a long one more, and a number the Seller names is used), up to 20.
_Avoid_: Script, plan, shot list

**Scene**:
The text of one of the moments of a Storyboard: what is seen, and the Caption written on its panel. The planner writes it and the Storyboard picture is drawn from it; the Seller does not read or edit it. It is kept only to draw the picture again on a retry.
_Avoid_: Shot, slide (a panel is the Scene as drawn in the Storyboard picture)

**Art direction**:
The look of one ad, written by the planner for this product, its buyers and its story: mood, colour grade, light, the graphic style of labels and accents, and the effects, transitions and text animations that fit. It is chosen like a professional editor would, not taken from one fixed recipe, and the Storyboard picture is made in it. It is kept only to draw the picture again on a retry. The video model is not given it: it sees the look in the picture and decides the rest itself. The Seller does not see or edit it.
_Avoid_: Style (that is the Studio photo Style), theme, template

**Storyboard picture**:
The whole Storyboard as one tall vertical image: a grid of panels (two columns; an odd last panel runs across the full width), each with its number and the Caption of its Scene (those are its only text; panels have no fixed titles, and it carries no words about itself), made from the Product photo so the product stays the same in every panel. It is made in the same request as the Seller asks for the Storyboard (no approval of the Scenes in between), costs one image and can be made again from the same Scenes.
_Avoid_: Frame, sheet (in the UI), scene image, thumbnail

**Ad video**:
A vertical video made from the Storyboard picture of a Storyboard, 10, 20 or 30 seconds long, in one call to the video model. The Seller attaches the picture in the Video Feature and says in their own words what video they want. The video model decides everything else (its style, the text it shows, its effects, the camera, the acting and the sound) and the app keeps the video as the model returned it; the app draws no text and adds no voice or music of its own.
_Avoid_: Reel, clip

**Length**:
How long the Ad video runs: 10, 20 or 30 seconds, the one the Seller's words name, otherwise 10. The price follows it.
_Avoid_: Duration, any other number of seconds

### Conversation

**Session**:
One saved conversation: its own messages and results, listed in the sidebar and labelled with the Feature of its first result (a Session whose first result is an Ad video is a Video Session, even when the picture came from a Storyboard Session). It stays in the browser it was made in.
_Avoid_: Chat, thread, conversation, history (history is the list of Sessions)

### Money

**Price question**:
The pop-up that tells the Seller what a Studio photo, a Storyboard picture or an Ad video will cost (for a video, at the Length their words name), and asks before anything is spent. It is asked again for every "Coba lagi" and every picture drawn again, because each one costs again. It opens after the app has read the request ("thinking") and before any image or video model is called. "Lanjut" (yes) makes the video at that price; "Batal", Esc or a click outside (no) stops, spends nothing and the chat says so. A yes covers that price; the same request that would now cost more asks again. It is the only cost guard in the app: LAKU keeps no usage meter, ledger or spend limit, and the balance on Google's side is the only other stop.
_Avoid_: Confirmation, checkout, payment, Usage meter (removed)
