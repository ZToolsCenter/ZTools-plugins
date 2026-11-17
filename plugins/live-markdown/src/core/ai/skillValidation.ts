import type { AiSkill } from "../../types/typora";

export type AiSkillDraft = Omit<AiSkill, "id">;

const categories = new Set<AiSkill["category"]>(["writing", "academic", "diagram", "coding", "summary"]);

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new Error(`${label}必须是文本。`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label}不能为空。`);
  if (normalized.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符。`);
  return normalized;
}

export function validateSkill(value: unknown): AiSkillDraft {
  if (!value || typeof value !== "object") throw new Error("技能内容无效。");
  const input = value as Partial<AiSkill>;
  const name = requiredText(input.name, "名称", 80);
  const description = requiredText(input.description, "说明", 240);
  const icon = requiredText(input.icon, "图标标识", 40);
  const systemPrompt = requiredText(input.systemPrompt, "系统提示词", 8_000);
  const userPromptTemplate = requiredText(input.userPromptTemplate, "用户提示模板", 12_000);
  if (!userPromptTemplate.includes("{{content}}")) throw new Error("用户提示模板必须包含 {{content}} 占位符。 ");
  if (!categories.has(input.category as AiSkill["category"])) throw new Error("请选择有效的技能类别。");
  return { name, description, icon, category: input.category as AiSkill["category"], systemPrompt, userPromptTemplate };
}

export function cloneSkill(skill: AiSkill): AiSkill {
  return { id: skill.id, name: skill.name, description: skill.description, icon: skill.icon, category: skill.category,
    systemPrompt: skill.systemPrompt, userPromptTemplate: skill.userPromptTemplate };
}
