import React from "react";
import { BookOpen, Code2, Copy, Eye, FileText, GraduationCap, ListChecks, Pencil, Play, Trash2, Workflow } from "lucide-react";
import type { AiSkill } from "../types/typora";

interface Props {
  skill: AiSkill;
  builtIn: boolean;
  busy: boolean;
  categoryName: string;
  onView: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: (trigger: HTMLButtonElement) => void;
  onRun: () => void;
}

const categoryIcons: Record<AiSkill["category"], React.ComponentType<{ size?: number; "aria-hidden"?: boolean }>> = {
  writing: FileText,
  academic: GraduationCap,
  diagram: Workflow,
  coding: Code2,
  summary: ListChecks
};

export const AiSkillCard: React.FC<Props> = ({ skill, builtIn, busy, categoryName, onView, onCopy, onEdit, onDelete, onRun }) => {
  const CategoryIcon = categoryIcons[skill.category] ?? BookOpen;
  return <article className="ty-ai-skills-card" aria-labelledby={`ty-ai-skill-name-${skill.id}`}>
    <div className="ty-ai-skills-card-main">
      <span className={`ty-ai-skills-card-icon ty-ai-skills-card-icon-${skill.category}`} aria-hidden="true"><CategoryIcon size={17} /></span>
      <div className="ty-ai-skills-card-copy">
        <h3 id={`ty-ai-skill-name-${skill.id}`} className="ty-ai-skills-card-name" title={skill.name}>{skill.name}</h3>
        <div className="ty-ai-skills-card-meta"><span>{categoryName}</span><span className="ty-ai-skills-card-kind">{builtIn ? "内置" : "自定义"}</span></div>
        <p className="ty-ai-skills-card-description" title={skill.description}>{skill.description}</p>
      </div>
    </div>
    <div className="ty-ai-skills-card-actions">
      <button className="ty-ai-skills-card-action" aria-label="查看" title="查看技能" onClick={onView}><Eye size={15} /><span>查看</span></button>
      {builtIn ? <button className="ty-ai-skills-card-icon-action" aria-label="复制" title="复制为自定义技能" disabled={busy} onClick={onCopy}><Copy size={15} /></button> : <>
        <button className="ty-ai-skills-card-icon-action" aria-label="编辑" title="编辑技能" disabled={busy} onClick={onEdit}><Pencil size={15} /></button>
        <button className="ty-ai-skills-card-icon-action" aria-label="删除" title="删除技能" disabled={busy} onClick={(event) => onDelete(event.currentTarget)}><Trash2 size={15} /></button>
      </>}
      <button className="ty-ai-skills-card-run" aria-label="运行" title="运行技能" disabled={busy} onClick={onRun}><Play size={14} /><span>运行</span></button>
    </div>
  </article>;
};
