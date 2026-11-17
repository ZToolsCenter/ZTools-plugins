import { prepareArtifactFill } from "./artifactFill";
import { resolveArtifactSpec } from "./artifactSpecFromInstruction";
import { ROLE_PRESETS } from "./agentOrchestrator";
import { resolveGenerationRequirements } from "./generationRequirements";
import { MANAGED_SECTION_MODEL_ID } from "./managedSectionRequest";
import { calculateLocalAiBudget, type LocalAiBudget } from "./requestBudget";
import { buildCodeGenerationScope } from "./codeGenerationScope";
import type { ArtifactSpec } from "./artifactSpec";

export interface ManagedCodeRequestInput {
  readonly source: "managed" | "ollama";
  readonly modelId: string;
  readonly prompt: string;
  readonly systemPrompt: string;
  readonly maxTokens: number;
  readonly outputSchema?: Record<string, unknown>;
}

export interface ManagedCodeRequest {
  readonly systemPrompt: string;
  readonly budget: LocalAiBudget;
  readonly applied: boolean;
}

const INPUT_MARKER = "输入数据：";
const MAX_PROMPT_UNITS = 1_048_576;
const generalSystemPrompt = ROLE_PRESETS.find(role => role.id === "general")?.systemPrompt;

interface CodeInputData {
  readonly instruction: string;
  readonly source?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactJson(left: unknown, right: unknown): boolean {
  try { return JSON.stringify(left) === JSON.stringify(right); }
  catch { return false; }
}

function readCodeInput(prompt: string): CodeInputData | undefined {
  if (prompt.length > MAX_PROMPT_UNITS || prompt.indexOf(INPUT_MARKER) < 0 ||
      prompt.indexOf(INPUT_MARKER) !== prompt.lastIndexOf(INPUT_MARKER)) return undefined;
  const marker = prompt.indexOf(INPUT_MARKER);
  let parsed: unknown;
  try { parsed = JSON.parse(prompt.slice(marker + INPUT_MARKER.length).trim()) as unknown; }
  catch { return undefined; }
  if (!isRecord(parsed) || typeof parsed.instruction !== "string" ||
      parsed.source !== undefined && typeof parsed.source !== "string" ||
      Object.keys(parsed).some(key => key !== "instruction" && key !== "source")) return undefined;
  return parsed as unknown as CodeInputData;
}

function fallback(systemPrompt: string, budget: LocalAiBudget): ManagedCodeRequest {
  return { systemPrompt, budget, applied: false };
}

/** Adapts only an exact production artifact-fill request for managed Qwen 1.7B. */
export function prepareManagedCodeRequest(input: ManagedCodeRequestInput): ManagedCodeRequest | undefined {
  if (input.source !== "managed" || input.modelId !== MANAGED_SECTION_MODEL_ID || !generalSystemPrompt) return undefined;
  const data = readCodeInput(input.prompt);
  if (!data) return undefined;

  try {
    const requirements = resolveGenerationRequirements(data.instruction, "custom");
    const spec: ArtifactSpec = resolveArtifactSpec(data.instruction, requirements, { effect: "edit", operation: "insert" });
    if (spec.kind !== "code") return undefined;
    const source = data.source;
    if (spec.sourceDependent && source === undefined) return undefined;
    const includeSource = Object.hasOwn(data, "source");
    const originalFill = prepareArtifactFill({ instruction: data.instruction, spec, requirements,
      ...(source === undefined ? {} : { source }), includeSource, systemPrompt: generalSystemPrompt });
    if (!originalFill || originalFill.prompt !== input.prompt || originalFill.systemPrompt !== input.systemPrompt ||
        originalFill.maxTokens !== input.maxTokens || !exactJson(originalFill.outputSchema, input.outputSchema)) return undefined;

    const scopedBase = buildCodeGenerationScope({ instruction: data.instruction, spec,
      baseSystemPrompt: generalSystemPrompt, systemPrompt: generalSystemPrompt, source, includeSource });
    if (!scopedBase) return undefined;
    const scopedFill = prepareArtifactFill({ instruction: data.instruction, spec, requirements,
      ...(source === undefined ? {} : { source }), includeSource, systemPrompt: scopedBase });
    if (!scopedFill || scopedFill.prompt !== input.prompt || scopedFill.maxTokens !== input.maxTokens ||
        !exactJson(scopedFill.outputSchema, input.outputSchema)) return undefined;

    const originalBudget = calculateLocalAiBudget(input.prompt, input.systemPrompt, input.maxTokens);
    try {
      const scopedBudget = calculateLocalAiBudget(input.prompt, scopedFill.systemPrompt, input.maxTokens);
      if (scopedBudget.maxTokens !== originalBudget.maxTokens) return fallback(input.systemPrompt, originalBudget);
      return { systemPrompt: scopedFill.systemPrompt, budget: scopedBudget, applied: true };
    } catch {
      return fallback(input.systemPrompt, originalBudget);
    }
  } catch {
    // Preserve the existing section helper's original-budget/error behavior.
    return undefined;
  }
}
