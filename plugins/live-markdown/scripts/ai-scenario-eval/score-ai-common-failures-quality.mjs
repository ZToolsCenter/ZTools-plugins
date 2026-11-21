// Adds independent, evidence-bounded quality checks beside the unchanged legacy oracle.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { GFM, parser } from "@lezer/markdown";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const reviewRoot = path.join(pluginRoot, ".cache/acceptance/ai-common-failures/v1/independent-reviews");
const mdParser = parser.configure(GFM);
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function count(text, value) { return value ? text.split(value).length - 1 : 0; }

function recordSource(record) {
  return record.snapshot?.content ?? record.expected?.patch?.expectedText ?? "";
}

function recordPatch(record) {
  const proposal = record.result?.proposal;
  const patch = record.resolvedEdit ?? proposal?.patch ?? record.proposal?.patch ?? null;
  if (!patch || !Number.isSafeInteger(patch.from) || !Number.isSafeInteger(patch.to) || typeof patch.insertText !== "string") return null;
  return patch;
}

function candidateFor(record) {
  const source = recordSource(record);
  const patch = recordPatch(record);
  if (patch && patch.from >= 0 && patch.to >= patch.from && patch.to <= source.length && source.slice(patch.from, patch.to) === patch.expectedText) {
    const reconstructed = source.slice(0, patch.from) + patch.insertText + source.slice(patch.to);
    if (typeof record.resolvedEdit?.content === "string" && record.resolvedEdit.content !== reconstructed) return { text: null, reason: "resolved-content-does-not-match-patch" };
    return { text: reconstructed, patch, reason: null };
  }
  if (typeof record.resolvedEdit?.content === "string") return { text: record.resolvedEdit.content, patch, reason: "patch-evidence-unavailable" };
  return { text: null, patch, reason: record.error?.message ?? "no-complete-proposal" };
}

function intentAlignment(record) {
  const expected = record.expected?.intent ?? record.expected?.plan?.intent ?? null;
  const actual = record.result?.resolvedIntent ?? record.plannerIntent ?? record.rawParsedIntent ?? null;
  if (!expected || !actual) return { status: "unavailable", planningMode: record.result?.planningMode ?? record.planningMode ?? null };
  const issues = [];
  for (const field of ["kind", "operation", "target"]) {
    if (expected[field] !== undefined && actual[field] !== expected[field]) issues.push(`${field}: expected ${expected[field]}, got ${actual[field]}`);
  }
  const expectedMode = expected.mode ?? expected.content?.mode;
  if (expectedMode !== undefined && actual.content?.mode !== expectedMode) issues.push(`content.mode: expected ${expectedMode}, got ${actual.content?.mode ?? "missing"}`);
  const expectedTask = expected.task ?? expected.content?.task;
  if (expectedTask !== undefined && actual.content?.task !== expectedTask && !(expected.taskAnyOf ?? []).includes(actual.content?.task)) issues.push(`content.task: expected ${expectedTask}, got ${actual.content?.task ?? "missing"}`);
  return { status: issues.length ? "mismatch" : "aligned", planningMode: record.result?.planningMode ?? record.planningMode ?? (record.calls?.some(({ phase }) => phase === "planning") ? "model" : "unknown"), issues, intent: actual };
}

function completionEvidence(record, candidate) {
  const patch = candidate.patch;
  const hasProposal = Boolean(record.result?.proposal && patch && candidate.text !== null);
  const intent = intentAlignment(record);
  const source = recordSource(record);
  const qualityExpectation = record.qualityExpectation ?? record.expected?.qualityExpectation ?? null;
  let expectedRange = record.expected?.patch ?? null;
  if (!expectedRange && qualityExpectation?.operation === "append") expectedRange = { from: source.length, to: source.length, expectedText: "" };
  if (!expectedRange && qualityExpectation?.operation === "rewrite") expectedRange = { from: 0, to: source.length, expectedText: source };
  const rangeMatches = expectedRange ? Boolean(patch && patch.from === expectedRange.from && patch.to === expectedRange.to && patch.expectedText === expectedRange.expectedText) : null;
  const rangeStatus = rangeMatches === false ? "mismatch" : rangeMatches === true ? "aligned" : "not-frozen";
  const sourceHashMatches = record.sourceSha256 ? record.sourceSha256 === sha256(source) : null;
  const allEvidenceAligned = hasProposal && intent.status === "aligned" && rangeStatus !== "mismatch" && sourceHashMatches !== false;
  return {
    status: allEvidenceAligned ? "complete" : hasProposal ? "proposal-with-contract-gap" : "not-completed",
    hasCompleteProposal: hasProposal,
    intent,
    expectedRange: expectedRange ? { ...expectedRange, status: rangeStatus } : { status: "not-frozen" },
    patch: patch ? { from: patch.from, to: patch.to, insertBytes: Buffer.byteLength(patch.insertText), exactExpectedText: source.slice(patch.from, patch.to) === patch.expectedText } : null,
    sourceHashMatches
  };
}

function tableRows(markdown) {
  const tree = mdParser.parse(markdown);
  const tables = [];
  const headers = [];
  const rows = [];
  const cursor = tree.cursor();
  do {
    const entry = { from: cursor.from, to: cursor.to };
    if (cursor.name === "Table") tables.push(entry);
    else if (cursor.name === "TableHeader") headers.push(entry);
    else if (cursor.name === "TableRow") rows.push(entry);
  } while (cursor.next());
  const readCells = ({ from, to }) => {
    const cells = [];
    const scan = tree.cursor();
    do {
      if (scan.name === "TableCell" && scan.from >= from && scan.to <= to) cells.push(markdown.slice(scan.from, scan.to).trim().replaceAll("\\|", "|"));
    } while (scan.next());
    return cells;
  };
  return { tableCount: tables.length, headers: headers.map(readCells), rows: rows.map(readCells) };
}

function tableColumnIndex(header, label) {
  return header.findIndex((value) => value.replace(/[*`_]/gu, "").includes(label));
}

function semanticUnitMatches(value, unit) {
  const compact = value.replace(/[\s*`_]/gu, "");
  if (unit === "元/人") return /(?:每人|元\/(?:每)?人|元每人|每人\d+(?:\.\d+)?元|按人)/u.test(compact);
  if (unit === "元/月") return /(?:每月|元\/(?:每)?月|元每月|每月\d+(?:\.\d+)?元|按月)/u.test(compact);
  return compact.includes(unit.replaceAll(" ", ""));
}

export function scoreTableRelations(record, expectations) {
  const candidate = candidateFor(record);
  if (!candidate.text) return { status: "not_completed", reason: candidate.reason };
  const generated = candidate.patch?.insertText ?? record.result?.text ?? candidate.text;
  const parsed = tableRows(generated);
  const expectedHeadings = expectations.headings ?? ["场馆", "票种", "价格", "单位"];
  const expectedRows = expectations.rows ?? [];
  const header = parsed.headers[0] ?? [];
  const columns = Object.fromEntries(expectedHeadings.map((name) => [name, tableColumnIndex(header, name)]));
  const problems = [];
  if (parsed.tableCount !== 1) problems.push(`expected one GFM Table AST node, got ${parsed.tableCount}`);
  if (expectedHeadings.some((name) => columns[name] < 0)) problems.push("required table column is missing");
  if (parsed.rows.length !== expectedRows.length) problems.push(`expected ${expectedRows.length} rows, got ${parsed.rows.length}`);
  for (let index = 0; index < expectedRows.length; index += 1) {
    const expected = expectedRows[index];
    const row = parsed.rows[index] ?? [];
    const venue = row[columns[expectedHeadings[0]]] ?? "";
    const ticket = row[columns[expectedHeadings[1]]] ?? "";
    const price = row[columns[expectedHeadings[2]]] ?? "";
    const unit = row[columns[expectedHeadings[3]]] ?? "";
    if (!venue.includes(expected.venue)) problems.push(`row ${index + 1}: venue does not match ${expected.venue}`);
    if (expected.ticket && !ticket.includes(expected.ticket)) problems.push(`row ${index + 1}: ticket does not match ${expected.ticket}`);
    if (!new RegExp(`(?:^|\\D)${expected.price}(?:\\D|$)`, "u").test(price)) problems.push(`row ${index + 1}: price does not match ${expected.price}`);
    if (!semanticUnitMatches(unit || price, expected.unit)) problems.push(`row ${index + 1}: unit does not match ${expected.unit}`);
  }
  const source = recordSource(record);
  if (!candidate.patch || candidate.patch.from !== source.length || candidate.patch.to !== source.length) problems.push("proposal is not an exact EOF append");
  return { status: problems.length ? "failed" : "passed", ast: "@lezer/markdown GFM Table node", tableCount: parsed.tableCount, header, rows: parsed.rows, columns, problems };
}

function lineBreakSequence(text) { return text.match(/\r\n|\r|\n/gu) ?? []; }

export function scoreProofread(record, corrections, protectedText = []) {
  const candidate = candidateFor(record);
  if (!candidate.text) return { status: "not_completed", reason: candidate.reason };
  const source = recordSource(record);
  const expectedPatch = candidate.patch;
  const problems = [];
  for (const { from, to } of corrections) {
    const occurrences = count(source, from);
    const fixed = count(candidate.text, to) - count(source, to);
    if (count(candidate.text, from) !== 0) problems.push(`unfixed occurrence of ${from}`);
    if (fixed < occurrences) problems.push(`corrected ${Math.max(0, fixed)} of ${occurrences} ${from} occurrences`);
  }
  const protectedMissing = protectedText.filter((value) => value && !candidate.text.includes(value));
  if (protectedMissing.length) problems.push(`protected text changed or missing: ${protectedMissing.join(", ")}`);
  if (JSON.stringify(lineBreakSequence(source)) !== JSON.stringify(lineBreakSequence(candidate.text))) problems.push("line ending sequence or line count changed");
  if (!expectedPatch || expectedPatch.from !== 0 || expectedPatch.to !== source.length || expectedPatch.expectedText !== source) problems.push("proposal did not rewrite the exact original document range");
  return { status: problems.length ? "failed" : "passed", corrections: corrections.map(({ from, to }) => ({ from, to, sourceOccurrences: count(source, from), remaining: count(candidate.text, from), addedCorrected: count(candidate.text, to) - count(source, to) })), protectedChecked: protectedText.length, lineEndingPreserved: problems.every((problem) => !problem.startsWith("line ending")), problems };
}

function labeledSegment(text, id, prefix) {
  const marker = `${id}：`;
  const from = text.indexOf(marker);
  if (from < 0) return null;
  const next = new RegExp(`\\n\\n${prefix}\\d{2}：`, "gu");
  next.lastIndex = from + marker.length;
  const match = next.exec(text);
  return text.slice(from, match?.index ?? text.length);
}

export function scoreLongDocument(record, preplanEvidence = null) {
  const candidate = candidateFor(record);
  if (!candidate.text) return { status: "not_completed", reason: candidate.reason, batchEvidence: preplanEvidence ? { batchCount: preplanEvidence.batchCount, planSha256: preplanEvidence.sha256 } : null };
  const quality = record.qualityExpectation ?? record.expected?.qualityExpectation ?? null;
  const segments = quality?.segments ?? Array.from({ length: 8 }, (_, index) => ({ id: `C${String(index + 1).padStart(2, "0")}`, requiredCorrection: { from: "以经", to: "已经" } }));
  const prefix = segments[0]?.id?.[0] ?? "C";
  const source = recordSource(record);
  const problems = [];
  const indices = [];
  for (const segment of segments) {
    const expectedText = segment.sourceText ?? labeledSegment(source, segment.id, prefix);
    const actualText = labeledSegment(candidate.text, segment.id, prefix);
    const correction = segment.requiredCorrection ?? { from: "以经", to: "已经" };
    if (!expectedText || !actualText) { problems.push(`missing segment ${segment.id}`); continue; }
    indices.push(candidate.text.indexOf(`${segment.id}：`));
    const sourceCount = count(expectedText, correction.from);
    if (count(actualText, correction.from) !== 0 || count(actualText, correction.to) < count(expectedText, correction.to) + sourceCount) problems.push(`not all ${correction.from} occurrences were corrected in ${segment.id}`);
    if (actualText.length < expectedText.length * 0.65) problems.push(`${segment.id} is unexpectedly shortened`);
  }
  for (const protectedText of record.expected?.quality?.requiredAll ?? []) {
    if (protectedText && !candidate.text.includes(protectedText)) problems.push("protected source node is missing or changed");
  }
  if (indices.some((value, index) => index > 0 && value <= indices[index - 1])) problems.push("segment order changed");
  const generationCalls = (record.calls ?? []).filter(({ phase }) => phase === "generation").length;
  const stats = record.result?.proseStats ?? record.proseStats ?? null;
  const planEvidence = preplanEvidence ?? record.prosePlanEvidence ?? null;
  if (!stats || !planEvidence) problems.push("pre-call prose plan or execution stats are missing");
  else {
    if (stats.batches !== planEvidence.batchCount || stats.modelCalls !== planEvidence.batchCount || generationCalls !== planEvidence.batchCount) problems.push("preplanned batch count, stats, and actual generation call count differ");
    if (stats.sourceHash !== planEvidence.sourceHash) problems.push("execution source hash differs from the pre-call prose plan");
    if (planEvidence.slotCount < segments.length || !/^[0-9a-f]{64}$/u.test(planEvidence.sha256 ?? "")) problems.push("plan hash or source-owned slot coverage evidence is incomplete");
  }
  return { status: problems.length ? "failed" : "passed", segmentCount: segments.length, correctedSegments: segments.filter((segment) => !problems.some((issue) => issue.includes(segment.id))).length, generationCalls, batchEvidence: planEvidence ? { batchCount: planEvidence.batchCount, slotCount: planEvidence.slotCount, sha256: planEvidence.sha256, stats: stats ? { batches: stats.batches, modelCalls: stats.modelCalls, sourceHash: stats.sourceHash } : null } : null, problems };
}

function extractFenced(text, language) {
  const blocks = [];
  const matcher = /(^|\r?\n)(`{3,}|~{3,})[ \t]*([a-z0-9_-]+)[^\S\r\n]*\r?\n([\s\S]*?)\r?\n\2[ \t]*(?=\r?\n|$)/gimu;
  let match;
  while ((match = matcher.exec(text))) blocks.push({ language: match[3].toLowerCase(), body: match[4], from: match.index + match[1].length, to: matcher.lastIndex });
  const selected = blocks.filter((block) => block.language === language.toLowerCase());
  if (selected.length !== 1) return null;
  const rest = `${text.slice(0, selected[0].from)}${text.slice(selected[0].to)}`;
  if (/(?:^|\r?\n)[ \t]*(?:`{3,}|~{3,})/u.test(rest)) return null;
  return selected[0].body;
}

export function validatePythonAdd(code) {
  if (typeof code !== "string") return { status: "not_assessed", reason: "No code candidate." };
  const parsed = spawnSync("python3", ["-c", "import ast,sys\nt=ast.parse(sys.stdin.read())\nf=[n for n in t.body if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef)) and n.name=='add']\nassert len(f)==1\na=f[0].args.args\nassert [x.arg for x in a]==['a','b']\nr=[n for n in f[0].body if isinstance(n,ast.Return)]\nassert len(r)==1 and isinstance(r[0].value,ast.BinOp) and isinstance(r[0].value.op,ast.Add)\nassert {r[0].value.left.id,r[0].value.right.id}=={'a','b'}\n"], { input: code, encoding: "utf8", timeout: 3000, maxBuffer: 64 * 1024 });
  if (parsed.error?.code === "ENOENT") return { status: "not_assessed", reason: "python3 static AST parser is unavailable." };
  if (parsed.error) return { status: "failed", reason: `Python static AST check failed: ${parsed.error.message}` };
  return parsed.status === 0 ? { status: "passed", parser: "python3 ast.parse + static add(a,b) AST assertions; generated code was not executed" } : { status: "failed", reason: (parsed.stderr || "Python syntax/function AST assertion failed.").trim() };
}

function scoreCode(record) {
  const candidate = candidateFor(record);
  if (!candidate.text) return { status: "not_completed", reason: candidate.reason };
  const generated = candidate.patch?.insertText ?? record.result?.text ?? candidate.text;
  const code = extractFenced(generated, "python");
  const problems = [];
  if (code === null) problems.push("no single complete python fenced block");
  const syntax = code === null ? { status: "not_assessed", reason: "Python fence missing." } : validatePythonAdd(code);
  if (syntax.status !== "passed") problems.push(syntax.reason ?? syntax.status);
  return { status: problems.length ? (syntax.status === "not_assessed" ? "manual_review" : "failed") : "passed", syntax, hasPythonFence: code !== null, problems };
}

function extractDates(text) { return [...text.matchAll(/\b(?:20\d{2})[-/.年](?:0?[1-9]|1[0-2])[-/.月](?:0?[1-9]|[12]\d|3[01])日?\b/gu)].map(([value]) => value); }
function extractAmounts(text) { return [...text.matchAll(/\d[\d,.]*\s?(?:万元|人民币|美元|US\$|GB|TB|人日|元|%)/giu)].map(([value]) => value.replaceAll(" ", "")); }

export function sourceBoundReview(record) {
  const candidate = candidateFor(record);
  if (!candidate.text) return { status: "not_completed", reason: candidate.reason };
  const source = recordSource(record);
  const addedDates = extractDates(candidate.text).filter((value, index, values) => values.slice(0, index).filter((item) => item === value).length >= extractDates(source).filter((item) => item === value).length);
  const addedAmounts = extractAmounts(candidate.text).filter((value, index, values) => values.slice(0, index).filter((item) => item === value).length >= extractAmounts(source).filter((item) => item === value).length);
  const extraBrandLikeTokens = [...new Set(candidate.text.match(/\b[A-Z][A-Za-z0-9.-]{2,}\b/gu) ?? [])].filter((value) => !source.includes(value) && !["Markdown", "Mermaid", "SQLite", "JavaScript", "TypeScript", "Python"].includes(value));
  return {
    status: "manual_review_required",
    automaticFindings: { addedDates, addedAmounts, extraBrandLikeTokens },
    note: "Lexical checks cannot prove attribution, relationship, owner identity, or usefulness. No source-bound content is marked quality-pass by this scanner."
  };
}

export function mermaidSyntax(record) {
  const candidate = candidateFor(record);
  if (!candidate.text) return { status: "not_completed", reason: candidate.reason, preview: "not_assessed" };
  const generated = candidate.patch?.insertText ?? record.result?.text ?? candidate.text;
  const body = extractFenced(generated, "mermaid");
  if (body === null) return { status: "failed", preview: "not_assessed", reason: "Missing complete mermaid fence." };
  const labels = record.qualityExpectation?.requiredLabels ?? record.expected?.quality?.requiredGroups?.map(([label]) => label) ?? [];
  const edgeCount = [...body.matchAll(/-->|---|==>|-\.->/gu)].length;
  const missingLabels = labels.filter((label) => !body.includes(label));
  const problems = [...missingLabels.map((value) => `missing label ${value}`)];
  const requiredEdges = record.qualityExpectation?.edgeCount ?? (record.id === "G04" ? 2 : null);
  if (requiredEdges !== null && edgeCount !== requiredEdges) problems.push(`expected ${requiredEdges} edges, got ${edgeCount}`);
  return { status: problems.length ? "failed" : "candidate-structure-only", preview: "not_assessed", parser: "bounded edge/label subset; not Mermaid parser or renderer", edgeCount, missingLabels, problems };
}

function callsEvidence(record) {
  const calls = record.calls ?? [];
  return { total: calls.length, planning: calls.filter(({ phase }) => phase === "planning").length, generation: calls.filter(({ phase }) => phase === "generation").length, phases: calls.map(({ phase, outputSchema }) => ({ phase, hasSchema: outputSchema !== null && outputSchema !== undefined })) };
}

function readPreplan(directory, record) {
  const evidence = record.prosePlanEvidence;
  if (!evidence?.path || !evidence.sha256) return null;
  const filePath = path.resolve(pluginRoot, evidence.path);
  if (!filePath.startsWith(`${directory}${path.sep}`) || !fs.existsSync(filePath)) return { status: "invalid", reason: "preplan path is missing or escaped run directory" };
  const bytes = fs.readFileSync(filePath);
  if (sha256(bytes) !== evidence.sha256) return { status: "invalid", reason: "preplan content hash mismatch" };
  const parsed = JSON.parse(bytes.toString("utf8"));
  return { ...evidence, contentHashValid: true, batchCount: parsed.batches?.length ?? 0, slotCount: parsed.sourceOwnedRanges?.length ?? 0 };
}

export function reviewRun(runDirectory) {
  const report = JSON.parse(fs.readFileSync(path.join(runDirectory, "run-report.json"), "utf8"));
  const selected = new Set(["G03", "G04", "G06", "G08", "G11", "G14", "G16", "H03-table-entity-unit-01", "H08-proofread-crlf-inline-01", "H08-proofread-lf-emoji-02", "H11-long-duplicate-paragraph-slots-01", "H14-source-bound-no-brand-01", "H16-continue-no-invented-date-01", "H04-mermaid-real-preview-01"]);
  const cases = [];
  for (const id of selected) {
    const filePath = path.join(runDirectory, "records", `${id}.json`);
    if (!fs.existsSync(filePath)) continue;
    const record = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const candidate = candidateFor(record);
    const completion = completionEvidence(record, candidate);
    const calls = callsEvidence(record);
    const entry = { id, legacyStrictIntent: record.evaluation?.strictIntent?.pass ?? null, legacyUserTask: record.evaluation?.userTask?.pass ?? null, completion, calls };
    if (id === "G03") entry.quality = scoreTableRelations(record, { headings: ["水果", "价格"], rows: [{ venue: "苹果", ticket: "", price: "3", unit: "元/斤" }, { venue: "香蕉", ticket: "", price: "5", unit: "元/斤" }] });
    if (id === "H03-table-entity-unit-01") entry.quality = scoreTableRelations(record, record.qualityExpectation);
    if (id === "G06") entry.quality = scoreCode(record);
    if (id === "G08") entry.quality = scoreProofread(record, [{ from: "以经", to: "已经" }, { from: "处里", to: "处理" }], record.expected?.quality?.requiredAll ?? []);
    if (id.startsWith("H08-proofread")) entry.quality = scoreProofread(record, record.qualityExpectation?.corrections ?? [], record.qualityExpectation?.protectedExact ?? []);
    if (id === "G11" || id === "H11-long-duplicate-paragraph-slots-01") entry.quality = scoreLongDocument(record, readPreplan(runDirectory, record));
    if (id === "G14" || id === "H14-source-bound-no-brand-01" || id === "G16" || id === "H16-continue-no-invented-date-01") entry.quality = sourceBoundReview(record);
    if (id === "G04" || id === "H04-mermaid-real-preview-01") entry.quality = mermaidSyntax(record);
    cases.push(entry);
  }
  return {
    schemaVersion: 1,
    reviewType: "independent-evidence-bounded-quality-review",
    run: { id: report.runId, variant: report.variant, status: report.status, model: report.model?.modelId ?? null, expectedCases: report.expectedTotal, executedCases: report.executedTotal },
    historicalOracle: { scores: report.summary?.scores ?? null, note: "Copied from original run report unchanged; not recomputed or replaced by these checks." },
    coverage: { selectedAvailable: cases.length, selectedExpected: selected.size, incomplete: cases.filter(({ completion }) => completion.status !== "complete").map(({ id, completion }) => ({ id, status: completion.status })) },
    cases
  };
}

function markdown(report) {
  const lines = [
    `# Independent quality review: ${report.run.id}`,
    "",
    `Run status: ${report.run.status}; model: ${report.run.model ?? "unknown"}; cases ${report.run.executedCases}/${report.run.expectedCases}.`,
    `Legacy oracle scores are copied unchanged: ${JSON.stringify(report.historicalOracle.scores)}.`,
    "",
    "| Case | Proposal completion | Legacy strict | Calls (plan/body) | New check |",
    "|---|---|---:|---:|---|"
  ];
  for (const item of report.cases) lines.push(`| ${item.id} | ${item.completion.status} | ${item.legacyStrictIntent ?? "N/A"} | ${item.calls.planning}/${item.calls.generation} | ${item.quality?.status ?? "not scored"} |`);
  lines.push("", "This report does not convert refusal into completion. Source-bound generation and native preview remain manual/unverified where stated.", "");
  return lines.join("\n");
}

export function writeRunReview(runDirectory) {
  const report = reviewRun(runDirectory);
  fs.mkdirSync(reviewRoot, { recursive: true });
  const target = path.join(reviewRoot, report.run.id);
  fs.mkdirSync(target, { recursive: false });
  fs.writeFileSync(path.join(target, "independent-quality-review.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  fs.writeFileSync(path.join(target, "independent-quality-review.md"), markdown(report), { flag: "wx" });
  return target;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runDirectory = process.argv[2];
  if (!runDirectory || process.argv.length !== 3) throw new Error("Usage: node scripts/ai-scenario-eval/score-ai-common-failures-quality.mjs <run-directory>");
  console.log(writeRunReview(path.resolve(runDirectory)));
}
