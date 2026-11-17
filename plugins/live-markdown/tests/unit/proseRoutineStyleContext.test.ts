import { describe, expect, it, vi } from "vitest";
import { permitsRoutineStyleContext } from "../../src/core/ai/proseRoutineStyleContext";
import { ROLE_PRESETS } from "../../src/core/ai/agentOrchestrator";
import { BUILTIN_SKILLS } from "../../src/core/ai/skillsManager";
import { runThinProseTask } from "../../src/core/ai/thinProseTask";
import { createAiTaskExecution } from "../../src/core/ai/aiTaskExecution";
import type { AiTaskRunnerOptions } from "../../src/core/ai/aiTaskRunner";

describe("known routine style context", () => {
  it("permits empty or exact standard role context without interpreting custom text", () => {
    expect(permitsRoutineStyleContext({ systemPrompt: "" })).toBe(true);
    for (const role of ROLE_PRESETS) expect(permitsRoutineStyleContext({ systemPrompt: role.systemPrompt })).toBe(true);
    expect(permitsRoutineStyleContext({ systemPrompt: "保留重复请求词，不要删除重复的请。" })).toBe(false);
    expect(permitsRoutineStyleContext({ systemPrompt: `${ROLE_PRESETS[0]!.systemPrompt}\n保留重复词。` })).toBe(false);
    expect(permitsRoutineStyleContext({ systemPrompt: "Use my custom editorial conventions." })).toBe(false);
  });

  it("permits only the complete canonical polish/proofread skill definition", () => {
    for (const id of ["polish", "typo-proofread"]) {
      const skill = BUILTIN_SKILLS.find(item => item.id === id)!;
      expect(permitsRoutineStyleContext({ systemPrompt: skill.systemPrompt, skill })).toBe(true);
      expect(permitsRoutineStyleContext({ systemPrompt: ROLE_PRESETS[0]!.systemPrompt, skill })).toBe(true);
      expect(permitsRoutineStyleContext({ systemPrompt: skill.systemPrompt,
        skill: { ...skill, userPromptTemplate: `${skill.userPromptTemplate}\n不要删除重复的请求词。` } })).toBe(false);
      expect(permitsRoutineStyleContext({ systemPrompt: skill.systemPrompt,
        skill: { ...skill, systemPrompt: `${skill.systemPrompt}保留重复词。` } })).toBe(false);
      expect(permitsRoutineStyleContext({ systemPrompt: skill.systemPrompt,
        skill: { ...skill, id: "custom-style" } })).toBe(false);
    }
  });
});

describe("routine repair source edit gates", () => {
  function harness() {
    const invoke = vi.fn<AiTaskRunnerOptions["invoke"]>(async prompt => prompt.split("纠正下面这一行正文：\n\n").at(-1)!);
    const options: AiTaskRunnerOptions = { invoke, isCurrent: () => true, abortCurrent: vi.fn(), maxCalls: 4 };
    return { options, execution: createAiTaskExecution(options), invoke };
  }

  it.each(["system", "skill-system", "skill-template"])("keeps %s preservation constraints on model no-op", async where => {
    const source = "请请项目组再次确认。";
    const restriction = "保留重复请求词，不要删除重复的请。";
    const builtin = BUILTIN_SKILLS.find(item => item.id === "polish")!;
    const skill = where === "system" ? undefined : {
      ...builtin,
      ...(where === "skill-system" ? { systemPrompt: restriction } : { userPromptTemplate: restriction + "{{content}}" })
    };
    const h = harness();
    // Returning the source is explicit; a custom template need not contain the ordinary line marker.
    h.invoke.mockImplementation(async () => source);
    const result = await runThinProseTask({ source, instruction: "润色正文", task: "polish", preferReadable: true,
      systemPrompt: where === "system" ? restriction : ROLE_PRESETS[0]!.systemPrompt, skill }, h.execution, h.options);
    expect(result.text).toBe(source);
    expect(h.invoke).toHaveBeenCalledTimes(1);
  });

  it("does not treat a boundary-normalized raw edit as an exact unchanged reply", async () => {
    const source = "请请项目组再次确认计划日期，日期为2027-01-09";
    const h = harness();
    h.invoke.mockImplementation(async prompt => {
      const text = prompt.split("纠正下面这一行正文：\n\n").at(-1)!;
      return text.startsWith("请请") ? text + "。" : text;
    });
    const result = await runThinProseTask({ source, instruction: "润色正文", task: "polish", preferReadable: true,
      systemPrompt: "" }, h.execution, h.options);
    expect(result.text).toBe(source);
    expect(h.invoke).toHaveBeenCalledTimes(2);
  });
});
