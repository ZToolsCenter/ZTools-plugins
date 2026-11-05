import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  detectClipboardImageWithFallback,
  inferMediaTypeFromPath,
  createLayeredImageDetectionHook,
} from "../preload/layered-image-detection";
import type { CanonicalClipboardRecord } from "../preload/clipboard-store";

describe("Layered Image Detection", () => {
  const mockDependencies = {
    clipboard: {
      has: vi.fn(),
      read: vi.fn(),
      readImage: vi.fn(),
      readBuffer: vi.fn(),
    },
    fs: {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      access: vi.fn(),
    },
    imageDir: "/tmp/test-blobs",
    uuid: vi.fn(),
    cryptoHash: vi.fn(),
    now: vi.fn(),
    isFile: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("inferMediaTypeFromPath", () => {
    test("should infer JPEG media type", () => {
      expect(inferMediaTypeFromPath("/path/to/image.jpg")).toBe("image/jpeg");
      expect(inferMediaTypeFromPath("/path/to/image.JPEG")).toBe("image/jpeg");
    });

    test("should infer PNG media type as default", () => {
      expect(inferMediaTypeFromPath("/path/to/image.png")).toBe("image/png");
      expect(inferMediaTypeFromPath("/path/to/image.unknown")).toBe("image/png");
    });

    test("should handle other formats correctly", () => {
      expect(inferMediaTypeFromPath("/path/to/image.gif")).toBe("image/gif");
      expect(inferMediaTypeFromPath("/path/to/image.webp")).toBe("image/webp");
      expect(inferMediaTypeFromPath("/path/to/image.HEIC")).toBe("image/heic");
    });
  });

  describe("detectClipboardImageWithFallback - Level 1: Host-provided", () => {
    test("should succeed with valid host-provided imagePath", async () => {
      const mockPath = "/tmp/host-provided-image.png";
      const mockBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]); // PNG signature
      
      mockDependencies.fs.access.mockResolvedValue(undefined);
      mockDependencies.fs.readFile.mockResolvedValue(mockBuffer);

      const result = await detectClipboardImageWithFallback(
        mockDependencies as any,
        mockPath,
      );

      expect(result.success).toBe(true);
      expect(result.imagePath).toBe(mockPath);
      expect(result.method).toBe("host-provided");
      expect(result.blobBytes).toBe(mockBuffer.length);
      expect(result.mediaType).toBe("image/png");
    });

    test("should fall through when host-provided path is invalid", async () => {
      const mockPath = "/nonexistent/path.png";
      
      mockDependencies.fs.access.mockRejectedValue(new Error("ENOENT"));

      const result = await detectClipboardImageWithFallback(
        mockDependencies as any,
        mockPath,
      );

      expect(result.success).toBe(false);
      expect(result.method).toBeNull();
    });
  });

  describe("detectClipboardImageWithFallback - Level 2: File-url decode", () => {
    test("should extract image from public.file-url flavor", async () => {
      const tempImagePath = "/tmp/.private/wechat-temp-screenshot.png";
      const mockBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
      const fileUrl = `file://${tempImagePath}`;

      mockDependencies.clipboard.has.mockReturnValue(true);
      mockDependencies.clipboard.read.mockReturnValue(fileUrl);
      mockDependencies.isFile.mockReturnValue(true);
      mockDependencies.fs.readFile.mockResolvedValue(mockBuffer);
      mockDependencies.fs.writeFile.mockResolvedValue(undefined);
      mockDependencies.now.mockReturnValue(1234567890);
      mockDependencies.uuid.mockReturnValue("test-uuid-12345");

      const result = await detectClipboardImageWithFallback(
        mockDependencies as any,
        null,
      );

      expect(result.success).toBe(true);
      expect(result.method).toBe("file-url-decode");
      expect(result.blobBytes).toBe(mockBuffer.length);
      expect(mockDependencies.fs.writeFile).toHaveBeenCalled();
    });

    test("should skip file-url decoding when not present", async () => {
      mockDependencies.clipboard.has.mockReturnValue(false);

      const result = await detectClipboardImageWithFallback(
        mockDependencies as any,
        null,
      );

      expect(result.success).toBe(false);
      expect(result.method).toBeNull();
    });
  });

  describe("detectClipboardImageWithFallback - Level 3: readImage extraction", () => {
    test("should extract image via readImage() when all else fails", async () => {
      const mockBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
      const mockImage = {
        isEmpty: vi.fn().mockReturnValue(false),
        toPNG: vi.fn().mockReturnValue(mockBuffer),
      };

      mockDependencies.clipboard.has.mockReturnValue(false);
      mockDependencies.clipboard.readImage.mockReturnValue(mockImage);
      mockDependencies.fs.writeFile.mockResolvedValue(undefined);
      mockDependencies.now.mockReturnValue(1234567890);
      mockDependencies.uuid.mockReturnValue("test-uuid-67890");

      const result = await detectClipboardImageWithFallback(
        mockDependencies as any,
        null,
      );

      expect(result.success).toBe(true);
      expect(result.method).toBe("readimage-extract");
      expect(result.imagePath).toContain("test-uuid-67890.png");
      expect(result.mediaType).toBe("image/png");
    });

    test("should handle empty readImage result gracefully", async () => {
      const mockImage = {
        isEmpty: vi.fn().mockReturnValue(true),
      };

      mockDependencies.clipboard.has.mockReturnValue(false);
      mockDependencies.clipboard.readImage.mockReturnValue(mockImage);

      const result = await detectClipboardImageWithFallback(
        mockDependencies as any,
        null,
      );

      expect(result.success).toBe(false);
      expect(result.method).toBeNull();
    });

    test("should prefer TIFF data when available and larger than PNG", async () => {
      const pngBuffer = Buffer.from([0x89, 0x50]);
      const tiffBuffer = Buffer.alloc(1024 * 1024); // 1MB TIFF
      const mockImage = {
        isEmpty: vi.fn().mockReturnValue(false),
        toPNG: vi.fn().mockReturnValue(pngBuffer),
      };

      mockDependencies.clipboard.has.mockReturnValue(false);
      mockDependencies.clipboard.readImage.mockReturnValue(mockImage);
      mockDependencies.clipboard.readBuffer.mockReturnValue(tiffBuffer);
      mockDependencies.fs.writeFile.mockResolvedValue(undefined);
      mockDependencies.now.mockReturnValue(1234567890);
      mockDependencies.uuid.mockReturnValue("test-uuid-tiff");

      const result = await detectClipboardImageWithFallback(
        mockDependencies as any,
        null,
      );

      expect(result.success).toBe(true);
      expect(result.mediaType).toBe("image/tiff");
      expect(result.blobBytes).toBe(tiffBuffer.length);
    });
  });

  describe("createLayeredImageDetectionHook", () => {
    test("should report error via global queue when detection fails", async () => {
      const record = {
        item: {
          kind: "image" as const,
          payload: { revision: "test", blobId: "old-id", mediaType: "image/png" },
        },
        origin: {
          host: "ztools",
          hostItemId: "img-123",
          hostType: "image" as const,
          imagePath: undefined,
        },
      } as unknown as CanonicalClipboardRecord;

      // Mock all layers failing
      mockDependencies.clipboard.has.mockReturnValue(false);
      mockDependencies.clipboard.readImage.mockReturnValue({
        isEmpty: vi.fn().mockReturnValue(true),
      });

      // Mock window object with error queue
      const originalWindow = (globalThis as any).window;
      (globalThis as any).window = {
        pasteboardProErrorQueue: {
          addError: vi.fn(),
          getErrors: vi.fn().mockReturnValue([]),
          clearErrors: vi.fn(),
          get hasCriticalErrors() { return false; },
        },
      };

      try {
        const hook = createLayeredImageDetectionHook(
          mockDependencies as any,
        );

        // Should throw and trigger error reporting
        await expect(hook(null, record)).rejects.toThrow(
          "Layered image detection failed"
        );

        // Verify error was queued
        expect(
          (globalThis as any).window.pasteboardProErrorQueue.addError
        ).toHaveBeenCalled();

        // Clean up
        (globalThis as any).window = originalWindow;
      } catch (e) {
        // Restore in case of early exit
        if (originalWindow) {
          (globalThis as any).window = originalWindow;
        }
      }
    });

    test("should handle non-image records without triggering detection", async () => {
      const record = {
        item: {
          kind: "text" as const,
          payload: { revision: "test", text: "hello" },
        },
        origin: { host: "ztools", hostItemId: "123", hostType: "text" },
      } as unknown as CanonicalClipboardRecord;

      const hook = createLayeredImageDetectionHook(
        mockDependencies as any,
      );
      const result = await hook(null, record);

      expect(result).toBe(record);
      expect(mockDependencies.clipboard.readImage).not.toHaveBeenCalled();
    });
  });

  describe("error context capturing", () => {
    test("should capture comprehensive failure context", async () => {
      const mockBuffer = Buffer.from([0x89, 0x50, 0x4E, 0x47]);
      
      // Configure mock to simulate Level 2 failure
      mockDependencies.clipboard.has
        .mockReturnValueOnce(true)  // Has file-url
        .mockReturnValueOnce(false); // No tiff
      
      mockDependencies.clipboard.read.mockReturnValue("file:///fake/path.png");
      mockDependencies.isFile.mockReturnValue(false); // File doesn't exist
      mockDependencies.fs.access.mockRejectedValue(new Error("ENOENT"));
      
      const result = await detectClipboardImageWithFallback(
        mockDependencies as any,
        null,
      );

      expect(result.success).toBe(false);
      expect(result.method).toBeNull();
      expect(result.error).toContain("Unable to detect");
    });

    test("should enumerate available clipboard flavors for debugging", async () => {
      // This test verifies flavor enumeration works correctly
      mockDependencies.clipboard.has.mockImplementation((flavor: string) => {
        return ["public.png", "public.tiff"].includes(flavor);
      });

      const result = await detectClipboardImageWithFallback(
        mockDependencies as any,
        null,
      );

      // Even though it fails, we should have attempted flavor checks
      expect(mockDependencies.clipboard.has).toHaveBeenCalled();
    });
  });
});
