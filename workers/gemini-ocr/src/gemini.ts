/** Gemini OCR domain: build the request, call the API, extract candidate text. */

import type { Env } from './env';
import { isRecord } from './shared';
import type { OcrPayload } from './ocr-request';
import { buildRequestBody } from './gemini-request';

export type GeminiResult =
  | { ok: true; text: string }
  | { ok: false; code: 'quota_exhausted' | 'upstream'; message: string };

function extractResponseText(response: unknown): string {
  if (!isRecord(response)) throw new Error('Gemini returned an invalid response payload');

  const candidates = response.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('Gemini returned no candidates');
  }

  const text = candidates
    .flatMap((c) =>
      isRecord(c) && isRecord(c.content) && Array.isArray(c.content.parts) ? c.content.parts : []
    )
    .flatMap((part) => (isRecord(part) && typeof part.text === 'string' ? [part.text] : []))
    .join('\n')
    .trim();

  if (!text) throw new Error('Gemini returned no text content');
  return text;
}

/** Maps a non-OK Gemini response to a client-facing error code + message. */
async function toError(response: Response): Promise<GeminiResult> {
  const body = (await response.json().catch(() => null)) as unknown;
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  const status = error?.status;

  if (response.status === 429 || status === 'RESOURCE_EXHAUSTED') {
    return {
      ok: false,
      code: 'quota_exhausted',
      message: 'The shared OCR quota is used up for now. Try again later.'
    };
  }

  const message =
    typeof error?.message === 'string'
      ? error.message
      : `Gemini request failed with status ${response.status}`;
  return { ok: false, code: 'upstream', message };
}

/** Sends the image to Gemini and returns its raw candidate text (or a typed error). */
export async function callGemini(env: Env, payload: OcrPayload): Promise<GeminiResult> {
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify(buildRequestBody(payload.imageBase64, payload.mimeType))
      }
    );
  } catch {
    return { ok: false, code: 'upstream', message: 'Failed to reach the OCR service.' };
  }

  if (!response.ok) return toError(response);

  try {
    return { ok: true, text: extractResponseText(await response.json()) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gemini returned an unexpected response.';
    return { ok: false, code: 'upstream', message };
  }
}
