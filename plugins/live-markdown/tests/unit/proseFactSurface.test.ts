import { describe, expect, it } from "vitest";
import { buildThinProseSlots } from "../../src/core/ai/thinProseSlots";
import { prepareReadableProse } from "../../src/core/ai/readableProseView";
import { restoreUniqueEquivalentIsoDate } from "../../src/core/ai/proseFactSurface";
import { restoreSourceTerminalMark } from "../../src/core/ai/proseReadonlyTrivia";

const instruction = "润色正文使其简洁，不改变日期和负责人。";
const source = "由林安负责的排期日期是2026-11-03，请请大家进行确认。";

function viewFor(text: string) {
  const slots = buildThinProseSlots(text, instruction);
  const view = prepareReadableProse(text, slots);
  if (!view) throw new Error("Expected a readable prose view for the captured one-line case.");
  return { slots, view };
}

describe("trusted prose fact surface normalization", () => {
  it("projects a uniquely equivalent Chinese date spelling back to its ISO source token", () => {
    const { slots, view } = viewFor(source);
    const decoded = view.decode("由林安负责，排期日期为2026年11月3日，请大家进行确认。");

    expect(decoded.get(slots[0]!.id)).toBe("由林安负责，排期日期为");
    expect(decoded.get(slots[1]!.id)).toBe("，请大家进行确认。");
  });

  it("assigns only a horizontal space inserted at a read-only date boundary to the adjacent text slot", () => {
    const { slots, view } = viewFor(source);
    const decoded = view.decode("由林安负责的排期日期是 2026-11-03，请请大家进行确认。");
    const fullwidthSpaceDecoded = view.decode("由林安负责的排期日期是　2026-11-03，请请大家进行确认。");

    expect(decoded.get(slots[0]!.id)).toBe("由林安负责的排期日期是 ");
    expect(decoded.get(slots[1]!.id)).toBe("，请请大家进行确认。");
    expect(fullwidthSpaceDecoded.get(slots[0]!.id)).toBe("由林安负责的排期日期是　");
  });

  it("keeps changed, swapped, or repeated dates protected", () => {
    const { view } = viewFor(source);
    expect(() => view.decode("由林安负责的排期日期是2026年11月4日，请请大家进行确认。"))
      .toThrow("模型修改了只读内容或跨越多个正文槽，原文未修改。");

    const multipleDates = "A排期2026-11-03，B排期2026-11-04。";
    const multiSlots = buildThinProseSlots(multipleDates, instruction);
    const multiView = prepareReadableProse(multipleDates, multiSlots);
    if (!multiView) throw new Error("Expected a readable view for the two-date case.");
    expect(() => multiView.decode("A排期2026-11-04，B排期2026-11-03。"))
      .toThrow("模型修改了只读内容或跨越多个正文槽，原文未修改。");
    expect(() => view.decode("由林安负责的排期日期是2026年11月3日，请请大家确认，另一个日期是2026年11月3日。"))
      .toThrow("模型修改了只读内容或跨越多个正文槽，原文未修改。");
  });

  it("restores only one valid Gregorian date with trusted readonly source evidence", () => {
    const restore = (sourceView: string, modelView: string, readonlySpans = [{ from: 0, to: sourceView.length }]) =>
      restoreUniqueEquivalentIsoDate(sourceView, modelView, readonlySpans);

    expect(restore("2024-02-29", "2024年2月29日")).toBe("2024-02-29");
    expect(restore("2023-02-29", "2023年2月29日")).toBe("2023年2月29日");
    expect(restore("2024-02-29", "2024年2月30日")).toBe("2024年2月30日");
    expect(restore("2024-02-29", "2024年2月29日", [])).toBe("2024年2月29日");
    expect(restore("2026-11-03", "2026年11月3日 08:30")).toBe("2026年11月3日 08:30");
    expect(restore("2026-11-03T08:30Z", "2026年11月3日T08:30Z"))
      .toBe("2026年11月3日T08:30Z");
    expect(restore("2026-11-03 +08:00", "2026年11月3日 +08:00"))
      .toBe("2026年11月3日 +08:00");
    expect(restore("2026-11-03 +0800", "2026年11月3日 +0800"))
      .toBe("2026年11月3日 +0800");
    expect(restore("2026-11-03UTC", "2026年11月3日UTC"))
      .toBe("2026年11月3日UTC");
    expect(restore("2026-11-03 08:30", "2026年11月3日08:30"))
      .toBe("2026年11月3日08:30");
    expect(restore("2026-11-03至5日", "2026年11月3日至5日"))
      .toBe("2026年11月3日至5日");
    expect(restore("2026-11-03/05", "2026年11月3日/05"))
      .toBe("2026年11月3日/05");
    expect(restore("2026-11-03", "日期为2026年11月3日，另有2026年11月3日"))
      .toBe("日期为2026年11月3日，另有2026年11月3日");
    expect(restore("2026-11-03 至 2026-11-04", "2026年11月3日 至 2026年11月4日"))
      .toBe("2026年11月3日 至 2026年11月4日");
  });

  it("preserves inline code, math, CRLF, and Chinese punctuation around a date", () => {
    const crlfSource = "前置说明\r\n请核对2026-11-03，代码`const day = \\\"2026-11-03\\\"`，公式$2026-11-03$。\r\n后续内容";
    const lineStart = crlfSource.indexOf("请核对");
    const lineEnd = crlfSource.indexOf("\r\n", lineStart);
    const slots = buildThinProseSlots(crlfSource, instruction).filter(slot =>
      slot.range.from >= lineStart && slot.range.to <= lineEnd);
    const view = prepareReadableProse(crlfSource, slots);
    if (!view) throw new Error("Expected a readable CRLF prose line.");
    expect(view.text).toContain("ProtectedCode");
    expect(view.text).toContain("ProtectedMath");
    const raw = view.text.replace("2026-11-03", "2026年11月3日");
    const decoded = view.decode(raw);
    const projected = [...slots].sort((left, right) => right.range.from - left.range.from).reduce(
      (text, slot) => text.slice(0, slot.range.from) + decoded.get(slot.id)! + text.slice(slot.range.to),
      crlfSource
    );
    expect(projected).toBe(crlfSource);
  });

  it("rejects ambiguous boundary ownership and non-space insertions", () => {
    const adjacentSource = "ab";
    const adjacentSlots = [
      { id: "left", range: { from: 0, to: 1 }, sourceText: "a", contextBefore: "", contextAfter: "b" },
      { id: "right", range: { from: 1, to: 2 }, sourceText: "b", contextBefore: "a", contextAfter: "" }
    ];
    const adjacentView = prepareReadableProse(adjacentSource, adjacentSlots);
    if (!adjacentView) throw new Error("Expected adjacent owned slots to remain a valid view.");
    expect(() => adjacentView.decode("a b")).toThrow("模型修改了只读内容或跨越多个正文槽，原文未修改。");

    const { view } = viewFor(source);
    expect(() => view.decode("由林安负责的排期日期是x2026-11-03，请请大家进行确认。"))
      .toThrow("模型修改了只读内容或跨越多个正文槽，原文未修改。");
  });

  it("restores only a source terminal mark after an exact protected anchor", () => {
    const capturedSource = "The [release](https://internal.invalid/r) have 3 stages and use `R17`.";
    const slots = buildThinProseSlots(capturedSource, instruction);
    const view = prepareReadableProse(capturedSource, slots);
    if (!view) throw new Error("Expected the captured code-count prose view.");
    const placeholder = view.readonlyPlaceholders[0];
    if (!placeholder) throw new Error("Expected the protected inline-code placeholder.");
    const capturedRaw = `The release has 3 stages and uses ${placeholder}`;

    expect(view.text).toBe(`The release have 3 stages and use ${placeholder}.`);
    const decoded = view.decode(capturedRaw);
    const projected = [...slots].sort((left, right) => right.range.from - left.range.from).reduce(
      (text, slot) => text.slice(0, slot.range.from) + decoded.get(slot.id)! + text.slice(slot.range.to),
      capturedSource
    );
    expect(projected).toBe("The [release](https://internal.invalid/r) has 3 stages and uses `R17`.");
    expect(() => view.decode(`The release has 4 stages and uses ${placeholder}`)).toThrow();
    expect(() => view.decode(`The release has stages and uses ${placeholder}`)).toThrow();
    expect(() => view.decode(`The release has 3 stages and uses ${placeholder.replace("Code1", "Code2")}`)).toThrow();
    expect(() => view.decode(`The release has 3 stages and uses ${placeholder} today`)).toThrow();
    expect(() => view.decode(`${capturedRaw} ${placeholder}`)).toThrow();
    expect(() => view.decode(`${capturedRaw}fake`)).toThrow();
  });

  it("restores Chinese terminal punctuation only when it follows the same opaque anchor", () => {
    const capturedSource = "请核对代码`R17`。";
    const slots = buildThinProseSlots(capturedSource, instruction);
    const view = prepareReadableProse(capturedSource, slots);
    if (!view) throw new Error("Expected a Chinese terminal punctuation view.");
    const placeholder = view.readonlyPlaceholders[0]!;
    expect(() => view.decode(`请核对代码${placeholder}`)).not.toThrow();
    expect(() => view.decode("请核对代码")).toThrow();
    expect(() => view.decode(`请核对代码${placeholder}，继续说明`)).toThrow();
    expect(() => view.decode(`请核对代码${placeholder}x`)).toThrow();
  });

  it("uses a unique protected number as a terminal anchor without masking number edits", () => {
    const numericSource = "Version 3.";
    const slots = buildThinProseSlots(numericSource, instruction);
    const view = prepareReadableProse(numericSource, slots);
    if (!view) throw new Error("Expected a protected-number prose view.");
    expect(view.text).toBe("Version 3.");
    expect(() => view.decode("Version 3")).not.toThrow();
    expect(() => view.decode("Version 4")).toThrow();
    expect(() => view.decode("Version")).toThrow();
  });

  it("does not infer terminal punctuation from editable prose alone", () => {
    const proseSource = "The release has a problem.";
    const slots = buildThinProseSlots(proseSource, instruction);
    const view = prepareReadableProse(proseSource, slots);
    if (!view) throw new Error("Expected an unanchored prose view.");
    expect(restoreSourceTerminalMark(proseSource, "The release has a problem", [
      { viewFrom: 0, viewTo: proseSource.length }
    ])).toBe("The release has a problem");
    const decoded = view.decode("The release has a problem");
    const projected = [...slots].sort((left, right) => right.range.from - left.range.from).reduce(
      (text, slot) => text.slice(0, slot.range.from) + decoded.get(slot.id)! + text.slice(slot.range.to),
      proseSource
    );
    expect(projected).toBe("The release has a problem");
  });

  it("does not normalize a date range ending at present or today", () => {
    const restore = (sourceView: string, modelView: string) =>
      restoreUniqueEquivalentIsoDate(sourceView, modelView, [{ from: 0, to: sourceView.length }]);
    expect(restore("2026-11-03 to present", "2026年11月3日 to present"))
      .toBe("2026年11月3日 to present");
    expect(restore("2026-11-03 至今", "2026年11月3日至今"))
      .toBe("2026年11月3日至今");
    expect(restore("2026-11-03 to today", "2026年11月3日 to today"))
      .toBe("2026年11月3日 to today");
  });
});
