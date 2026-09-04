import { describe, expect, it } from "vitest";

import { requestZToolsScreenCapture } from "../src/shared/ztools-screen-capture";

describe("ZTools screen capture", () => {
  it("preserves the 3.2 image and bounds callback", async () => {
    await expect(requestZToolsScreenCapture({
      screenCapture(callback) {
        callback("data:image/png;base64,aGVsbG8=", { width: 8, height: 6 });
        return Promise.resolve();
      },
    })).resolves.toEqual({
      image: "data:image/png;base64,aGVsbG8=",
      bounds: { width: 8, height: 6 },
    });
  });

  it("propagates an asynchronous host rejection", async () => {
    await expect(requestZToolsScreenCapture({
      screenCapture() { return Promise.reject(new Error("capture ipc failed")); },
    })).rejects.toThrow("capture ipc failed");
  });
});
