import { copyCapturedUint8ArrayV2, inspectCapturedUint8ArrayV2 } from '@pasteboard-pro/core';
import { failV2 } from './canonical.js';

export type PortableTextEncodingV2 = 'utf8' | 'cf-unicode-text';
export type PortableTextLimitsV2 = Readonly<{ maxInputBytes: number; maxOutputBytes: number }>;
const MAX_TEXT_BYTES = 10 * 1024 * 1024;

/** Conversion only: this function does not authorize retention, sharing or publication. */
export function encodePortableTextV2(input: Uint8Array, encoding: PortableTextEncodingV2, limits: PortableTextLimitsV2): Uint8Array {
  if (!limits || !Number.isSafeInteger(limits.maxInputBytes) || limits.maxInputBytes <= 0 ||
      !Number.isSafeInteger(limits.maxOutputBytes) || limits.maxOutputBytes <= 0) failV2();
  const view = inspectCapturedUint8ArrayV2(input);
  if (!view) failV2();
  if (view.byteLength > Math.min(MAX_TEXT_BYTES, limits.maxInputBytes)) failV2('over-limit');
  const owned = copyCapturedUint8ArrayV2(view);
  let text: string;
  try {
    if (encoding === 'utf8') {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(owned);
    } else if (encoding === 'cf-unicode-text') {
      if (owned.length < 2 || owned.length % 2 !== 0 || owned[owned.length - 1] !== 0 || owned[owned.length - 2] !== 0) failV2();
      text = new TextDecoder('utf-16le', { fatal: true, ignoreBOM: true }).decode(owned.subarray(0, -2));
    } else {
      return failV2();
    }
  } catch {
    return failV2();
  }
  if (text.includes('\0')) failV2();
  const maxOutput = Math.min(MAX_TEXT_BYTES, limits.maxOutputBytes);
  let byteLength = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    byteLength += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (byteLength > maxOutput) failV2('over-limit');
  }
  const output = new TextEncoder().encode(text);
  return output;
}
