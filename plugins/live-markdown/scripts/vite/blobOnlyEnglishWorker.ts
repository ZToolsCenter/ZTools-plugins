import type { Plugin } from "vite";

const ENGLISH_WORKER_FILE = /(?:^|[/\\])englishAgreementWorker\.ts$/;
const DATA_FALLBACK = /catch\s*\(\s*([\w$]+)\s*\)\s*\{\s*return\s+new\s+Worker\(\s*(['"])data:text\/javascript;charset=utf-8,\2\s*\+\s*encodeURIComponent\(jsContent\)\s*,\s*(\{[\s\S]*?\})\s*\)\s*;?\s*\}/;

/** Removes Vite's large data-URL fallback from this optional analysis worker. */
export function blobOnlyEnglishWorkerPlugin(): Plugin {
  return {
    name: "live-markdown:blob-only-english-worker",
    enforce: "post",
    transform(code, id) {
      const sourceId = id.split(/[?#]/, 1)[0] ?? id;
      if (!ENGLISH_WORKER_FILE.test(sourceId) || !/[?&]worker(?:&|$)/.test(id) || !/[?&]inline(?:&|$)/.test(id)) {
        return null;
      }

      const match = DATA_FALLBACK.exec(code);
      if (!match) {
        if (code.includes("encodeURIComponent(jsContent)") || code.includes("data:text/javascript;charset=utf-8,")) {
          this.error("Vite's English worker wrapper changed; refusing to package its large data-URL fallback.");
        }
        return null;
      }

      const [, errorName] = match;
      const blobOnlyFailure = `catch (${errorName}) {
        if (objURL) {
          try { (self.URL || self.webkitURL).revokeObjectURL(objURL); } catch {}
        }
        const workerError = new Error("Inline English agreement Worker requires Blob URL support.");
        workerError.cause = ${errorName};
        throw workerError;
      }`;

      return { code: code.replace(DATA_FALLBACK, blobOnlyFailure), map: null };
    }
  };
}
