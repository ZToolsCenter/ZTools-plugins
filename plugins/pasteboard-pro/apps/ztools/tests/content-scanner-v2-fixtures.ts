import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { createBoundedContentScannerV2 } from "../preload/content-scanner-v2";
import type { ContentKindV2, ContentPolicyScanRequestV2 } from "@pasteboard-pro/core";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
let built: Promise<string> | undefined;
let serial = 0;
export function workerBundle() {
  return built ??= (async () => {
    const base = path.join(projectRoot, "artifacts/pasteboardpro/clipboard-format-g0");
    await mkdir(base, { recursive: true });
    const dir = await mkdtemp(path.join(base, "v015-worker-"));
    await build({ configFile: false, logLevel: "silent", build: {
      target: "node18", outDir: dir, emptyOutDir: true,
      lib: { entry: path.join(projectRoot, "apps/ztools/preload/content-scan-worker.ts"), formats: ["cjs"], fileName: () => "scanner.cjs" },
      rollupOptions: { external: [/^node:/] },
    } });
    return path.join(dir, "scanner.cjs");
  })();
}

export async function fixtureWorker(source: string) {
  const dir = path.dirname(await workerBundle());
  const filename = path.join(dir, `fixture-${serial++}.cjs`);
  await writeFile(filename, 'const {parentPort,workerData}=require("node:worker_threads");\n' + source);
  return filename;
}

export function codec(key = "rep", kind: ContentKindV2 = "text") {
  return { representationKey: key, contentKind: kind,
    ...(kind === "text" || kind === "url" ? { encoding: "utf-8" as const, termination: "none" as const } : {}) };
}
export function request(text = "hello", kind: ContentKindV2 = "text", key = "rep"): ContentPolicyScanRequestV2 {
  return { policyRevision: "policy-1", representationKey: key, itemIndex: 0, contentKind: kind,
    requiredScopes: kind === "text" ? ["text"] : kind === "url" || kind === "rich-text" ? ["text", "links"] : ["ocr", "image-metadata"],
    bytes: new TextEncoder().encode(text) };
}
export async function scanner(options: Partial<Parameters<typeof createBoundedContentScannerV2>[0]> = {}) {
  return createBoundedContentScannerV2({ workerPath: await workerBundle(),
    policy: { revision: "policy-1", blockLikelySecrets: true, contentRules: [] }, codecs: [codec()], ...options });
}
export const goodReply = `const reply={schemaVersion:1,requestId:workerData.requestId,policyRevision:workerData.request.policyRevision,representationKey:workerData.request.representationKey,checks:workerData.request.requiredScopes.map(scope=>({scope,status:"passed"}))};`;
