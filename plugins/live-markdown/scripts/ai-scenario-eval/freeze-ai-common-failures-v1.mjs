import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = path.join(pluginRoot, ".cache/acceptance/ai-common-failures/v1");
const legacyRoot = path.join(pluginRoot, ".cache/acceptance/ai-scenarios/v1");
const b6Root = path.join(pluginRoot, ".cache/acceptance/ai-scenarios/v2-r4/snapshots/B6");
const v2ToolsRoot = path.join(pluginRoot, ".cache/acceptance/ai-scenarios/v2-r4");
const runtimePrepPath = path.join(pluginRoot, ".cache/acceptance/ai-model-comparison/v1/runtime-preparation.json");
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function ensureRegularFile(root, relative) {
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Path escaped root: ${relative}`);
  let current = absolute;
  while (current !== path.resolve(root)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlink path is not allowed: ${relative}`);
    current = path.dirname(current);
  }
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Expected regular file: ${relative}`);
  return absolute;
}

function walk(root, current = root, result = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Snapshot refuses symlink: ${path.relative(root, absolute)}`);
    if (entry.isDirectory()) walk(root, absolute, result);
    else if (entry.isFile()) result.push(path.relative(root, absolute).split(path.sep).join("/"));
    else throw new Error(`Snapshot refuses non-regular entry: ${path.relative(root, absolute)}`);
  }
  return result.sort();
}

function hashFiles(root, files) {
  return Object.fromEntries(files.map((relative) => {
    const bytes = fs.readFileSync(ensureRegularFile(root, relative));
    return [relative, { sha256: sha256(bytes), bytes: bytes.byteLength }];
  }));
}

function copyFiles(sourceRoot, destinationRoot, files) {
  for (const relative of files) {
    const source = ensureRegularFile(sourceRoot, relative);
    const destination = path.resolve(destinationRoot, relative);
    if (!destination.startsWith(`${path.resolve(destinationRoot)}${path.sep}`)) throw new Error(`Copy escaped destination: ${relative}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  }
}

function productPaths(root) {
  const paths = [];
  for (const dir of ["src", "preload"]) {
    const absolute = path.join(root, dir);
    if (!fs.lstatSync(absolute).isDirectory()) throw new Error(`Missing product directory: ${dir}`);
    paths.push(...walk(root, absolute));
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && (/^package(?:-[^.]+)?\.json$/u.test(entry.name) || entry.name === "plugin.json")) paths.push(entry.name);
    if (entry.isSymbolicLink() && (/^package(?:-[^.]+)?\.json$/u.test(entry.name) || entry.name === "plugin.json")) throw new Error(`Product metadata is a symlink: ${entry.name}`);
  }
  for (const required of ["package.json", "plugin.json"]) if (!paths.includes(required)) throw new Error(`Missing required product file: ${required}`);
  return [...new Set(paths)].sort();
}

function copySnapshot({ name, sourceRoot, outputRoot, caseManifestSha256, sourceManifest }) {
  const beforePaths = productPaths(sourceRoot);
  const before = hashFiles(sourceRoot, beforePaths);
  const target = path.join(outputRoot, "snapshots", name);
  fs.mkdirSync(target, { recursive: false });
  const source = path.join(target, "source");
  fs.mkdirSync(source, { recursive: false });
  copyFiles(sourceRoot, source, beforePaths);
  const afterPaths = productPaths(sourceRoot);
  const after = hashFiles(sourceRoot, afterPaths);
  if (JSON.stringify(beforePaths) !== JSON.stringify(afterPaths) || JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(`${name} source changed during snapshot capture; partial output is retained and must not be overwritten.`);
  }
  const copied = hashFiles(source, beforePaths);
  if (JSON.stringify(copied) !== JSON.stringify(before)) throw new Error(`${name} snapshot copy hashes differ from source.`);
  const manifest = {
    schemaVersion: 1,
    variant: name,
    capturedAt: new Date().toISOString(),
    caseManifestSha256,
    provenance: name === "B6" ? "existing-frozen-B6-product-snapshot" : "live-product-candidate-frozen-before-implementation",
    verificationMode: "snapshot-only-after-freeze",
    paths: beforePaths,
    files: before,
    sourceManifestSha256: sourceManifest ? sha256(sourceManifest) : null,
    stable: true
  };
  fs.writeFileSync(path.join(target, "source-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return { sourceRoot: path.relative(pluginRoot, source).split(path.sep).join("/"), manifestPath: path.relative(pluginRoot, path.join(target, "source-manifest.json")).split(path.sep).join("/"), manifestSha256: sha256(fs.readFileSync(path.join(target, "source-manifest.json"))), paths: beforePaths, files: before };
}

function holdoutCases() {
  const longSegments = Array.from({ length: 8 }, (_, index) => {
    const id = `H${String(index + 1).padStart(2, "0")}`;
    const body = "巡检人员已经核对输入、依赖和恢复路径，并保留了验收记录。每个结论都应能追溯到本段事实。".repeat(5);
    return { id, sourceText: `${id}：我们以经记录本段工作，${body}`, requiredCorrection: { from: "以经", to: "已经" }, requiredOrderIndex: index };
  });
  const crlfSource = [
    "---", "title: 海岬", "owner: 林澈", "---", "", "# 巡检记录 ✨", "",
    "我门以经完成 17 项复核。", "", "**核对路经**后再继续；命令 `pnpm run buid` 应保持原样。", "",
    '<span data-count="17">复核</span> [操作手册](https://docs.example.test/harbor) 与公式 $a^2+b^2=c^2$ 保持不变。', "",
    "注释见脚注[^h1]。", "", "[^h1]: 备份已保存。"
  ].join("\r\n");
  return {
    schemaVersion: 1,
    holdoutSetId: "ai-common-failures-holdout-v1",
    purpose: "Post-implementation generalization checks. Do not add these fixture terms to product rules.",
    cases: [
      {
        id: "H03-table-entity-unit-01", family: "table-relations", source: "# 套餐定价\n\n海岬公园的家庭票每人 128 元。松汀植物园的月卡每月 860 元。以上价格均为当前挂牌价。",
        instruction: "在文末生成 Markdown 表格，列为场馆、票种、价格和单位，只列出这两项。",
        expected: { operation: "append", artifact: "table", rows: [{ venue: "海岬公园", ticket: "家庭票", price: "128", unit: "元/人" }, { venue: "松汀植物园", ticket: "月卡", price: "860", unit: "元/月" }], rowOrder: "source", noAdditionalRows: true, eofOnly: true }
      },
      {
        id: "H08-proofread-crlf-inline-01", family: "proofread-preserve-markdown", source: crlfSource,
        instruction: "校对全文并改正错别字，保留 Markdown 与 HTML 结构、所有数字、链接、命令、公式和换行。",
        expected: { operation: "rewrite", lineEnding: "CRLF", corrections: [{ from: "我门", to: "我们" }, { from: "以经", to: "已经" }, { from: "路经", to: "路径" }], allOccurrences: true, protectedExact: ["---\r\ntitle: 海岬\r\nowner: 林澈\r\n---", "**核对路径**", "`pnpm run buid`", '<span data-count="17">复核</span>', "https://docs.example.test/harbor", "$a^2+b^2=c^2$", "[^h1]", "[^h1]: 备份已保存。"], noNewLineBreaks: true }
      },
      {
        id: "H08-proofread-lf-emoji-02", family: "proofread-preserve-markdown", source: "# 复核 🧭\n\n值班员发来 6 条记录。\n\n**复核路经**已确认；保留 `inline_code` 和 [目标](https://docs.example.test/waypoint)。\n\n代码样例：\n\n```txt\nKEEP-17\n```\n",
        instruction: "校对并改正正文错别字，保留标题、emoji、行序、行尾、代码、行内代码、链接文字和 URL。",
        expected: { operation: "rewrite", lineEnding: "LF", corrections: [{ from: "路经", to: "路径" }], allOccurrences: true, protectedExact: ["🧭", "`inline_code`", "[目标](https://docs.example.test/waypoint)", "```txt\nKEEP-17\n```"], utf16Offsets: true, noNewLineBreaks: true }
      },
      {
        id: "H11-long-duplicate-paragraph-slots-01", family: "long-document-proofread", source: longSegments.map(({ sourceText }) => sourceText).join("\n\n"),
        instruction: "润色全文并纠正错别字。保持 H01 到 H08 的段落标识和顺序、每段事实，不删减重复信息。",
        expected: { operation: "rewrite", segments: longSegments, allSegmentsMustChange: true, noSourceFactsRemoved: true, outputMode: "single-diff-after-all-batches", batchCount: "compute-from-frozen-source-and-frozen-planner-before-first-model-call-per-product-snapshot-and-record-immutable-plan-hash", noPartialProposalOnFailure: true }
      },
      {
        id: "H14-source-bound-no-brand-01", family: "grounded-technical-plan", source: "## 已确认条件\n\n项目代号为雾港。需要在离线环境整理 Markdown。设备可用内存为 6GB。文稿不得发送到外部。未指定模型品牌、设备型号或上线日期。主要风险是内存不足和输出失真。",
        instruction: "严格依据原文整理技术方案，包含目标、方案、风险；保留 6GB、离线和不外发约束。不要新增品牌、型号、负责人或日期。",
        expected: { operation: "append", artifact: "markdown", requiredHeadings: ["目标", "方案", "风险"], requiredFacts: ["雾港", "6GB", "离线", "不得发送到外部", "内存不足", "输出失真"], forbiddenNewFactClasses: ["brand", "model", "owner", "date"], sourceBoundOnly: true, eofOnly: true }
      },
      {
        id: "H16-continue-no-invented-date-01", family: "grounded-continuation", source: "## 当前进展\n\n团队已完成路径检查和副本恢复演练。下一步应核对依赖清单、安排双人复核并记录结果。发布窗口尚未确定。",
        instruction: "续写一段简短的后续行动建议，沿用原文事实；不要编造日期、金额或负责人。",
        expected: { operation: "append", artifact: "markdown", requiredFacts: ["核对依赖清单", "双人复核", "记录结果"], forbiddenNewFactClasses: ["date", "amount", "owner"], sourceBoundOnly: true, noInstructionEcho: true, eofOnly: true }
      },
      {
        id: "H04-mermaid-real-preview-01", family: "mermaid-rendering", source: "# 审批流程\n\n流程只有三步：受理、复核、归档。没有分支。",
        instruction: "在文末生成 Mermaid 流程图，准确表示受理、复核、归档三个顺序节点，不添加分支。",
        expected: { operation: "append", artifact: "mermaid", requiredLabels: ["受理", "复核", "归档"], edgeCount: 2, forbiddenBranches: true, previewEvidenceSeparate: true, parserAcceptanceAndHostRenderingRequired: true, rawRegexIsNotRenderingEvidence: true }
      }
    ]
  };
}

function qualityContract() {
  return {
    schemaVersion: 1,
    contractId: "ai-common-failures-quality-v1",
    dimensions: {
      legacyStrict: "Report the unchanged v2 strict-intent score separately; never use it as task completion.",
      exactPatchCompletion: "For each edit require a proposal, exact source.slice(from,to) binding, correct target/EOF and exact resolved output; answer-only requires a non-empty answer and no proposal.",
      positiveTaskCompletion: "A refusal, clarify, invalid-output block, or missing proposal is not a successful requested edit. Safe rejection is reported only in the safety dimension.",
      g03Table: "Require an actual GFM Table AST node; exact named rows and value-unit-entity associations from source; no row swaps, extra facts, source echo, or misplaced insertion.",
      g06Code: "Require one correct Python fenced-code AST node and add(a,b) returning a+b; record raw and decoded candidate. Syntax/semantics are separately checked; the editor does not execute generated code.",
      g08Proofread: "Every frozen typo occurrence must be corrected. Compare all protected Markdown/HTML nodes and facts byte-for-byte; any missing correction or structural/factual drift fails content completion.",
      g11LongEdit: "Every frozen paragraph/slot receives meaningful correction, every fact and order survives, and one proposal is created only after every batch succeeds. Freeze each snapshot's deterministic batch plan and hash before the first inference call; count may differ by snapshot and is not gated by old 8-16 calls.",
      g14SourceBound: "Check each required section and constraint; source-outside brands, models, owners, dates and other claims fail factual quality unless explicitly allowed as suggestions and labeled as such.",
      g16GroundedContinuation: "Require useful continuation based on authorized facts; new dates, amounts, owners, or instruction-echo text fail when absent from source or explicitly prohibited.",
      g04Preview: "Score model-produced Mermaid text/relations separately from actual parser acceptance and native editor preview. A regex/subset rubric or SVG presence alone is not rendering evidence.",
      astScope: "AST checks prove only configured structural/range invariants, not arbitrary semantic truth or attribution; quality and source-fact checks remain separate."
    },
    immutableRules: ["no retries", "no automatic scope shrink", "one final Diff/writeback/undo on full success", "no partial proposal on any failed/cancelled/stale batch", "never convert refusal into positive completion"]
  };
}

function evaluationConfig(runtimePrep) {
  const profiles = runtimePrep.profiles.map((profile) => ({
    id: profile.profileId,
    modelId: profile.modelId,
    modelSha256: profile.modelSha256,
    modelBytes: profile.modelBytes,
    runtimeId: profile.runtimeId,
    backend: "metal",
    contextTokens: 4096,
    retries: 0,
    deploymentAllowed: false,
    cacheIntegrityVerifiedAtFreeze: profile.cachedIntegrityVerified
  }));
  return {
    schemaVersion: 1,
    evaluationId: "ai-common-failures-v1",
    sourceVariants: ["B6", "current"],
    profiles,
    rounds: 2,
    schedule: [
      [{ profile: "light", variant: "B6" }, { profile: "balanced", variant: "current" }, { profile: "light", variant: "current" }, { profile: "balanced", variant: "B6" }],
      [{ profile: "balanced", variant: "B6" }, { profile: "light", variant: "current" }, { profile: "balanced", variant: "current" }, { profile: "light", variant: "B6" }]
    ],
    runtime: { provider: "local", activeRoleId: "general", retries: 0, deploymentAllowed: false, downloadsAllowed: false, sequentialRequests: true, editorWriteback: false },
    limits: { maxCallsPerCase: 64, perCaseRunnerDeadlineMs: 90000, perCaseHarnessDeadlineMs: 90000, totalTaskDeadlineMs: 300000, sourceMaxBytes: 1048576, maxChunks: 50 },
    runPolicy: "Use cached verified profiles only; no model downloads, no single-case retries, no default model changes. Run each profile/variant pair exactly twice in the explicit interleaved schedule. Store run output in this evaluation directory only."
  };
}

function writeJson(relative, value) {
  const target = path.join(outputRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}

export function freezeAiCommonFailuresV1() {
  if (fs.existsSync(outputRoot)) throw new Error("ai-common-failures/v1 already exists; refusing to overwrite frozen inputs or records.");
  const caseBytes = fs.readFileSync(path.join(legacyRoot, "case-manifest.json"));
  const caseManifest = JSON.parse(caseBytes.toString("utf8"));
  const caseManifestSha256 = sha256(caseBytes);
  const v1SourceManifest = JSON.parse(fs.readFileSync(path.join(legacyRoot, "source-manifest.json"), "utf8"));
  if (caseManifest.schemaVersion !== 1 || caseManifest.realCases?.length !== 80 || caseManifest.controlledCases?.length !== 16 || v1SourceManifest.caseManifestSha256 !== caseManifestSha256) {
    throw new Error("Expected the original immutable v1 80+16 case set with matching source provenance.");
  }
  const b6ManifestBytes = fs.readFileSync(path.join(b6Root, "source-manifest.json"));
  const b6Manifest = JSON.parse(b6ManifestBytes.toString("utf8"));
  if (b6Manifest.capture?.name !== "B6" || b6Manifest.capture?.stability?.stable !== true || b6Manifest.caseManifestSha256 !== caseManifestSha256) {
    throw new Error("Frozen B6 snapshot does not match the original frozen case set.");
  }
  const runtimePrepBytes = fs.readFileSync(runtimePrepPath);
  const runtimePrep = JSON.parse(runtimePrepBytes.toString("utf8"));
  if (runtimePrep.status !== "configured-from-verified-cache" || runtimePrep.profiles?.length !== 2 || runtimePrep.downloadBytes !== 0 || runtimePrep.profiles.some((profile) => !profile.cachedIntegrityVerified)) {
    throw new Error("Expected two previously verified cached model profiles with no downloads.");
  }
  for (const profile of runtimePrep.profiles) if (!fs.existsSync(path.join(pluginRoot, profile.path))) throw new Error(`Cached runtime is missing for ${profile.profileId}.`);

  fs.mkdirSync(path.dirname(outputRoot), { recursive: true });
  fs.mkdirSync(outputRoot, { recursive: false });
  fs.writeFileSync(path.join(outputRoot, "legacy-cases.json"), caseBytes, { flag: "wx" });
  fs.writeFileSync(path.join(outputRoot, "legacy-source-manifest.json"), fs.readFileSync(path.join(legacyRoot, "source-manifest.json")), { flag: "wx" });
  fs.mkdirSync(path.join(outputRoot, "snapshots"), { recursive: false });
  const b6Snapshot = copySnapshot({ name: "B6", sourceRoot: path.join(b6Root, "source"), outputRoot, caseManifestSha256, sourceManifest: b6ManifestBytes });
  const currentSnapshot = copySnapshot({ name: "current", sourceRoot: pluginRoot, outputRoot, caseManifestSha256 });
  const holdouts = holdoutCases();
  const casesById = new Set(caseManifest.realCases.map(({ id }) => id));
  for (const item of holdouts.cases) if (casesById.has(item.id)) throw new Error(`Holdout ID collides with legacy case: ${item.id}`);
  const config = evaluationConfig(runtimePrep);
  writeJson("holdout-cases.json", holdouts);
  writeJson("quality-contract.json", qualityContract());
  writeJson("config.json", config);

  const docPaths = ["docs/ai-common-failures-technical-plan.md", "docs/ai-model-comparison.md", ".cache/acceptance/ai-model-comparison/v1/independent-review.md", ".cache/acceptance/ai-model-comparison/v1/independent-review.json"];
  const files = walk(outputRoot).filter((relative) => relative !== "freeze-manifest.json");
  const fileHashes = hashFiles(outputRoot, files);
  const provenance = Object.fromEntries(docPaths.map((relative) => [relative, { sha256: sha256(fs.readFileSync(ensureRegularFile(pluginRoot, relative))), bytes: fs.statSync(path.join(pluginRoot, relative)).size }]));
  const v2ToolManifestBytes = fs.readFileSync(path.join(v2ToolsRoot, "tool-manifest.json"));
  const manifest = {
    schemaVersion: 1,
    evaluationId: config.evaluationId,
    frozenAt: new Date().toISOString(),
    sourceEvidence: {
      originalCaseSetId: caseManifest.caseSetId,
      originalCaseManifestSha256: caseManifestSha256,
      originalSourceManifestSha256: sha256(fs.readFileSync(path.join(legacyRoot, "source-manifest.json"))),
      B6SnapshotManifestSha256: sha256(b6ManifestBytes),
      v2ToolManifestSha256: sha256(v2ToolManifestBytes),
      priorRuntimePreparationSha256: sha256(runtimePrepBytes),
      documents: provenance
    },
    snapshots: { B6: b6Snapshot, current: currentSnapshot },
    caseCounts: { legacyReal: caseManifest.realCases.length, legacyControlled: caseManifest.controlledCases.length, holdout: holdouts.cases.length },
    files: fileHashes,
    freezeRules: ["old model-comparison four-round records are read-only and excluded from this output tree", "no product inference has run", "current source snapshot is captured before implementation work", "G11 batch plan is computed and frozen per product snapshot before the first model call"]
  };
  const manifestPath = path.join(outputRoot, "freeze-manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return { outputRoot: path.relative(pluginRoot, outputRoot).split(path.sep).join("/"), manifestPath: path.relative(pluginRoot, manifestPath).split(path.sep).join("/"), manifestSha256: sha256(fs.readFileSync(manifestPath)), caseManifestSha256, holdoutSetId: holdouts.holdoutSetId, holdoutCount: holdouts.cases.length, snapshots: { B6: b6Snapshot.manifestSha256, current: currentSnapshot.manifestSha256 } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error("Usage: node scripts/ai-scenario-eval/freeze-ai-common-failures-v1.mjs");
    console.log(JSON.stringify(freezeAiCommonFailuresV1(), null, 2));
  } catch (error) {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  }
}
