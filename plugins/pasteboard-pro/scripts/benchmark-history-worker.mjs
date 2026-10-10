import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
// Run the current service source and the real packaged Node worker.
const source = await readFile(path.join(root, "apps/ztools/preload/history-search.ts"), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { HistorySearchService } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const documents = Array.from({ length: 100_000 }, (_, i) => ({
  _id: `pasteboard-pro:record:fp-${i}`, type: "pasteboard-pro-record",
  record: { origin: { host: "sync", remoteAvailable: true }, item: {
    id: `item-${i}`, kind: i % 10 === 0 ? "html" : "text", title: `Record ${i}`,
    sourceDeviceId: "test", sourceApp: { name: "Safari", bundleId: "com.apple.Safari" },
    copiedAt: new Date(1_800_000_000_000 - i).toISOString(), updatedAt: new Date(1_800_000_000_000 - i).toISOString(),
    contentFingerprint: `fp-${i}`, payload: { revision: String(i),
      text: i === 99_999 ? "x".repeat(16_384) + " 中文尾部命中" : `Clipboard content ${i}`,
      ...(i % 100 === 0 ? { html: `<p>${"long html paragraph ".repeat(800)}末尾</p>` } : {}),
    }, ...(i % 20 === 0 ? { ocrText: `Invoice ${i}` } : {}), pinned: false, fieldClocks: {},
  } },
}));
const stats = { fullReads: 0, changedReads: 0 };
const service = new HistorySearchService(path.join(root, "apps/ztools/dist/history-worker.cjs"), {
  all: async () => { stats.fullReads++; return documents; },
  changed: async ids => { stats.changedReads += ids.length; return ids.flatMap(id => documents.find(doc => doc._id === id) ?? []); },
});
const started = performance.now();
try {
  const first = await service.page({});
  const coldMs = performance.now() - started;
  assert.equal(first.items.length, 50);
  assert.equal(first.total, 100_000);
  const heartbeatGaps = [];
  let lastBeat = performance.now();
  const timer = setInterval(() => { const now = performance.now(); heartbeatGaps.push(now - lastBeat); lastBeat = now; }, 10);
  const queries = [];
  try {
    for (const query of ["中文尾部命中", "Clipboard", "type:html app:Safari", "Invoice", "末尾"]) {
      const durations = [];
      let matches = 0;
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        const result = await service.page({ query });
        durations.push(performance.now() - start);
        matches = result.total;
        assert.ok(result.items.length <= 50);
        if (query === "中文尾部命中") assert.equal(result.items[0].id, "item-99999");
      }
      durations.sort((a, b) => a - b);
      queries.push({ query, matches, p95Ms: durations[18], medianMs: durations[10] });
    }
  } finally { clearInterval(timer); }
  const before = await service.page({});
  documents[99_999].record.item.payload.text = "incremental-needle";
  service.invalidate([documents[99_999]._id]);
  const after = await service.page({ query: "incremental-needle" });
  assert.equal(after.total, 1);
  assert.equal(stats.fullReads, 1);
  assert.equal(stats.changedReads, 1);
  assert.equal((await service.page({ cursor: before.nextCursor })).reset, true);
  const report = {
    generatedAt: new Date().toISOString(), node: process.version,
    data: "100000 synthetic records including HTML, OCR and long-text tail matches",
    scope: "packaged Node worker and current service; excludes ZTools database IPC and native window rendering",
    coldMs, queries, maximumHeartbeatGapMs: Math.max(...heartbeatGaps), ...stats,
  };
  const output = path.join(root, "artifacts/search-capacity-20260908/worker-performance.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  assert.ok(queries.every(query => query.p95Ms < 250), "worker P95 exceeds 250 ms");
  assert.ok(report.maximumHeartbeatGapMs < 150, "search blocks the caller's event loop");
} finally { service.dispose(); }
