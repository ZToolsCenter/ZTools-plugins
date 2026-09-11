export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(String(value || '').trim());
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function assertSafeExternalUrl(value: string): string {
  const url = String(value || '').trim();
  if (!isSafeExternalUrl(url)) throw new Error('Only http and https URLs can be opened externally.');
  return url;
}
