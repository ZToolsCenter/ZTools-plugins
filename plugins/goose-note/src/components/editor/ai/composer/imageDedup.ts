export function getImageFastFingerprint(file: File): string {
  return JSON.stringify([
    file.name,
    file.size,
    file.lastModified,
    file.type,
  ]);
}

export async function calculateImageSha256(file: File): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof subtle.digest !== "function") return null;

    const digest = await subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    return null;
  }
}

interface TrackedImage {
  fastFingerprint: string;
  sequence: number;
  contentHash?: string;
}

/** Tracks insertion order so async hashes always reject the later image. */
export class ImageDedupTracker {
  private nextSequence = 0;
  private readonly images = new Map<string, TrackedImage>();
  private readonly fastFingerprints = new Map<string, string>();
  private readonly contentHashes = new Map<string, string>();

  claim(imageId: string, file: File): boolean {
    const fastFingerprint = getImageFastFingerprint(file);
    if (this.fastFingerprints.has(fastFingerprint)) return false;

    this.images.set(imageId, {
      fastFingerprint,
      sequence: this.nextSequence++,
    });
    this.fastFingerprints.set(fastFingerprint, imageId);
    return true;
  }

  has(imageId: string): boolean {
    return this.images.has(imageId);
  }

  release(imageId: string): void {
    const image = this.images.get(imageId);
    if (!image) return;

    if (this.fastFingerprints.get(image.fastFingerprint) === imageId) {
      this.fastFingerprints.delete(image.fastFingerprint);
    }
    if (image.contentHash && this.contentHashes.get(image.contentHash) === imageId) {
      this.contentHashes.delete(image.contentHash);
    }
    this.images.delete(imageId);
  }

  /** Returns the later imageId when a content duplicate is found. */
  resolveContentHash(imageId: string, contentHash: string): string | null {
    const image = this.images.get(imageId);
    if (!image) return null;
    image.contentHash = contentHash;

    const existingId = this.contentHashes.get(contentHash);
    const existing = existingId ? this.images.get(existingId) : undefined;
    if (!existingId || !existing) {
      this.contentHashes.set(contentHash, imageId);
      return null;
    }
    if (existingId === imageId) return null;

    if (existing.sequence < image.sequence) return imageId;

    this.contentHashes.set(contentHash, imageId);
    return existingId;
  }

  clear(): void {
    this.images.clear();
    this.fastFingerprints.clear();
    this.contentHashes.clear();
  }
}
