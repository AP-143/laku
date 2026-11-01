import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type AssetVariant = "original" | "resized";

export interface AssetFile {
  bytes: Uint8Array;
  mediaType: string;
}

export interface AssetStore {
  /** Saves a photo's original and its resized copy, and returns the id that finds them again. */
  save(files: Record<AssetVariant, AssetFile>): Promise<string>;
  read(assetId: string, variant: AssetVariant): Promise<AssetFile | undefined>;
}

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MEDIA_TYPES = Object.fromEntries(Object.entries(EXTENSIONS).map(([type, ext]) => [ext, type]));
const ASSET_ID = /^[0-9a-f-]{36}$/;

/** True when the text looks like an id this store made, so it is safe to use in a path. */
export function isAssetId(value: string): boolean {
  return ASSET_ID.test(value);
}

/** Files live in a plain directory, one sub-folder per asset. */
export function createAssetStore(rootDir: string): AssetStore {
  return {
    async save(files) {
      const assetId = randomUUID();
      const dir = path.join(rootDir, assetId);
      await mkdir(dir, { recursive: true });
      for (const variant of ["original", "resized"] as const) {
        const { bytes, mediaType } = files[variant];
        await writeFile(path.join(dir, `${variant}.${EXTENSIONS[mediaType]}`), bytes);
      }
      return assetId;
    },

    async read(assetId, variant) {
      // The id comes from the URL, so it must look like one of ours before it touches the file system.
      if (!isAssetId(assetId)) return undefined;
      for (const [extension, mediaType] of Object.entries(MEDIA_TYPES)) {
        try {
          return { bytes: await readFile(path.join(rootDir, assetId, `${variant}.${extension}`)), mediaType };
        } catch {
          // Not this extension; try the next one.
        }
      }
      return undefined;
    },
  };
}

/** The app's asset folder, outside the source tree (and git-ignored). */
export function createDefaultAssetStore(): AssetStore {
  return createAssetStore(path.resolve("storage", "assets"));
}
