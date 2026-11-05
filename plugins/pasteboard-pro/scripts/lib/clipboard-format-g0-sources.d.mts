import type { Buffer } from "node:buffer";
export function collectG0Sources(root: string, platform: "darwin" | "win32"): Promise<{
  directory: string; sources: string[]; sourceHashes: Record<string, string>;
}>;
export function verifyBuiltProbe(root: string, options: {
  platform: "darwin" | "win32"; architecture: string; receiptBytes: Buffer;
  binary: string; binaryBytes: Buffer;
}): Promise<{ receipt: unknown; receiptSha256: string; binarySha256: string }>;
