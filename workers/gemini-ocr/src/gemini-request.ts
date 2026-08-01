/** Pure Gemini request construction for runner screenshot OCR. */
import { EXTRACTION_PROMPT } from './prompt';

export function buildRequestBody(imageBase64: string, mimeType: string) {
  return {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
          { text: EXTRACTION_PROMPT }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      topK: 1,
      topP: 0.8,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json'
    }
  };
}
