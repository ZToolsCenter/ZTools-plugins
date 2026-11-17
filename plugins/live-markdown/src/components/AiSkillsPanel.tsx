import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, Copy, Pencil, Play, Plus } from "lucide-react";
import type { AiSkill } from "../types/typora";
import type { SkillsManager } from "../core/ai/skillsManager";
import type { AiSkillDraft } from "../core/ai/skillValidation";
import { AiSkillForm } from "./AiSkillForm";
import { AiSkillCard } from "./AiSkillCard";
import "../styles/ai-skills.css";

interface Props {
  manager: SkillsManager;
  busy: boolean;
  onRun: (id: string) => void;
}

type Screen = { kind: "list" } | { kind: "view"; id: string } | { kind: "edit"; id: string } | { kind: "create"; draft?: AiSkillDraft };

const categoryNames: Record<AiSkill["category"], string> = {
  writing: "写作", academic: "学术", diagram: "图表", coding: "编程", summary: "总结"
};

export const AiSkillsPanel: React.FC<Props> = ({ manager, busy, onRun }) => {
  const [revision, setRevision] = useState(0);
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState("");
  const confirmDialog = useRef<HTMLDialogElement | null>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const addSkillButton = useRef<HTMLButtonElement | null>(null);
  const entries = manager.getAllEntries();
  void revision;
  useEffect(() => {
    const dialog = confirmDialog.current;
    if (confirmDelete && dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, [confirmDelete]);

  const selected = screen.kind === "view" || screen.kind === "edit"
    ? entries.find((entry) => entry.skill.id === screen.id)
    : undefined;
  const returnToList = () => { setScreen({ kind: "list" }); setError(""); };
  const run = (id: string) => { if (!busy) onRun(id); };
  const save = (draft: AiSkillDraft) => {
    if (busy) return;
    try {
      if (screen.kind === "edit") manager.updateSkill(screen.id, draft);
      else if (screen.kind === "create") manager.createSkill(draft);
      setRevision((value) => value + 1);
      returnToList();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "技能保存失败，请重试。");
    }
  };
  const copyBuiltin = (id: string) => {
    if (busy) return;
    try {
      const source = manager.getSkillById(id);
      if (!source) throw new Error("找不到要复制的内置技能。");
      const draft: AiSkillDraft = {
        name: source.name, description: source.description, icon: source.icon, category: source.category,
        systemPrompt: source.systemPrompt, userPromptTemplate: source.userPromptTemplate
      };
      const suffix = "（副本）";
      setScreen({ kind: "create", draft: { ...draft, name: `${draft.name.slice(0, 80 - suffix.length)}${suffix}` } });
      setError("");
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : "复制失败，请检查本地存储。");
    }
  };
  const removeSkill = () => {
    if (busy || !confirmDelete) return;
    try {
      manager.deleteSkill(confirmDelete);
      setRevision((value) => value + 1);
      setConfirmDelete(null);
      setError("");
      window.requestAnimationFrame(() => (deleteTrigger.current?.isConnected ? deleteTrigger.current : addSkillButton.current)?.focus());
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除失败，请重试。");
      setConfirmDelete(null);
    }
  };

  if (screen.kind === "create" || screen.kind === "edit") {
    const initial = screen.kind === "edit" ? selected?.skill : screen.kind === "create" ? screen.draft : undefined;
    return <section className="ty-ai-skills" aria-label="技能管理">
      <button className="ty-ai-skills-back" onClick={returnToList}><ArrowLeft size={15} />返回技能列表</button>
      {error && <p className="ty-ai-skills-error" role="alert">{error}</p>}
      <AiSkillForm key={screen.kind === "edit" ? screen.id : "new"} mode={screen.kind} initial={initial} busy={busy} onCancel={returnToList} onSave={save} />
    </section>;
  }

  if (screen.kind === "view") {
    if (!selected) return <section className="ty-ai-skills"><button onClick={returnToList}>返回</button><p>该技能已不存在。</p></section>;
    const { skill, builtIn } = selected;
    return <section className="ty-ai-skills" aria-label="技能详情">
      <button className="ty-ai-skills-back" onClick={returnToList}><ArrowLeft size={15} />返回技能列表</button>
      <header className="ty-ai-skills-heading"><div><small>{builtIn ? "内置技能" : "自定义技能"} · {categoryNames[skill.category]}</small><h2>{skill.name}</h2><p>{skill.description}</p></div></header>
      <dl className="ty-ai-skills-detail"><dt>系统提示词</dt><dd><pre>{skill.systemPrompt}</pre></dd><dt>用户提示模板</dt><dd><pre>{skill.userPromptTemplate}</pre></dd></dl>
      <footer className="ty-ai-skills-actions">
        {builtIn ? <button disabled={busy} onClick={() => copyBuiltin(skill.id)}><Copy size={14} />复制为自定义</button> : <button disabled={busy} onClick={() => { setError(""); setScreen({ kind: "edit", id: skill.id }); }}><Pencil size={14} />编辑</button>}
        <button className="primary" disabled={busy} onClick={() => run(skill.id)}><Play size={14} />运行技能</button>
      </footer>
      {error && <p className="ty-ai-skills-error" role="alert">{error}</p>}
    </section>;
  }

  return <section className="ty-ai-skills" aria-label="技能管理">
    <header className="ty-ai-skills-heading"><div><h2>技能库</h2><p>浏览内置技能，或创建自己的模板。</p></div><button ref={addSkillButton} className="ty-ai-skills-new" aria-label="新建技能" title="新建技能" disabled={busy || entries.filter((entry) => !entry.builtIn).length >= manager.getMaxCustomSkills()} onClick={() => { setError(""); setScreen({ kind: "create" }); }}><Plus size={15} /><span>新建</span></button></header>
    {manager.getPersistenceIssue() && <p className="ty-ai-skills-notice" role="status">{manager.getPersistenceIssue()}</p>}
    {error && <p className="ty-ai-skills-error" role="alert">{error}</p>}
    <div className="ty-ai-skills-list">
      {entries.map(({ skill, builtIn }) => <AiSkillCard key={skill.id} skill={skill} builtIn={builtIn} busy={busy} categoryName={categoryNames[skill.category]} onView={() => { setError(""); setScreen({ kind: "view", id: skill.id }); }} onCopy={() => copyBuiltin(skill.id)} onEdit={() => { setError(""); setScreen({ kind: "edit", id: skill.id }); }} onDelete={(trigger) => { deleteTrigger.current = trigger; setConfirmDelete(skill.id); }} onRun={() => run(skill.id)} />)}
    </div>
    {busy && <p className="ty-ai-skills-notice">AI 正在运行，技能定义暂时锁定。</p>}
    {confirmDelete && <dialog ref={confirmDialog} className="ty-ai-skills-confirm" aria-labelledby="ty-ai-delete-title" aria-describedby="ty-ai-delete-description" onCancel={(event) => { event.preventDefault(); setConfirmDelete(null); }}>
      <h3 id="ty-ai-delete-title">删除自定义技能？</h3><p id="ty-ai-delete-description">此操作会从本机技能列表中移除该技能，无法撤销。</p>
      <footer><button disabled={busy} onClick={() => setConfirmDelete(null)}>取消</button><button className="danger" disabled={busy} onClick={removeSkill}>删除技能</button></footer>
    </dialog>}
  </section>;
};
