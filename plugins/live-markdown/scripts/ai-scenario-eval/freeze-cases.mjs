import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { literalCases } from "./literal-cases.mjs";
import { boundaryCases } from "./boundary-cases.mjs";
import { generationCases } from "./generation-cases.mjs";
import { executionSafetyCases } from "./execution-safety.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const destination = path.join(pluginRoot, ".cache/acceptance/ai-scenarios/v1/case-manifest.json");

function safeBoundary(source, offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset > source.length) return false;
  if (offset > 0 && offset < source.length) {
    const before = source.charCodeAt(offset - 1);
    const after = source.charCodeAt(offset);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) return false;
    if (source[offset - 1] === "\r" && source[offset] === "\n") return false;
  }
  return true;
}

export function buildCaseManifest() {
  const realCases = [...literalCases, ...boundaryCases, ...generationCases];
  const all = [...realCases, ...executionSafetyCases];
  if (all.length !== 96 || realCases.length !== 80) throw new Error("Expected 80 real tasks and 16 controlled fault cases.");
  if (new Set(all.map((item) => item.id)).size !== all.length) throw new Error("Duplicate case IDs.");
  for (const item of realCases) {
    if (!item.source && item.source !== "") throw new Error(`${item.id}: missing concrete source`);
    if (!item.instruction?.trim() || !item.expected?.intent || !item.expected?.calls) throw new Error(`${item.id}: missing instruction/oracle/calls`);
    for (const range of [item.selection, item.expected.patch]) {
      if (!range) continue;
      if (!safeBoundary(item.source, range.from) || !safeBoundary(item.source, range.to) || range.from > range.to) throw new Error(`${item.id}: unsafe fixture range`);
      if (range.expectedText !== undefined && range.expectedText !== item.source.slice(range.from, range.to)) throw new Error(`${item.id}: expectedText mismatch`);
    }
    if (item.cursor != null && !safeBoundary(item.source, item.cursor)) throw new Error(`${item.id}: unsafe cursor fixture`);
    const rubric = item.expected.quality;
    for (const pattern of [...(item.expected.rejectPatterns ?? []), ...(item.expected.noChangePatterns ?? []), ...(rubric?.requiredGroups ?? []).flat(), ...(rubric?.forbiddenPatterns ?? [])]) new RegExp(pattern, "iu");
    const heading = item.expected.intent.expectedHeading;
    if (heading && !new RegExp(`^ {0,3}#{1,6}[ \\t]+${heading.text}(?:\\r?\\n|$)`, "u").test(item.source.slice(heading.lineFrom))) throw new Error(`${item.id}: heading identity not grounded`);
    if (item.expected.effect === "reject" && !item.expected.rejectPatterns?.length) throw new Error(`${item.id}: rejection lacks diagnostic oracle`);
    if (item.expected.effect === "answer" && !rubric) throw new Error(`${item.id}: answer lacks content oracle`);
  }
  return {
    schemaVersion: 1, caseSetId: "live-markdown-multiscenario-v1", frozenAt: new Date().toISOString(),
    policy: {
      testOnly: true, productAndPromptTuning: false, retries: 0,
      modelProfile: "cached-light/Qwen3-0.6B-Q4_K_M.gguf", execution: "sequential",
      realTaskCount: realCases.length, controlledCaseCount: executionSafetyCases.length,
      independentScores: ["intent", "task", "safety", "quality", "callBudget"],
      capabilityLimitedCases: all.filter((item) => item.capabilityLimited).map((item) => item.id),
      timeoutMsPerCase: 90_000, productionDefaultDeadlineMs: 300_000,
      evidenceLimit: "No model repair retries; no native editor apply, visual rendering or Windows/Linux execution. Controlled E cases are not model accuracy."
    },
    realCases, controlledCases: executionSafetyCases
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some((argument) => argument !== "--check")) throw new Error("Only --check is supported.");
  const manifest = buildCaseManifest();
  if (!process.argv.includes("--check")) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  }
  console.log(JSON.stringify({ status: process.argv.includes("--check") ? "validated" : "cases-frozen", realCases: manifest.realCases.length, controlledCases: manifest.controlledCases.length }));
}
