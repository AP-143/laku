# The Price question is the only cost guard

The app has one guard on cost: a pop-up that tells the Seller the price of a Studio photo, a Storyboard picture or an Ad video and waits for a yes before any model is called. The same question is asked again on every "Coba lagi" and every picture drawn again, since each costs again. (Studio photos and Storyboard pictures were first left out and added the same day, on the owner's request.) The usage meter (the sidebar total, `/api/usage`, the `usage_updated` event) and the ledger behind it are removed, so nothing is booked, given back or counted. This follows the monthly budget and the daily limit, which were removed before it.

## Considered options

- **Keep the usage meter next to the pop-up.** Rejected on the owner's request: the only thing left should be chat → thinking → price pop-up → yes (generate) or no (stop). The meter only counted anyway; it never stopped a request.
- **Keep the price as a card in the chat (ADR 0003).** Rejected: a card scrolls away and the Seller can type on while it waits. A modal pop-up has to be answered.

## Consequences

- The server is unchanged in the way that matters: a video is only made when the request carries `confirmedUsd` at least as high as the price of the Length the words name (ADR 0003). The pop-up is how the browser gets that yes; a no is simply no second request.
- A Storyboard is priced as its one picture and asked about before the planner runs, so a no costs not even the planner call. The browser keeps the yes out of the request it saves for "Coba lagi", so a retry always asks.
- Nothing in the app knows what has been spent. The balance on Google's side, and a spend cap set in AI Studio, are the only other stops.
- The request-size bounds of the chat API (body size, message count and length) stay: they are input validation, not cost accounting.
