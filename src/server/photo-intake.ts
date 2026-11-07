import sharp from "sharp";
import type { AssetFile } from "./asset-store";

/** Photos are shrunk before any model sees them, which also saves free-tier quota. */
const RESIZED_LONG_SIDE = 1024;

const MEDIA_TYPES: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

interface PreparedPhoto {
  original: AssetFile;
  resized: AssetFile;
}

/** Checks that the bytes really are a JPG, PNG or WebP (not just labelled one) and makes the resized copy. */
export async function preparePhoto(bytes: Uint8Array): Promise<PreparedPhoto> {
  const image = sharp(bytes).rotate();
  const { format } = await sharp(bytes).metadata();
  const mediaType = format ? MEDIA_TYPES[format] : undefined;
  if (!mediaType) throw new Error("unsupported image format");

  const resized = await image
    .resize({ width: RESIZED_LONG_SIDE, height: RESIZED_LONG_SIDE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();

  return { original: { bytes, mediaType }, resized: { bytes: resized, mediaType: "image/jpeg" } };
}
