/**
 * runSubagent 工具 schema（仅 openai / openai-responses 暴露）。
 */

import type { ToolSchemaEntry } from "../toolSchemas";

export const RUN_SUBAGENT_DESCRIPTION =
  "派发子代理执行独立子任务。子代理拥有独立上下文，完成后你只会收到摘要 summary；" +
  "适合可并行的调研、搜索、文件分析等。可指定 name、modelId、reasoningLevel（low/medium/high）覆盖默认（继承当前 turn）。" +
  "嵌套最多 2 层；叶节点不可再派发。";

export const RUN_SUBAGENT_SCHEMA: ToolSchemaEntry = {
  description: RUN_SUBAGENT_DESCRIPTION,
  parameters: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "交给子代理的完整任务说明",
      },
      name: {
        type: "string",
        description: "子代理展示名称（可选，如「调研竞品」）",
      },
      modelId: {
        type: "string",
        description: "覆盖模型 id；缺省继承当前 turn",
      },
      reasoningLevel: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "覆盖思考长度；缺省继承当前 turn",
      },
    },
    required: ["task"],
  },
};
