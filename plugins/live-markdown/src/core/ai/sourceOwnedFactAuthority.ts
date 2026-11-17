import type { AiTaskRequest } from "./aiTaskRunner";
import type { BoundIntent } from "./intentBinder";
import type { IntentTask } from "./intentTypes";
import { AI_ACTIONS } from "./aiTaskPrompts";
import { ROLE_PRESETS } from "./agentOrchestrator";
import { authorizeRoutineStyleRequestMarkerRepair } from "./proseRoutineStyleAuthorization";
import { createRoutineStyleCanonicalAuthority, isRoutineStyleCanonicalAuthority,
  type RoutineStyleCanonicalAuthority } from "./proseRoutineStyleContext";
import type { ThinProseScopeContext } from "./thinProseSlots";

const sourceOwnedFactBrand: unique symbol = Symbol("source-owned-closed-fact-authority");
const authorities = new WeakMap<object, AuthorityBinding>();
const MAX_INSTRUCTION_CHARS = 2048;

export type SourceOwnedFactAuthorization = "canonical-routine-style" | "explicit-routine-style-source-copy";
export type SourceOwnedFactAuthority = Readonly<{ [sourceOwnedFactBrand]: true }>;

interface AuthorityBinding {
  readonly source: string;
  readonly instruction: string;
  readonly task: IntentTask;
  readonly effectiveSystemPrompt: string;
  readonly skillShape: string;
  readonly scopeRange: Readonly<{ from: 0; to: number }>;
  readonly origin: SourceOwnedFactAuthorization;
}

export interface SourceOwnedFactAuthorityInput {
  request: AiTaskRequest;
  bound: BoundIntent;
  source: string;
  instruction: string;
  task: IntentTask;
  effectiveSystemPrompt: string;
  routineStyleAuthority?: RoutineStyleCanonicalAuthority;
}

export interface SourceOwnedFactContext {
  source: string;
  instruction: string;
  task: IntentTask;
  effectiveSystemPrompt: string;
  skill?: AiTaskRequest["skill"];
  scopeContext?: ThinProseScopeContext;
}

function generalSystemPrompt(): string | undefined {
  return ROLE_PRESETS.find(role => role.id === "general")?.systemPrompt;
}

function skillShape(skill: AiTaskRequest["skill"]): string {
  return JSON.stringify(skill ? { id: skill.id, category: skill.category, systemPrompt: skill.systemPrompt,
    userPromptTemplate: skill.userPromptTemplate } : null);
}

function exactActionDefinition(request: AiTaskRequest, task: IntentTask): boolean {
  const expected = AI_ACTIONS.find(action => action.id === task);
  const actual = request.actionDefinition;
  return Boolean(expected && request.action === task && actual.id === expected.id && actual.label === expected.label &&
    actual.prompt === expected.prompt && actual.system === expected.system);
}

function hasFullDocumentBinding(input: SourceOwnedFactAuthorityInput): boolean {
  if (!input || typeof input !== "object" || !input.request || !input.bound ||
      typeof input.source !== "string" || typeof input.instruction !== "string" ||
      typeof input.effectiveSystemPrompt !== "string" || !input.request.actionDefinition ||
      !input.bound.range || !input.bound.intent) return false;
  const { request, bound, source } = input;
  return typeof source === "string" && source.length > 0 && source.length <= 1_048_576 &&
    request.source === source && request.scope === "document" && bound.source === source &&
    bound.documentContent === source && bound.dependency === "document" &&
    bound.range.from === 0 && bound.range.to === source.length && bound.range.expectedText === source &&
    bound.intent.kind === "edit" && bound.intent.operation === "rewrite" && bound.intent.target === "document" &&
    bound.intent.content.mode === "generate" && bound.intent.content.task === input.task &&
    input.instruction.length > 0 && input.instruction.length <= MAX_INSTRUCTION_CHARS &&
    (input.task === "polish" || input.task === "proofread");
}

function authorizationOrigin(input: SourceOwnedFactAuthorityInput): SourceOwnedFactAuthorization | undefined {
  const { request, source, instruction, task, routineStyleAuthority } = input;
  const general = generalSystemPrompt();
  if (!general || request.baseSystemPrompt !== general || request.executionPolicy === "direct" ||
      input.effectiveSystemPrompt !== (request.skill?.systemPrompt || request.baseSystemPrompt)) return undefined;

  if ((request.userPrompt === undefined || request.userPrompt === "") &&
      isRoutineStyleCanonicalAuthority(routineStyleAuthority, instruction, task) &&
      createRoutineStyleCanonicalAuthority({ request, instruction, task })) {
    return "canonical-routine-style";
  }

  if (request.skill || request.userPrompt !== instruction || !exactActionDefinition(request, task)) return undefined;
  const explicit = authorizeRoutineStyleRequestMarkerRepair({ instruction, document: source,
    taskRange: { from: 0, to: source.length }, taskSource: source, task });
  return explicit ? "explicit-routine-style-source-copy" : undefined;
}

/** Mints a private capability only for an exact full-document routine rewrite. */
export function createSourceOwnedFactAuthority(input: SourceOwnedFactAuthorityInput): SourceOwnedFactAuthority | undefined {
  try {
    if (!hasFullDocumentBinding(input)) return undefined;
    const origin = authorizationOrigin(input);
    if (!origin) return undefined;
    const skillBinding = skillShape(input.request.skill);

    const token = Object.freeze({ [sourceOwnedFactBrand]: true as const }) as SourceOwnedFactAuthority;
    authorities.set(token, Object.freeze({ source: input.source, instruction: input.instruction, task: input.task,
      effectiveSystemPrompt: input.effectiveSystemPrompt, skillShape: skillBinding,
      scopeRange: Object.freeze({ from: 0 as const, to: input.source.length }), origin }));
    return token;
  } catch {
    return undefined;
  }
}

/** Validates a minted authority against the exact prose-task snapshot and whole-document scope. */
export function sourceOwnedFactAuthorization(value: unknown, context: SourceOwnedFactContext): SourceOwnedFactAuthorization | undefined {
  try {
    if (!context || typeof context.source !== "string" || typeof context.instruction !== "string" ||
        typeof context.effectiveSystemPrompt !== "string" ||
        (typeof value !== "object" && typeof value !== "function") || value === null) return undefined;
    const binding = authorities.get(value as object);
    if (!binding || binding.source !== context.source || binding.instruction !== context.instruction ||
        binding.task !== context.task || binding.effectiveSystemPrompt !== context.effectiveSystemPrompt ||
        binding.skillShape !== skillShape(context.skill)) return undefined;
    const range = context.scopeContext?.range;
    const document = context.scopeContext?.document;
    if (context.scopeContext && (document !== binding.source || range?.from !== binding.scopeRange.from ||
        range?.to !== binding.scopeRange.to)) return undefined;
    return binding.origin;
  } catch {
    return undefined;
  }
}

