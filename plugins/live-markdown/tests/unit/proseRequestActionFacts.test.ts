import { describe, expect, it } from "vitest";
import { validateProseRequestActionFacts } from "../../src/core/ai/proseRequestActionFacts";

const rejectCases = [
  ["deleting a repeated-action modifier", "请请星河项目组再次确认。", "请请星河项目组确认。"],
  ["deleting 再次 in the captured numeric sentence", "本次核对金额为18万元，请请星河项目组再次确认。", "本次核对金额为18万元，请请星河项目组确认。"],
  ["adding a repeated-action modifier", "请星河项目组确认。", "请星河项目组再次确认。"],
  ["changing repeat to redo", "请星河项目组再次确认。", "请星河项目组重新确认。"],
  ["distinguishing single 再 from 再次", "请星河项目组再次确认。", "请星河项目组再确认。"],
  ["preserving modifier order", "请项目组再次先确认范围。", "请项目组先再次确认范围。"],
  ["changing a named project group", "请星河项目组再次确认范围。", "请海岚项目组再次确认范围。"],
  ["changing a named team", "请星河测试组再次确认范围。", "请星河财务组再次确认范围。"],
  ["not replacing a named recipient with a generic one", "请星河项目组再次确认范围。", "请大家再次确认范围。"],
  ["not deleting an explicit recipient", "请星河项目组再次确认范围。", "请再次确认范围。"],
  ["not changing a direct you request to everyone", "请你确认排期。", "请大家确认排期。"],
  ["not changing an honorific recipient to a collective", "请您确认排期。", "请各位确认排期。"],
  ["not changing the plural direct recipient identity", "请你们确认排期。", "请您们确认排期。"],
  ["protecting an ASCII-named team", "请QA团队再次确认范围。", "请UX团队再次确认范围。"],
  ["keeping the action class", "请项目组再次确认范围。", "请项目组再次完成范围。"],
  ["keeping the target", "请项目组再次确认金额。", "请项目组再次确认日期。"],
  ["not deleting the target", "请项目组再次确认金额。", "请项目组再次确认。"],
  ["preserving the order of multiple actions", "请项目组再次确认金额，并请财务组先完成复核。", "请财务组先完成复核，并请项目组再次确认金额。"],
  ["not deleting one of multiple actions", "请项目组再次确认金额，并请财务组先完成复核。", "请项目组再次确认金额。"],
  ["rejecting a known action changed into an unparsed verb", "请项目组再次确认范围。", "请项目组再次启动范围。"],
  ["not adding a new action frame", "请项目组再次确认范围。", "请项目组再次确认范围，并请财务组完成复核。"],
  ["preserving negation expressed in the target", "请项目组确认范围。", "请项目组确认不扩大范围。"],
  ["preserving a date target", "请项目组确认2026年10月28日。", "请项目组确认2026年10月29日。"],
  ["preserving a modifier when an adjacent frame target exceeds the short-target budget", `请项目组再次确认短范围。请星河项目组再次确认${"范围".repeat(25)}。`, `请项目组再次确认短范围。请星河项目组重新确认${"范围".repeat(25)}。`],
  ["preserving a modifier in a sentence beyond the exact-duplicate sentence budget", `请项目组再次确认短范围。${"说".repeat(520)} 请星河项目组再次确认范围。`, `请项目组再次确认短范围。${"说".repeat(520)} 请星河项目组重新确认范围。`],
  ["preserving every modifier after four repeated tokens", "请项目组再次确认短范围。请星河项目组再次再次再次再次再次确认范围。", "请项目组再次确认短范围。请星河项目组再次再次重新再次再次确认范围。"],
  ["rejecting a short known target made opaque in the candidate", "请项目组再次确认范围。", `请项目组再次确认${"范围".repeat(25)}。`],
  ["preserving a short target in a long sentence", `请项目组再次确认短范围。${"说".repeat(520)} 请星河项目组再次确认范围。`, `请项目组再次确认短范围。${"说".repeat(520)} 请星河项目组再次确认日期。`],
  ["preserving the action target before a comma", "请项目组再次确认排期，说明内容有点点啰嗦。", "请项目组再次确认截止日期，说明内容有点点啰嗦。"],
  ["preserving the actor of a second comma-separated request", "请项目组再次确认排期，请财务组再次确认范围。", "请项目组再次确认排期，请项目组再次确认范围。"],
  ["preserving the modifier of a second comma-separated request", "请项目组再次确认排期，请财务组再次确认范围。", "请项目组再次确认排期，请财务组确认范围。"],
  ["preserving decimal version facts", "请项目组再次确认版本v1.2。", "请项目组再次确认版本v1.3。"],
  ["preserving URL query facts", "请项目组再次确认https://api.example.com/path?mode=a。", "请项目组再次确认https://api.example.com/path?mode=b。"],
  ["keeping the named project intact", "请星河项目组再次确认范围。", "请星河项目确认范围。"],
  ["not collapsing repeated requests across intervening prose", "请项目组再次确认范围。中间插入旁文。请项目组再次确认范围。", "请项目组再次确认范围。"],
  ["not globally merging a nonconsecutive repeated action", "请项目组再次确认范围。请财务组先完成复核。请项目组再次确认范围。", "请项目组再次确认范围。请财务组先完成复核。"],
  ["not collapsing non-identical full sentences that share an action frame", "请项目组再次确认范围，说明已完成。请项目组再次确认范围，说明待核对。", "请项目组再次确认范围，说明已完成。"],
  ["not collapsing non-identical long sentence bytes", `请项目组再次确认${"补充说明".repeat(140)}内容一。请项目组再次确认${"补充说明".repeat(140)}内容二。`, `请项目组再次确认${"补充说明".repeat(140)}内容一。`],
] as const;

const allowedCases = [
  ["removing duplicate 请", "请请项目组再次确认范围。", "请项目组再次确认范围。"],
  ["allowing generic collective aliases", "请大家再次确认测试报告。", "请各位再次确认测试报告。"],
  ["allowing an omitted generic recipient", "请大家再次确认测试报告。", "请再次确认测试报告。"],
  ["allowing a light-verb removal", "请项目组再次进行确认上线范围。", "请项目组再次确认上线范围。"],
  ["allowing edits in an independent comma-following clause", "请项目组再次确认排期，说明内容有点点啰嗦。", "请项目组再次确认排期，说明内容有些啰嗦。"],
  ["allowing edits after an ASCII comma", "请项目组再次确认排期,说明内容有点点啰嗦。", "请项目组再次确认排期,说明内容有些啰嗦。"],
  ["allowing edits after an ASCII semicolon", "请项目组再次确认排期;说明内容有点点啰嗦。", "请项目组再次确认排期;说明内容有些啰嗦。"],
  ["allowing unrelated edits with an opaque long action target", `请项目组再次确认短范围。请星河项目组再次确认${"范围".repeat(25)}，说明内容有点点啰嗦。`, `请项目组再次确认短范围。请星河项目组再次确认${"范围".repeat(25)}，说明内容有些啰嗦。`],
  ["allowing unrelated edits while preserving all modifiers beyond four tokens", "请项目组再次再次再次再次再次确认范围，说明内容有点点啰嗦。", "请项目组再次再次再次再次再次确认范围，说明内容有些啰嗦。"],
  ["allowing unrelated prose edits in a long sentence with a known action prefix", `请项目组再次确认短范围。${"说".repeat(520)} 请星河项目组再次确认范围，说明内容有点点啰嗦。`, `请项目组再次确认短范围。${"说".repeat(520)} 请星河项目组再次确认范围，说明内容有些啰嗦。`],
  ["allowing removal of 予以", "请项目组再次予以确认上线范围。", "请项目组再次确认上线范围。"],
  ["allowing removal of 作出", "请项目组再次作出确认上线范围。", "请项目组再次确认上线范围。"],
  ["allowing duplicate-请 cleanup in the captured numeric sentence", "本次核对金额为18万元，请请星河项目组再次确认。", "本次核对金额为18万元，请星河项目组再次确认。"],
  ["allowing decision-verb aliases", "请项目组再次确认上线范围。", "请项目组再次明确上线范围。"],
  ["allowing completion-verb aliases", "请项目组先完成验收。", "请项目组先做完验收。"],
  ["allowing repeat aliases", "请项目组再次确认范围。", "请项目组再一次确认范围。"],
  ["allowing 再度 as repeat", "请项目组再度确认范围。", "请项目组再次确认范围。"],
  ["allowing first-action aliases", "请项目组首先完成验收。", "请项目组先完成验收。"],
  ["allowing an exact repeated full-sentence run to collapse", "请项目组再次确认范围。请项目组再次确认范围。", "请项目组再次确认范围。"],
  ["collapsing only exact copies of a full sentence with a comma clause", "请项目组再次确认范围，说明内容简洁。".repeat(3), "请项目组再次确认范围，说明内容简洁。"],
  ["collapsing two adjacent full sentences that each contain two requests", "请项目组再次确认排期，请财务组再次确认预算。".repeat(2), "请项目组再次确认排期，请财务组再次确认预算。"],
  ["collapsing three adjacent full sentences that each contain two requests", "请项目组再次确认排期，请财务组再次确认预算。".repeat(3), "请项目组再次确认排期，请财务组再次确认预算。"],
  ["collapsing mixed runs of different complete multi-request sentences", "请项目组再次确认排期，请财务组再次确认预算。".repeat(3) + "请测试组先完成验收，请产品组再次确认版本。".repeat(2), "请项目组再次确认排期，请财务组再次确认预算。请测试组先完成验收，请产品组再次确认版本。"],
  ["collapsing adjacent byte-identical long complete sentences", `请项目组再次确认${"补充说明".repeat(140)}。`.repeat(3), `请项目组再次确认${"补充说明".repeat(140)}。`],
  ["collapsing a contiguous three-copy run", "请项目组再次确认范围。".repeat(3), "请项目组再次确认范围。"],
  ["collapsing a contiguous four-copy run", "请项目组再次确认范围。".repeat(4), "请项目组再次确认范围。"],
  ["collapsing a contiguous five-copy run", "请项目组再次确认范围。".repeat(5), "请项目组再次确认范围。"],
  ["collapsing two copies with an ASCII period", "请项目组再次确认范围.".repeat(2), "请项目组再次确认范围."],
  ["collapsing three copies with an ASCII period", "请项目组再次确认范围.".repeat(3), "请项目组再次确认范围."],
  ["collapsing two copies with an ASCII exclamation mark", "请项目组再次确认范围!".repeat(2), "请项目组再次确认范围!"],
  ["collapsing three copies with an ASCII exclamation mark", "请项目组再次确认范围!".repeat(3), "请项目组再次确认范围!"],
  ["collapsing two copies with an ASCII question mark", "请项目组再次确认范围?".repeat(2), "请项目组再次确认范围?"],
  ["collapsing three copies with an ASCII question mark", "请项目组再次确认范围?".repeat(3), "请项目组再次确认范围?"],
  ["collapsing adjacent runs of different complete request sentences", "请项目组再次确认范围。".repeat(3) + "请财务组先完成复核。".repeat(4), "请项目组再次确认范围。请财务组先完成复核。"],
  ["not comparing unparsed requests that were added outside a known frame", "请项目组再次确认范围。", "请项目组再次确认范围。请说明附件。"],
  ["preserving multiple ordered requests while allowing duplicate-请 cleanup", "请项目组再次确认金额，并请财务组先完成复核。", "请项目组再次确认金额，并请财务组先完成复核。"],
  ["abstaining when the source has an unknown verb", "请项目组开始处理范围。", "请项目组确认范围。"],
  ["abstaining when both source and replacement have unknown request forms", "请项目组开始处理范围。", "请财务组稍后查看范围。"],
  ["abstaining for an oversized source", "请项目组再次确认范围。".repeat(2_000), "已修改"],
] as const;

describe("prose request action facts", () => {
  it.each(rejectCases)("rejects %s", (_label, source, replacement) => {
    expect(() => validateProseRequestActionFacts(source, replacement)).toThrow();
  });

  it.each(allowedCases)("allows or abstains for %s", (_label, source, replacement) => {
    expect(() => validateProseRequestActionFacts(source, replacement)).not.toThrow();
  });

  it("abstains quickly on a 1 MiB unterminated repeated-请 run", () => {
    const source = "请".repeat(1024 * 1024);
    const started = performance.now();
    expect(() => validateProseRequestActionFacts(source, "已修改。" )).not.toThrow();
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("abstains on bounded long repeated markers, unclosed recipients, and excessive sentences", () => {
    const cases = [
      ["请".repeat(16_000), "改写后。"],
      [`请${"星".repeat(300)}再次确认。`, "改写后。"],
      ["请项目组再次确认。".repeat(65), "改写后。"],
    ] as const;
    const started = performance.now();
    for (const [source, replacement] of cases) {
      expect(() => validateProseRequestActionFacts(source, replacement)).not.toThrow();
    }
    expect(performance.now() - started).toBeLessThan(250);
  });
});
