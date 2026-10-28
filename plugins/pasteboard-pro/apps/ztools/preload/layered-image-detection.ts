import path from "node:path";
import type { CanonicalClipboardRecord } from "./clipboard-store";

/**
 * Layered clipboard image detection strategy for macOS clipboard compatibility.
 * 
 * This module implements a multi-tier detection approach to handle edge cases like
 * WeChat images that use non-standard clipboard flavors (public.file-url + TIFF combo).
 * 
 * Detection hierarchy:
 * 1. Primary path: Use host-provided imagePath when available
 * 2. Fallback 1: Decode public.file-url temp paths from clipboard
 * 3. Fallback 2: Extract PNG/TIFF data directly via readImage()
 * 4. Null result with warning log if all methods fail
 * 
 * Known issues this addresses:
 * - WeChat screenshot paste failures (see Kimi CLI #2652, Crush CLI #3150)
 * - Maccy #1331: Images not appearing in history despite enabled checkbox
 */

export const LAYERED_IMAGE_DETECTION_VERSION = "1.0.0";

export type DetectionResult = Readonly<{
  success: boolean;
  imagePath?: string;
  blobBytes?: number;
  mediaType?: string;
  method: "host-provided" | "file-url-decode" | "readimage-extract" | null;
  error?: string;
  stackTrace?: string;
  timestamp?: number;
}>;

/**
 * Error context for layered detection failures.
 * Collected automatically for debugging and issue reporting.
 */
export type LayeredImageDetectionErrorContext = Readonly<{
  version: typeof LAYERED_IMAGE_DETECTION_VERSION;
  platform: NodeJS.Platform;
  electronVersion?: string;
  detectedAt: number;
  failureLevel: 1 | 2 | 3 | null; // Which layer failed (1=host, 2=file-url, 3=readImage)
  attemptedMethod: "host-provided" | "file-url-decode" | "readimage-extract" | null;
  hostProvidedImagePath?: string | null;
  hasPublicFileUrl: boolean;
  hasTiffFlavor: boolean;
  readImageIsEmpty: boolean;
  lastErrorMessage: string;
  lastErrorStack?: string;
  clipboardFlavors?: readonly string[]; // Available flavors in pasteboard
}>;

export type LayeredImageDetectionDependencies = Readonly<{
  /** NativeElectron Clipboard API */
  clipboard: Readonly<{
    read?(type?: string): unknown;
    readImage?(): unknown;
    readBuffer?(type: string): unknown;
    has?(type: string): boolean;
  }>;
  
  /** File system utilities */
  fs: Readonly<{
    readFile(path: string): Promise<Buffer>;
    writeFile(path: string, data: Buffer): Promise<void>;
    access(path: string, mode?: number): Promise<void>;
  }>;
  
  /** Image storage directory */
  imageDir: string;
  
  /** Utility functions */
  uuid: () => string;
  cryptoHash: (data: Buffer) => string;
  now: () => number;
  isFile: (path: string) => boolean;
}>;

function isNativeImageLike(val: unknown): val is { isEmpty(): boolean; toPNG(): Buffer } {
  return typeof val === "object" && val !== null && typeof (val as { isEmpty?: unknown }).isEmpty === "function";
}

export function inferMediaTypeFromPath(imagePath: string): string {
  const extension = path.extname(imagePath).toLowerCase().slice(1);
  switch (extension) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    default:
      return "image/png";
  }
}

export async function detectClipboardImageWithFallback(
  dependencies: LayeredImageDetectionDependencies,
  hostProvidedImagePath?: string | null,
): Promise<DetectionResult> {
  // Level 1: Host-provided imagePath (primary path)
  if (hostProvidedImagePath !== null && hostProvidedImagePath !== undefined) {
    try {
      await dependencies.fs.access(hostProvidedImagePath);
      const stat = await dependencies.fs.readFile(hostProvidedImagePath);
      return {
        success: true,
        imagePath: hostProvidedImagePath,
        blobBytes: stat.length,
        mediaType: inferMediaTypeFromPath(hostProvidedImagePath),
        method: "host-provided",
      };
    } catch (error) {
      console.warn(
        "[LayeredImageDetection] Host-provided image path invalid or inaccessible:",
        hostProvidedImagePath,
        error,
      );
    }
  }

  // Level 2: Try decoding public.file-url temporary paths (WeChat pattern)
  const fileUrlResult = await tryDecodeFileUrlInClipboard(dependencies);
  if (fileUrlResult.success) {
    return fileUrlResult;
  }

  // Level 3: Extract image data directly using readImage() as final fallback
  const readImageResult = await tryExtractViaReadImage(dependencies);
  if (readImageResult.success) {
    return readImageResult;
  }

  // All methods failed
  console.error(
    "[LayeredImageDetection] Failed to extract clipboard image after all fallback attempts",
  );
  return {
    success: false,
    method: null,
    error: "Unable to detect image from clipboard after trying all detection methods",
  };
}

async function tryDecodeFileUrlInClipboard(
  dependencies: LayeredImageDetectionDependencies,
): Promise<DetectionResult> {
  try {
    // Check if public.file-url flavor exists in clipboard
    if (typeof dependencies.clipboard.has === "function" && !dependencies.clipboard.has("public.file-url")) {
      return { success: false, method: null };
    }

    const fileUrlData = typeof dependencies.clipboard.read === "function" ? dependencies.clipboard.read("public.file-url") : undefined;
    if (typeof fileUrlData !== "string") {
      return { success: false, method: null };
    }

    // Parse file:// URL to get actual path
    const fileUrl = fileUrlData.trim();
    if (!fileUrl.startsWith("file://")) {
      return { success: false, method: null };
    }

    // Decode percent-encoding and extract path
    let decodedPath = decodeURIComponent(fileUrl.slice(7)); // Remove "file://" prefix
    
    // Handle macOS特有的空主机名格式 file:///path/to/file
    if (decodedPath.startsWith("//") && !decodedPath.startsWith("///")) {
      decodedPath = "/" + decodedPath.slice(2);
    }

    // Verify file exists
    if (!dependencies.isFile(decodedPath)) {
      return { success: false, method: null };
    }

    // Read file content and save to image store
    const fileBuffer = await dependencies.fs.readFile(decodedPath);
    const imageName = `${dependencies.now()}-${dependencies.uuid()}.png`;
    const imagePath = path.join(dependencies.imageDir, imageName);
    await dependencies.fs.writeFile(imagePath, fileBuffer);

    console.log(
      "[LayeredImageDetection] Successfully extracted image via file-url decode:",
      decodedPath,
      "->",
      imagePath,
    );

    return {
      success: true,
      imagePath,
      blobBytes: fileBuffer.length,
      mediaType: "image/png",
      method: "file-url-decode",
    };
  } catch (error) {
    console.warn(
      "[LayeredImageDetection] Failed to decode file-url from clipboard:",
      error,
    );
    return { success: false, method: null };
  }
}

async function tryExtractViaReadImage(
  dependencies: LayeredImageDetectionDependencies,
): Promise<DetectionResult> {
  try {
    // Use Electron's native readImage() which handles multiple clipboard flavors internally
    const rawImage = typeof dependencies.clipboard.readImage === "function"
      ? dependencies.clipboard.readImage()
      : undefined;
    
    if (!isNativeImageLike(rawImage) || rawImage.isEmpty()) {
      return { success: false, method: null };
    }

    // Convert to PNG buffer (most widely supported format)
    const pngBuffer = rawImage.toPNG();
    if (!pngBuffer || pngBuffer.length === 0) {
      return { success: false, method: null };
    }

    // Also check for TIFF data (WeChat sometimes uses TIFF)
    let tiffBuffer: Buffer | undefined;
    try {
      const tiffData = typeof dependencies.clipboard.readBuffer === "function"
        ? dependencies.clipboard.readBuffer("public.tiff")
        : undefined;
      if (Buffer.isBuffer(tiffData) && tiffData.length > 0) {
        tiffBuffer = tiffData;
      }
    } catch {
      // TIFF extraction not supported or empty
    }

    // Save to image store
    const useTiff = Boolean(tiffBuffer && tiffBuffer.length > pngBuffer.length);
    const selectedBuffer: Buffer = (useTiff && tiffBuffer) ? tiffBuffer : pngBuffer;
    const imageName = `${dependencies.now()}-${dependencies.uuid()}.png`;
    const imagePath = path.join(dependencies.imageDir, imageName);
    await dependencies.fs.writeFile(imagePath, selectedBuffer);

    console.log(
      "[LayeredImageDetection] Successfully extracted image via readImage():",
      `${(selectedBuffer.length / 1024).toFixed(2)}KB`,
      "->",
      imagePath,
    );

    return {
      success: true,
      imagePath,
      blobBytes: selectedBuffer.length,
      mediaType: useTiff ? "image/tiff" : "image/png",
      method: "readimage-extract",
    };
  } catch (error) {
    console.warn(
      "[LayeredImageDetection] Failed to extract via readImage():",
      error,
    );
    return { success: false, method: null };
  }
}

/**
 * prepareRecord hook wrapper that adds layered detection fallback.
 * 
 * When host doesn't provide imagePath for an image record, this hook automatically
 * attempts to extract the image data using the layered detection strategy.
 */
export function createLayeredImageDetectionHook(
  dependencies: LayeredImageDetectionDependencies,
) {
  return async (
    _rawItem: unknown,
    record: CanonicalClipboardRecord,
  ): Promise<CanonicalClipboardRecord> => {
    if (record.item.kind !== "image") {
      return record;
    }

    const origin = record.origin;
    if (origin.host !== "ztools" || origin.hostType !== "image") {
      return record;
    }

    // If host already provided imagePath, no need to re-detect
    if (origin.imagePath !== undefined && origin.imagePath !== "") {
      return record;
    }

    console.log(
      "[LayeredImageDetection] Host didn't provide imagePath, attempting fallback detection...",
    );

    const result = await detectClipboardImageWithFallback(dependencies);

    if (!result.success || result.imagePath === undefined) {
      const errorContext = captureLayeredImageDetectionError(
        dependencies,
        result,
      );
      
      // Report error via IPC if available
      reportLayeredImageError(errorContext);
      
      console.warn(
        "[LayeredImageDetection] Fallback detection failed, skipping record",
        errorContext.lastErrorMessage,
      );
      throw new Error(
        "Layered image detection failed - cannot extract image without host support",
      );
    }

    // Update record with detected image path and metadata
    return {
      ...record,
      origin: {
        ...origin,
        imagePath: result.imagePath,
        ...(result.blobBytes !== undefined ? { blobBytes: result.blobBytes } : {}),
      },
    };
  };
}

/**
 * Capture comprehensive error context for debugging.
 * Returns structured data suitable for issue creation or error logging.
 */
function captureLayeredImageDetectionError(
  dependencies: LayeredImageDetectionDependencies,
  result: DetectionResult,
): LayeredImageDetectionErrorContext {
  const clipboardFlavors = getAvailableClipboardFlavors(dependencies.clipboard);
  
  // Check what's actually in clipboard
  const hasFileUrl = typeof dependencies.clipboard.has === "function" && dependencies.clipboard.has("public.file-url");
  let hasTiffFlavor = false;
  try {
    const tiffData = typeof dependencies.clipboard.readBuffer === "function" ? dependencies.clipboard.readBuffer("public.tiff") : undefined;
    hasTiffFlavor = Buffer.isBuffer(tiffData) && tiffData.length > 0;
  } catch {
    // TIFF extraction not supported
  }

  const rawImage = typeof dependencies.clipboard.readImage === "function" ? dependencies.clipboard.readImage() : undefined;
  const readImageIsEmpty = isNativeImageLike(rawImage) ? rawImage.isEmpty() : true;

  return {
    version: LAYERED_IMAGE_DETECTION_VERSION,
    platform: process.platform,
    ...(process.versions.electron ? { electronVersion: process.versions.electron } : {}),
    detectedAt: Date.now(),
    failureLevel: result.method === null ? null : (
      result.method === "host-provided" ? 1 :
      result.method === "file-url-decode" ? 2 : 3
    ),
    attemptedMethod: result.method,
    ...(result.imagePath ? { hostProvidedImagePath: result.imagePath } : {}),
    hasPublicFileUrl: hasFileUrl,
    hasTiffFlavor: hasTiffFlavor,
    readImageIsEmpty,
    lastErrorMessage: result.error || "Unknown failure",
    ...(result.stackTrace ? { lastErrorStack: result.stackTrace } : {}),
    clipboardFlavors,
  };
}

/**
 * Try to enumerate available clipboard flavors for debugging.
 */
function getAvailableClipboardFlavors(
  clipboard: LayeredImageDetectionDependencies["clipboard"],
): readonly string[] {
  try {
    // Electron clipboard doesn't directly expose flavors, so we try common ones
    const knownFlavors = [
      "public.text",
      "public.utf8-plain-text",
      "public.png",
      "public.tiff",
      "public.hires-tiff",
      "NSFilenamesPboardType",
      "public.file-url",
      "com.apple.private.clipboard.images.data",
      "NSTIFFBitmapType",
      "lunkr-clipboard-image-id",
    ];
    
    const available = knownFlavors.filter((flavor) => {
      try {
        return typeof clipboard.has === "function" && clipboard.has(flavor);
      } catch {
        return false;
      }
    });
    
    return available;
  } catch {
    return [];
  }
}

/**
 * Report error to parent window or remote logging service.
 * This can be customized based on your app's architecture.
 */
function reportLayeredImageError(context: LayeredImageDetectionErrorContext): void {
  try {
    const queueManager = (window as unknown as { pasteboardProErrorQueue?: { addError(err: unknown): void } }).pasteboardProErrorQueue;
    if (queueManager) {
      queueManager.addError(context);
    }
  } catch {
    console.warn(
      "[LayeredImageDetection] Clipboard processing error:",
      context.lastErrorMessage,
    );
  }
}
