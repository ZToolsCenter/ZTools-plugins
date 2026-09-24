import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import process from "node:process";

import { searchPasteItems } from "../packages/core/dist/src/query.js";

const NOW = "2026-07-17T00:00:00.000Z";
const WARMUP_RUNS = 3;
const MEASURED_RUNS = 40;
const REPORT_URL = new URL(
  "../artifacts/pasteboardpro/search-performance.json",
  import.meta.url,
);

const benchmarkCases = [
  {
    itemCount: 10_000,
    thresholdMs: 50,
    queries: [
      "needle-token",
      "type:image app:Safari",
      "invoice type:text",
      "date:week Safari",
    ],
  },
  {
    itemCount: 100_000,
    thresholdMs: 150,
    queries: [
      "needle-token",
      "type:image app:Safari",
      "invoice type:text",
      "date:week Safari",
    ],
  },
];

const results = [];

for (const benchmarkCase of benchmarkCases) {
  const items = createItems(benchmarkCase.itemCount);
  const queryResults = benchmarkCase.queries.map((query) =>
    benchmarkQuery(items, query),
  );
  const p95Ms = Math.max(...queryResults.map((result) => result.p95Ms));

  results.push({
    itemCount: benchmarkCase.itemCount,
    thresholdMs: benchmarkCase.thresholdMs,
    p95Ms,
    pass: p95Ms <= benchmarkCase.thresholdMs,
    queries: queryResults,
  });
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  runtime: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  },
  methodology: {
    clock: "performance.now",
    data: "deterministic synthetic PasteItem records",
    warmupRuns: WARMUP_RUNS,
    measuredRuns: MEASURED_RUNS,
    percentile: 95,
    aggregation: "slowest query P95 per item-count gate",
  },
  pass: results.every((result) => result.pass),
  results,
};

await mkdir(new URL("./", REPORT_URL), { recursive: true });
await writeFile(REPORT_URL, `${JSON.stringify(report, null, 2)}\n`, "utf8");

for (const result of results) {
  console.log(
    `${result.itemCount.toLocaleString("en-US")} items: P95 ${result.p95Ms.toFixed(2)} ms / ${result.thresholdMs} ms (${result.pass ? "PASS" : "FAIL"})`,
  );
  for (const query of result.queries) {
    console.log(
      `  ${JSON.stringify(query.query)}: P95 ${query.p95Ms.toFixed(2)} ms, median ${query.medianMs.toFixed(2)} ms, ${query.matchCount} matches`,
    );
  }
}
console.log(`Report: ${REPORT_URL.pathname}`);

if (!report.pass) {
  process.exitCode = 1;
}

function benchmarkQuery(items, query) {
  for (let run = 0; run < WARMUP_RUNS; run += 1) {
    searchPasteItems(items, query, { now: NOW });
  }

  const durations = [];
  let matchCount = 0;

  for (let run = 0; run < MEASURED_RUNS; run += 1) {
    const startedAt = performance.now();
    const matches = searchPasteItems(items, query, { now: NOW });
    durations.push(performance.now() - startedAt);
    matchCount = matches.length;
  }

  durations.sort((left, right) => left - right);

  return {
    query,
    matchCount,
    medianMs: round(durations[Math.floor(durations.length / 2)]),
    p95Ms: round(percentile(durations, 95)),
    minMs: round(durations[0]),
    maxMs: round(durations.at(-1)),
  };
}

function percentile(sortedValues, percentileValue) {
  const index = Math.ceil((percentileValue / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, index)];
}

function round(value) {
  return Number(value.toFixed(3));
}

function createItems(itemCount) {
  const kinds = [
    "text",
    "rich_text",
    "html",
    "url",
    "image",
    "pdf",
    "color",
    "files",
  ];
  const apps = [
    { bundleId: "com.apple.Safari", name: "Safari" },
    { bundleId: "com.microsoft.VSCode", name: "Visual Studio Code" },
    { bundleId: "com.apple.Notes", name: "Notes" },
    { bundleId: "com.tinyspeck.slackmacgap", name: "Slack" },
  ];
  const baseTimestamp = Date.parse(NOW);

  return Array.from({ length: itemCount }, (_, index) => {
    const timestamp = new Date(baseTimestamp - index * 1_000).toISOString();
    const kind = kinds[index % kinds.length];

    return {
      id: `benchmark-item-${index}`,
      kind,
      title: `Project alpha clip ${index}`,
      sourceApp: apps[index % apps.length],
      sourceDeviceId: `device-${index % 3}`,
      copiedAt: timestamp,
      updatedAt: timestamp,
      contentFingerprint: `fingerprint-${index}`,
      payload: {
        revision: `revision-${index}`,
        text: `Pasteboard benchmark content ${index}${index % 997 === 0 ? " needle-token" : ""}`,
        mediaType: kind === "image" ? "image/png" : "text/plain",
        filePaths:
          kind === "files" ? [`/tmp/benchmark-file-${index}.txt`] : undefined,
      },
      ocrText:
        index % 251 === 0 ? "invoice total needle-ocr" : undefined,
      pinboardId: index % 17 === 0 ? "work" : undefined,
      pinboardOrderKey: index % 17 === 0 ? `${index}` : undefined,
      pinned: index % 17 === 0,
      fieldClocks: {},
    };
  });
}
