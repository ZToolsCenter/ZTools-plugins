import { describe, expect, it } from "vitest";
import type { AiTaskRequest, AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";
import { deriveInstructionContract } from "../../src/core/ai/instructionConstraints";
import { buildAiIntentCandidates } from "../../src/core/ai/intentContext";
import { resolveKnownIntent } from "../../src/core/ai/resolvedIntentContract";
import { bindThinTask } from "../../src/core/ai/thinTaskBinding";
import { runPlannedAiTaskCore } from "../../src/core/ai/plannedTaskRunnerCore";
import type { AiDocumentSnapshot } from "../../src/types/aiEditing";

const source = "# Notes\n\nExisting text.";
const customRequest = (instruction: string, content = source): AiTaskRequest => ({
  action: "custom", source: content, userPrompt: instruction, baseSystemPrompt: "",
  actionDefinition: { id: "custom", label: "custom", prompt: instruction, system: "" }
});

function snapshot(content = source, cursor: number | null = content.length, selection: AiDocumentSnapshot["selection"] = null): AiDocumentSnapshot {
  return { documentId: "literal.md", revision: 3, content, cursor, selection, readOnly: false };
}

function contractFor(instruction: string, document: AiDocumentSnapshot) {
  return deriveInstructionContract(instruction, {
    hasSelection: Boolean(document.selection && document.selection.to > document.selection.from),
    hasCursor: document.cursor !== null
  });
}

function expectedWrite(instruction: string, role = "write") {
  const contract = deriveInstructionContract(instruction);
  return contract.literals.filter((literal) => literal.role === role);
}

async function runLiteral(instruction: string, document = snapshot()) {
  let calls = 0;
  const options: AiTaskRunnerOptions = {
    invoke: async () => { calls += 1; throw new Error("literal edit should not call provider"); },
    isCurrent: () => true, abortCurrent() {}
  };
  const result = await runPlannedAiTaskCore(customRequest(instruction, document.content), document, options);
  return { calls, result };
}

function apply(document: AiDocumentSnapshot, patch: NonNullable<NonNullable<Awaited<ReturnType<typeof runPlannedAiTaskCore>>["proposal"]>["patch"]>): string {
  return document.content.slice(0, patch.from) + patch.insertText + document.content.slice(patch.to);
}

describe("grounded literal binding in the default thin path", () => {
  it("treats a prefix colon as a delimiter and appends the exact unquoted payload with zero calls", async () => {
    const instruction = "在文末原样追加：Ship after checks.";
    const writes = expectedWrite(instruction);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ role: "write", raw: "Ship after checks.", value: "Ship after checks." });
    expect(instruction.slice(writes[0].from, writes[0].to)).toBe(writes[0].raw);
    const document = snapshot();
    const { calls, result } = await runLiteral(instruction, document);
    expect(calls).toBe(0);
    expect(apply(document, result.proposal!.patch!)).toBe(`${source}\n\nShip after checks.`);
  });

  it("defaults an EOF literal insertion to a block while preserving quoted emoji", async () => {
    const instruction = "文末追加‘发布前再核对 🧪’。";
    const writes = expectedWrite(instruction);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ raw: "发布前再核对 🧪", value: "发布前再核对 🧪" });
    const document = snapshot();
    const { calls, result } = await runLiteral(instruction, document);
    expect(calls).toBe(0);
    expect(result.proposal?.patch).toMatchObject({ from: source.length, to: source.length, insertText: "\n\n发布前再核对 🧪" });
    expect(apply(document, result.proposal!.patch!)).toBe(`${source}\n\n发布前再核对 🧪`);
  });

  it("does not treat an artifact heading parameter as the complete insertion body", () => {
    const instruction = "在文末新增 Markdown H2 标题“状态”";
    const document = snapshot();
    const contract = contractFor(instruction, document);
    const candidates = buildAiIntentCandidates(instruction, document.content, contract);
    expect(expectedWrite(instruction)).toHaveLength(0);
    expect(resolveKnownIntent(instruction, document, candidates, contract)).toBeNull();
    expect(bindThinTask(customRequest(instruction), document, instruction, contract, candidates)?.intent)
      .toMatchObject({ kind: "edit", operation: "insert", content: { mode: "generate" } });
  });

  it("keeps a complete quoted fenced code artifact as one exact write literal", () => {
    const code = "```txt\n标题路径: foo\n```";
    const instruction = `在文末原样新增代码块“${code}”`;
    const document = snapshot();
    const contract = contractFor(instruction, document);
    const candidates = buildAiIntentCandidates(instruction, document.content, contract);
    const writes = expectedWrite(instruction);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ role: "write", raw: code, value: code });
    expect(resolveKnownIntent(instruction, document, candidates, contract)).not.toBeNull();
  });

  it("keeps a follow-up instruction outside the heading parameter and leaves it for generation", () => {
    const instruction = "在文末新增 Markdown H2 标题“状态”，并解释它的用途。";
    const document = snapshot();
    const contract = contractFor(instruction, document);
    const candidates = buildAiIntentCandidates(instruction, document.content, contract);
    expect(expectedWrite(instruction)).toHaveLength(0);
    expect(resolveKnownIntent(instruction, document, candidates, contract)).toBeNull();
    expect(bindThinTask(customRequest(instruction), document, instruction, contract, candidates)?.intent)
      .toMatchObject({ kind: "edit", operation: "insert", content: { mode: "generate" } });
  });

  it("binds an English end-of-document add-exactly command from its source span", async () => {
    const instruction = "At the end of the document, add exactly Ship after checks.";
    const writes = expectedWrite(instruction);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ raw: "Ship after checks.", value: "Ship after checks." });
    expect(instruction.slice(writes[0].from, writes[0].to)).toBe(writes[0].raw);
    const document = snapshot();
    const { calls, result } = await runLiteral(instruction, document);
    expect(calls).toBe(0);
    expect(apply(document, result.proposal!.patch!)).toBe(`${source}\n\nShip after checks.`);
  });

  it("keeps English replacement operands exact while excluding the last/exact qualifiers", () => {
    const instruction = "Replace only the last exact Alpha is old. with Alpha is new.";
    const literals = deriveInstructionContract(instruction).literals;
    expect(literals.filter(({ role }) => role === "find")).toEqual([
      { role: "find", from: instruction.indexOf("Alpha is old."), to: instruction.indexOf("Alpha is old.") + 13,
        raw: "Alpha is old.", value: "Alpha is old." }
    ]);
    expect(literals.filter(({ role }) => role === "write")).toEqual([
      { role: "write", from: instruction.indexOf("Alpha is new."), to: instruction.indexOf("Alpha is new.") + 13,
        raw: "Alpha is new.", value: "Alpha is new." }
    ]);
  });

  it("grounds Chinese find and replacement text from a generic 改成 relation", () => {
    const instruction = "只润色选区中的“我们以经完成备份。”，只将以经改成已经，其余字不变。";
    const literals = deriveInstructionContract(instruction).literals;
    expect(literals.filter(({ role }) => role === "find").map(({ raw, value }) => ({ raw, value })))
      .toEqual([{ raw: "以经", value: "以经" }]);
    expect(literals.filter(({ role }) => role === "write").map(({ raw, value }) => ({ raw, value })))
      .toEqual([{ raw: "已经", value: "已经" }]);
    for (const literal of literals.filter(({ role }) => role === "find" || role === "write")) {
      expect(instruction.slice(literal.from, literal.to)).toBe(literal.raw);
    }
  });

  it("still rejects an extra connected task after a polish-labeled exact refinement", () => {
    const baseInstruction = "只润色选区中的“我们以经完成备份。”，只将以经改成已经，其余字不变。";
    const instruction = `${baseInstruction}并解释修改原因。`;
    const document = snapshot("我们以经完成备份。", 0, { from: 0, to: "我们以经完成备份。".length });
    const contract = contractFor(baseInstruction, document);
    const candidates = buildAiIntentCandidates(instruction, document.content, contract);
    expect(contract.operation).toMatchObject({ state: "explicit", value: "replace_exact" });
    expect(contract.occurrence).toMatchObject({ state: "explicit", value: "single" });
    expect(contract.generationTasks?.state).toBe("explicit");
    expect(resolveKnownIntent(instruction, document, candidates, contract)).toBeNull();
  });

  it("does not silently absorb a follow-up explanation into an unquoted exact payload", () => {
    const instruction = "在文末原样追加：Ship after checks.，并解释这样安排的原因。";
    const document = snapshot();
    const contract = contractFor(instruction, document);
    const candidates = buildAiIntentCandidates(instruction, document.content, contract);
    expect(bindThinTask(customRequest(instruction), document, instruction, contract, candidates)).toBeNull();
  });

  it("keeps CRLF after a colon outside the exact inserted payload", async () => {
    const instruction = "在文末原样追加：\r\nShip after checks.";
    const writes = expectedWrite(instruction);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ raw: "Ship after checks.", value: "Ship after checks." });
    expect(instruction.slice(writes[0].from, writes[0].to)).toBe(writes[0].raw);
    const { calls, result } = await runLiteral(instruction, snapshot());
    expect(calls).toBe(0);
    expect(result.proposal?.patch?.insertText).toBe("\n\nShip after checks.");
  });

  it("preserves punctuation and nested quotation marks inside a quoted payload", async () => {
    const instruction = "文末追加“说：‘先检查’，再发布！”";
    const writes = expectedWrite(instruction);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ raw: "说：‘先检查’，再发布！", value: "说：‘先检查’，再发布！" });
    const { calls, result } = await runLiteral(instruction, snapshot());
    expect(calls).toBe(0);
    expect(result.proposal?.patch?.insertText).toBe("\n\n说：‘先检查’，再发布！");
  });

  it("uses an inline cursor insertion when no layout was stated", async () => {
    const instruction = "在光标处原样插入“！”";
    const document = snapshot("Hi", 1);
    const { calls, result } = await runLiteral(instruction, document);
    expect(calls).toBe(0);
    expect(result.proposal?.dependency).toBe("cursor");
    expect(result.proposal?.patch).toEqual({ from: 1, to: 1, expectedText: "", insertText: "！" });
    expect(apply(document, result.proposal!.patch!)).toBe("H！i");
  });

  it("assigns a single unquoted selected-replacement payload the write role", () => {
    const instruction = "只把当前选区替换为 Backup verified.";
    const writes = expectedWrite(instruction);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ role: "write", raw: "Backup verified.", value: "Backup verified." });
    expect(instruction.slice(writes[0].from, writes[0].to)).toBe(writes[0].raw);
  });

  it("binds a selected rewrite literally when the operation constraint is rewrite", () => {
    const instruction = "只把当前选区替换为 Backup verified.";
    const document = snapshot("before selected after", 13, { from: 7, to: 15 });
    const contract = contractFor(instruction, document);
    const rewriteContract = {
      ...contract,
      operation: { state: "explicit" as const, value: "rewrite" as const,
        evidence: contract.operation.state === "explicit" ? contract.operation.evidence : [] }
    };
    const candidates = buildAiIntentCandidates(instruction, document.content, rewriteContract);
    const bound = resolveKnownIntent(instruction, document, candidates, rewriteContract);
    expect(bound?.intent).toMatchObject({ kind: "edit", operation: "rewrite", target: "selection", content: { mode: "literal", text: "Backup verified." } });
    expect(bound?.range).toEqual({ from: 7, to: 15, expectedText: "selected" });
  });

  it("does not turn a long literal into a silent generation shortcut", () => {
    const instruction = `在文末原样追加“${"x".repeat(300)}”`;
    const document = snapshot();
    const contract = contractFor(instruction, document);
    const candidates = buildAiIntentCandidates(instruction, document.content, contract);
    expect(expectedWrite(instruction)).toHaveLength(1);
    expect(resolveKnownIntent(instruction, document, candidates, contract)).toBeNull();
    expect(bindThinTask(customRequest(instruction), document, instruction, contract, candidates)).toBeNull();
  });

  it("does not silently discard an additional generation request after a literal", () => {
    const instruction = "在文末原样追加“Ship after checks.”，再总结全文。";
    const document = snapshot();
    const contract = contractFor(instruction, document);
    const candidates = buildAiIntentCandidates(instruction, document.content, contract);
    expect(expectedWrite(instruction)).toHaveLength(1);
    expect(resolveKnownIntent(instruction, document, candidates, contract)).toBeNull();
    expect(bindThinTask(customRequest(instruction), document, instruction, contract, candidates)).toBeNull();
  });

  it("does not program-bind a literal when layout constraints conflict", () => {
    const instruction = "在光标处行内插入并另起一段“！”";
    const document = snapshot("Hi", 1);
    const contract = contractFor(instruction, document);
    const candidates = buildAiIntentCandidates(instruction, document.content, contract);
    expect(contract.layout.state).toBe("conflict");
    expect(resolveKnownIntent(instruction, document, candidates, contract)).toBeNull();
    expect(bindThinTask(customRequest(instruction, document.content), document, instruction, contract, candidates)).toBeNull();
  });
});
