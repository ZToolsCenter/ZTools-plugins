export type ZToolsScreenCaptureResult = Readonly<{
  image: string;
  bounds?: unknown;
}>;

export function requestZToolsScreenCapture(api: {
  screenCapture?: (callback: (image: string, bounds?: unknown) => void) => unknown;
} | undefined): Promise<ZToolsScreenCaptureResult> {
  const screenCapture = api?.screenCapture;
  if (typeof screenCapture !== "function") {
    return Promise.reject(new Error("请升级到 ZTools 3.2.0 以使用截图导入。"));
  }
  return new Promise((resolve, reject) => {
    try {
      const request = screenCapture((image, bounds) => resolve({ image, bounds }));
      if (request && typeof (request as PromiseLike<unknown>).then === "function") {
        void Promise.resolve(request).catch(reject);
      }
    } catch (error) {
      reject(error);
    }
  });
}
