function base64ToBytes(base64: string): Uint8Array {
  const standard = base64.replaceAll('-', '+').replaceAll('_', '/');
  const binaryStr = atob(standard);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.codePointAt(i)!;
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  const binaryStr = Array.from(bytes)
    .map((byte) => String.fromCodePoint(byte))
    .join('');
  const standard = btoa(binaryStr);
  return standard.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function extractEncodedPayload(input: string): string {
  const trimmed = input.trim();
  const hashIndex = trimmed.indexOf('#');
  if (hashIndex !== -1) return trimmed.slice(hashIndex + 1);
  return trimmed;
}

async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/** Compress a UTF-8 string with gzip and return a base64url string. */
export async function gzipStringToBase64(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const compressed = await gzipBytes(bytes);
  return bytesToBase64(compressed);
}

/** Decompress a base64url gzip payload back into a UTF-8 string. */
export async function gunzipBase64ToString(base64: string): Promise<string> {
  const compressed = base64ToBytes(base64);
  const decompressed = await gunzipBytes(compressed);
  return new TextDecoder().decode(decompressed);
}
