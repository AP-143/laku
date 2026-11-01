import sharp from "sharp";

/** Real, decodable images of a given size, made on the fly so the tests need no fixture files. */
export async function makePhoto(format: "jpeg" | "png" | "webp", width = 800, height = 600): Promise<Buffer> {
  const canvas = sharp({ create: { width, height, channels: 3, background: "#cc3333" } });
  if (format === "png") return canvas.png().toBuffer();
  if (format === "webp") return canvas.webp().toBuffer();
  return canvas.jpeg().toBuffer();
}

export function uploadRequest(bytes: Uint8Array, options: { name?: string; type?: string } = {}): Request {
  const form = new FormData();
  form.set("photo", new File([bytes as BlobPart], options.name ?? "photo.jpg", { type: options.type ?? "image/jpeg" }));
  return new Request("http://localhost/api/assets", { method: "POST", body: form });
}
