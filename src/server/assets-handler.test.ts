import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import sharp from "sharp";
import { createAssetReadHandler, createUploadHandler } from "./assets-handler";
import { createAssetStore } from "./asset-store";
import { readEvents } from "./testing/events";
import { makePhoto, uploadRequest } from "./testing/photos";

/** The photo upload and asset read endpoints, driven the way the browser drives them. */

async function freshHandlers() {
  const store = createAssetStore(await mkdtemp(path.join(os.tmpdir(), "laku-assets-")));
  return { upload: createUploadHandler(store), read: createAssetReadHandler(store) };
}

/** What a browser sends: the size is declared up front, so the server can refuse before reading anything. */
function oversizedDeclaredRequest(bytes: number): Request {
  const form = new FormData();
  form.set("photo", new File([Buffer.alloc(1024)], "photo.jpg", { type: "image/jpeg" }));
  return new Request("http://localhost/api/assets", {
    method: "POST",
    body: form,
    headers: { "content-length": String(bytes) },
  });
}

/** A chunked upload with no declared size that never stops; the server has to give up on its own. */
function endlessRequest(): Request {
  const chunk = new Uint8Array(1024 * 1024);
  return new Request("http://localhost/api/assets", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=x" },
    body: new ReadableStream({
      pull: (controller) => controller.enqueue(chunk),
    }),
    duplex: "half",
  } as RequestInit);
}

function readRequest(assetId: string, variant?: string): Request {
  return new Request(`http://localhost/api/assets/${assetId}${variant ? `?variant=${variant}` : ""}`);
}

/** Safari and iOS only play a video if the server can answer for a part of it, so ranges are served. */
describe("serving a video in parts", () => {
  async function storedVideo() {
    const store = createAssetStore(await mkdtemp(path.join(os.tmpdir(), "laku-assets-")));
    const bytes = Uint8Array.from({ length: 1000 }, (_, index) => index % 251);
    const assetId = await store.saveVideo(bytes);
    const read = (range?: string) =>
      createAssetReadHandler(store)(
        new Request(`http://localhost/api/assets/${assetId}`, { headers: range ? { range } : {} }),
        assetId,
      );
    return { read, bytes };
  }

  it("says it can serve parts and serves the whole file when no part is asked for", async () => {
    const { read, bytes } = await storedVideo();

    const response = await read();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    assert.equal(response.headers.get("content-type"), "video/mp4");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  });

  it("serves just the bytes asked for, with their place in the file", async () => {
    const { read, bytes } = await storedVideo();

    const response = await read("bytes=100-199");

    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), "bytes 100-199/1000");
    assert.equal(response.headers.get("content-length"), "100");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes.slice(100, 200));
  });

  it("serves from a start to the end, and the last bytes of the file", async () => {
    const { read, bytes } = await storedVideo();

    const fromStart = await read("bytes=900-");
    assert.equal(fromStart.headers.get("content-range"), "bytes 900-999/1000");
    assert.deepEqual(new Uint8Array(await fromStart.arrayBuffer()), bytes.slice(900));

    const last = await read("bytes=-50");
    assert.equal(last.status, 206);
    assert.equal(last.headers.get("content-range"), "bytes 950-999/1000");
    assert.deepEqual(new Uint8Array(await last.arrayBuffer()), bytes.slice(950));
  });

  it("refuses a part that starts beyond the end, and says how long the file is", async () => {
    const { read } = await storedVideo();

    const response = await read("bytes=2000-3000");

    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), "bytes */1000");
  });

  it("serves the whole file when the range cannot be understood", async () => {
    const { read, bytes } = await storedVideo();

    const response = await read("bytes=0-10,20-30");

    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  });
});

describe("photo upload", () => {
  for (const format of ["jpeg", "png", "webp"] as const) {
    it(`accepts a ${format} photo and serves the original back by its id`, async () => {
      const { upload, read } = await freshHandlers();
      const photo = await makePhoto(format);

      const response = await upload(uploadRequest(photo, { type: `image/${format}` }));
      const [event] = await readEvents(response);

      assert.equal(response.status, 200);
      assert.equal(event.type, "asset_ready");
      assert.ok(event.type === "asset_ready" && event.kind === "image");
      const assetId = event.type === "asset_ready" ? event.assetId : "";
      assert.equal(event.type === "asset_ready" && event.url, `/api/assets/${assetId}`);

      const served = await read(readRequest(assetId), assetId);
      assert.equal(served.status, 200);
      assert.equal(served.headers.get("content-type"), `image/${format}`);
      assert.deepEqual(Buffer.from(await served.arrayBuffer()), photo);
    });
  }

  const MB = 1024 * 1024;
  const rejections: Array<[string, () => Promise<Request>, number]> = [
    ["a text file labelled as a JPG", async () => uploadRequest(Buffer.from("bukan foto"), { name: "a.jpg" }), 415],
    ["a GIF", async () => uploadRequest(await sharp({ create: { width: 8, height: 8, channels: 3, background: "#fff" } }).gif().toBuffer(), { type: "image/gif" }), 415],
    ["a file just over 10 MB", async () => uploadRequest(Buffer.alloc(10 * MB + 1)), 413],
    ["a body that declares a size far over the limit", async () => oversizedDeclaredRequest(12 * MB), 413],
    ["a body that streams on past the limit without declaring a size", async () => endlessRequest(), 413],
    ["a form with no photo in it", async () => new Request("http://localhost/api/assets", { method: "POST", body: new FormData() }), 400],
    ["a body that is not a form", async () => new Request("http://localhost/api/assets", { method: "POST", body: "halo" }), 400],
  ];

  for (const [name, makeRequest, status] of rejections) {
    it(`rejects ${name} with a retryable Indonesian error`, async () => {
      const { upload } = await freshHandlers();

      const response = await upload(await makeRequest());
      const events = await readEvents(response);

      assert.equal(response.status, status);
      assert.equal(events.length, 1);
      assert.equal(events[0].type, "error");
      assert.equal(events[0].type === "error" && events[0].retryable, true);
    });
  }

  it("treats a file of exactly 10 MB as the wrong type, not as too large", async () => {
    const { upload } = await freshHandlers();

    const response = await upload(uploadRequest(Buffer.alloc(10 * MB)));

    assert.equal(response.status, 415);
  });

  it("returns 404 for an asset id that does not exist", async () => {
    const { read } = await freshHandlers();

    const response = await read(readRequest("00000000-0000-0000-0000-000000000000"), "00000000-0000-0000-0000-000000000000");

    assert.equal(response.status, 404);
  });

  it("does not let an asset id reach outside the storage folder", async () => {
    const { read } = await freshHandlers();

    const response = await read(readRequest("..%2F..%2Fpackage.json"), "../../package.json");

    assert.equal(response.status, 404);
  });

  it("keeps a resized copy no larger than 1024 pixels on the long side", async () => {
    const { upload, read } = await freshHandlers();
    const [event] = await readEvents(await upload(uploadRequest(await makePhoto("jpeg", 3000, 2000))));
    const assetId = event.type === "asset_ready" ? event.assetId : "";

    const resized = await read(readRequest(assetId, "resized"), assetId);
    const info = await sharp(Buffer.from(await resized.arrayBuffer())).metadata();

    assert.equal(resized.status, 200);
    assert.deepEqual([info.width, info.height], [1024, 683]);
  });
});

describe("asset download", () => {
  it("asks the browser to save the file, with a sensible name, when download is requested", async () => {
    const { upload, read } = await freshHandlers();
    const [event] = await readEvents(await upload(uploadRequest(await makePhoto("png"))));
    const assetId = event.type === "asset_ready" ? event.assetId : "";

    const response = await read(new Request(`http://localhost/api/assets/${assetId}?download=1`), assetId);

    assert.match(response.headers.get("content-disposition") ?? "", /^attachment; filename="laku-[0-9a-f]{8}\.png"$/);
  });

  it("shows the file inline when download is not requested", async () => {
    const { upload, read } = await freshHandlers();
    const [event] = await readEvents(await upload(uploadRequest(await makePhoto("png"))));
    const assetId = event.type === "asset_ready" ? event.assetId : "";

    const response = await read(readRequest(assetId), assetId);

    assert.equal(response.headers.get("content-disposition"), null);
  });
});
