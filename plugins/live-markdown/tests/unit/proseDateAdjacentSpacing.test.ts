import { describe, expect, it } from "vitest";
import {
  findEligibleProseDateOwner,
  validateProseDateOwnerReplacement
} from "../../src/core/ai/proseDateOwnership";

function findFact(source: string) {
  return findEligibleProseDateOwner({ source, sourcePlanRange: { from: 0, to: source.length }, astSyntaxRanges: [] });
}

function validate(source: string, candidate: string): string {
  const fact = findFact(source);
  expect(fact).not.toBeNull();
  return validateProseDateOwnerReplacement(fact!, source, candidate);
}

describe("source-bound date adjacency typography", () => {
  it.each([
    ["ASCII space before ISO date", "由林安负责的验收日期是2026-11-03，计划发布。", "由林安负责的验收日期是 2026-11-03，计划发布。"],
    ["ideographic space before ISO date", "由林安负责的验收日期是2026-11-03，计划发布。", "由林安负责的验收日期是　2026-11-03，计划发布。"],
    ["nonbreaking space before ISO date", "由林安负责的验收日期是2026-11-03，计划发布。", "由林安负责的验收日期是\u00a02026-11-03，计划发布。"],
    ["horizontal spaces on both date boundaries", "由林安负责的验收日期是2026-11-03，计划发布。", "由林安负责的验收日期是 2026-11-03　，计划发布。"],
    ["pre-spaced source and candidate", "由周宁负责的交付日期为　2027-02-28，等待验收。", "由周宁负责的交付日期为 2027-02-28，等待验收。"],
    ["event after date with adjacent spaces", "由陈晨负责的审计日期是2026-11-03", "由陈晨负责的　2026-11-03　审计"]
  ])("keeps owner, event, and date under %s", (_label, source, candidate) => {
    expect(validate(source, candidate)).toBe(candidate);
  });

  it("keeps the existing equivalent Chinese calendar spelling path", () => {
    const source = "由林安负责的验收日期是2026-11-03";
    const candidate = "由林安负责的验收日期是　2026年11月3日";
    expect(validate(source, candidate)).toBe("由林安负责的验收日期是　2026-11-03");
  });

  it.each([
    ["changed date value", "由林安负责的验收日期是 2026-11-04，计划发布。"],
    ["missing date", "由林安负责的验收日期是，计划发布。"],
    ["missing owner", "验收日期是 2026-11-03，计划发布。"],
    ["changed owner", "由王安负责的验收日期是 2026-11-03，计划发布。"],
    ["changed event", "由林安负责的交付日期是 2026-11-03，计划发布。"],
    ["changed owner relation", "由林安安排的验收日期是 2026-11-03，计划发布。"],
    ["date moved before owner", "2026-11-03由林安负责的验收日期，计划发布。"],
    ["added statement", "由林安负责的验收日期是 2026-11-03，计划已发布。"],
    ["tab before date", "由林安负责的验收日期是\t2026-11-03，计划发布。"],
    ["newline before date", "由林安负责的验收日期是\n2026-11-03，计划发布。"],
    ["tab after date", "由林安负责的验收日期是2026-11-03\t，计划发布。"],
    ["newline after date", "由林安负责的验收日期是2026-11-03\n，计划发布。"]
  ])("rejects %s", (_label, candidate) => {
    const source = "由林安负责的验收日期是2026-11-03，计划发布。";
    expect(() => validate(source, candidate)).toThrow();
  });
});
