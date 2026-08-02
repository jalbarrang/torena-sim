import { parseUmadumpTrainedCharaJson, type ParseUmadumpResult } from './parser';

export const UMADUMP_IMPORT_PARAM = 'from';
export const UMADUMP_DEEP_LINK_MAX_VALUE_LENGTH = 15_000;

const UMADUMP_DEEP_LINK_VERSION = 1;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

type UmadumpDeepLinkEnvelope = {
  v: number;
  data: unknown;
};

function linkError(message: string): ParseUmadumpResult {
  return { ok: false, error: message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeBase64Url(payload: string): string | null {
  if (!BASE64URL_PATTERN.test(payload) || payload.length % 4 === 1) return null;

  const base64 = payload.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');

  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function encodeBase64Url(raw: string): string {
  const bytes = new TextEncoder().encode(raw);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** Decode and validate a base64url-encoded umadump import envelope. */
export function decodeUmadumpDeepLinkValue(value: string): ParseUmadumpResult {
  if (!value) {
    return linkError(
      'This umadump import link has an empty payload. Generate a new link or import trained_chara_data.json instead.'
    );
  }

  if (value.length > UMADUMP_DEEP_LINK_MAX_VALUE_LENGTH) {
    return linkError(
      'This umadump import link is too long for reliable browser support. Import trained_chara_data.json instead.'
    );
  }

  const decoded = decodeBase64Url(value);
  if (decoded === null || !decoded.trim()) {
    return linkError(
      decoded === ''
        ? 'This umadump import link has an empty payload. Generate a new link or import trained_chara_data.json instead.'
        : 'This umadump import link has a malformed payload. Copy the complete link or import trained_chara_data.json instead.'
    );
  }

  let envelope: unknown;
  try {
    envelope = JSON.parse(decoded);
  } catch {
    return linkError(
      'This umadump import link does not contain valid JSON. Generate a new link or import trained_chara_data.json instead.'
    );
  }

  if (!isRecord(envelope) || typeof envelope.v !== 'number' || !('data' in envelope)) {
    return linkError(
      'This umadump import link has an unsupported format. Update umadump or import trained_chara_data.json instead.'
    );
  }

  const typedEnvelope = envelope as UmadumpDeepLinkEnvelope;
  if (typedEnvelope.v !== UMADUMP_DEEP_LINK_VERSION) {
    return linkError(
      `This umadump import link uses unsupported version “${typedEnvelope.v}”. Update umadump or import trained_chara_data.json instead.`
    );
  }

  const parsed = parseUmadumpTrainedCharaJson(JSON.stringify(typedEnvelope.data));
  if (parsed.ok) return parsed;

  return linkError(
    `Invalid umadump import link. ${parsed.error} Generate a new link or import trained_chara_data.json instead.`
  );
}

/** Build a v1 base64url envelope. Intended for contract tests and integrations. */
export function encodeUmadumpDeepLinkValue(rawJson: string): string {
  const data: unknown = JSON.parse(rawJson);
  return encodeBase64Url(JSON.stringify({ v: UMADUMP_DEEP_LINK_VERSION, data }));
}
