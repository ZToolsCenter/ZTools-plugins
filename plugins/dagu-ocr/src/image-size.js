const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const PNG_IHDR = [73, 72, 68, 82];

function sameBytes(bytes, expected, offset = 0) {
  return expected.every((byte, index) => bytes[offset + index] === byte);
}

export function pngSizeFromDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) return null;

  const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
  try {
    const decodedPrefix = atob(encoded.slice(0, 32));
    if (decodedPrefix.length < 24) return null;

    const bytes = Uint8Array.from(decodedPrefix, (char) => char.charCodeAt(0));
    if (!sameBytes(bytes, PNG_SIGNATURE) || !sameBytes(bytes, PNG_IHDR, 12)) return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width > 0 && height > 0 ? { width, height } : null;
  } catch {
    return null;
  }
}
