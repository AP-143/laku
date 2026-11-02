import type { AssetStore } from "./asset-store";
import { readBoundedBytes } from "./bounded-body";
import { eventResponse } from "./event-response";
import { preparePhoto } from "./photo-intake";

export type UploadHandler = (request: Request) => Promise<Response>;
export type AssetReadHandler = (request: Request, assetId: string) => Promise<Response>;

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
// Room for the multipart envelope around a photo of up to 10 MB.
const MAX_UPLOAD_BYTES = MAX_PHOTO_BYTES + 1024 * 1024;

const REJECTIONS = {
  unreadable: { status: 400, message: "Fotonya belum terbaca. Pilih foto lalu coba lagi ya." },
  tooLarge: { status: 413, message: "Fotonya terlalu besar. Maksimal 10 MB ya." },
  unsupportedType: { status: 415, message: "Format fotonya belum didukung. Pakai JPG, PNG, atau WebP ya." },
} as const;

function rejection(reason: keyof typeof REJECTIONS): Response {
  const { status, message } = REJECTIONS[reason];
  return eventResponse(async (send) => send({ type: "error", message, retryable: true }), { status });
}

/** Pulls the `photo` file out of a multipart body, or says why it cannot. */
async function readPhotoFile(request: Request): Promise<File | keyof typeof REJECTIONS> {
  const body = await readBoundedBytes(request, MAX_UPLOAD_BYTES);
  if (!body) return "tooLarge";

  try {
    const form = await new Response(body as BodyInit, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
    const photo = form.get("photo");
    return photo instanceof File ? photo : "unreadable";
  } catch {
    return "unreadable";
  }
}

export function createUploadHandler(store: AssetStore): UploadHandler {
  return async (request) => {
    const photo = await readPhotoFile(request);
    if (typeof photo === "string") return rejection(photo);
    if (photo.size > MAX_PHOTO_BYTES) return rejection("tooLarge");

    let prepared;
    try {
      prepared = await preparePhoto(new Uint8Array(await photo.arrayBuffer()));
    } catch {
      return rejection("unsupportedType");
    }

    const assetId = await store.save(prepared);
    return eventResponse(async (send) =>
      send({ type: "asset_ready", assetId, kind: "image", url: `/api/assets/${assetId}` }),
    );
  };
}

export function createAssetReadHandler(store: AssetStore): AssetReadHandler {
  return async (request, assetId) => {
    const params = new URL(request.url).searchParams;
    const variant = params.get("variant") === "resized" ? "resized" : "original";
    const file = await store.read(assetId, variant);
    if (!file) return new Response("Not found", { status: 404 });

    const headers: Record<string, string> = { "content-type": file.mediaType, "accept-ranges": "bytes" };
    if (params.get("download")) {
      // The id is safe in a header (it passed the store's id check), and the extension follows the file type.
      const extension = file.mediaType.split("/")[1].replace("jpeg", "jpg");
      headers["content-disposition"] = `attachment; filename="laku-${assetId.slice(0, 8)}.${extension}"`;
    }

    // Safari and iOS only play a video if the server can answer for a part of it.
    const size = file.bytes.byteLength;
    const range = readRange(request.headers.get("range"), size);
    if (range === "unsatisfiable") {
      return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
    }
    if (range) {
      const part = file.bytes.slice(range.start, range.end + 1);
      return new Response(part as BodyInit, {
        status: 206,
        headers: { ...headers, "content-range": `bytes ${range.start}-${range.end}/${size}`, "content-length": String(part.byteLength) },
      });
    }
    return new Response(file.bytes as BodyInit, { headers });
  };
}

/**
 * Reads a single "bytes=start-end" range. A range it cannot understand (several ranges, nonsense) is ignored, so the
 * whole file is served; one that starts beyond the end is unsatisfiable.
 */
function readRange(header: string | null, size: number): { start: number; end: number } | "unsatisfiable" | undefined {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
  if (!match || (match[1] === "" && match[2] === "")) return undefined;

  if (match[1] === "") {
    // "-50" means the last 50 bytes.
    const length = Number(match[2]);
    return length === 0 ? "unsatisfiable" : { start: Math.max(size - length, 0), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size) return "unsatisfiable";
  return end < start ? undefined : { start, end };
}
