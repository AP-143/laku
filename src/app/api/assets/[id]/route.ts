import { createAssetReadHandler, type AssetReadHandler } from "../../../../server/assets-handler";
import { createDefaultAssetStore } from "../../../../server/asset-store";

let handler: AssetReadHandler | undefined;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  handler ??= createAssetReadHandler(createDefaultAssetStore());
  const { id } = await params;
  return handler(request, id);
}
