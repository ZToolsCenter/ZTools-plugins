import { expect, it } from "vitest";
import type { Plugin } from "vite";
import { blobOnlyEnglishWorkerPlugin } from "../../scripts/vite/blobOnlyEnglishWorker";

const workerId = "/plugin/src/core/ai/englishAgreementWorker.ts?worker&inline";
const viteWorkerWrapper = `const jsContent = "self.onmessage = () => {};";
const blob = typeof self !== "undefined" && self.Blob && new Blob([jsContent], { type: "text/javascript;charset=utf-8" });
export default function WorkerWrapper(options) {
  let objURL;
  try {
    objURL = blob && (self.URL || self.webkitURL).createObjectURL(blob);
    if (!objURL) throw ''
    const worker = new Worker(objURL, { name: options?.name });
    worker.addEventListener("error", () => {
      (self.URL || self.webkitURL).revokeObjectURL(objURL);
    });
    return worker;
  } catch(e) {
    return new Worker(
      'data:text/javascript;charset=utf-8,' + encodeURIComponent(jsContent),
      { name: options?.name }
    );
  }
}`;

async function transform(plugin: Plugin, code: string, id: string) {
  const hook = plugin.transform;
  const handler = typeof hook === "function" ? hook : hook?.handler;
  return handler?.call({ error: (message: string) => { throw new Error(message); } } as never, code, id);
}

it("strips Vite's data URL fallback from the English worker while preserving classic Blob startup", async () => {
  const plugin = blobOnlyEnglishWorkerPlugin();
  const result = await transform(plugin, viteWorkerWrapper, workerId);
  const code = typeof result === "string" ? result : result?.code;

  expect(code).toBeDefined();
  expect(code).toContain("new Worker(objURL");
  expect(code).toContain("createObjectURL(blob)");
  expect(code).toContain("Inline English agreement Worker requires Blob URL support.");
  expect(code).toContain("throw workerError");
  expect(code).not.toContain("data:text/javascript");
  expect(code).not.toContain("encodeURIComponent(jsContent)");
  expect(code).not.toContain('type: "module"');
});

it("does not rewrite unrelated inline workers", async () => {
  const plugin = blobOnlyEnglishWorkerPlugin();
  expect(await transform(plugin, viteWorkerWrapper, "/plugin/src/core/ai/aiTaskWorker.ts?worker&inline")).toBeNull();
});
