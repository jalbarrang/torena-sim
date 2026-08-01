import { describe, expect, it } from 'vitest';
import { buildRequestBody } from '../../../../workers/gemini-ocr/src/gemini-request';
import { parseFormData } from '../../../../workers/gemini-ocr/src/ocr-request';
import { EXTRACTION_PROMPT } from '../../../../workers/gemini-ocr/src/prompt';

function createRequest(): Request {
  const form = new FormData();
  form.append('image', new Blob(['image'], { type: 'image/png' }), 'runner.png');
  form.append('token', 'test-token');
  return new Request('https://ocr.test', { method: 'POST', body: form });
}

describe('Gemini runner OCR worker contract', () => {
  it('parses the legacy runner multipart request without a mode field', async () => {
    const parsed = await parseFormData(createRequest());

    expect(parsed).toMatchObject({
      ok: true,
      value: { mimeType: 'image/png', token: 'test-token' }
    });
    if (parsed.ok) {
      expect(parsed.value).not.toHaveProperty('mode');
    }
  });

  it('uses only the server-owned runner prompt', () => {
    const body = buildRequestBody('base64', 'image/png');

    expect(body.contents[0].parts[1]).toEqual({ text: EXTRACTION_PROMPT });
    expect(EXTRACTION_PROMPT).toContain('extract the runner data');
  });
});
