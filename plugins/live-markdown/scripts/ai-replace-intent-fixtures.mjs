import fs from "node:fs";
import path from "node:path";

const replacementCases = [
  {
    id: "bottom-tight",
    instruction: "底部hello改成helloworld",
    appendedSource: "\n\nhello",
    operation: "replace_exact",
    find: "hello",
    replacement: "helloworld",
    occurrence: "last"
  },
  {
    id: "document-end-spaced",
    instruction: "把文末的 hello 改成 helloworld",
    appendedSource: "\n\nhello",
    operation: "replace_exact",
    find: "hello",
    replacement: "helloworld",
    occurrence: "last"
  },
  {
    id: "unique-word-replace",
    instruction: "把 hello 替换为 helloworld",
    appendedSource: "\n\nhello",
    operation: "replace_exact",
    find: "hello",
    replacement: "helloworld",
    occurrence: "single"
  },
  {
    id: "quoted-document-end",
    instruction: "把文末的“hello”改成“helloworld”",
    appendedSource: "\n\nhello",
    operation: "replace_exact",
    find: "hello",
    replacement: "helloworld",
    occurrence: "last"
  },
  {
    id: "replace-all",
    instruction: "把所有 hello 替换为 helloworld",
    appendedSource: "\n\nhello\n\nhello",
    operation: "replace_exact",
    find: "hello",
    replacement: "helloworld",
    occurrence: "all"
  }
];

const heldOutCases = [
  {
    id: "last-foo",
    instruction: "把最后一处 foo 改为 bar",
    appendedSource: "\n\nfoo earlier\n\nfoo",
    operation: "replace_exact",
    find: "foo",
    replacement: "bar",
    occurrence: "last"
  },
  {
    id: "last-draft",
    instruction: "把文末的“草案”改成“终稿”",
    appendedSource: "\n\n草案\n\n草案",
    operation: "replace_exact",
    find: "草案",
    replacement: "终稿",
    occurrence: "last"
  },
  {
    id: "version-token",
    instruction: "将v1.2.0替换为v2.0.1",
    appendedSource: "\n\n当前版本 v1.2.0",
    operation: "replace_exact",
    find: "v1.2.0",
    replacement: "v2.0.1",
    occurrence: "single"
  }
];

const appendCases = [
  { id: "append-comma-tight", instruction: "底部加个hello，world", expectedText: "hello，world" },
  { id: "append-comma-spaced", instruction: "底部加个 hello， world", expectedText: "hello， world" },
  { id: "append-hello", instruction: "底部加hello", expectedText: "hello" }
].map((item) => ({
  ...item,
  appendedSource: "",
  operation: "insert",
  target: "document_end",
  layout: "block",
  occurrence: null
}));

export function selectCases(label, suite) {
  if (/^prompt-preview(?:-v\d+)?$/.test(label)) return suite === "priority" ? replacementCases.slice(0, 3) : null;
  if (label === "baseline") {
    if (suite === "priority") return replacementCases.slice(0, 3);
    if (suite === "extended") return replacementCases.slice(3);
    if (suite === "all") return replacementCases;
    return null;
  }
  if (label !== "fixed" && label !== "fixed-v2" && label !== "fixed-v3" && label !== "fixed-v4") return null;
  if (suite === "priority") return replacementCases.slice(0, 3);
  if (suite === "extended") return [...replacementCases.slice(3), ...heldOutCases];
  if (suite === "append") return appendCases;
  if (suite === "all") return [...replacementCases, ...heldOutCases, ...appendCases];
  return null;
}

export function sourceForCase(quickstart, item) {
  return `${quickstart}${item.appendedSource}`;
}

export function loadFrozenQuickstart({ pluginRoot, acceptanceRoot, label, currentQuickstart, hash }) {
  const fixtureSnapshotPath = path.join(acceptanceRoot, "source-freeze", label, "quickstart.md");
  const fixtureFreezePath = path.join(acceptanceRoot, `${label}-fixture-freeze.json`);
  fs.mkdirSync(path.dirname(fixtureSnapshotPath), { recursive: true });
  let fixtureText = currentQuickstart;
  if (label === "baseline" && fs.existsSync(fixtureSnapshotPath)) {
    fixtureText = fs.readFileSync(fixtureSnapshotPath, "utf8");
  } else if (label === "baseline") {
    const previousPromptPath = path.join(acceptanceRoot, "baseline/priority-prompts.json");
    if (fs.existsSync(previousPromptPath)) {
      const priorHash = JSON.parse(fs.readFileSync(previousPromptPath, "utf8")).quickstart?.sha256;
      if (priorHash && priorHash !== hash(fixtureText)) throw new Error("Quickstart fixture changed after priority baseline; refusing to mix source snapshots");
    }
    fs.writeFileSync(fixtureSnapshotPath, fixtureText, { flag: "wx" });
  } else if (!fs.existsSync(fixtureSnapshotPath)) {
    fs.writeFileSync(fixtureSnapshotPath, fixtureText, { flag: "wx" });
  }
  const record = { path: path.relative(pluginRoot, fixtureSnapshotPath), sha256: hash(fixtureText), utf8Bytes: Buffer.byteLength(fixtureText) };
  if (fs.existsSync(fixtureFreezePath)) {
    const frozen = JSON.parse(fs.readFileSync(fixtureFreezePath, "utf8"));
    if (frozen.quickstart?.sha256 !== record.sha256) throw new Error("Quickstart fixture hash differs from its frozen baseline");
    return { fixtureText, record: frozen.quickstart };
  }
  fs.writeFileSync(fixtureFreezePath, `${JSON.stringify({ quickstart: record }, null, 2)}\n`, { flag: "wx" });
  return { fixtureText, record };
}

export function allExactMatches(source, find) {
  const matches = [];
  let cursor = 0;
  while (cursor <= source.length - find.length) {
    const from = source.indexOf(find, cursor);
    if (from < 0) break;
    matches.push({
      from,
      to: from + find.length,
      context: source.slice(Math.max(0, from - 32), Math.min(source.length, from + find.length + 48))
    });
    cursor = from + find.length;
  }
  return matches;
}

function expectedReplacementMatches(item, source) {
  const matches = allExactMatches(source, item.find);
  if (item.occurrence === "all") return matches;
  if (item.occurrence === "last") return matches.length ? [matches[matches.length - 1]] : [];
  return matches.length === 1 ? [matches[0]] : [];
}

export function buildIntentOracle(item, source, hashValue) {
  if (item.operation === "insert") {
    const separator = source.includes("\r\n") ? "\r\n" : source.includes("\r") && !source.includes("\n") ? "\r" : "\n";
    const trailingBreaks = source.match(/(?:\r\n|\r|\n)*$/)?.[0].match(/\r\n|\r|\n/g)?.length ?? 0;
    const expectedInsertText = separator.repeat(Math.max(0, 2 - trailingBreaks)) + item.expectedText;
    const expectedFinalText = source + expectedInsertText;
    return {
      operation: "insert",
      target: item.target,
      expectedText: item.expectedText,
      expectedChangedRanges: [{ from: source.length, to: source.length }],
      expectedInsertText,
      expectedFinalText,
      expectedFinalSha256: hashValue(expectedFinalText),
      totalRawMatches: []
    };
  }

  const targetMatches = expectedReplacementMatches(item, source);
  let expectedFinalText = source;
  for (const match of [...targetMatches].reverse()) {
    expectedFinalText = expectedFinalText.slice(0, match.from) + item.replacement + expectedFinalText.slice(match.to);
  }
  return {
    operation: item.operation,
    target: "document",
    find: item.find,
    occurrence: item.occurrence,
    targetMatches,
    expectedChangedRanges: targetMatches.map(({ from, to }) => ({ from, to })),
    expectedReplacement: item.replacement,
    expectedFinalText,
    expectedFinalSha256: hashValue(expectedFinalText),
    totalRawMatches: allExactMatches(source, item.find)
  };
}

export function intentMatchesOracle(item, intent, candidates) {
  if (!intent || intent.kind !== "edit" || intent.operation !== item.operation) return false;
  const literal = intent.content?.mode === "literal"
    ? intent.content.text ?? candidates.literals.find((entry) => entry.id === intent.content.literalId)?.text
    : undefined;
  if (literal !== (item.operation === "insert" ? item.expectedText : item.replacement)) return false;
  if (item.operation === "insert") return intent.target === item.target && intent.layout === item.layout;
  return intent.target === "document" && intent.find === item.find && intent.occurrence === item.occurrence;
}

export function summarize(records) {
  const outcomes = Object.fromEntries([
    "passed", "model-misinterpretation", "binding-failure", "protocol-output-failure",
    "inference-failure", "planner-failure", "patch-outside-oracle"
  ].map((name) => [name, records.filter((record) => record.outcome === name).length]));
  const cold = records.filter((record) => record.phase === "cold-after-release");
  const hot = records.filter((record) => record.phase.startsWith("hot-"));
  return {
    total: records.length,
    outcomes,
    callsPerAttemptExactlyOnce: records.every((record) => record.callCount === 1),
    coldPassed: cold.filter((record) => record.outcome === "passed").length,
    coldFailures: cold.filter((record) => record.outcome !== "passed").length,
    hotPassed: hot.filter((record) => record.outcome === "passed").length,
    hotFailures: hot.filter((record) => record.outcome !== "passed").length,
    patchOraclePasses: records.filter((record) => record.finalPatch?.patchMatchesOracleTarget === true).length,
    patchOracleFailures: records.filter((record) => record.finalPatch && record.finalPatch.patchMatchesOracleTarget !== true).length,
    fullRunnerOraclePasses: records.filter((record) => record.fullRunnerReplay?.fullDocumentExactOracle === true).length
  };
}
