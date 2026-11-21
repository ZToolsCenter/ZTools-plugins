import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cacheRoot = path.join(pluginRoot, ".cache/acceptance/ai-scenarios");
const caseDefinitions = [
  { id: "G03", renderer: "table" },
  { id: "G06", renderer: "code" },
  { id: "G05", renderer: "math" },
  { id: "G04", renderer: "mermaid", labelsFrom: "requiredGroups" },
  { id: "H04-mermaid-real-preview-01", renderer: "mermaid", labelsFrom: "requiredLabels" }
];
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function inside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function resolveLocal(value, label) {
  const target = path.resolve(pluginRoot, value);
  if (!inside(pluginRoot, target)) throw new Error(`${label} must stay inside the plugin checkout.`);
  let current = target;
  while (current !== pluginRoot) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error(`${label} refuses symlink path components.`);
    current = path.dirname(current);
  }
  return target;
}

function parseArgs(argv) {
  const values = new Map();
  for (const arg of argv) {
    const match = /^--([a-z-]+)=(.*)$/u.exec(arg);
    if (!match || !["run-dir", "out-dir"].includes(match[1]) || values.has(match[1])) {
      throw new Error("Usage: node scripts/ai-scenario-eval/render-successful-proposals.mjs --run-dir=<B8-run-directory> [--out-dir=<new-cache-directory>]");
    }
    values.set(match[1], match[2]);
  }
  if (!values.has("run-dir")) throw new Error("--run-dir is required.");
  return values;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function verifyCandidateSnapshot(runReport) {
  const source = runReport.source;
  if (runReport.variant !== "B" || !/b9/iu.test(String(runReport.runId ?? ""))) {
    throw new Error(`Expected final B9 real run; got variant=${runReport.variant}, runId=${runReport.runId}.`);
  }
  if (!source || source.verificationMode !== "snapshot-only" || source.snapshotStableAfter !== true) {
    throw new Error("Run report must identify a stable snapshot-only product source.");
  }
  if (!/^[a-f0-9]{64}$/iu.test(String(source.sourceManifestSha256 ?? ""))) {
    throw new Error("Run report is missing a SHA-256 source manifest proof.");
  }
  const manifestPath = resolveLocal(source.sourceManifest, "Source manifest");
  if (!fs.existsSync(manifestPath)) throw new Error(`Missing candidate source manifest: ${manifestPath}`);
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifestSha256 = sha256(manifestBytes);
  if (manifestSha256 !== source.sourceManifestSha256) throw new Error("Candidate source manifest hash does not match the run report.");
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const files = manifest.files;
  const filePaths = files && typeof files === "object" && !Array.isArray(files) ? Object.keys(files).sort() : [];
  if (manifest.variant !== "B9" || manifest.stable !== true || !String(manifest.verificationMode ?? "").startsWith("snapshot-only")) {
    throw new Error("Source manifest identity does not prove a stable B9 snapshot-only candidate.");
  }
  if (source.sourceFileCount !== filePaths.length || canonical(source.sourceManifestFiles) !== canonical(files) || canonical(manifest.paths?.slice().sort()) !== canonical(filePaths)) {
    throw new Error("Run report file hashes do not match the source manifest.");
  }
  const toolSnapshot = runReport.toolSnapshot;
  if (!toolSnapshot?.caseManifest || !/^[a-f0-9]{64}$/iu.test(String(runReport.caseManifestSha256 ?? ""))) {
    throw new Error("Run report is missing its derived case-manifest binding.");
  }
  const caseManifestPath = resolveLocal(toolSnapshot.caseManifest, "Derived case manifest");
  if (!fs.existsSync(caseManifestPath)) throw new Error(`Missing derived case manifest: ${caseManifestPath}`);
  const caseManifestBytes = fs.readFileSync(caseManifestPath);
  const derivedCaseManifestSha256 = sha256(caseManifestBytes);
  if (derivedCaseManifestSha256 !== runReport.caseManifestSha256 || derivedCaseManifestSha256 !== toolSnapshot.caseManifestSha256) {
    throw new Error("Derived case manifest hash does not match the run report and frozen tool snapshot.");
  }
  const caseManifest = JSON.parse(caseManifestBytes.toString("utf8"));
  if (caseManifest.caseSetId !== runReport.caseSetId || caseManifest.baseCaseManifestSha256 !== manifest.caseManifestSha256 ||
      caseManifest.realCases?.length !== 87 || caseManifest.controlledCases?.length !== 16) {
    throw new Error("Derived 87+16 case set does not bind to the B9 source manifest's base-case SHA.");
  }
  const sourceRoot = resolveLocal(source.sourceRoot, "Source snapshot root");
  const verifiedFiles = [];
  for (const relativePath of filePaths) {
    const filePath = resolveLocal(path.join(sourceRoot, relativePath), "Source snapshot file");
    if (!inside(sourceRoot, filePath) || !fs.existsSync(filePath)) throw new Error(`Missing candidate snapshot file: ${relativePath}`);
    const bytes = fs.readFileSync(filePath);
    const expected = files[relativePath];
    if (bytes.byteLength !== expected.bytes || sha256(bytes) !== expected.sha256) throw new Error(`Candidate snapshot file hash mismatch: ${relativePath}`);
    verifiedFiles.push({ path: relativePath, bytes: bytes.byteLength, sha256: expected.sha256 });
  }
  return {
    candidate: "B9",
    sourceRoot: path.relative(pluginRoot, sourceRoot).split(path.sep).join("/"),
    sourceManifest: path.relative(pluginRoot, manifestPath).split(path.sep).join("/"),
    sourceManifestSha256: manifestSha256,
    sourceFileCount: verifiedFiles.length,
    snapshotFilesSha256: sha256(canonical(verifiedFiles)),
    sourceBaseCaseManifestSha256: manifest.caseManifestSha256,
    derivedCaseManifest: path.relative(pluginRoot, caseManifestPath).split(path.sep).join("/"),
    derivedCaseManifestSha256,
    caseCounts: { real: caseManifest.realCases.length, controlled: caseManifest.controlledCases.length },
    snapshotStable: true
  };
}

function distFingerprint(distDirectory) {
  const files = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Refusing symlink in preview dist: ${path.relative(distDirectory, absolute)}`);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        const bytes = fs.readFileSync(absolute);
        files.push({ path: path.relative(distDirectory, absolute).split(path.sep).join("/"), bytes: bytes.byteLength, sha256: sha256(bytes) });
      } else throw new Error(`Unexpected preview dist entry: ${path.relative(distDirectory, absolute)}`);
    }
  };
  visit(distDirectory);
  return { fileCount: files.length, totalBytes: files.reduce((total, item) => total + item.bytes, 0), filesSha256: sha256(canonical(files)), files };
}

function labelsFor(record, definition) {
  if (definition.labelsFrom === "requiredLabels") return record.expected?.requiredLabels ?? record.qualityExpectation?.requiredLabels ?? [];
  return (record.expected?.quality?.requiredGroups ?? []).map((group) => group?.[0]).filter(Boolean);
}

function bindProposal(record, recordBytes, definition) {
  const source = record.snapshot?.content;
  const proposal = record.result?.proposal;
  const evidence = {
    id: definition.id,
    evaluationStatus: record.status ?? record.evaluation?.outcome ?? null,
    recordSha256: sha256(recordBytes),
    sourceSha256: typeof source === "string" ? sha256(source) : null,
    frozenSourceSha256: record.sourceSha256 ?? null,
    proposalSha256: proposal ? sha256(canonical(proposal)) : null
  };
  if (!proposal) return { status: "not_completed", reason: record.error?.message ?? "record contains no result.proposal", evidence };
  if (typeof source !== "string" || !proposal.snapshot || proposal.snapshot.content !== source) {
    return { status: "integrity_failed", reason: "proposal snapshot is not bound to the record source", evidence };
  }
  if (record.sourceSha256 && record.sourceSha256 !== evidence.sourceSha256) {
    return { status: "integrity_failed", reason: "record sourceSha256 does not match snapshot.content", evidence };
  }
  const patch = proposal.patch;
  if (!patch || !Number.isSafeInteger(patch.from) || !Number.isSafeInteger(patch.to) || typeof patch.expectedText !== "string" || typeof patch.insertText !== "string") {
    return { status: "integrity_failed", reason: "proposal patch is incomplete", evidence };
  }
  if (patch.from < 0 || patch.to < patch.from || patch.to > source.length || source.slice(patch.from, patch.to) !== patch.expectedText) {
    return { status: "integrity_failed", reason: "proposal patch preimage does not match its bound source", evidence };
  }
  const expected = record.expected?.patch;
  const isAppendCase = definition.id === "G03" || definition.id === "G04" || definition.id === "G05" || definition.id === "G06" || definition.id.startsWith("H04-");
  if (expected && (patch.from !== expected.from || patch.to !== expected.to || patch.expectedText !== expected.expectedText)) {
    return { status: "integrity_failed", reason: "proposal range differs from the frozen case range", evidence };
  }
  if (isAppendCase && (patch.from !== source.length || patch.to !== source.length || patch.expectedText !== "")) {
    return { status: "integrity_failed", reason: "frozen rendering case requires an exact document-end insertion", evidence };
  }
  const finalSource = source.slice(0, patch.from) + patch.insertText + source.slice(patch.to);
  const renderedRange = finalSource.slice(patch.from, patch.from + patch.insertText.length);
  if (renderedRange !== patch.insertText) return { status: "integrity_failed", reason: "candidate source does not contain the exact inserted proposal", evidence };
  return {
    status: "ready",
    source,
    finalSource,
    insertText: patch.insertText,
    patch: { from: patch.from, to: patch.to, expectedText: patch.expectedText, insertText: patch.insertText },
    labels: labelsFor(record, definition),
    expectedEdges: record.qualityExpectation?.edgeCount
      ?? record.expected?.qualityExpectation?.edgeCount
      ?? record.expected?.edgeCount
      ?? Math.max(0, labelsFor(record, definition).length - 1),
    evidence: { ...evidence, renderedSourceSha256: sha256(finalSource), insertBytes: Buffer.byteLength(patch.insertText) }
  };
}

function check(name, passed, details = {}) { return { name, passed: Boolean(passed), ...details }; }

async function inspectTable(page) {
  const widget = page.locator("#write .ty-cm6-table-widget").filter({ hasText: "水果" }).first();
  const count = await page.locator("#write .ty-cm6-table-widget").filter({ hasText: "水果" }).count();
  if (!count) return { checks: [check("native-table-widget", false, { selector: "#write .ty-cm6-table-widget" })], details: { matchingWidgets: 0 } };
  const details = await widget.evaluate((element) => ({
    headers: [...element.querySelectorAll("thead th")].map((cell) => cell.innerText.trim()),
    rows: [...element.querySelectorAll("tbody tr")].map((row) => [...row.querySelectorAll("td")].map((cell) => cell.innerText.trim())),
    tableCount: element.querySelectorAll("table").length
  }));
  const rows = details.rows.map((row) => row.join(" "));
  const apple = rows.find((row) => row.includes("苹果")) ?? "";
  const banana = rows.find((row) => row.includes("香蕉")) ?? "";
  return {
    details: { matchingWidgets: count, ...details },
    checks: [
      check("native-table-widget", count > 0, { selector: "#write .ty-cm6-table-widget" }),
      check("two-column-header", details.headers.some((text) => text.includes("水果")) && details.headers.some((text) => text.includes("价格")), { headers: details.headers }),
      check("two-source-entities", Boolean(apple && banana), { rows }),
      check("entity-price-association", /3/u.test(apple) && /5/u.test(banana), { apple, banana }),
      check("two-rendered-data-rows", details.rows.length === 2, { rowCount: details.rows.length })
    ]
  };
}

async function inspectCode(page) {
  const languages = await page.locator("#write .ty-codeblock-lang").allTextContents();
  const codeLines = await page.locator("#write .cm-codeblock-line").allTextContents();
  const keywordCount = await page.locator("#write .cm-codeblock-line .cm-keyword").count();
  const details = { languages, codeLineCount: codeLines.length, keywordCount, codePreview: codeLines.join("\n").slice(0, 1200) };
  return { details, checks: [
    check("python-language-badge", languages.some((language) => language.trim().toLowerCase() === "python"), { languages }),
    check("code-lines-rendered", codeLines.length > 0, { codeLineCount: codeLines.length }),
    check("syntax-highlighting-rendered", keywordCount > 0, { keywordCount })
  ] };
}

function mathSourceExpressions(insertText) {
  return [...insertText.matchAll(/\$\$([\s\S]*?)\$\$|(?<!\$)\$([^$\n]+)\$(?!\$)/gu)]
    .map((match) => (match[1] ?? match[2]).trim()).filter(Boolean);
}

async function inspectMath(page, insertText) {
  const expressions = mathSourceExpressions(insertText);
  const renders = await page.locator("#write .ty-cm6-math-widget .ty-math-block-render, #write .ty-cm6-math-inline-widget .ty-math-inline-render").evaluateAll((elements) => elements.map((element) => ({
    title: element.getAttribute("title") ?? "",
    text: element.innerText,
    superscripts: element.querySelectorAll(".ty-math-sup").length,
    fractions: element.querySelectorAll(".ty-math-frac").length,
    children: element.children.length
  })));
  const matched = renders.find((render) => expressions.some((expression) => render.title === `LaTeX: ${expression}`));
  const fallback = await page.locator("#write .ty-cm6-math-widget .ty-math-empty, #write .ty-cm6-math-inline-widget .ty-math-empty").count();
  return { details: { expressions, renders, emptyMathFallbacks: fallback }, checks: [
    check("math-source-present", expressions.length > 0, { expressions }),
    check("proposal-formula-rendered", Boolean(matched), { matched: matched ?? null }),
    check("formula-render-has-structure", Boolean(matched && matched.children > 0 && matched.superscripts > 0), { matched: matched ?? null }),
    check("no-empty-math-fallback", fallback === 0, { count: fallback })
  ] };
}

async function inspectMermaid(page, labels, expectedEdges) {
  const widget = page.locator("#write .ty-cm6-mermaid-widget").first();
  const widgetCount = await page.locator("#write .ty-cm6-mermaid-widget").count();
  const fallbackCount = await page.locator("#write .ty-cm6-mermaid-widget .ty-mermaid-fallback").count();
  const svg = page.locator("#write .ty-cm6-mermaid-widget svg.ty-mermaid-svg").first();
  const svgCount = await page.locator("#write .ty-cm6-mermaid-widget svg.ty-mermaid-svg").count();
  const details = svgCount ? await svg.evaluate((element) => ({
    viewBox: element.getAttribute("viewBox"),
    textLabels: [...element.querySelectorAll("text")].map((node) => node.textContent?.trim() ?? "").filter(Boolean),
    nodeCount: element.querySelectorAll(":scope > g[transform^='translate('").length,
    cubicEdgeCount: element.querySelectorAll(":scope > g path[d*=' C ']").length,
    pathCount: element.querySelectorAll("path[d]").length
  })) : { viewBox: null, textLabels: [], nodeCount: 0, cubicEdgeCount: 0, pathCount: 0 };
  const checkLabels = labels.map((label) => check(`svg-label-${label}`, details.textLabels.some((text) => text.includes(label)), { label, svgText: details.textLabels }));
  return {
    details: { widgetCount, svgCount, fallbackCount, ...details, expectedLabels: labels, expectedEdges },
    checks: [
      check("mermaid-widget", widgetCount > 0, { selector: "#write .ty-cm6-mermaid-widget" }),
      check("svg-rendered", svgCount > 0, { selector: "svg.ty-mermaid-svg" }),
      check("no-mermaid-fallback", fallbackCount === 0, { fallbackCount }),
      check("svg-node-count", details.nodeCount >= labels.length, { expected: labels.length, actual: details.nodeCount }),
      ...checkLabels,
      check("svg-edge-count", details.cubicEdgeCount >= expectedEdges, { expected: expectedEdges, actual: details.cubicEdgeCount, pathCount: details.pathCount })
    ]
  };
}

async function renderCase(browser, record, definition, bound, distIndexUrl, outDirectory) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  let result;
  try {
    const require = createRequire(import.meta.url);
    const { installLocalAiWorkflow } = require("../../tests/e2e/fixtures/local-ai-workflow.cjs");
    await page.addInitScript(installLocalAiWorkflow, { configured: true, content: bound.finalSource });
    await page.goto(distIndexUrl, { waitUntil: "load" });
    if (new URL(page.url()).protocol !== "file:") throw new Error(`Expected file:// preview, got ${page.url()}`);
    await page.locator("#write .cm-content").waitFor({ timeout: 15_000 });
    const loadedContent = await page.evaluate(() => window.typoraBridge?.loadPersistedState?.().lastOpenDoc?.content ?? null);
    const exactLoad = loadedContent === bound.finalSource;
    if (!exactLoad) throw new Error("file:// preview did not load the source reconstructed from the bound proposal");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    let inspected;
    if (definition.renderer === "table") inspected = await inspectTable(page);
    else if (definition.renderer === "code") inspected = await inspectCode(page);
    else if (definition.renderer === "math") inspected = await inspectMath(page, bound.insertText);
    else inspected = await inspectMermaid(page, bound.labels, bound.expectedEdges);
    const checks = [check("exact-proposal-source-loaded", exactLoad, { sourceSha256: bound.evidence.renderedSourceSha256 }), ...inspected.checks];
    result = {
      id: definition.id,
      status: checks.every(({ passed }) => passed) && pageErrors.length === 0 ? "passed" : "failed",
      renderer: definition.renderer,
      evaluationStatus: bound.evidence.evaluationStatus,
      evidence: bound.evidence,
      proposalRange: bound.patch,
      checks,
      details: inspected.details,
      pageErrors,
      previewUrl: page.url(),
      screenshot: `${definition.id}.png`
    };
    await page.screenshot({ path: path.join(outDirectory, result.screenshot), fullPage: true });
    return result;
  } catch (error) {
    result = {
      id: definition.id,
      status: "failed",
      renderer: definition.renderer,
      evaluationStatus: bound.evidence.evaluationStatus,
      evidence: bound.evidence,
      proposalRange: bound.patch,
      checks: [check("rendering-execution", false, { error: String(error?.message ?? error) })],
      pageErrors,
      previewUrl: page.url(),
      screenshot: `${definition.id}.png`
    };
    await page.screenshot({ path: path.join(outDirectory, result.screenshot), fullPage: true }).catch(() => {});
    return result;
  } finally {
    await page.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runDirectory = resolveLocal(args.get("run-dir"), "Run directory");
  const reportPath = path.join(runDirectory, "run-report.json");
  if (!fs.existsSync(reportPath)) throw new Error(`Missing run-report.json: ${reportPath}`);
  const runReport = readJson(reportPath);
  const candidateEvidence = verifyCandidateSnapshot(runReport);
  const outDirectory = args.has("out-dir")
    ? resolveLocal(args.get("out-dir"), "Output directory")
    : path.join(cacheRoot, "v2-r4", "render-verification", String(runReport.runId));
  if (!inside(cacheRoot, outDirectory)) throw new Error("Output must be written under .cache/acceptance/ai-scenarios.");
  if (fs.existsSync(outDirectory)) throw new Error(`Refusing to overwrite render evidence: ${outDirectory}`);
  const distDirectory = path.join(pluginRoot, "dist");
  const indexPath = path.join(distDirectory, "index.html");
  if (!fs.existsSync(indexPath)) throw new Error(`Missing built preview: ${indexPath}`);
  const dist = distFingerprint(distDirectory);
  const distIndexSha256 = sha256(fs.readFileSync(indexPath));
  const recordsDirectory = path.join(runDirectory, "records");
  const prepared = [];
  for (const definition of caseDefinitions) {
    const recordPath = path.join(recordsDirectory, `${definition.id}.json`);
    if (!fs.existsSync(recordPath)) {
      prepared.push({ definition, result: { id: definition.id, status: "not_completed", renderer: definition.renderer, reason: "record file missing", evidence: null } });
      continue;
    }
    const recordBytes = fs.readFileSync(recordPath);
    const record = JSON.parse(recordBytes.toString("utf8"));
    if (record.id !== definition.id) throw new Error(`Record identity mismatch in ${recordPath}: ${record.id}`);
    const bound = bindProposal(record, recordBytes, definition);
    if (bound.status !== "ready") {
      prepared.push({ definition, result: { id: definition.id, status: bound.status, renderer: definition.renderer, reason: bound.reason, evidence: bound.evidence } });
      continue;
    }
    prepared.push({ definition, record, bound });
  }
  fs.mkdirSync(path.dirname(outDirectory), { recursive: true });
  fs.mkdirSync(outDirectory, { recursive: false });
  const cases = [];
  const readyItems = prepared.filter((item) => item.bound);
  let browser = null;
  if (readyItems.length) {
    const { launchBrowser } = createRequire(import.meta.url)("../../tests/e2e/browser.cjs");
    try { browser = await launchBrowser(); }
    catch (error) {
      for (const item of readyItems) cases.push({
        id: item.definition.id,
        status: "failed",
        renderer: item.definition.renderer,
        evaluationStatus: item.bound.evidence.evaluationStatus,
        evidence: item.bound.evidence,
        proposalRange: item.bound.patch,
        checks: [check("browser-launch", false, { error: String(error?.message ?? error) })],
        pageErrors: [],
        screenshot: null
      });
    }
  }
  try {
    for (const item of prepared) {
      if (item.bound && browser) cases.push(await renderCase(browser, item.record, item.definition, item.bound, pathToFileURL(indexPath).href, outDirectory));
      else if (item.bound) continue;
      else cases.push(item.result);
    }
  } finally {
    if (browser) await browser.close();
  }
  const report = {
    schemaVersion: 1,
    type: "actual-ai-proposal-file-preview-render-validation",
    generatedAt: new Date().toISOString(),
    run: { runId: runReport.runId, variant: runReport.variant, caseSetId: runReport.caseSetId, model: runReport.model ?? null },
    candidateEvidence,
    preview: { protocol: "file:", indexSha256: distIndexSha256, dist },
    mermaidRendererBoundary: "Live Markdown handwritten Mermaid subset renderer; SVG evidence here does not prove compatibility with the official Mermaid parser.",
    summary: Object.fromEntries(["passed", "failed", "not_completed", "integrity_failed"].map((status) => [status, cases.filter((item) => item.status === status).length])),
    cases
  };
  fs.writeFileSync(path.join(outDirectory, "render-validation.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`${JSON.stringify({ output: path.relative(pluginRoot, outDirectory), summary: report.summary, report: "render-validation.json" }, null, 2)}\n`);
  if (report.summary.failed || report.summary.integrity_failed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
