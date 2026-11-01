/** Reads a request body as bytes, giving up (undefined) as soon as it grows past `maxBytes`. */
export async function readBoundedBytes(request: Request, maxBytes: number): Promise<Uint8Array | undefined> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > maxBytes) return undefined;
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
