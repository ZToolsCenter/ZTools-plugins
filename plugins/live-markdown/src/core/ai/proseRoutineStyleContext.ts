import type { AiTaskRequest } from "./aiTaskRunner";
import type { IntentTask } from "./intentTypes";
import { ROLE_PRESETS } from "./agentOrchestrator";
import { AI_ACTIONS } from "./aiTaskPrompts";
import { BUILTIN_SKILLS } from "./skillsManager";

const routineAuthorityBrand: unique symbol = Symbol("routine-style-canonical-authority");
const routineAuthorities = new WeakMap<object, { instruction: string; task: IntentTask }>();

/** Unforgeable in-process authority for one exact canonical UI directive and task. */
export type RoutineStyleCanonicalAuthority = Readonly<{ [routineAuthorityBrand]: true }>;

interface StyleContext {
  systemPrompt: string;
  skill?: AiTaskRequest["skill"];
}

/** Unknown supplemental instructions stay with the ordinary model path; never guess their constraints. */
export function permitsRoutineStyleContext(input: StyleContext): boolean {
  const knownRole = input.systemPrompt === "" || ROLE_PRESETS.some(role => role.systemPrompt === input.systemPrompt);
  if (!input.skill) return knownRole;
  const skill = input.skill;
  if (skill.id !== "polish" && skill.id !== "typo-proofread") return false;
  const canonical = BUILTIN_SKILLS.find(item => item.id === skill.id);
  if (!canonical || skill.category !== canonical.category || skill.systemPrompt !== canonical.systemPrompt ||
      skill.userPromptTemplate !== canonical.userPromptTemplate) return false;
  return knownRole || input.systemPrompt === canonical.systemPrompt;
}

function sameActionDefinition(actual: AiTaskRequest["actionDefinition"], expected: typeof AI_ACTIONS[number]): boolean {
  return actual.id === expected.id && actual.label === expected.label && actual.prompt === expected.prompt && actual.system === expected.system;
}

function hasCanonicalActionDefinition(request: AiTaskRequest): boolean {
  const action = AI_ACTIONS.find(item => item.id === request.action);
  if (action) return sameActionDefinition(request.actionDefinition, action);
  if (request.action !== "typo-proofread") return false;
  const definition = request.actionDefinition;
  return definition.id === "custom" && definition.label === "自定义" &&
    definition.prompt === "请根据用户要求处理以下 Markdown：" &&
    definition.system === "遵照用户指令操作，保留原文中未要求变更的事实和 Markdown 结构。只输出结果正文。";
}

function expectedTaskForAction(action: string): IntentTask | undefined {
  if (action === "polish") return "polish";
  if (action === "proofread") return "proofread";
  return undefined;
}

function matchesCanonicalSkill(request: AiTaskRequest, task: IntentTask, instruction: string): boolean {
  const skill = request.skill;
  if (!skill || (skill.id !== "polish" && skill.id !== "typo-proofread")) return false;
  const canonical = BUILTIN_SKILLS.find(item => item.id === skill.id);
  if (!canonical || skill.category !== canonical.category || skill.systemPrompt !== canonical.systemPrompt ||
      skill.userPromptTemplate !== canonical.userPromptTemplate || instruction !== canonical.userPromptTemplate) return false;
  if (skill.id === "polish") return request.action === "polish" && task === "polish";
  return (request.action === "typo-proofread" || request.action === "proofread") && task === "proofread";
}

/** Mints authority only from an exact, unmodified built-in request; never from caller prose alone. */
export function createRoutineStyleCanonicalAuthority(input: {
  request: AiTaskRequest;
  instruction: string;
  task: IntentTask;
}): RoutineStyleCanonicalAuthority | undefined {
  const { request, instruction, task } = input;
  if (!request || typeof instruction !== "string" || !instruction ||
      (request.userPrompt !== undefined && request.userPrompt !== "") ||
      !permitsRoutineStyleContext({ systemPrompt: request.baseSystemPrompt, skill: request.skill })) return undefined;

  const action = AI_ACTIONS.find(item => item.id === request.action);
  const actionTask = expectedTaskForAction(request.action);
  const canonicalAction = !request.skill && action && actionTask === task && instruction === action.prompt &&
    sameActionDefinition(request.actionDefinition, action);
  if (!canonicalAction && !matchesCanonicalSkill(request, task, instruction)) return undefined;
  if (!hasCanonicalActionDefinition(request)) return undefined;

  const token = Object.freeze({ [routineAuthorityBrand]: true as const }) as RoutineStyleCanonicalAuthority;
  routineAuthorities.set(token, { instruction, task });
  return token;
}

/** Checks a runtime-issued capability and its exact directive/task binding. */
export function isRoutineStyleCanonicalAuthority(value: unknown, instruction: string, task: IntentTask): boolean {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  const binding = routineAuthorities.get(value as object);
  return Boolean(binding && binding.instruction === instruction && binding.task === task);
}
