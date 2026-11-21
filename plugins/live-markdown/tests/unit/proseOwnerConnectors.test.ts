import { expect, it } from "vitest";
import { createAiTaskExecution } from "../../src/core/ai/aiTaskExecution";
import { validateProseReplacementFacts } from "../../src/core/ai/proseEditFactGuard";
import { runThinProseTask } from "../../src/core/ai/thinProseTask";

it.each([
  ["且且由周宁负责", "且由周宁负责"],
  ["并且由林安负责", "并由林安负责"]
])("allows removal of a duplicated connector before the same explicit owner: %s", (source, replacement) => {
  expect(() => validateProseReplacementFacts(source, replacement)).not.toThrow();
});

it("assembles a corrected connector while preserving the owner, negation, and date", async () => {
  const source = "验证尚未完成，且且由周宁负责，计划于2026-11-12复查。";
  const responses = ["验证尚未完成", "且由周宁负责", "计划于2026-11-12复查。"];
  let calls = 0;
  const options = {
    invoke: async () => { calls += 1; return responses.shift()!; },
    isCurrent: () => true,
    abortCurrent() {},
    maxCalls: 3
  };

  const result = await runThinProseTask({
    source,
    instruction: "校对文字并修正重复词，保留否定、负责人和日期。",
    systemPrompt: "",
    preferReadable: true
  }, createAiTaskExecution(options), options);

  expect(calls).toBe(3);
  expect(result.text).toBe("验证尚未完成，且由周宁负责，计划于2026-11-12复查。");
});

it.each([
  ["改变姓名", "且且由周宁负责", "且由王安负责"],
  ["改变责任关系", "且且由周宁负责", "且由周宁担任"],
  ["改成移交关系", "且且由周宁负责", "且交给周宁负责"],
  ["增加否定", "且且由周宁负责", "且由周宁不负责"],
  ["交换两个责任主体", "且由周宁负责，随后由林安担任审核", "且由林安负责，随后由周宁担任审核"],
  ["改变日期", "且且由周宁负责，计划于2026-11-12复查", "且由周宁负责，计划于2026-11-13复查"],
  ["改变直接负责人", "周宁负责排期", "王安负责排期"],
  ["把姓名内部的由当作连接词", "许由负责排期", "王由负责排期"],
  ["把复合姓名内部的由当作连接词", "林由周宁负责排期", "林由王安负责排期"],
  ["没有由标记时猜测连接词和姓名边界", "且周宁负责排期", "且王安负责排期"]
])("still rejects a fact change: %s", (_label, source, replacement) => {
  expect(() => validateProseReplacementFacts(source, replacement)).toThrow(/显式名称|否定|数字/);
});
