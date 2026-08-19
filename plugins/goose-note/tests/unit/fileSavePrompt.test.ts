import { expect, test } from "playwright/test";
import { saveBlobWithPrompt } from "../../src/lib/export/fileSave";

test("saveBlobWithPrompt treats closing the system dialog as cancellation", async () => {
  const previousWindow = globalThis.window;
  (globalThis as typeof globalThis & { window: unknown }).window = {
    utools: {
      showSaveDialog: () => ({ canceled: true }),
    },
    gooseFs: {},
  };

  try {
    await expect(
      saveBlobWithPrompt(new Blob(["backup"]), "backup.zip"),
    ).resolves.toBe("cancelled");
  } finally {
    (globalThis as typeof globalThis & { window: unknown }).window = previousWindow;
  }
});
