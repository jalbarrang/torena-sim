/** Request domain: parse and validate the inbound multipart OCR request. */

import { toBase64 } from './shared';

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

// Requests larger than this are rejected before hitting Gemini (inline_data limit ~20MB).
export const MAX_BODY_BYTES = 15_000_000;

export type OcrPayload = {
  /** base64-encoded image bytes (Gemini's inline_data requires base64). */
  imageBase64: string;
  mimeType: (typeof ALLOWED_MIME_TYPES)[number];
  token: string;
};

export type ParseResult =
  | { ok: true; value: OcrPayload }
  | { ok: false; error: string; tooLarge?: boolean };

function isMimeType(value: unknown): value is OcrPayload['mimeType'] {
  return typeof value === 'string' && (ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * Parses the multipart request: an `image` file part and a `token` text part. The
 * client sends raw image bytes (no base64 bloat on the wire); we base64-encode here
 * because Gemini's inline_data requires it.
 */
export async function parseFormData(request: Request): Promise<ParseResult> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, error: 'Invalid multipart form data.' };
  }

  // The runtime returns a File for uploaded parts, but the default workers-types entry
  // types `get()` as `string | null`, so cast to reach the Blob API (size/type/bytes).
  const image = form.get('image') as unknown as Blob | string | null;
  const token = form.get('token');

  if (image === null || typeof image === 'string' || image.size === 0) {
    return { ok: false, error: 'Missing image data.' };
  }
  if (!isMimeType(image.type)) {
    return { ok: false, error: 'Unsupported or missing image mime type.' };
  }
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, error: 'Missing verification token.' };
  }
  if (image.size > MAX_BODY_BYTES) {
    return { ok: false, error: 'Image is too large.', tooLarge: true };
  }

  const imageBase64 = toBase64(await image.arrayBuffer());
  return { ok: true, value: { imageBase64, mimeType: image.type, token } };
}
