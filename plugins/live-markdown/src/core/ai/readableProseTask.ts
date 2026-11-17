import type { ThinProseTaskInput } from "./thinProseTask";
import type { ReadableProseView } from "./readableProseView";

export type ReadableProseTaskInput = Pick<ThinProseTaskInput, "instruction" | "systemPrompt" | "skill">;

/** Builds one raw-text correction request for the bounded readable-line protocol. */
export function buildReadableProsePrompts(
  input: ReadableProseTaskInput,
  view: Pick<ReadableProseView, "text" | "readonlyPlaceholders">
): { prompt: string; systemPrompt: string } {
  const taskTemplate = input.skill?.userPromptTemplate.replace(/\{\{content\}\}/gu, () => view.text);
  const prompt = [
    `用户任务：${input.instruction}`,
    ...(taskTemplate ? [`技能任务：\n${taskTemplate}`] : []),
    "仅按用户任务指定的范围修改这一行。保留未要求修改的正确内容、原意、数字和单位，不添加新内容。",
    ...(view.readonlyPlaceholders.length ? [`以下占位词保持原样，不删除、复制或移动：${view.readonlyPlaceholders.join("，")}`] : []),
    "纠正下面这一行正文：",
    view.text
  ].join("\n\n");
  const systemPrompt = [
    input.systemPrompt,
    input.skill?.systemPrompt,
    "你是文字校对员。遵守用户任务的修改范围，保留正确内容和原意。只返回处理后的这一行普通文本，不要解释、加引号、代码围栏或字段名。"
  ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index).join("\n\n");
  return { prompt, systemPrompt };
}
