const REQUIRED_CASES = ["G16", "H16-continue-no-invented-date-01", "L25"];

function requireCaseManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.realCases) || manifest.realCases.length !== 87) {
    throw new Error("Scoped follow-up requires the frozen 87-case real manifest.");
  }
  const byId = new Map(manifest.realCases.map((item) => [item?.id, item]));
  if (byId.size !== manifest.realCases.length || REQUIRED_CASES.some((id) => !byId.has(id))) {
    throw new Error("Frozen follow-up manifest is missing or duplicates a required source case.");
  }
  return byId;
}

function cloneSourceCase(item, assessment) {
  return structuredClone({ ...item, assessment });
}

function selectionFor(source, needle) {
  const from = source.indexOf(needle);
  if (from < 0) throw new Error(`Scoped selection fixture is missing its literal target: ${needle}`);
  return { from, to: from + needle.length };
}

/** Extract a frozen built-in Markdown template without evaluating candidate source code. */
export function extractQuickstartTemplate(sourceModule) {
  const marker = "export const TYPORA_QUICKSTART_MARKDOWN = `";
  const start = sourceModule.indexOf(marker);
  if (start < 0) throw new Error("Frozen Welcome template export was not found.");
  let cursor = start + marker.length;
  let result = "";
  while (cursor < sourceModule.length) {
    const character = sourceModule[cursor];
    if (character === "\\") {
      const next = sourceModule[cursor + 1];
      if (next === undefined) throw new Error("Frozen Welcome template ends with an incomplete escape.");
      if (next === "n") result += "\n";
      else if (next === "r") result += "\r";
      else if (next === "t") result += "\t";
      else result += next;
      cursor += 2;
      continue;
    }
    if (character === "`") return result;
    if (character === "$" && sourceModule[cursor + 1] === "{") {
      throw new Error("Frozen Welcome template contains interpolation; safe extraction is unavailable.");
    }
    result += character;
    cursor += 1;
  }
  throw new Error("Frozen Welcome template is unterminated.");
}

export function buildScopedFollowupCases({ frozenManifest, nativeSource, welcomeSource, nativeSourceProvenance }) {
  const byId = requireCaseManifest(frozenManifest);
  if (typeof nativeSource !== "string" || !nativeSource || typeof welcomeSource !== "string" || !welcomeSource) {
    throw new Error("Native fixture and frozen Welcome source are required.");
  }

  const nativeInstruction = "在文末新增一个 Python 代码块，实现 multiply(a, b) 函数并返回 a * b。保留原有内容，只输出新增代码块。";
  const cases = [
    {
      id: "sf-native-multiply-exact",
      family: "native-explicit-code-generation",
      title: "原生失败指令：在复杂原文末尾新增 Python multiply",
      instruction: nativeInstruction,
      source: nativeSource,
      selection: null,
      assessment: { kind: "append-code", language: "python", functionName: "multiply", parameters: ["a", "b"], returnExpression: "a * b" },
      provenance: nativeSourceProvenance
    },
    {
      id: "sf-native-multiply-welcome",
      family: "native-explicit-code-generation",
      title: "同一原生指令：内置 Welcome 富文本上下文",
      instruction: nativeInstruction,
      source: welcomeSource,
      selection: null,
      assessment: { kind: "append-code", language: "python", functionName: "multiply", parameters: ["a", "b"], returnExpression: "a * b" },
      provenance: { source: "candidate-source", path: "src/core/sampleDocs.ts#TYPORA_QUICKSTART_MARKDOWN" }
    },
    {
      id: "sf-code-js-divide-variant",
      family: "explicit-code-generation-variant",
      title: "明确 JavaScript 函数与返回表达式",
      instruction: "请在文末新增 JavaScript 代码块，实现 divide(a, b) 并返回 a 除以 b；保留原文，只输出新增代码块。",
      source: "# 计算器说明\n\n保留这条已有说明。\n",
      selection: null,
      assessment: { kind: "append-code", language: "javascript", functionName: "divide", parameters: ["a", "b"], returnExpression: "a / b" }
    },
    {
      id: "sf-code-python-clamp-short-variant",
      family: "explicit-code-generation-variant",
      title: "短原文 Python 上下界函数变体",
      instruction: "在文末新增 Python 代码块，实现 clamp(value, lower, upper)，返回 value 限制在上下界之间的结果。保留原文，只输出新增代码块。",
      source: "# 数值处理\n\n保留这一行。\n",
      selection: null,
      assessment: { kind: "append-code", language: "python", functionName: "clamp", parameters: ["value", "lower", "upper"], returnExpression: "min(max(value, lower), upper)" }
    },
    cloneSourceCase(byId.get("L25"), {
      kind: "literal-selection",
      expectedPatch: { from: 6, to: 12, expectedText: "这是旧段落。", insertText: "**已定稿**" }
    }),
    {
      id: "sf-literal-selection-bold-variant",
      family: "literal-selection-format-variant",
      title: "选区原样替换为带粗体标记的字面文本",
      instruction: "将当前选中的片段原样替换为“**验收通过**”",
      source: "保留开头。\n旧术语需要更新。\n保留结尾。",
      selection: selectionFor("保留开头。\n旧术语需要更新。\n保留结尾。", "旧术语需要更新。"),
      selectionValid: true,
      cursor: null,
      assessment: {
        kind: "literal-selection",
        expectedPatch: {
          from: selectionFor("保留开头。\n旧术语需要更新。\n保留结尾。", "旧术语需要更新。").from,
          to: selectionFor("保留开头。\n旧术语需要更新。\n保留结尾。", "旧术语需要更新。").to,
          expectedText: "旧术语需要更新。",
          insertText: "**验收通过**"
        }
      }
    },
    cloneSourceCase(byId.get("G16"), {
      kind: "grounded-action-suggestions",
      requireAppend: true,
      requireProgrammedSingleCall: true,
      requiredTopics: ["备份", "恢复"],
      minimumDistinctActionPairs: 2,
      rejectRepeatedSourceSentences: true,
      rejectNewDatesAndAmounts: true,
      rejectNamedOwner: true,
      forbidInstructionEcho: true
    }),
    cloneSourceCase(byId.get("H16-continue-no-invented-date-01"), {
      kind: "grounded-action-suggestions",
      requireAppend: true,
      requireProgrammedSingleCall: true,
      requiredTopics: ["依赖清单", "双人复核", "action-and-result"],
      minimumDistinctActionPairs: 2,
      rejectRepeatedSourceSentences: true,
      rejectNewDatesAndAmounts: true,
      rejectNamedOwner: true,
      forbidInstructionEcho: true
    }),
    {
      id: "sf-ambiguous-target-requires-clarification",
      family: "negative-intent-boundary",
      title: "存在两个候选段落，修改对象不明确",
      instruction: "在正文开头或文末新增一段说明，只插入一次，位置由我稍后确定。",
      source: "## 方案甲\n\n待确认。\n\n## 方案乙\n\n仍需确认。",
      selection: null,
      assessment: { kind: "no-write", reason: "ambiguous-target" }
    },
    {
      id: "sf-negated-edit-is-answer-only",
      family: "negative-intent-boundary",
      title: "否定编辑，只询问操作方法",
      instruction: "不要修改文档，只告诉我如何在文末增加 hello。",
      source: "# 操作说明\n\n保留原有内容。",
      selection: null,
      assessment: { kind: "no-write", reason: "explicitly-negated-edit" }
    },
    {
      id: "sf-missing-selection-no-full-document-fallback",
      family: "negative-scope-boundary",
      title: "要求改选区但当前没有有效选区",
      instruction: "把选中的片段原样替换成“**终稿**”。",
      source: "# 保留整篇\n\n这里没有选区，不能把全文替换成终稿。",
      selection: null,
      selectionValid: false,
      cursor: null,
      assessment: { kind: "no-write", reason: "missing-selection" }
    }
  ];

  const duplicateIds = new Set();
  for (const item of cases) {
    if (duplicateIds.has(item.id)) throw new Error(`Duplicate scoped follow-up case id: ${item.id}`);
    duplicateIds.add(item.id);
    if (typeof item.instruction !== "string" || typeof item.source !== "string" || !item.assessment?.kind) {
      throw new Error(`Scoped follow-up case is incomplete: ${item.id}`);
    }
  }
  return cases;
}

function normalizeText(value) {
  return String(value ?? "").normalize("NFKC").replace(/[\s\p{P}\p{S}]+/gu, "").toLowerCase();
}

function hasInstructionEcho(output, instruction) {
  const needle = normalizeText(instruction);
  return needle.length >= 8 && normalizeText(output).includes(needle);
}

function repeatedSourceSentences(output, source) {
  const normalizedOutput = normalizeText(output);
  return source.split(/[。！？!?\n]+/u)
    .map((sentence) => normalizeText(sentence))
    .filter((sentence) => sentence.length >= 8 && normalizedOutput.includes(sentence));
}

function actionPairs(text) {
  return procedureSteps(text);
}

function procedureSteps(text) {
  const verbs = "核对|复核|验证|演练|记录|检查|执行|确认|留存|保留|标记|比对|对照|安排|准备|拆成|拆分|覆盖|建立|标出|复查|处理";
  const objects = ["前置条件", "实际结果", "完成证据", "结果证据", "未满足项", "未完成", "待确认", "不一致处", "处理结论", "检查输入", "相关演练", "观察结果", "发现的问题", "检查范围", "执行证据", "检查点", "备份", "恢复", "依赖清单", "双人复核", "结果", "异常"];
  const steps = [];
  for (const block of text.split(/\n\n+/u)) {
    const lines = block.split("\n").filter((line) => !/^依据摘录\s*[:：]/u.test(line));
    const actionBlock = lines.join(" ").replace(/^[-*]?\s*建议(?:核对|复核|验证|演练|记录)\s*[:：]/u, "");
    if (actionBlock === lines.join(" ")) continue;
    for (const clause of actionBlock.split(/[，,、。；;\n]|并且|并|随后|然后|接着|再|同时/gu)) {
      const match = new RegExp(`(${verbs})`, "gu");
      const actions = [...clause.matchAll(match)];
      const object = objects.find((candidate) => clause.includes(candidate));
      if (actions.length && object) steps.push(`${actions.at(-1)[1]}:${object}`);
    }
  }
  return [...new Set(steps)];
}

function newDateOrAmount(output, source) {
  const pattern = /(?:\b\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?|\b\d+(?:\.\d+)?\s*(?:万元|万|元|人民币|美元|%))/gu;
  return [...new Set(output.match(pattern) ?? [])].filter((value) => !source.includes(value));
}

function namedOwnerSignals(output, source) {
  const signals = [];
  if (/(?:负责人|责任人)\s*[:：为是]/u.test(output) && !/(?:负责人|责任人)\s*[:：为是]/u.test(source)) signals.push("owner-label");
  const named = output.match(/(?:由|交由|指定)\s*([\u4e00-\u9fff]{2,4})\s*(?:负责|执行|复核|确认|处理)/gu) ?? [];
  for (const phrase of named) if (!source.includes(phrase)) signals.push(phrase);
  return signals;
}

function hasRequiredActionTopics(text, topics) {
  return topics.every((topic) => {
    if (topic === "action-and-result") return /(?:记录|留存)[^。；;\n]{0,10}(?:结果|记录)/u.test(text);
    if (topic === "双人复核") return /(?:双人|两人|双方)[^。；;\n]{0,10}(?:复核|交叉核验|复查)/u.test(text);
    return text.includes(topic);
  });
}

function scoreCode(item, patch) {
  const contract = item.assessment;
  const insertText = patch?.insertText ?? "";
  const fence = /^\s*```([^\n`]*)\n([\s\S]*?)\n```\s*$/u.exec(insertText.trim());
  const normalizedLanguage = fence?.[1].trim().toLowerCase() ?? "";
  const aliases = contract.language === "javascript" ? new Set(["javascript", "js"]) : new Set([contract.language]);
  const code = fence?.[2] ?? "";
  const escapedName = contract.functionName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const signature = contract.language === "python"
    ? new RegExp(`\\bdef\\s+${escapedName}\\s*\\(\\s*${contract.parameters.map((value) => `\\b${value}\\b`).join("\\s*,\\s*")}\\s*\\)\\s*:`, "u")
    : contract.language === "javascript"
      ? new RegExp(`(?:\\bfunction\\s+${escapedName}\\s*\\(\\s*${contract.parameters.map((value) => `\\b${value}\\b`).join("\\s*,\\s*")}\\s*\\)|\\bconst\\s+${escapedName}\\s*=\\s*\\([^)]*\\)\\s*=>)`, "u")
      : new RegExp(`\\bdef\\s+${escapedName}\\s*\\(\\s*${contract.parameters.map((value) => `\\b${value}\\b`).join("\\s*,\\s*")}\\s*\\)`, "u");
  const returnPattern = contract.functionName === "clamp"
    ? /\breturn\s+(?:min\s*\(\s*max\s*\(\s*value\s*,\s*lower\s*\)\s*,\s*upper\s*\)|max\s*\(\s*lower\s*,\s*min\s*\(\s*value\s*,\s*upper\s*\)\s*\)|max\s*\(\s*min\s*\(\s*value\s*,\s*upper\s*\)\s*,\s*lower\s*\))/u
    : new RegExp(`\\breturn\\s+${contract.returnExpression.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").replace(/ /gu, "\\s*")}`, "u");
  const checks = {
    appendedAtEof: patch?.from === item.source.length && patch?.to === item.source.length && patch?.expectedText === "",
    oneFencedCodeBlockOnly: Boolean(fence),
    language: aliases.has(normalizedLanguage),
    signature: signature.test(code),
    returnBehavior: returnPattern.test(code),
    originalSourcePreserved: Boolean(patch?.content === item.source + insertText)
  };
  checks.lexicalStaticCheck = checks.oneFencedCodeBlockOnly && checks.language && checks.signature && checks.returnBehavior;
  return {
    status: Object.values(checks).every(Boolean) ? "passed" : patch ? "failed" : "incomplete",
    outcome: patch ? "generated-patch" : "no-patch",
    checks,
    staticAnalysis: { type: "lexicalStaticCheck", generatedCodeExecuted: false, provesPythonOrJavaScriptExecution: false },
    patch: patch ? { from: patch.from, to: patch.to, expectedText: patch.expectedText, insertText: patch.insertText } : null
  };
}

function scoreLiteralSelection(item, patch) {
  const expected = item.assessment.expectedPatch;
  const selection = item.selection;
  const exactPatch = Boolean(patch && patch.from === expected.from && patch.to === expected.to &&
    patch.expectedText === expected.expectedText && patch.insertText === expected.insertText);
  const sourceOutsideSelectionPreserved = Boolean(patch && selection &&
    patch.content.slice(0, selection.from) === item.source.slice(0, selection.from) &&
    patch.content.slice(selection.from + expected.insertText.length) === item.source.slice(selection.to));
  const checks = { exactPatch, sourceOutsideSelectionPreserved };
  return {
    status: Object.values(checks).every(Boolean) ? "passed" : patch ? "failed" : "incomplete",
    outcome: patch ? "literal-selection-patch" : "no-patch",
    checks,
    patch: patch ? { from: patch.from, to: patch.to, expectedText: patch.expectedText, insertText: patch.insertText } : null
  };
}

const GROUNDED_ACTIONS = new Set(["核对", "复核", "验证", "演练", "记录"]);

function parseGroundedSuggestions(raw) {
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value?.suggestions) ? value.suggestions : null;
  } catch {
    return null;
  }
}

function readAllowedFacts(prompt) {
  const match = /可引用事实 ID(?: 与可执行动作)?：([\s\S]*?)(?:\n\n|$)/u.exec(prompt ?? "");
  if (!match) return null;
  try {
    const values = JSON.parse(match[1]);
    return Array.isArray(values) ? new Map(values.map((value) => [value.id, value])) : null;
  } catch {
    return null;
  }
}

function inspectGroundedActionAudit(item, record) {
  const call = record.calls?.length === 1 ? record.calls[0] : null;
  const suggestions = call && typeof call.raw === "string" ? parseGroundedSuggestions(call.raw) : null;
  const facts = call ? readAllowedFacts(call.prompt) : null;
  const actions = suggestions?.map(({ action }) => action) ?? [];
  const ids = suggestions?.flatMap(({ evidenceIds }) => Array.isArray(evidenceIds) ? evidenceIds : []) ?? [];
  const legalActions = Boolean(suggestions?.length && actions.every((action) => GROUNDED_ACTIONS.has(action)));
  const validEvidenceIds = Boolean(facts && ids.length && ids.every((id) => facts.has(id)));
  const selectedQuotes = validEvidenceIds ? [...new Set(ids.map((id) => facts.get(id).quote))] : [];
  const actualFacts = Array.isArray(record.result?.sourceFacts) ? [...new Set(record.result.sourceFacts)] : [];
  const sourceSlices = selectedQuotes.every((quote) => item.source.includes(quote));
  const quoteOffsetsMatch = validEvidenceIds && ids.every((id) => {
    const match = /^sf:(\d+):(\d+):/u.exec(id);
    if (!match) return false;
    return item.source.slice(Number(match[1]), Number(match[2])) === facts.get(id).quote;
  });
  const selectedFactsTraceable = Boolean(validEvidenceIds && sourceSlices && quoteOffsetsMatch &&
    JSON.stringify(selectedQuotes) === JSON.stringify(actualFacts));
  const excerpts = [...String(record.resolvedEdit?.insertText ?? "").matchAll(/依据摘录：([^\n]*)/gu)].map((match) => match[1].replace(/\\([\\`*_{}\[\]()#+.!|>~])/gu, "$1").replace(/^[“"]|[”"]$/gu, "").trim());
  const coveredQuotes = new Set();
  const everyExcerptIsShortAndTraceable = excerpts.every((excerpt) => {
    const normalizedExcerpt = normalizeText(excerpt.replace(/…/gu, ""));
    const matchingQuote = selectedQuotes.find((quote) => {
      const normalizedQuote = normalizeText(quote);
      return normalizedQuote.includes(normalizedExcerpt) && normalizedExcerpt.length < normalizedQuote.length;
    });
    if (matchingQuote) coveredQuotes.add(matchingQuote);
    return normalizedExcerpt.length >= 4 && Boolean(matchingQuote);
  });
  const shortEvidenceExcerpts = everyExcerptIsShortAndTraceable && coveredQuotes.size === selectedQuotes.length;
  return { legalActions, validEvidenceIds, selectedFactsTraceable, shortEvidenceExcerpts, actionCount: actions.length, selectedFactIds: [...new Set(ids)], selectedFacts: selectedQuotes, excerpts };
}

function recommendationQuality(item, text, policy, audit) {
  const blocks = text.split(/\n\n+/u).filter((value) => value.trim());
  const actionBlocks = blocks.map((block) => {
    const match = /^[-*]?\s*建议\s*(核对|复核|验证|演练|记录)\s*[:：]/u.exec(block);
    return match ? { action: match[1], text: block } : null;
  }).filter(Boolean);
  const outcomeEvidence = actionBlocks.map(({ text: block }) => {
    const body = block.replace(/\n依据摘录\s*[:：][^\n]*/gu, "");
    return procedureSteps(block).length > 0 && /(?:结果|证据|记录|异常|未满足项|不一致处)/u.test(body) && /\n依据摘录\s*[:：]\S/u.test(block);
  });
  const completeRecommendationBlocks = actionBlocks.length > 0 && outcomeEvidence.every(Boolean);
  const subjectTopics = item.id === "G16" ? ["备份", "恢复", "发布"] : ["依赖清单", "双人复核", "记录结果"];
  const topicActions = [...new Set(subjectTopics.filter((topic) =>
    audit.selectedFacts.some((fact) => fact.includes(topic)) && actionBlocks.some(({ text: block }) => procedureSteps(block).length > 0)
  ))];
  const steps = actionBlocks.flatMap(({ text: block }) => procedureSteps(block));
  return { actionBlockCount: actionBlocks.length, completeRecommendationBlocks, procedureSteps: [...new Set(steps)], distinctConcreteActions: steps.length >= policy.minimumDistinctActionPairs && topicActions.length >= policy.minimumDistinctActionPairs };
}

function scoreGroundedActions(item, patch, record) {
  const policy = item.assessment;
  const text = patch?.insertText ?? "";
  const repeated = policy.rejectRepeatedSourceSentences ? repeatedSourceSentences(text, item.source) : [];
  const unexpectedDatesOrAmounts = policy.rejectNewDatesAndAmounts ? newDateOrAmount(text, item.source) : [];
  const owners = policy.rejectNamedOwner ? namedOwnerSignals(text, item.source) : [];
  const pairs = actionPairs(text);
  const audit = inspectGroundedActionAudit(item, record);
  const recommendation = recommendationQuality(item, text, policy, audit);
  const singleProgrammedContentCall = record.result?.planningMode === "program" && record.calls?.length === 1;
  const checks = {
    appendedAtEof: patch?.from === item.source.length && patch?.to === item.source.length && patch?.expectedText === "",
    requiredTopics: hasRequiredActionTopics(text, policy.requiredTopics),
    distinctConcreteActions: recommendation.distinctConcreteActions,
    operationResultEvidencePerAction: recommendation.completeRecommendationBlocks,
    singleProgrammedContentCall,
    legalActionsAndTraceableFacts: audit.legalActions && audit.validEvidenceIds && audit.selectedFactsTraceable && audit.shortEvidenceExcerpts,
    noRepeatedSourceSentence: repeated.length === 0,
    noNewDateOrAmount: unexpectedDatesOrAmounts.length === 0,
    noNamedOwner: owners.length === 0,
    noInstructionEcho: !policy.forbidInstructionEcho || !hasInstructionEcho(text, item.instruction)
  };
  return {
    status: !patch ? "incomplete" : !checks.appendedAtEof || !audit.validEvidenceIds || !audit.selectedFactsTraceable || !checks.noNewDateOrAmount || !checks.noNamedOwner ? "failed" : Object.values(checks).every(Boolean) ? "passed" : "partial",
    outcome: patch ? "generated-action-append" : "no-patch",
    checks,
    evidence: { actionPairs: pairs, ...recommendation, ...audit, planningMode: record.result?.planningMode ?? "unclassified", callCount: record.calls?.length ?? 0, repeatedSourceSentences: repeated, unexpectedDatesOrAmounts, namedOwnerSignals: owners },
    patch: patch ? { from: patch.from, to: patch.to, expectedText: patch.expectedText, insertText: patch.insertText } : null
  };
}

function parsedClarification(record) {
  for (const call of [...(record.calls ?? [])].reverse()) {
    if (typeof call.raw !== "string") continue;
    try {
      const parsed = JSON.parse(call.raw);
      const intent = parsed?.kind === "clarify" ? parsed : parsed?.intent;
      if (intent?.kind === "clarify" && typeof intent.reason === "string") return intent.reason;
    } catch { /* raw model output may be text or another task schema */ }
  }
  return null;
}

function expectedNoWriteStop(item, record) {
  const reason = item.assessment.reason;
  const code = record.error?.code;
  const clarification = parsedClarification(record);
  const transportFailure = record.calls?.some(({ error }) => Boolean(error));
  const timeout = record.harnessTimedOut || record.runnerDeadlineExceeded || ["timeout", "independent_case_timeout"].includes(code);
  const recognizedTerminalError = ["PlanValidationError", "IntentProtocolError"].includes(record.error?.name) ||
    ["invalid_evidence", "selection_required", "ambiguous_instruction", "ambiguous_anchor", "missing_target", "missing_operation"].includes(code) ||
    /尚未修改|未修改文档|原文未修改|明确处理全文还是选区|找到多个可能的位置|范围或操作歧义|范围未明确|请说明修改位置|请说明要对文档执行/u.test(record.error?.message ?? "");
  if (transportFailure || timeout || record.error && !recognizedTerminalError) return false;
  if (reason === "missing-selection") return code === "selection_required";
  if (reason === "ambiguous-target") {
    return ["ambiguous_instruction", "ambiguous_anchor", "scope_mismatch", "target_mismatch", "unsafe_target"].includes(code) ||
      ["ambiguous_anchor", "scope_conflict", "conflicting_constraints", "compound", "missing_target"].includes(clarification) ||
      /找到多个可能的位置|范围或操作歧义|请明确处理全文还是选区/u.test(record.error?.message ?? "");
  }
  if (reason === "explicitly-negated-edit") {
    return !record.error && record.result?.answerOnly === true || clarification !== null || code === "ambiguous_instruction" ||
      /请说明要对文档执行什么操作/u.test(record.error?.message ?? "");
  }
  return false;
}

function scoreNoWrite(item, record) {
  const unexpectedPatch = Boolean(record.resolvedEdit || record.result?.proposal?.patch || record.result?.proposal?.text);
  const transportFailure = record.calls?.some(({ error }) => Boolean(error));
  const timeout = record.harnessTimedOut || record.runnerDeadlineExceeded || ["timeout", "independent_case_timeout"].includes(record.error?.code);
  const reasonMatchesExpectation = expectedNoWriteStop(item, record);
  const clarification = parsedClarification(record);
  const recognizedTerminalError = ["PlanValidationError", "IntentProtocolError"].includes(record.error?.name) ||
    ["invalid_evidence", "selection_required", "ambiguous_instruction", "ambiguous_anchor", "missing_target", "missing_operation"].includes(record.error?.code) ||
    /尚未修改|未修改文档|原文未修改|明确处理全文还是选区|找到多个可能的位置|范围或操作歧义|范围未明确|请说明修改位置|请说明要对文档执行/u.test(record.error?.message ?? "");
  const infrastructureFailure = transportFailure || timeout || Boolean(record.error && !recognizedTerminalError);
  const productTerminalObserved = !infrastructureFailure && (clarification !== null || recognizedTerminalError || reasonMatchesExpectation);
  const taskAnswerCompleted = record.result?.answerOnly === true;
  const safeNoWrite = !unexpectedPatch && productTerminalObserved;
  return {
    status: unexpectedPatch ? "failed" : infrastructureFailure ? "incomplete" : safeNoWrite ? "passed" : "incomplete",
    outcome: unexpectedPatch ? "unexpected-write" : infrastructureFailure ? "infrastructure-incomplete" : safeNoWrite ? (taskAnswerCompleted ? "answer-only" : "safe-stop") : "unverified-no-write",
    taskAnswerCompleted,
    checks: { noProposal: !unexpectedPatch, productTerminalObserved, expectedTerminalReason: reasonMatchesExpectation, taskAnswerCompleted, noTransportOrTimeoutFailure: !infrastructureFailure, sourceNotReplaced: !record.resolvedEdit || record.resolvedEdit.content === record.snapshot.content },
    patch: record.resolvedEdit ? { from: record.resolvedEdit.from, to: record.resolvedEdit.to, expectedText: record.resolvedEdit.expectedText, insertText: record.resolvedEdit.insertText } : null
  };
}

export function scoreScopedFollowupCase(item, record) {
  const patch = record.resolvedEdit ?? null;
  switch (item.assessment?.kind) {
    case "append-code": return scoreCode(item, patch);
    case "literal-selection": return scoreLiteralSelection(item, patch);
    case "grounded-action-suggestions": return scoreGroundedActions(item, patch, record);
    case "no-write": return scoreNoWrite(item, record);
    default: throw new Error(`Unknown scoped follow-up assessment kind: ${item.assessment?.kind}`);
  }
}

export function summarizeScopedFollowup(records) {
  const summary = { expected: records.length, passed: 0, partial: 0, failed: 0, incomplete: 0, outcomes: {} };
  for (const record of records) {
    const status = record.evaluation?.status ?? "incomplete";
    summary[status] = (summary[status] ?? 0) + 1;
    const outcome = record.evaluation?.outcome ?? "missing-evaluation";
    summary.outcomes[outcome] = (summary.outcomes[outcome] ?? 0) + 1;
  }
  return summary;
}
