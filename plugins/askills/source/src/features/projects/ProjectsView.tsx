import { useI18n } from "../../app/i18n";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { pluginHost } from "../../lib/host";
import "../../app/ztools-layout.css";
import {
  FolderGit2,
  FolderPlus,
  ScanSearch,
  RefreshCw,
  RotateCcw,
  Unplug,
  Pencil,
  Trash2,
  ListChecks,
} from "lucide-react";
import { useCall, shortHash } from "../../lib/ipc/client";
import type {
  Project,
  Deployment,
  DetectedSkill,
  RunOperation,
} from "../../lib/ipc/types";
import { EmptyState } from "../../components/EmptyState";
import { ContextMenu, useContextMenu } from "../../components/ContextMenu";
import {
  SelectionToolbar,
  useSelection,
} from "../../components/SelectionToolbar";
import { Modal } from "../../components/Modal";
const statusLabels: Record<string, string> = {
  installed: "已启用",
  MissingEntry: "安装入口已丢失",
  EntryReplaced: "安装入口被替换",
  LocalChangesDetected: "副本被外部修改",
  RevisionModified: "库内版本被修改",
  UnsafePath: "路径需要检查",
  FileSystemError: "文件读取失败",
  valid: "已识别",
  external: "外部技能",
  linked: "链接技能",
  broken: "链接失效",
  broken_link: "链接失效",
  invalid: "格式无效",
  ready: "正常",
  active: "已启用",
  drifted: "内容已变化",
  healthy: "正常",
};
export function ProjectsView({
  projects,
  deployments,
  busy,
  run,
  addProject,
  discover,
  changeDeployment,
  addSkills,
  selectedProjectId,
  selectProject,
  remove,
  updated,
}: {
  projects: Project[];
  deployments: Deployment[];
  busy: boolean;
  run: RunOperation;
  addProject: () => void;
  discover: () => void;
  changeDeployment: (
    deployment: Deployment,
    action: "remove" | "rollback",
  ) => void;
  addSkills: (project: Project) => void;
  selectedProjectId: string;
  selectProject: (id: string) => void;
  remove: (projects: Project[]) => void;
  updated: (project: Project) => void;
}) {
  const { t } = useI18n();
  const call = useCall();
  const inlineDetails = !!pluginHost();
  const layout = useRef<HTMLDivElement>(null);
  const selected = projects.find((p) => p.id === selectedProjectId) || null;
  const [entries, setEntries] = useState<DetectedSkill[] | null>(null);
  const menu = useContextMenu<Project>();
  const selection = useSelection();
  const chosen = projects.filter((project) =>
    selection.ids.includes(project.id),
  );
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  async function saveName(displayName: string) {
    if (!renaming) return;
    const value = await run(t("保存项目备注名"), () =>
      call<Project>("set_project_display_name", {
        projectId: renaming.id,
        displayName,
      }),
    );
    if (value) {
      updated(value);
      setRenaming(null);
    }
  }
  async function scan(project: Project) {
    selectProject(project.id);
    setEntries(null);
    const result = await run(t("扫描项目技能"), () =>
      call<DetectedSkill[]>("scan_project", { projectId: project.id }),
    );
    if (result) setEntries(result);
  }
  const installed = deployments.filter((d) => d.projectId === selected?.id);
  useLayoutEffect(() => {
    if (inlineDetails) {
      layout.current
        ?.querySelector<HTMLElement>('.project-card[aria-expanded="true"]')
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [inlineDetails, selected?.id]);
  function collapse() {
    selectProject("");
    setEntries(null);
  }
  const detail = selected && (
    <section className="project-detail">
      <div className="detail-heading">
        <h2>{selected.displayName || selected.name}</h2>
        {inlineDetails && (
          <button className="text-button" disabled={busy} onClick={collapse}>
            {t("收起")}
          </button>
        )}
        <button
          className="primary"
          disabled={busy}
          onClick={() => addSkills(selected)}
        >
          <FolderPlus size={16} />
          {t("添加技能")}
        </button>
        <button disabled={busy} onClick={() => void scan(selected)}>
          <RefreshCw size={15} />
          {t("重新扫描")}
        </button>
      </div>
      <p className="path">{selected.path}</p>
      <h3 className="section-title">
        {t("由 Askills 管理")}
        <span>{installed.length}</span>
      </h3>
      {installed.map((item) => (
        <div className="deployment-row" key={item.id}>
          <div>
            <strong>{item.name}</strong>
            <p>
              {item.agent} · {item.mode} ·{" "}
              {t(statusLabels[item.status] || item.status)}
            </p>
            <code className="path">{item.targetPath}</code>
            <small>
              {t("版本 {hash}", { hash: shortHash(item.revisionId) })}
            </small>
          </div>
          <div className="button-column">
            <button
              disabled={busy || !item.previousRevisionId}
              onClick={() => changeDeployment(item, "rollback")}
            >
              <RotateCcw size={14} />
              {t("回滚")}
            </button>
            <button
              className="danger-quiet"
              disabled={busy}
              onClick={() => changeDeployment(item, "remove")}
            >
              <Unplug size={14} />
              {t("停用")}
            </button>
          </div>
        </div>
      ))}
      {!installed.length && (
        <p className="subtle-empty">
          {t("从技能库选择一个技能，点击“添加到项目”。")}
        </p>
      )}
      <h3 className="section-title">
        {t("扫描发现")}
        <span>{entries?.length ?? "—"}</span>
      </h3>
      {entries?.map((entry, index) => (
        <div className="detected-row" key={entry.path + index}>
          <div className="detail-heading">
            <strong>{entry.name}</strong>
            <span className="badge">
              {t(statusLabels[entry.status] || entry.status)}
            </span>
          </div>
          <p className="path">{entry.path}</p>
          <p className="muted">
            {t("可能读取：")}
            {entry.consumers.join(" / ") || t("未知工具")}
          </p>
          {entry.resolvedPath && entry.resolvedPath !== entry.path && (
            <p className="path">
              {t("目标：")}
              {entry.resolvedPath}
            </p>
          )}
          {entry.diagnostics.map((d) => (
            <p className="notice" key={d}>
              {t(d)}
            </p>
          ))}
        </div>
      ))}
      {entries?.length === 0 && (
        <p className="subtle-empty">
          {t("没有发现现有技能目录。可以从技能库添加。")}
        </p>
      )}
      <p className="footnote">
        {t("扫描只读取文件。多个工具可能同时读取同一个兼容目录。")}
      </p>
    </section>
  );
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">PROJECT WORKSPACES</p>
          <h1>
            {t("项目")}
            <span className="count">{projects.length}</span>
          </h1>
          <p className="subtitle">
            {t("查看项目现有技能，管理每个项目使用的版本。")}
          </p>
        </div>
        <div className="button-row">
          <button disabled={busy} onClick={discover}>
            <ScanSearch size={17} />
            {t("扫描目录")}
          </button>
          <button className="primary" disabled={busy} onClick={addProject}>
            <FolderPlus size={17} />
            {t("添加项目")}
          </button>
        </div>
      </header>
      {selection.active && (
        <SelectionToolbar
          count={chosen.length}
          busy={busy}
          selectAll={() => selection.select(projects.map((p) => p.id))}
          clear={() => selection.select([])}
          exit={selection.exit}
        >
          <button
            className="danger-quiet"
            disabled={busy || !chosen.length}
            onClick={() => remove(chosen)}
          >
            <Trash2 size={16} />
            {t("删除所选")}
          </button>
        </SelectionToolbar>
      )}
      <div
        ref={layout}
        className={`projects-layout${inlineDetails ? " ztools-inline-layout" : ""}`}
      >
        <section
          className={`project-list${inlineDetails ? " ztools-inline-list" : ""}`}
          aria-label={t("项目列表")}
        >
          {projects.map((project) => (
            <Fragment key={project.id}>
              <div className="selectable-item" {...menu.bind(project, busy)}>
                {selection.active && (
                  <input
                    type="checkbox"
                    disabled={busy}
                    aria-label={t("选择 {name}", {
                      name: project.displayName || project.name,
                    })}
                    checked={selection.ids.includes(project.id)}
                    onChange={() => selection.toggle(project.id)}
                  />
                )}
                <button
                  disabled={busy}
                  className={
                    (
                      selection.active
                        ? selection.ids.includes(project.id)
                        : selected?.id === project.id
                    )
                      ? "project-card selected"
                      : "project-card"
                  }
                  aria-expanded={
                    inlineDetails ? selected?.id === project.id : undefined
                  }
                  aria-pressed={
                    selection.active
                      ? selection.ids.includes(project.id)
                      : undefined
                  }
                  onClick={() =>
                    selection.active
                      ? selection.toggle(project.id)
                      : inlineDetails && selected?.id === project.id
                        ? collapse()
                        : void scan(project)
                  }
                >
                  <FolderGit2 size={22} />
                  <span>
                    <strong>{project.displayName || project.name}</strong>
                    <small className="path">{project.path}</small>
                    <small>
                      {t("{count} 个受管理技能", {
                        count: deployments.filter(
                          (d) => d.projectId === project.id,
                        ).length,
                      })}
                    </small>
                  </span>
                </button>
              </div>
              {inlineDetails && selected?.id === project.id && detail}
            </Fragment>
          ))}
          {!projects.length && (
            <EmptyState
              icon={<FolderGit2 size={28} />}
              title={t("连接你的第一个项目")}
            >
              {t("选择项目文件夹，自动识别 Codex、Cursor 等工具的技能目录。")}
            </EmptyState>
          )}
        </section>
        {selected
          ? !inlineDetails && detail
          : projects.length > 0 && (
              <EmptyState
                icon={<ScanSearch size={28} />}
                title={t("选择项目查看技能")}
              >
                {t("同时展示已管理的部署和项目中的现有技能。")}
              </EmptyState>
            )}
      </div>
      {menu.anchor && !busy && (
        <ContextMenu
          anchor={menu.anchor}
          label={t("项目操作")}
          close={menu.close}
          actions={[
            {
              label: t("备注项目名"),
              icon: <Pencil size={16} />,
              action: () => {
                setNameDraft(menu.anchor!.item.displayName || "");
                setRenaming(menu.anchor!.item);
              },
            },
            {
              label: t("添加技能"),
              icon: <FolderPlus size={16} />,
              action: () => {
                selectProject(menu.anchor!.item.id);
                setEntries(null);
                addSkills(menu.anchor!.item);
              },
            },
            {
              label: t("多选"),
              icon: <ListChecks size={16} />,
              action: () => selection.enter(menu.anchor!.item.id),
            },
            {
              label: t("删除"),
              icon: <Trash2 size={16} />,
              danger: true,
              action: () => remove([menu.anchor!.item]),
            },
          ]}
        />
      )}
      {renaming && (
        <Modal
          title={t("备注项目名")}
          busy={busy}
          close={() => setRenaming(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveName(nameDraft);
            }}
          >
            <div className="modal-body">
              <label className="field">
                {t("显示名称")}
                <input
                  autoFocus
                  maxLength={80}
                  disabled={busy}
                  value={nameDraft}
                  placeholder={renaming.name}
                  onChange={(e) => setNameDraft(e.target.value)}
                />
              </label>
              <p className="path">{renaming.path}</p>
              <p className="footnote">
                {t(
                  "备注仅用于 Askills 显示，不改变项目文件夹名称或路径。留空可恢复原名。",
                )}
              </p>
            </div>
            <footer className="modal-footer">
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveName("")}
              >
                {t("恢复原名")}
              </button>
              <button type="submit" className="primary" disabled={busy}>
                {t("保存名称")}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </>
  );
}
