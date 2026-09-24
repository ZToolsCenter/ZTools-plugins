import type { NativeImageLike } from "./thumbnail";

export type ScreenCaptureBounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type ScreenCaptureImportResult = Readonly<{
  bounds?: ScreenCaptureBounds;
}>;

type ScreenCaptureHost = Readonly<{
  screenCapture?: (
    callback: (image: unknown, bounds?: unknown) => void,
    autoConfirm?: boolean,
  ) => void | Promise<unknown>;
}>;

export const SCREEN_CAPTURE_UNAVAILABLE_MESSAGE =
  "当前 ZTools 版本不支持截图导入";
export const SCREEN_CAPTURE_PAUSED_MESSAGE =
  "剪贴板捕获已暂停，请先继续捕获";

export type ScreenCaptureImportOptions = Readonly<{
  canImport?: () => boolean | Promise<boolean>;
}>;

export type ScreenshotNativeImageApi = Readonly<{
  createFromDataURL(value: string): NativeImageLike;
}>;

export type ScreenshotClipboard = Readonly<{
  writeImage(image: NativeImageLike): void;
}>;

export function importCapturedScreenshot(
  imageDataUrl: string,
  dependencies: Readonly<{
    nativeImage: ScreenshotNativeImageApi;
    clipboard: ScreenshotClipboard;
  }>,
): boolean {
  if (!/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+=*$/iu.test(imageDataUrl)) {
    return false;
  }
  try {
    const image = dependencies.nativeImage.createFromDataURL(imageDataUrl);
    if (image.isEmpty()) return false;
    dependencies.clipboard.writeImage(image);
    return true;
  } catch {
    return false;
  }
}

function captureBounds(value: unknown): ScreenCaptureBounds | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.x !== "number" ||
    typeof candidate.y !== "number" ||
    typeof candidate.width !== "number" ||
    typeof candidate.height !== "number" ||
    candidate.width <= 0 ||
    candidate.height <= 0
  ) return undefined;
  return {
    x: candidate.x,
    y: candidate.y,
    width: candidate.width,
    height: candidate.height,
  };
}

export async function importScreenCapture(
  host: ScreenCaptureHost,
  nativeImage: ScreenshotNativeImageApi,
  clipboard: ScreenshotClipboard,
  options: ScreenCaptureImportOptions = {},
): Promise<ScreenCaptureImportResult> {
  const screenCapture = host.screenCapture;
  if (screenCapture === undefined) {
    throw new Error(SCREEN_CAPTURE_UNAVAILABLE_MESSAGE);
  }
  if (options.canImport !== undefined && !(await options.canImport())) {
    throw new Error(SCREEN_CAPTURE_PAUSED_MESSAGE);
  }
  return new Promise<ScreenCaptureImportResult>((resolve, reject) => {
    let settled = false;
    const complete = (image: unknown, rawBounds?: unknown): void => {
      if (settled) return;
      settled = true;
      void (async () => {
        const bounds = captureBounds(rawBounds);
        if (rawBounds !== undefined && rawBounds !== null && bounds === undefined) {
          throw new TypeError("截图区域信息无效");
        }
        if (options.canImport !== undefined && !(await options.canImport())) {
          throw new Error(SCREEN_CAPTURE_PAUSED_MESSAGE);
        }
        if (typeof image === "string") {
          if (!importCapturedScreenshot(image, { nativeImage, clipboard })) {
            throw new TypeError("截图图像无效");
          }
        } else {
          const capturedImage = image as NativeImageLike;
          if (
            capturedImage === null ||
            typeof capturedImage !== "object" ||
            capturedImage.isEmpty()
          ) throw new TypeError("截图图像无效");
          clipboard.writeImage(capturedImage);
        }
        resolve(bounds === undefined ? {} : { bounds });
      })().catch(reject);
    };
    try {
      const result = screenCapture(complete, false);
      if (result !== undefined && typeof (result as PromiseLike<unknown>).then === "function") {
        void Promise.resolve(result).catch((error: unknown) => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        });
      }
    } catch (error) {
      settled = true;
      reject(error);
    }
  });
}
