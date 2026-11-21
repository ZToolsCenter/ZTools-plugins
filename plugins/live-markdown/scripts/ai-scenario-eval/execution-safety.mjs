/**
 * Controlled, model-free execution safety fixtures for the frozen AI harness.
 * The caller supplies modules loaded from the formal v1 source snapshot. This
 * file intentionally imports no live product source and never writes a file.
 */

export const executionSafetyCases = Object.freeze([
  { id: "E01", title: "revision 变化使旧提案失效", family: "stale-document", expected: { current: false, resolves: true, safeToApply: false } },
  { id: "E02", title: "revision 不变但源码内容变化仍使旧提案失效", family: "stale-document", expected: { current: false, resolves: true, safeToApply: false } },
  { id: "E03", title: "选区依赖提案在选择范围变化后失效", family: "stale-selection", expected: { current: false, resolves: true, safeToApply: false } },
  { id: "E04", title: "光标依赖提案在光标移动后失效", family: "stale-cursor", expected: { current: false, resolves: true, safeToApply: false } },
  { id: "E05", title: "提案生成后文档变为只读则失效", family: "readonly-transition", expected: { current: false, resolves: true, safeToApply: false } },
  { id: "E06", title: "全文末尾提案不受无关选区与光标变化影响", family: "document-dependency", expected: { current: true, resolves: true, safeToApply: true } },
  { id: "E07", title: "意图规划等待期间取消并丢弃迟到 JSON", family: "cancel-planning", expected: { cancelled: true, proposal: false, lateOutputIgnored: true, contentCalls: 0, abortCalls: 1 } },
  { id: "E08", title: "正文生成等待期间取消并丢弃迟到输出", family: "cancel-generation", expected: { cancelled: true, proposal: false, lateOutputIgnored: true, contentCalls: 1, abortCalls: 1 } },
  { id: "E09", title: "非法 JSON 只规划一次并拒绝", family: "invalid-plan", expected: { rejected: true, proposal: false, planningCalls: 1, contentCalls: 0, failure: { stage: "planning", name: "IntentProtocolError", code: "invalid_output", messageIncludes: "未能形成明确编辑计划" } } },
  { id: "E10", title: "代码围栏包裹的 JSON 只规划一次并拒绝", family: "invalid-plan", expected: { rejected: true, proposal: false, planningCalls: 1, contentCalls: 0, failure: { stage: "planning", name: "IntentProtocolError", code: "invalid_output", messageIncludes: "未能形成明确编辑计划" } } },
  { id: "E11", title: "空正文生成不创建提案", family: "invalid-generation", expected: { rejected: true, proposal: false, planningCalls: 1, contentCalls: 1, failure: { stage: "content-validation", name: "Error", code: null, messageIncludes: "模型返回空结果，内容不可应用。" } } },
  { id: "E12", title: "未闭合代码围栏正文被 AST 完整性检查拒绝", family: "ast-completeness", expected: { rejected: true, proposal: false, planningCalls: 1, contentCalls: 1, failure: { stage: "ast-completeness", name: "Error", code: null, messageIncludes: "模型输出在代码块中途结束" } } },
  { id: "E13", title: "源码超过 1 MiB 时在模型调用前拒绝", family: "input-budget", expected: { rejected: true, proposal: false, planningCalls: 0, contentCalls: 0, failure: { stage: "source-budget-preflight", name: "Error", code: null, messageIncludes: "内容超过 1 MiB 安全上限" } } },
  { id: "E14", title: "指令超过 64 KiB 时在模型调用前拒绝", family: "input-budget", expected: { rejected: true, proposal: false, planningCalls: 0, contentCalls: 0, failure: { stage: "planning-budget-preflight", name: "IntentProtocolError", code: "budget_exceeded", messageIncludes: "这条指令或可选目标过长" } } },
  { id: "E15", title: "光标位于 emoji 代理对中间时拒绝", family: "unsafe-offset", expected: { rejected: true, proposal: false, planningCalls: 1, contentCalls: 0, failure: { stage: "binding", name: "Error", code: null, messageIncludes: "目标位置切开了换行符或 Unicode 字符" } } },
  { id: "E16", title: "光标位于 CRLF 中间时拒绝", family: "unsafe-offset", expected: { rejected: true, proposal: false, planningCalls: 1, contentCalls: 0, failure: { stage: "binding", name: "Error", code: null, messageIncludes: "目标位置切开了换行符或 Unicode 字符" } } }
]);

const BASIC_SOURCE = "# 安全事务\n\n正文保持原样。";
const APPEND_PLAN = JSON.stringify({
  version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block",
  content: { mode: "literal", text: "END" }
});
const CURSOR_PLAN = JSON.stringify({
  version: 1, kind: "edit", operation: "insert", target: "cursor", layout: "inline",
  content: { mode: "literal", text: "X" }
});
const GENERATED_APPEND_PLAN = JSON.stringify({
  version: 1, kind: "edit", operation: "insert", target: "document_end", layout: "block",
  content: { mode: "generate", task: "continue" }
});

function replacementPlan() {
  return JSON.stringify({
    version: 1, kind: "edit", operation: "replace_exact", target: "selection",
    find: "alpha", occurrence: "single", content: { mode: "literal", text: "beta" }
  });
}

function snapshot(content = BASIC_SOURCE, overrides = {}) {
  const value = {
    documentId: "execution-safety-fixture",
    revision: 1,
    content,
    selection: null,
    cursor: null,
    readOnly: false,
    ...overrides
  };
  if (value.selection) Object.freeze(value.selection);
  return Object.freeze(value);
}

function request(userPrompt, source) {
  return {
    source,
    action: "custom",
    userPrompt,
    baseSystemPrompt: "受控安全事务 fixture。",
    actionDefinition: { id: "custom", label: "自定义", prompt: userPrompt, system: "" }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

function createTrace({ plannerResponse = APPEND_PLAN, bodyResponse = "" } = {}) {
  const trace = {
    invocations: [],
    requestStarts: [],
    abortCalls: 0,
    streamedChunks: [],
    invoke: async (prompt, systemPrompt, maxTokens, onChunk, outputSchema) => {
      const phase = outputSchema ? "planning" : "content";
      trace.invocations.push({
        index: trace.invocations.length + 1,
        phase,
        controlled: true,
        outputSchema: Boolean(outputSchema),
        maxTokens
      });
      const response = phase === "planning" ? plannerResponse : bodyResponse;
      if (typeof response === "function") return response({ prompt, systemPrompt, maxTokens, onChunk, outputSchema, trace });
      if (phase === "content" && response) onChunk?.(response);
      return response;
    },
    options(signal) {
      return {
        invoke: trace.invoke,
        isCurrent: () => true,
        signal,
        abortCurrent: () => { trace.abortCalls += 1; },
        onRequestStart: (requestIndex) => trace.requestStarts.push(requestIndex),
        onChunk: (chunk) => trace.streamedChunks.push(chunk)
      };
    }
  };
  return trace;
}

function assertModules(modules) {
  for (const name of ["runPlannedAiTask", "isAiProposalCurrent", "resolveAiEdit"]) {
    if (typeof modules?.[name] !== "function") throw new TypeError(`Frozen v1 modules must provide ${name}().`);
  }
}

function inputFor(id) {
  switch (id) {
    case "E01": case "E02": case "E05": {
      const frozen = snapshot();
      return { snapshot: frozen, request: request("在文档末尾追加“END”。", frozen.content), plan: APPEND_PLAN };
    }
    case "E03": {
      const content = "# 选区替换\n\nalpha 是选区目标，其他文字不得变动。";
      const from = content.indexOf("alpha");
      const frozen = snapshot(content, { selection: { from, to: from + "alpha".length }, selectionValid: true });
      return { snapshot: frozen, request: request("只把选中的“alpha”替换为“beta”。", content), plan: replacementPlan() };
    }
    case "E04": {
      const content = "# 光标位置\n\n在此处插入文本。";
      const cursor = content.indexOf("插入") + 1;
      const frozen = snapshot(content, { cursor });
      return { snapshot: frozen, request: request("在光标处插入“X”。", content), plan: CURSOR_PLAN };
    }
    case "E06": {
      const content = "# 全文末尾\n\n当前选区与光标都不影响显式的全文末尾操作。";
      const from = content.indexOf("当前选区");
      const frozen = snapshot(content, { selection: { from, to: from + "当前选区".length }, selectionValid: true, cursor: from });
      const plan = JSON.stringify({ ...JSON.parse(APPEND_PLAN), content: { mode: "literal", text: "END" } });
      return { snapshot: frozen, request: request("在全文末尾追加“END”。", content), plan };
    }
    case "E07": case "E08": {
      const frozen = snapshot();
      return {
        snapshot: frozen,
        request: request("在文末续写一段说明。", frozen.content),
        plan: GENERATED_APPEND_PLAN
      };
    }
    case "E09": {
      const frozen = snapshot();
      return { snapshot: frozen, request: request("在文末追加“END”。", frozen.content), plan: "{" };
    }
    case "E10": {
      const frozen = snapshot();
      return { snapshot: frozen, request: request("在文末追加“END”。", frozen.content), plan: `\`\`\`json\n${APPEND_PLAN}\n\`\`\`` };
    }
    case "E11": case "E12": {
      const frozen = snapshot();
      return { snapshot: frozen, request: request("在文末续写一段说明。", frozen.content), plan: GENERATED_APPEND_PLAN };
    }
    case "E13": {
      const content = `# 大文件\n\n${"z".repeat(1_048_576)}`;
      const frozen = snapshot(content);
      return { snapshot: frozen, request: request("在文末追加“END”。", content), plan: APPEND_PLAN };
    }
    case "E14": {
      const frozen = snapshot();
      const instruction = `请处理：${"x".repeat(65_536)}`;
      return { snapshot: frozen, request: request(instruction, frozen.content), plan: APPEND_PLAN };
    }
    case "E15": {
      const content = "# 代理对\n\nemoji 🧭 boundary";
      const frozen = snapshot(content, { cursor: content.indexOf("🧭") + 1 });
      return { snapshot: frozen, request: request("在光标处插入“X”。", content), plan: CURSOR_PLAN };
    }
    case "E16": {
      const content = "# CRLF\r\n\r\n正文内容。";
      const frozen = snapshot(content, { cursor: content.indexOf("\r\n") + 1 });
      return { snapshot: frozen, request: request("在光标处插入“X”。", content), plan: CURSOR_PLAN };
    }
    default: throw new Error(`Unknown execution safety case: ${id}`);
  }
}

function staleSnapshotFor(id, proposed) {
  switch (id) {
    case "E01": return { ...proposed, revision: proposed.revision + 1 };
    case "E02": return { ...proposed, content: `${proposed.content}\n\n外部内容已变化。` };
    case "E03": return { ...proposed, selection: { from: proposed.selection.from + 1, to: proposed.selection.to + 1 } };
    case "E04": return { ...proposed, cursor: proposed.cursor + 1 };
    case "E05": return { ...proposed, readOnly: true };
    case "E06": return { ...proposed, selection: { from: 0, to: 1 }, cursor: 0 };
    default: throw new Error(`No stale-snapshot mutation for ${id}`);
  }
}

function observedError(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function classifyFailureStage(error, trace) {
  const message = error instanceof Error ? error.message : String(error);
  if (trace.invocations.length === 0) {
    if (error?.name === "IntentProtocolError" && error?.code === "budget_exceeded") return "planning-budget-preflight";
    if (message.includes("内容超过 1 MiB 安全上限")) return "source-budget-preflight";
  }
  if (error?.name === "IntentProtocolError" && error?.code === "invalid_output") return "planning";
  if (message.includes("模型返回空结果")) return "content-validation";
  if (message.includes("模型输出在代码块中途结束")) return "ast-completeness";
  if (message.includes("目标位置切开了换行符或 Unicode 字符")) return "binding";
  return "unknown";
}

function outcomeOf(promise) {
  return promise.then((value) => ({ status: "resolved", value }))
    .catch((error) => ({ status: "rejected", error }));
}

async function waitForCancellationStart(started, running, timeoutMs = 1_000) {
  let timer;
  try {
    return await Promise.race([
      started.promise.then((phase) => ({ kind: "started", phase })),
      running.then((outcome) => ({ kind: "settled", outcome })),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs); })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function evidenceBase(trace) {
  return {
    controlled: true,
    newModelCalls: 0,
    invocations: trace.invocations,
    requestStarts: trace.requestStarts,
    abortCalls: trace.abortCalls
  };
}

async function runProposalCurrencyCase(testCase, modules) {
  const fixture = inputFor(testCase.id);
  const trace = createTrace({ plannerResponse: fixture.plan });
  const outcome = await outcomeOf(modules.runPlannedAiTask(fixture.request, fixture.snapshot, trace.options()));
  if (outcome.status !== "resolved" || !outcome.value?.proposal) {
    return {
      ...testCase, passed: false,
      error: outcome.status === "rejected" ? observedError(outcome.error) : "Runner did not produce an edit proposal.",
      evidence: { ...evidenceBase(trace), proposal: null }
    };
  }
  const proposal = outcome.value.proposal;
  const current = staleSnapshotFor(testCase.id, fixture.snapshot);
  const isCurrent = modules.isAiProposalCurrent(proposal, current);
  const resolved = modules.resolveAiEdit(proposal);
  const safeToApply = isCurrent && resolved !== null;
  const shouldMatchContent = testCase.id !== "E06" || resolved?.content === `${fixture.snapshot.content}\n\nEND`;
  const passed = isCurrent === testCase.expected.current &&
    Boolean(resolved) === testCase.expected.resolves &&
    safeToApply === testCase.expected.safeToApply && shouldMatchContent;
  return {
    ...testCase,
    passed,
    ...(passed ? {} : { error: "Proposal currency/resolution did not match the frozen expectation." }),
    evidence: {
      ...evidenceBase(trace),
      proposal: {
        dependency: proposal.dependency,
        mode: proposal.mode,
        patch: proposal.patch,
        snapshot: {
          documentId: proposal.snapshot.documentId,
          revision: proposal.snapshot.revision,
          contentBytes: new TextEncoder().encode(proposal.snapshot.content).byteLength,
          selection: proposal.snapshot.selection,
          cursor: proposal.snapshot.cursor,
          readOnly: proposal.snapshot.readOnly
        }
      },
      currentSnapshot: { revision: current.revision, contentChanged: current.content !== proposal.snapshot.content, selection: current.selection, cursor: current.cursor, readOnly: current.readOnly },
      proposalCurrent: isCurrent,
      resolved: resolved ? { from: resolved.from, to: resolved.to, expectedText: resolved.expectedText, insertText: resolved.insertText, contentBytes: new TextEncoder().encode(resolved.content).byteLength } : null,
      safeToApply
    }
  };
}

async function runCancellationCase(testCase, modules) {
  const fixture = inputFor(testCase.id);
  const controller = new AbortController();
  const pending = deferred();
  const started = deferred();
  const providerSettled = deferred();
  let lateOutputObserved = false;
  let contentEmit;
  const trace = createTrace({ plannerResponse: fixture.plan });
  trace.invoke = async (prompt, systemPrompt, maxTokens, onChunk, outputSchema) => {
    const phase = outputSchema ? "planning" : "content";
    trace.invocations.push({ index: trace.invocations.length + 1, phase, controlled: true, outputSchema: Boolean(outputSchema), maxTokens });
    if (testCase.id === "E07" || phase === "content") {
      if (phase === "content") contentEmit = onChunk;
      started.resolve(phase);
      return pending.promise.then((value) => {
        lateOutputObserved = true;
        providerSettled.resolve();
        return value;
      });
    }
    return fixture.plan;
  };
  const running = outcomeOf(modules.runPlannedAiTask(fixture.request, fixture.snapshot, trace.options(controller.signal)));
  const startup = await waitForCancellationStart(started, running);
  if (startup.kind !== "started") {
    if (startup.kind === "timeout") controller.abort();
    const earlyOutcome = startup.kind === "settled" ? startup.outcome : null;
    return {
      ...testCase,
      passed: false,
      error: startup.kind === "timeout" ? "Runner did not enter its controlled provider call before the startup deadline."
        : earlyOutcome?.status === "rejected" ? observedError(earlyOutcome.error) : "Runner settled before reaching the controlled provider call.",
      evidence: {
        ...evidenceBase(trace),
        startup: startup.kind,
        outcome: earlyOutcome?.status ?? "pending",
        observedError: earlyOutcome?.status === "rejected" ? observedError(earlyOutcome.error) : undefined,
        proposal: earlyOutcome?.status === "resolved" ? earlyOutcome.value?.proposal ?? null : null,
        planningCalls: trace.invocations.filter(({ phase }) => phase === "planning").length,
        contentCalls: trace.invocations.filter(({ phase }) => phase === "content").length,
        providerSettledAfterCancel: false,
        lateOutputIgnored: false
      }
    };
  }
  const startedPhase = startup.phase;
  controller.abort();
  const outcome = await running;
  if (testCase.id === "E08") contentEmit?.("取消后的迟到片段");
  pending.resolve(testCase.id === "E07" ? fixture.plan : "取消后的迟到正文");
  await providerSettled.promise;
  const planningCalls = trace.invocations.filter(({ phase }) => phase === "planning").length;
  const contentCalls = trace.invocations.filter(({ phase }) => phase === "content").length;
  const noProposal = outcome.status === "rejected" || !outcome.value?.proposal;
  const lateIgnored = lateOutputObserved && noProposal && (testCase.id !== "E08" || trace.streamedChunks.length === 0);
  const cancellationMatches = testCase.expected.cancelled
    ? outcome.status === "rejected" && outcome.error?.name === "AiTaskCancelledError" && outcome.error?.message === "AI 任务已取消。"
    : outcome.status !== "rejected";
  const proposalMatches = noProposal === !testCase.expected.proposal;
  const lateOutputMatches = !testCase.expected.lateOutputIgnored || lateIgnored;
  const passed = cancellationMatches && proposalMatches && lateOutputMatches &&
    contentCalls === testCase.expected.contentCalls && trace.abortCalls === testCase.expected.abortCalls &&
    (testCase.id === "E07" ? planningCalls === 1 : planningCalls === 1 && startedPhase === "content");
  return {
    ...testCase,
    passed,
    ...(passed ? {} : { error: outcome.status === "rejected" ? observedError(outcome.error) : "Cancellation exposed a result or late output." }),
    evidence: {
      ...evidenceBase(trace),
      startup: "started",
      outcome: outcome.status,
      observedError: outcome.status === "rejected" ? observedError(outcome.error) : undefined,
      startedPhase,
      proposal: outcome.status === "resolved" ? outcome.value?.proposal ?? null : null,
      planningCalls,
      contentCalls,
      providerSettledAfterCancel: lateOutputObserved,
      streamedChunksAfterCancel: trace.streamedChunks.length,
      lateOutputIgnored: lateIgnored
    }
  };
}

async function runRejectedTaskCase(testCase, modules) {
  const fixture = inputFor(testCase.id);
  let bodyResponse = "";
  if (testCase.id === "E12") bodyResponse = "```js\nconst unfinished = true;";
  const trace = createTrace({ plannerResponse: fixture.plan, bodyResponse });
  const outcome = await outcomeOf(modules.runPlannedAiTask(fixture.request, fixture.snapshot, trace.options()));
  const planningCalls = trace.invocations.filter(({ phase }) => phase === "planning").length;
  const contentCalls = trace.invocations.filter(({ phase }) => phase === "content").length;
  const noProposal = outcome.status === "rejected" || !outcome.value?.proposal;
  const expectedCalls = testCase.expected;
  const error = outcome.status === "rejected" ? outcome.error : null;
  const message = error instanceof Error ? error.message : error === null ? "" : String(error);
  const diagnostic = error ? {
    stage: classifyFailureStage(error, trace),
    name: error instanceof Error ? error.name : "non-error rejection",
    code: error?.code ?? null,
    message
  } : null;
  const failureExpectation = expectedCalls.failure;
  const diagnosticMatches = Boolean(diagnostic && failureExpectation &&
    diagnostic.stage === failureExpectation.stage &&
    diagnostic.name === failureExpectation.name &&
    diagnostic.code === failureExpectation.code &&
    diagnostic.message.includes(failureExpectation.messageIncludes));
  const passed = (outcome.status === "rejected") === expectedCalls.rejected &&
    noProposal === !expectedCalls.proposal &&
    planningCalls === expectedCalls.planningCalls && contentCalls === expectedCalls.contentCalls &&
    diagnosticMatches;
  return {
    ...testCase,
    passed,
    ...(passed ? {} : { error: outcome.status === "rejected" ? observedError(outcome.error) : "Expected the task to reject without a proposal." }),
    evidence: {
      ...evidenceBase(trace),
      outcome: outcome.status,
      observedError: outcome.status === "rejected" ? observedError(outcome.error) : undefined,
      diagnostic,
      diagnosticMatches,
      proposal: outcome.status === "resolved" ? outcome.value?.proposal ?? null : null,
      planningCalls,
      contentCalls
    }
  };
}

/**
 * Runs controlled faults only. `modules` must come from the frozen formal v1
 * source snapshot; `invoke` is always replaced by this file's local mock.
 */
export async function runExecutionSafety(modules) {
  assertModules(modules);
  const results = [];
  for (const testCase of executionSafetyCases) {
    if (["E01", "E02", "E03", "E04", "E05", "E06"].includes(testCase.id)) {
      results.push(await runProposalCurrencyCase(testCase, modules));
    } else if (testCase.id === "E07" || testCase.id === "E08") {
      results.push(await runCancellationCase(testCase, modules));
    } else {
      results.push(await runRejectedTaskCase(testCase, modules));
    }
  }
  return results;
}
