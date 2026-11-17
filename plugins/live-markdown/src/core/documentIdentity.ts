let draftSequence = 0;

/** Path-backed docs are stable across reloads; every unsaved document gets its own identity. */
export function documentIdentity(path: string | null, draftToken?: string): string {
  if (path) return `file:${path}`;
  if (draftToken) return `draft:${draftToken}`;
  draftSequence += 1;
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${draftSequence.toString(36)}`;
  return `draft:${random}`;
}
