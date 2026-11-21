import { prepareManagedSectionRequest } from "./managedSectionRequest";
import { prepareManagedCodeRequest, type ManagedCodeRequestInput } from "./managedCodeRequest";
import type { LocalAiBudget } from "./requestBudget";

export type ManagedGenerationRequestInput = ManagedCodeRequestInput;

export interface ManagedGenerationRequest {
  readonly prompt: string;
  readonly systemPrompt: string;
  readonly budget: LocalAiBudget;
  readonly codeScopeApplied: boolean;
  readonly sectionProjectionApplied: boolean;
}

/** Applies one managed-model request adaptation at a time, preserving other requests byte-for-byte. */
export function prepareManagedGenerationRequest(input: ManagedGenerationRequestInput): ManagedGenerationRequest {
  const code = prepareManagedCodeRequest(input);
  if (code?.applied) {
    return { prompt: input.prompt, systemPrompt: code.systemPrompt, budget: code.budget,
      codeScopeApplied: true, sectionProjectionApplied: false };
  }
  if (code) {
    return { prompt: input.prompt, systemPrompt: input.systemPrompt, budget: code.budget,
      codeScopeApplied: false, sectionProjectionApplied: false };
  }

  const section = prepareManagedSectionRequest(input);
  return { prompt: section.prompt, systemPrompt: input.systemPrompt, budget: section.budget,
    codeScopeApplied: false, sectionProjectionApplied: section.applied };
}
