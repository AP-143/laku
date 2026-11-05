# Spending actions are explicit requests, never guessed from words

Approving a Storyboard and making an Ad video are sent to the server as their own fields of the request (`approve` and `video`, the latter carrying the Length and the Voice-over choice), not read out of what the Seller typed. A button press never goes through the intent router or the request reader, and **pressing the video button always shows the Price question first**, even for the cheapest Length. A typed request for a video still works, but only asks the Price question when the picture alone costs more than US$1.

## Considered options

- **Treat the button as a typed message and let the router read it.** Rejected: it spends a model call to learn what the button already said, and a wrong guess means paying for the wrong video.
- **Ask the Price question only above US$1, for the button too.** The first version. Rejected: a 10 second video costs exactly US$1.00 and started with no question at all, which is not what the Seller expects from a button that spends money.

## Consequences

- Whether to ask is judged by the price of the picture, but the price shown and the one a yes must cover include the narration, so a few thousandths of a dollar of narration neither skip the question nor hide in it.
- Any new paid action should follow the same shape: its own field, checked on the server, behind the Price question.
