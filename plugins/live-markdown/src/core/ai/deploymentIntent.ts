import type { LocalAiStatus, LocalAiSource } from "../../types/localAi";

export interface ManagedDeploymentIntent {
  epoch: number;
  source: LocalAiSource;
  modelId: string;
}

export function shouldAutoEnableDeployment(
  intent: ManagedDeploymentIntent | null,
  currentEpoch: number,
  provider: string,
  source: LocalAiSource,
  status: LocalAiStatus | null
): boolean {
  return Boolean(intent && intent.epoch === currentEpoch && provider === "local" && source === "managed" &&
    intent.source === "managed" && status?.phase === "ready" && status.modelId === intent.modelId);
}
