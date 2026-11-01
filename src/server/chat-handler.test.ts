import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatEvent } from "../shared/chat-events";
import { createChatHandler } from "./chat-handler";
import { createModelClient } from "./model-client";
import { fakeChatModel } from "./testing/fake-models";

/** The one test seam: the chat API boundary. Requests go in, the stream of events comes out. */

function chatRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readEvents(response: Response): Promise<ChatEvent[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as ChatEvent);
}

function handlerWith(model: ReturnType<typeof fakeChatModel>) {
  return createChatHandler(createModelClient({ chatModel: model }));
}

describe("chat API", () => {
  it("streams the assistant's reply as events and ends cleanly", async () => {
    const handle = handlerWith(fakeChatModel({ chunks: ["Halo! ", "Ada yang bisa kubantu?"] }));

    const response = await handle(chatRequest({ messages: [{ role: "user", text: "Halo" }] }));
    const events = await readEvents(response);

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /application\/x-ndjson/);
    const reply = events.flatMap((event) => (event.type === "assistant_text" ? [event.text] : [])).join("");
    assert.equal(reply, "Halo! Ada yang bisa kubantu?");
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  it("reports a model failure as a retryable Indonesian error and never says done", async () => {
    const handle = handlerWith(fakeChatModel({ chunks: ["Sebentar ya, "], failAfterChunks: true }));

    const response = await handle(chatRequest({ messages: [{ role: "user", text: "Halo" }] }));
    const events = await readEvents(response);

    const failure = events.at(-1);
    assert.equal(failure?.type, "error");
    assert.equal(failure.type === "error" && failure.retryable, true);
    assert.match(failure.type === "error" ? failure.message : "", /coba lagi/i);
    assert.equal(events.some((event) => event.type === "done"), false);
    // Text that was already streamed before the failure is kept.
    assert.equal(events[0].type === "assistant_text" && events[0].text, "Sebentar ya, ");
  });

  const invalidRequests: Array<[string, () => Request]> = [
    ["a body that is not JSON", () => new Request("http://localhost/api/chat", { method: "POST", body: "{oops" })],
    ["no messages", () => chatRequest({ messages: [] })],
    ["a missing messages list", () => chatRequest({})],
    ["a last message that is not from the user", () => chatRequest({ messages: [{ role: "assistant", text: "Hai" }] })],
    ["an empty user message", () => chatRequest({ messages: [{ role: "user", text: "   " }] })],
    ["more than 50 messages", () => chatRequest({ messages: Array.from({ length: 51 }, () => ({ role: "user", text: "Hai" })) })],
    ["a message over 4000 characters", () => chatRequest({ messages: [{ role: "user", text: "a".repeat(4001) }] })],
    [
      "a conversation over 20000 characters in total",
      () => chatRequest({ messages: Array.from({ length: 6 }, () => ({ role: "user", text: "a".repeat(4000) })) }),
    ],
    [
      "a body over 64 KB even when the messages are small",
      () => chatRequest({ messages: [{ role: "user", text: "Hai" }], padding: "x".repeat(70 * 1024) }),
    ],
  ];

  it("accepts a message exactly at the 4000 character limit", async () => {
    const handle = handlerWith(fakeChatModel({ chunks: ["Oke"] }));

    const response = await handle(chatRequest({ messages: [{ role: "user", text: "a".repeat(4000) }] }));
    const events = await readEvents(response);

    assert.equal(response.status, 200);
    assert.deepEqual(events.at(-1), { type: "done" });
  });

  for (const [name, makeRequest] of invalidRequests) {
    it(`rejects ${name} with a single non-retryable error`, async () => {
      const handle = handlerWith(fakeChatModel({ chunks: ["tidak boleh muncul"] }));

      const response = await handle(makeRequest());
      const events = await readEvents(response);

      assert.equal(response.status, 400);
      assert.equal(events.length, 1);
      assert.equal(events[0].type, "error");
      assert.equal(events[0].type === "error" && events[0].retryable, false);
    });
  }
});
