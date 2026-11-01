import { createUploadHandler, type UploadHandler } from "../../../server/assets-handler";
import { createDefaultAssetStore } from "../../../server/asset-store";

let handler: UploadHandler | undefined;

export async function POST(request: Request) {
  handler ??= createUploadHandler(createDefaultAssetStore());
  return handler(request);
}
