import type { AiTaskRequest } from "./aiTaskRunner";

export type ContentTaskFamily = "literal" | "knowledge" | "artifact" | "prose" | "evidence" | "summary" | "free";

export function isEvaluatedSmallLocalModel(request: Pick<AiTaskRequest, "provider" | "modelId">): boolean {
  if (request.provider !== "local" || !request.modelId) return false;
  const name = request.modelId.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return ["qwen306bq4km", "qwen306bq4kmgguf", "qwen317bq4km", "qwen317bq4kmgguf"].includes(name);
}

/** Advice from recorded local-model evaluations, never a provider switch or a success certificate. */
export function modelCapabilityAdvice(request: AiTaskRequest, family: ContentTaskFamily): string[] {
  if (family === "literal" || family === "knowledge" || !isEvaluatedSmallLocalModel(request)) return [];
  if (family === "evidence") return ["请核对来源字段的含义；引用存在不代表所有关系都已确认。"];
  return ["当前本地小模型的复杂生成尚未全面通过验证，请核对内容；需要时可在模型选择中改用宿主已配置的更高能力模型。"];
}
