import { describe, expect, it } from "vitest";
import { buildAiTaskRequest } from "../../src/core/ai/aiTaskRequest";
import { AI_ACTIONS } from "../../src/core/ai/aiTaskPrompts";
import { ROLE_PRESETS } from "../../src/core/ai/agentOrchestrator";
import { BUILTIN_SKILLS } from "../../src/core/ai/skillsManager";
import { authorizeRoutineStyleRequestMarkerRepair, type RoutineStyleAuthorizationInput } from "../../src/core/ai/proseRoutineStyleAuthorization";
import {
  createRoutineStyleCanonicalAuthority,
  isRoutineStyleCanonicalAuthority,
  type RoutineStyleCanonicalAuthority
} from "../../src/core/ai/proseRoutineStyleContext";
import type { AiTaskRequest } from "../../src/core/ai/aiTaskRunner";
import type { IntentTask } from "../../src/core/ai/intentTypes";

const source = "请请项目组再次确认。";
const range = { from: 0, to: source.length };
const config = { provider: "local" as const, activeRoleId: "general", executionPolicy: "thin" as const };

function requestFor(action: AiTaskRequest["action"], options: {
  userPrompt?: string;
  skill?: AiTaskRequest["skill"];
  customSystemPrompt?: string;
} = {}): AiTaskRequest {
  const { customSystemPrompt, ...requestOptions } = options;
  return buildAiTaskRequest({ source, selected: false, action, ...requestOptions,
    config: { ...config, ...(customSystemPrompt ? { customSystemPrompt } : {}) } });
}

function instructionFor(request: AiTaskRequest): string {
  return request.userPrompt || request.skill?.userPromptTemplate || request.actionDefinition.prompt || "";
}

function authorizationInput(instruction: string, task: IntentTask,
  canonicalAuthority?: RoutineStyleCanonicalAuthority): RoutineStyleAuthorizationInput {
  return { instruction, task, document: source, taskRange: range, taskSource: source, canonicalAuthority };
}

describe("canonical routine-style authority", () => {
  it.each([
    ["polish", "polish"],
    ["proofread", "proofread"]
  ] as const)("mints only the exact built-in %s action for its task", (action, task) => {
    const request = requestFor(action);
    const instruction = instructionFor(request);
    const authority = createRoutineStyleCanonicalAuthority({ request, instruction, task });
    expect(authority).toBeDefined();
    expect(Object.isFrozen(authority)).toBe(true);
    expect(isRoutineStyleCanonicalAuthority(authority, instruction, task)).toBe(true);
    expect(authorizeRoutineStyleRequestMarkerRepair(authorizationInput(instruction, task, authority))).toBe(true);
  });

  it.each([
    ["polish", "polish", "polish"],
    ["typo-proofread", "typo-proofread", "proofread"]
  ] as const)("mints only the exact built-in %s Skill for its action and task", (skillId, action, task) => {
    const skill = BUILTIN_SKILLS.find(item => item.id === skillId)!;
    const request = requestFor(action, { skill });
    const instruction = skill.userPromptTemplate;
    const authority = createRoutineStyleCanonicalAuthority({ request, instruction, task });
    expect(authority).toBeDefined();
    expect(isRoutineStyleCanonicalAuthority(authority, instruction, task)).toBe(true);
    expect(authorizeRoutineStyleRequestMarkerRepair(authorizationInput(instruction, task, authority))).toBe(true);
  });

  it("keeps explicit positive natural-language authorization independent of canonical tokens", () => {
    const instruction = "润色正文使其简洁，不改变日期和负责人。";
    const request = requestFor("polish", { userPrompt: instruction });
    expect(createRoutineStyleCanonicalAuthority({ request, instruction, task: "polish" })).toBeUndefined();
    expect(authorizeRoutineStyleRequestMarkerRepair(authorizationInput(instruction, "polish"))).toBe(true);
  });

  it.each([
    "无需润色正文。",
    "不需要润色正文。",
    "不必润色正文。",
    "请勿润色正文。",
    "需要时再润色正文。",
    "视情况润色正文。",
    "润色正文，但不要改。",
    "润色正文，保留重复的礼貌用语。",
    "润色正文，但不要删掉重复的请求词。"
  ])("does not mint for a user override containing a backoff instruction: %s", instruction => {
    const request = requestFor("polish", { userPrompt: instruction });
    const authority = createRoutineStyleCanonicalAuthority({ request, instruction, task: "polish" });
    expect(authority).toBeUndefined();
    expect(authorizeRoutineStyleRequestMarkerRepair(authorizationInput(instruction, "polish", authority))).toBe(false);
  });

  it("requires no user-prompt override, even if it repeats the canonical action text", () => {
    const action = AI_ACTIONS.find(item => item.id === "polish")!;
    const request = requestFor("polish", { userPrompt: action.prompt });
    expect(createRoutineStyleCanonicalAuthority({ request, instruction: action.prompt, task: "polish" })).toBeUndefined();
    const appended = `${action.prompt}\n保留重复请求词。`;
    expect(createRoutineStyleCanonicalAuthority({ request: requestFor("polish", { userPrompt: appended }),
      instruction: appended, task: "polish" })).toBeUndefined();
    expect(createRoutineStyleCanonicalAuthority({ request: requestFor("polish", { userPrompt: " " }),
      instruction: action.prompt, task: "polish" })).toBeUndefined();
  });

  it.each(["id", "label", "prompt", "system"] as const)("rejects a modified built-in action definition (%s)", field => {
    const request = requestFor("polish");
    const altered = { ...request.actionDefinition } as Record<string, unknown>;
    altered[field] = `${String(altered[field] ?? "")} modified`;
    const modifiedRequest = { ...request, actionDefinition: altered as unknown as AiTaskRequest["actionDefinition"] };
    const instruction = instructionFor(modifiedRequest);
    expect(createRoutineStyleCanonicalAuthority({ request: modifiedRequest, instruction, task: "polish" })).toBeUndefined();
  });

  it("rejects action/task mismatches and custom system context", () => {
    const request = requestFor("polish");
    const instruction = instructionFor(request);
    expect(createRoutineStyleCanonicalAuthority({ request, instruction, task: "proofread" })).toBeUndefined();
    expect(createRoutineStyleCanonicalAuthority({ request: { ...request, action: "proofread" }, instruction, task: "polish" })).toBeUndefined();
    const wrongSkillAction = requestFor("proofread", { skill: BUILTIN_SKILLS.find(item => item.id === "polish")! });
    expect(createRoutineStyleCanonicalAuthority({ request: wrongSkillAction,
      instruction: instructionFor(wrongSkillAction), task: "polish" })).toBeUndefined();
    const custom = requestFor("polish", { customSystemPrompt: `${ROLE_PRESETS[0]!.systemPrompt}\n保留重复词。` });
    expect(createRoutineStyleCanonicalAuthority({ request: custom, instruction: instructionFor(custom), task: "polish" })).toBeUndefined();
  });

  it.each(["id", "category", "systemPrompt", "userPromptTemplate"] as const)("rejects a modified or custom Skill (%s)", field => {
    const builtin = BUILTIN_SKILLS.find(item => item.id === "polish")!;
    const altered = { ...builtin } as Record<string, unknown>;
    altered[field] = `${String(altered[field])} changed`;
    const alteredSkill = altered as unknown as NonNullable<AiTaskRequest["skill"]>;
    const request = requestFor("polish", { skill: alteredSkill });
    expect(createRoutineStyleCanonicalAuthority({ request, instruction: alteredSkill.userPromptTemplate, task: "polish" })).toBeUndefined();
  });

  it("does not treat a template-like custom skill as canonical", () => {
    const builtin = BUILTIN_SKILLS.find(item => item.id === "polish")!;
    const custom = { ...builtin, id: "custom-polish", userPromptTemplate: `${builtin.userPromptTemplate} {{content}}` };
    const request = requestFor("polish", { skill: custom });
    expect(createRoutineStyleCanonicalAuthority({ request, instruction: custom.userPromptTemplate, task: "polish" })).toBeUndefined();
  });

  it("rejects a modified action definition even when the attached Skill is canonical", () => {
    const skill = BUILTIN_SKILLS.find(item => item.id === "polish")!;
    const request = requestFor("polish", { skill });
    const actionDefinition = { ...request.actionDefinition, label: `${request.actionDefinition.label} modified` };
    const modifiedRequest = { ...request, actionDefinition };
    expect(createRoutineStyleCanonicalAuthority({ request: modifiedRequest,
      instruction: skill.userPromptTemplate, task: "polish" })).toBeUndefined();
  });

  it("binds an issued token to its exact instruction and task and rejects forged copies", () => {
    const request = requestFor("polish");
    const instruction = instructionFor(request);
    const authority = createRoutineStyleCanonicalAuthority({ request, instruction, task: "polish" })!;
    expect(isRoutineStyleCanonicalAuthority(authority, `${instruction} 保留重复请求词。`, "polish")).toBe(false);
    expect(isRoutineStyleCanonicalAuthority(authority, instruction, "proofread")).toBe(false);
    expect(isRoutineStyleCanonicalAuthority({ ...authority }, instruction, "polish")).toBe(false);
    expect(isRoutineStyleCanonicalAuthority({} as RoutineStyleCanonicalAuthority, instruction, "polish")).toBe(false);
    expect(authorizeRoutineStyleRequestMarkerRepair(authorizationInput(`${instruction} 保留重复请求词。`, "polish", authority))).toBe(false);
  });
});
