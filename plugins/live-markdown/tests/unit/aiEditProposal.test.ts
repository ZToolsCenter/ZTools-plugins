import { describe, expect, it } from "vitest";
import { isAiProposalCurrent, isCurrentAiSnapshot, resolveAiEdit } from "../../src/core/ai/editProposal";
import { AiDocumentSnapshot, AiEditProposal } from "../../src/types/aiEditing";

const snapshot = (patch: Partial<AiDocumentSnapshot> = {}): AiDocumentSnapshot => ({
  documentId: "note.md", revision: 4, content: "same\n same", selection: { from: 6, to: 10 }, cursor: 10, readOnly: false, ...patch
});

describe("AI edit proposal safety", () => {
  it("replaces only the frozen exact selection and defaults to full document without selection", () => {
    const selected: AiEditProposal = { snapshot: snapshot(), mode: "replace", text: "updated" };
    expect(resolveAiEdit(selected)?.content).toBe("same\n updated");
    const whole: AiEditProposal = { snapshot: snapshot({ selection: null, cursor: 0 }), mode: "replace", text: "entire" };
    expect(resolveAiEdit(whole)?.content).toBe("entire");
  });

  it("inserts at the frozen cursor, appends at EOF, and rejects read-only or invalid ranges", () => {
    expect(resolveAiEdit({ snapshot: snapshot({ cursor: 4 }), mode: "insert", text: "!" })?.content).toBe("same!\n same");
    expect(resolveAiEdit({ snapshot: snapshot(), mode: "append", text: "!" })?.content).toBe("same\n same!");
    expect(resolveAiEdit({ snapshot: snapshot({ readOnly: true }), mode: "replace", text: "x" })).toBeNull();
    expect(resolveAiEdit({ snapshot: snapshot({ selection: { from: 0, to: 99 } }), mode: "replace", text: "x" })).toBeNull();
  });

  it("separates block fragments from document text without rewriting surrounding bytes", () => {
    const mermaid = "```mermaid\ngraph TD\n  A --> B\n```";
    const atStart = snapshot({ content: "# 发布流程", selection: null, cursor: 0 });
    const startEdit = resolveAiEdit({ snapshot: atStart, mode: "insert", text: mermaid });
    expect(startEdit?.insertText).toBe(`${mermaid}\n\n`);
    expect(startEdit?.content).toBe(`${mermaid}\n\n# 发布流程`);

    const atEnd = snapshot({ content: "说明文字", selection: null, cursor: 4 });
    const appendEdit = resolveAiEdit({ snapshot: atEnd, mode: "append", text: "| 名称 | 值 |\n| --- | --- |\n| A | 1 |" });
    expect(appendEdit?.insertText).toBe("\n\n| 名称 | 值 |\n| --- | --- |\n| A | 1 |");
    expect(appendEdit?.content).toBe("说明文字\n\n| 名称 | 值 |\n| --- | --- |\n| A | 1 |");
  });

  it("preserves existing line endings and adds only missing block boundaries", () => {
    const fence = "```ts\nconst x = 1;\n```";
    for (const ending of ["\n", "\n\n"]) {
      const content = `before${ending}after`;
      const cursor = `before${ending}`.length;
      const edit = resolveAiEdit({ snapshot: snapshot({ content, selection: null, cursor }), mode: "insert", text: fence });
      const prefix = ending === "\n" ? "before\n\n" : `before${ending}`;
      expect(edit?.content).toBe(`${prefix}${fence}\n\nafter`);
    }

    const middle = resolveAiEdit({
      snapshot: snapshot({ content: "keep before and after", selection: null, cursor: 11 }),
      mode: "insert",
      text: "$$\nx^2\n$$"
    });
    expect(middle?.content).toBe("keep before\n\n$$\nx^2\n$$\n\n and after");

    const crlf = resolveAiEdit({
      snapshot: snapshot({ content: "# old\r\n# next", selection: null, cursor: 7 }),
      mode: "insert",
      text: fence
    });
    expect(crlf?.content).toBe(`# old\r\n\r\n${fence}\r\n\r\n# next`);
  });

  it("keeps adjacent generated tables as separate blocks and counts existing fragment newlines", () => {
    const priorTable = "| old |\n| --- |\n| value |";
    const nextTable = "| new |\n| --- |\n| value |";
    const appended = resolveAiEdit({
      snapshot: snapshot({ content: priorTable, selection: null, cursor: priorTable.length }),
      mode: "append",
      text: nextTable
    });
    expect(appended?.content).toBe(`${priorTable}\n\n${nextTable}`);

    const fenced = "\n```ts\nconst x = 1;\n```\n";
    const onceBefore = resolveAiEdit({
      snapshot: snapshot({ content: "before\nafter", selection: null, cursor: 7 }),
      mode: "insert",
      text: fenced
    });
    expect(onceBefore?.content).toBe(`before\n${fenced}\nafter`);

    const twiceBefore = resolveAiEdit({
      snapshot: snapshot({ content: "before\n\nafter", selection: null, cursor: 8 }),
      mode: "insert",
      text: fenced
    });
    expect(twiceBefore?.content).toBe(`before\n\n${fenced}\nafter`);
  });

  it("leaves inline insertions and replacements byte-for-byte unchanged", () => {
    const inline = resolveAiEdit({ snapshot: snapshot({ cursor: 4 }), mode: "insert", text: "result" });
    expect(inline?.insertText).toBe("result");
    expect(inline?.content).toBe("sameresult\n same");

    const replacement = resolveAiEdit({ snapshot: snapshot(), mode: "replace", text: "```mermaid\ngraph TD\n```" });
    expect(replacement?.insertText).toBe("```mermaid\ngraph TD\n```");
    expect(replacement?.content).toBe("same\n ```mermaid\ngraph TD\n```");
  });

  it("rejects stale document, revision, content, and selection snapshots", () => {
    const frozen = snapshot();
    expect(isCurrentAiSnapshot(frozen, snapshot())).toBe(true);
    expect(isCurrentAiSnapshot(frozen, snapshot({ revision: 5 }))).toBe(false);
    expect(isCurrentAiSnapshot(frozen, snapshot({ content: "changed" }))).toBe(false);
    expect(isCurrentAiSnapshot(frozen, snapshot({ selection: null }))).toBe(false);
    expect(isCurrentAiSnapshot(frozen, snapshot({ documentId: "other.md" }))).toBe(false);
  });

  it("applies explicit patches exactly and rejects stale or unsafe ranges", () => {
    const content = "front\r\nanchor\r\nback";
    const proposal: AiEditProposal = {
      snapshot: snapshot({ content, selection: null, cursor: 2 }),
      text: "inserted",
      mode: "insert",
      patch: { from: 7, to: 13, expectedText: "anchor", insertText: "A\r\n\r\nB" },
      dependency: "document"
    };
    expect(resolveAiEdit(proposal)?.content).toBe("front\r\nA\r\n\r\nB\r\nback");
    expect(resolveAiEdit({ ...proposal, patch: { ...proposal.patch!, expectedText: "wrong" } })).toBeNull();
    expect(resolveAiEdit({ ...proposal, patch: { from: 6, to: 13, expectedText: "\nanchor", insertText: "x" } })).toBeNull();
  });

  it("invalidates proposals by their target dependency", () => {
    const frozen = snapshot();
    const documentProposal: AiEditProposal = { snapshot: frozen, mode: "append", text: "x", dependency: "document" };
    const selectionProposal: AiEditProposal = { snapshot: frozen, mode: "replace", text: "x", dependency: "selection" };
    const cursorProposal: AiEditProposal = { snapshot: frozen, mode: "insert", text: "x", dependency: "cursor" };
    const movedSelection = snapshot({ selection: { from: 0, to: 1 }, cursor: 1 });
    expect(isAiProposalCurrent(documentProposal, movedSelection)).toBe(true);
    expect(isAiProposalCurrent(selectionProposal, movedSelection)).toBe(false);
    expect(isAiProposalCurrent(cursorProposal, movedSelection)).toBe(false);
    expect(isAiProposalCurrent(documentProposal, snapshot({ revision: 5 }))).toBe(false);
    expect(isAiProposalCurrent(documentProposal, snapshot({ readOnly: true }))).toBe(false);
  });

  it("keeps unmappable legacy selections blocked while allowing a bound document patch", () => {
    const invalid = snapshot({ selection: null, selectionValid: false });
    const legacy: AiEditProposal = { snapshot: invalid, mode: "replace", text: "x" };
    expect(isAiProposalCurrent(legacy, { ...invalid })).toBe(false);
    const bound: AiEditProposal = { ...legacy, mode: "append", dependency: "document", patch: { from: invalid.content.length, to: invalid.content.length, expectedText: "", insertText: "x" } };
    expect(isAiProposalCurrent(bound, { ...invalid })).toBe(true);
  });
});
