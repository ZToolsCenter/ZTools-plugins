import React, { useState } from "react";
import type { AiSkill } from "../types/typora";
import type { AiSkillDraft } from "../core/ai/skillValidation";

interface Props {
  mode: "create" | "edit";
  initial?: AiSkillDraft;
  busy: boolean;
  onCancel: () => void;
  onSave: (draft: AiSkillDraft) => void;
}

const categories: Array<{ id: AiSkill["category"]; label: string }> = [
  { id: "writing", label: "写作" }, { id: "academic", label: "学术" }, { id: "diagram", label: "图表" },
  { id: "coding", label: "编程" }, { id: "summary", label: "总结" }
];

export const AiSkillForm: React.FC<Props> = ({ mode, initial, busy, onCancel, onSave }) => {
  const [form, setForm] = useState<AiSkillDraft>(() => initial ? { ...initial } : {
    name: "", description: "", icon: "Sparkles", category: "writing", systemPrompt: "",
    userPromptTemplate: "请处理以下内容：\n\n{{content}}"
  });
  const [validationError, setValidationError] = useState("");
  const update = <K extends keyof AiSkillDraft>(key: K, value: AiSkillDraft[K]) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setValidationError("");
    if (!form.userPromptTemplate.includes("{{content}}")) {
      setValidationError("模板必须包含 {{content}}，运行时会在该处插入正文。");
      return;
    }
    onSave(form);
  };

  return <form className="ty-ai-skills-form" onSubmit={submit}>
    <header><div><strong>{mode === "edit" ? "编辑技能" : "新建技能"}</strong><small>定义名称、执行类别和提示词模板</small></div></header>
    <label>名称<input autoFocus disabled={busy} maxLength={80} required value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="例如：产品需求审阅" /></label>
    <label>说明<input disabled={busy} maxLength={240} required value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="简要说明此技能适合处理什么" /></label>
    <label>执行类别<select disabled={busy} value={form.category} onChange={(event) => update("category", event.target.value as AiSkill["category"])}>{categories.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    <label>系统提示词<textarea aria-label="系统提示词" disabled={busy} required maxLength={8_000} rows={5} value={form.systemPrompt} onChange={(event) => update("systemPrompt", event.target.value)} placeholder="说明 AI 的角色、语气和约束" /></label>
    <label>用户提示模板<textarea aria-label="用户提示模板" disabled={busy} required maxLength={12_000} rows={6} value={form.userPromptTemplate} onChange={(event) => update("userPromptTemplate", event.target.value)} aria-describedby="ty-ai-skill-template-help" /></label>
    <small id="ty-ai-skill-template-help">必须包含 <code>{"{{content}}"}</code>。正文会按原文插入，包含 $ 符号也会原样保留。</small>
    {validationError && <p className="ty-ai-skills-error" role="alert">{validationError}</p>}
    <footer><button type="button" disabled={busy} onClick={onCancel}>取消</button><button className="primary" type="submit" disabled={busy}>{mode === "edit" ? "保存修改" : "创建技能"}</button></footer>
  </form>;
};
