import { resolveGenerationRequirements } from "./generationRequirements";
import { calculateLocalAiBudget, type LocalAiBudget } from "./requestBudget";
import { buildSectionObligationMap } from "./sectionObligationMap";
import type { EvidencedHeading, SectionObligationMap } from "./sectionObligationMap";

export const MANAGED_SECTION_MODEL_ID = "Qwen3-1.7B-Q4_K_M.gguf";
const INPUT_MARKER = "输入数据：";
const PROJECTION_INSTRUCTION = "请按各章节对应的原要求完成正文，共享要求适用于全文。完整原指令仍在输入数据中。";

export interface ManagedSectionRequestInput {
  source: "managed" | "ollama";
  modelId: string;
  prompt: string;
  systemPrompt: string;
  maxTokens: number;
  outputSchema?: Record<string, unknown>;
}

export interface ManagedSectionRequest {
  prompt: string;
  budget: LocalAiBudget;
  applied: boolean;
}

interface OriginalInputData extends Record<string, unknown> {
  instruction: string;
  source?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function readSectionNames(schema: Record<string, unknown> | undefined): string[] | undefined {
  if (!schema) return undefined;
  const root = isRecord(schema.properties) ? schema.properties : undefined;
  const payload = root && isRecord(root.payload) && isRecord(root.payload.properties) ? root.payload.properties : undefined;
  const sections = payload && isRecord(payload.sections) ? payload.sections : undefined;
  if (!sections || sections.type !== "object" || sections.additionalProperties !== false || !Array.isArray(sections.required)) return undefined;
  const names = sections.required;
  if (names.length === 0 || !names.every(name => typeof name === "string")) return undefined;
  if (!isRecord(sections.properties)) return undefined;
  const propertyNames = Object.keys(sections.properties);
  if (propertyNames.length !== names.length || propertyNames.some((name, index) => name !== names[index])) return undefined;
  return names as string[];
}

function readOriginalInput(prompt: string): { marker: number; data: OriginalInputData } | undefined {
  const marker = prompt.lastIndexOf(INPUT_MARKER);
  if (marker < 0 || marker !== prompt.indexOf(INPUT_MARKER)) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(prompt.slice(marker + INPUT_MARKER.length).trim()) as unknown; }
  catch { return undefined; }
  if (!isRecord(parsed) || typeof parsed.instruction !== "string" ||
      (parsed.source !== undefined && typeof parsed.source !== "string")) return undefined;
  return { marker, data: parsed as OriginalInputData };
}

function sameNames(map: SectionObligationMap, names: readonly string[]): boolean {
  return map.sections.length === names.length && map.sections.every((section, index) => section.heading === names[index]);
}

function makeProjection(map: SectionObligationMap): string {
  return JSON.stringify({
    sections: map.sections.map(section => ({
      heading: section.heading,
      requirements: section.requirements.map(requirement => requirement.raw)
    })),
    shared: map.shared.map(requirement => requirement.raw)
  });
}

/** Adds the R16 source-evidenced section projection when its complete eligibility contract holds. */
export function prepareManagedSectionRequest(input: ManagedSectionRequestInput): ManagedSectionRequest {
  const originalBudget = calculateLocalAiBudget(input.prompt, input.systemPrompt, input.maxTokens);
  const fallback = (): ManagedSectionRequest => ({ prompt: input.prompt, budget: originalBudget, applied: false });
  if (input.source !== "managed" || input.modelId !== MANAGED_SECTION_MODEL_ID) return fallback();

  const names = readSectionNames(input.outputSchema);
  if (!names) return fallback();
  try {
    const original = readOriginalInput(input.prompt);
    if (!original) return fallback();
    const headings: EvidencedHeading[] = resolveGenerationRequirements(original.data.instruction, "custom").requiredHeadings;
    if (headings.length !== names.length || headings.some((heading, index) => heading.text !== names[index])) return fallback();
    const map = buildSectionObligationMap(original.data.instruction, headings);
    if (!map || !sameNames(map, names)) return fallback();

    const projection = makeProjection(map);
    const insertedBlock = `${PROJECTION_INSTRUCTION}\n${projection}`;
    const prompt = `${input.prompt.slice(0, original.marker)}${insertedBlock}\n\n${input.prompt.slice(original.marker)}`;
    const suffixStart = original.marker + insertedBlock.length + 2;
    if (prompt.slice(suffixStart) !== input.prompt.slice(original.marker)) return fallback();
    let budget: LocalAiBudget;
    try { budget = calculateLocalAiBudget(prompt, input.systemPrompt, input.maxTokens); }
    catch { return fallback(); }
    return { prompt, budget, applied: true };
  } catch {
    return fallback();
  }
}
