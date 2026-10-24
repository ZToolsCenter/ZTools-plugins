import { useI18n } from "./i18n";
import { translate } from "./i18n/messages";
import { RELEASE_LABEL, REPOSITORY_URL } from "./metadata";
import appLogo from "../assets/askills.svg";
import type { HostPage } from "../lib/host";
import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  FolderGit2,
  GitFork as Github,
  Settings2,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import {
  useCall,
  errorMessage,
  isDesktop,
  shortHash,
  sizeLabel,
} from "../lib/ipc/client";
import type {
  Snapshot,
  RunOperation,
  PreparedImport,
  DirectorySelection,
  DiscoveredProject,
  Revision,
  DeploymentPlan,
  Deployment,
  Skill,
  Project,
  Appearance,
  Locale,
} from "../lib/ipc/types";
import { LibraryView } from "../features/library/LibraryView";
import { BatchInstallDialog } from "../features/library/BatchInstallDialog";
import { ProjectsView } from "../features/projects/ProjectsView";
import { ProjectSkillPicker } from "../features/projects/ProjectSkillPicker";
import { SourcesView } from "../features/sources/SourcesView";
import { Modal } from "../components/Modal";
import { Markdown } from "../components/Markdown";
import { GitHubMark } from "../components/GitHubMark";
import { AppearanceSettings } from "../features/settings/AppearanceSettings";
import { LanguageSettings } from "../features/settings/LanguageSettings";
import { LibrarySettings } from "../features/settings/LibrarySettings";
import { DEFAULT_APPEARANCE, useAppearance } from "./appearance";
import { OperationContext, type OperationProgress } from "./OperationContext";
import { OperationToast } from "../components/OperationToast";
import "./styles.css";
import "./fonts.css";
import "./theme.css";
type Page = HostPage;
type Dialog =
  | {
      type: "remove-items";
      kind: "skills" | "projects";
      items: (Skill | Project)[];
    }
  | { type: "batch-install"; skills: Skill[] }
  | {
      type: "import";
      value: PreparedImport;
      targetProjectId?: string;
      remote?: boolean;
    }
  | {
      type: "install";
      revision: Revision;
      targetProjectId?: string;
    }
  | {
      type: "project-add";
      project: Project;
    }
  | {
      type: "plan";
      value: DeploymentPlan;
    }
  | {
      type: "discover";
      values: DiscoveredProject[];
    }
  | {
      type: "deployment";
      value: Deployment;
      action: "remove" | "rollback";
    }
  | null;
const initial: Snapshot = {
  skills: [],
  projects: [],
  deployments: [],
  libraryRoot: "",
  recovery: [],
  repositoryHistory: [],
  appearance: DEFAULT_APPEARANCE,
  locale: "zh-CN",
};
export default function App({
  initialPage = "library",
}: {
  initialPage?: Page;
}) {
  const { t, locale, setLocale } = useI18n();
  const call = useCall();
  const [snapshot, setSnapshot] = useState<Snapshot>(initial);
  useAppearance(snapshot.appearance);
  const [page, setPage] = useState<Page>(initialPage);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState<OperationProgress | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [sourceSeed, setSourceSeed] = useState<Skill | null>(null);
  const [projectId, setProjectId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [agent, setAgent] = useState("codex");
  const [mode, setMode] = useState("auto");
  const [chosenProjects, setChosenProjects] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const initialized = useRef(false);
  const inFlight = useRef(false);
  const operationSequence = useRef(0);
  const cancelRequested = useRef(false);
  const desktop = isDesktop();
  const disabled = !!busy || !desktop || !ready;
  const run: RunOperation = async (label, work) => {
    if (inFlight.current) return;
    inFlight.current = true;
    operationSequence.current++;
    cancelRequested.current = false;
    setProgress(null);
    setBusy(label);
    setError("");
    setNotice("");
    try {
      return await work();
    } catch (e) {
      setError(errorMessage(e, locale));
      return undefined;
    } finally {
      setBusy("");
      setProgress(null);
      inFlight.current = false;
    }
  };
  async function reload() {
    const loaded = await call<Snapshot>("get_snapshot");
    const result = {
      ...loaded,
      appearance: loaded.appearance ?? DEFAULT_APPEARANCE,
      locale: loaded.locale ?? "zh-CN",
    };
    setSnapshot(result);
    setLocale(result.locale);
    setReady(true);
    return result;
  }
  useEffect(() => {
    cancelRequested.current = false;
    if (!initialized.current && desktop) {
      initialized.current = true;
      void run(t("打开本地技能库"), reload);
    }
    return () => {
      // Leaving a plugin visit must stop any remaining items in a batch, even
      // when a native filesystem transaction is still finishing safely.
      cancelRequested.current = true;
    };
  }, []);
  async function choose(purpose: string) {
    return call<DirectorySelection | null>("pick_directory", { purpose });
  }
  async function importLocal(targetProjectId?: string) {
    const value = await run(t("检查本地技能"), async () => {
      const selection = await choose("import");
      return selection
        ? call<PreparedImport>("prepare_import", {
            selectionId: selection.id,
          })
        : null;
    });
    if (value) setDialog({ type: "import", value, targetProjectId });
  }
  async function finishImport() {
    if (dialog?.type !== "import") return;
    const targetProjectId = dialog.targetProjectId;
    const remote = dialog.remote;
    const result = await run(t("保存技能快照"), async () => {
      const skill = await call<Skill>("finish_import", {
        importId: dialog.value.id,
      });
      setDialog(null);
      await reload();
      if (targetProjectId) {
        const versions = await call<Revision[]>("get_revisions", {
          skillId: skill.id,
        });
        const revision = versions.find((r) => r.id === skill.latestRevisionId);
        if (!revision)
          throw new Error(
            t("技能已保存，但无法读取安装版本，请从项目技能库重新选择。"),
          );
        return { revision };
      }
      return { revision: null };
    });
    if (result) {
      setDialog(null);
      if (result.revision && targetProjectId) {
        beginInstall(result.revision, targetProjectId);
        setNotice(t("技能已保存，请继续预览当前项目的安装变更。"));
      } else {
        if (!remote) setPage("library");
        setNotice(t("技能已保存到本地库，现有项目的版本保持不变。"));
      }
    }
  }
  function recordDownloads(skills: Skill[], targetProjectId?: string) {
    setSnapshot((current) => {
      const updated = new Map(current.skills.map((s) => [s.id, s]));
      for (const skill of skills) updated.set(skill.id, skill);
      return { ...current, skills: [...updated.values()] };
    });
    if (targetProjectId && skills.length === 1) {
      const skill = skills[0];
      void run(t("读取项目安装版本"), () =>
        call<Revision[]>("get_revisions", { skillId: skill.id }),
      ).then((versions) => {
        const revision = versions?.find((r) => r.id === skill.latestRevisionId);
        if (revision) beginInstall(revision, targetProjectId);
      });
    }
  }
  async function closeDialog() {
    if (dialog?.type === "import") {
      try {
        await call("discard_import", { importId: dialog.value.id });
      } catch (e) {
        setError(errorMessage(e, locale));
      }
    }
    setDialog(null);
    setError("");
  }
  async function addProject() {
    const result = await run(t("添加项目"), async () => {
      const selection = await choose("project");
      if (!selection) return null;
      await call("register_project", { selectionId: selection.id });
      return reload();
    });
    if (result) setNotice(t("项目已登记，可以选择项目扫描技能。"));
  }
  async function discover() {
    const result = await run(t("发现目录中的项目"), async () => {
      const selection = await choose("discover");
      return selection
        ? call<DiscoveredProject[]>("discover_projects", {
            selectionId: selection.id,
          })
        : null;
    });
    if (result) {
      setChosenProjects([]);
      setDialog({ type: "discover", values: result });
    }
  }
  async function addDiscovered() {
    const count = chosenProjects.length;
    const result = await run(t("登记选择的项目"), async () => {
      try {
        for (const selectionId of chosenProjects) {
          await call("register_project", { selectionId });
          setChosenProjects((ids) => ids.filter((id) => id !== selectionId));
          setDialog((current) =>
            current?.type === "discover"
              ? {
                  ...current,
                  values: current.values.filter(
                    (p) => p.selectionId !== selectionId,
                  ),
                }
              : current,
          );
        }
      } catch (e) {
        try {
          await reload();
        } catch {
          /* Preserve the original registration error. */
        }
        throw e;
      }
      return reload();
    });
    if (result) {
      setDialog(null);
      setNotice(t("已登记 {count} 个项目。", { count }));
    }
  }
  function beginInstall(revision: Revision, targetProjectId?: string) {
    setProjectId(targetProjectId || snapshot.projects[0]?.id || "");
    setDialog({ type: "install", revision, targetProjectId });
  }
  async function previewInstall() {
    if (dialog?.type !== "install") return;
    const value = await run(t("检查项目并生成安装计划"), () =>
      call<DeploymentPlan>("preview_deployment", {
        projectId: dialog.targetProjectId || projectId,
        revisionId: dialog.revision.id,
        agent,
        mode,
      }),
    );
    if (value) setDialog({ type: "plan", value });
  }
  async function applyInstall() {
    if (dialog?.type !== "plan") return;
    const result = await run(t("应用并校验项目部署"), async () => {
      const deployment = await call<Deployment>("apply_deployment", {
        planId: dialog.value.id,
      });
      setDialog(null);
      await reload();
      return deployment;
    });
    if (result) {
      setDialog(null);
      setNotice(
        t(
          "已通过 {mode} 启用技能。请在对应 Agent 中刷新或开启新会话验证加载。",
          {
            mode: result.mode,
          },
        ),
      );
    }
  }
  async function changeDeployment() {
    if (dialog?.type !== "deployment") return;
    const result = await run(
      dialog.action === "remove" ? t("停用项目技能") : t("恢复上一个版本"),
      async () => {
        await call(
          dialog.action === "remove"
            ? "remove_deployment"
            : "rollback_deployment",
          { deploymentId: dialog.value.id },
        );
        setDialog(null);
        return reload();
      },
    );
    if (result) {
      setDialog(null);
      setNotice(t("项目变更已完成，技能库中的版本仍然保留。"));
    }
  }
  async function removeItems() {
    if (dialog?.type !== "remove-items") return;
    const { kind, items } = dialog;
    const result = await run(t("删除所选条目"), async () => {
      await call(
        kind === "skills" ? "remove_library_skills" : "remove_projects",
        kind === "skills"
          ? { skillIds: items.map((item) => item.id) }
          : { projectIds: items.map((item) => item.id) },
      );
      setDialog(null);
      if (
        kind === "projects" &&
        items.some((item) => item.id === selectedProjectId)
      )
        setSelectedProjectId("");
      return reload();
    });
    if (result) setNotice(t("已删除 {count} 项。", { count: items.length }));
  }
  async function saveAppearance(appearance: Appearance) {
    const result = await run(t("保存个性化设置"), () =>
      call<Appearance>("set_appearance", { appearance }),
    );
    if (result) {
      setSnapshot((current) => ({ ...current, appearance: result }));
      setNotice(t("个性化设置已保存。"));
    }
  }
  async function saveLocale(next: Locale) {
    const saved = await run(t("保存界面语言"), () =>
      call<Locale>("set_locale", { locale: next }),
    );
    if (saved) {
      setSnapshot((current) => ({ ...current, locale: saved }));
      setLocale(saved);
      setNotice(translate("界面语言已保存。", saved));
    }
  }
  const nav = [
    {
      id: "library",
      title: t("技能库"),
      Icon: BookOpen,
      count: snapshot.skills.length,
    },
    {
      id: "projects",
      title: t("项目"),
      Icon: FolderGit2,
      count: snapshot.projects.length,
    },
    { id: "sources", title: t("来源"), Icon: Github },
    { id: "settings", title: t("设置"), Icon: Settings2 },
  ] as const;
  function cancel() {
    const operation = operationSequence.current;
    cancelRequested.current = true;
    void call("cancel_operation")
      .then(() => {
        if (inFlight.current && operationSequence.current === operation)
          setNotice(t("已请求取消；正在完成当前安全步骤。"));
      })
      .catch((e) => {
        if (inFlight.current && operationSequence.current === operation)
          setError(errorMessage(e, locale));
      });
  }
  return (
    <OperationContext
      value={{
        error,
        busy,
        notice,
        cancel,
        progress,
        reportProgress: setProgress,
        notify: setNotice,
        fail: setError,
        isCancellationRequested: () => cancelRequested.current,
        dismissError: () => setError(""),
        dismissNotice: () => setNotice(""),
      }}
    >
      <OperationToast />
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <img className="brand-mark" src={appLogo} alt="" />
            <div>
              Askills
              <small>{t("让技能各就其位")}</small>
            </div>
          </div>
          <nav aria-label={t("主导航")}>
            {nav.map(({ id, title, Icon, ...item }) => (
              <button
                key={id}
                aria-label={title}
                className={page === id ? "nav-item active" : "nav-item"}
                disabled={!!busy}
                onClick={() => setPage(id)}
              >
                <Icon size={19} />
                <span>{title}</span>
                {"count" in item && <small>{item.count}</small>}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span className="version">
              {t("当前版本: {version}", { version: RELEASE_LABEL })}
            </span>
            <a
              href={REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                if (!isDesktop()) return;
                event.preventDefault();
                void call("open_repository").catch((error) =>
                  setError(errorMessage(error, locale)),
                );
              }}
            >
              <GitHubMark />
              {t("GitHub 仓库")}
            </a>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <span>
              {t("工作空间")}
              <span className="slash">/</span>{" "}
              {nav.find((n) => n.id === page)?.title}
            </span>
            <button
              className="text-button"
              disabled={!!busy || !desktop}
              onClick={() => void run(t("刷新数据"), reload)}
            >
              <RefreshCw size={15} />
              {t("刷新")}
            </button>
          </header>
          {!desktop && (
            <div className="banner">
              {t("当前为浏览器预览。运行")}
              <code>pnpm tauri dev</code> {t("使用本地技能管理功能。")}
            </div>
          )}
          {snapshot.recovery.map((message) => (
            <div className="banner" key={message}>
              {t(message)}
            </div>
          ))}
          <main className="page-content">
            {page === "library" && (
              <LibraryView
                key={
                  snapshot.libraryRoot +
                  snapshot.skills.map((s) => s.latestRevisionId).join(":")
                }
                skills={snapshot.skills}
                updated={(skill) =>
                  setSnapshot((current) => ({
                    ...current,
                    skills: current.skills.map((s) =>
                      s.id === skill.id ? skill : s,
                    ),
                  }))
                }
                busy={disabled}
                run={run}
                importLocal={() => void importLocal()}
                install={beginInstall}
                installSkills={(skills) =>
                  setDialog({ type: "batch-install", skills })
                }
                remove={(items) =>
                  setDialog({ type: "remove-items", kind: "skills", items })
                }
                checkUpdate={(skill) => {
                  setSourceSeed(skill);
                  setPage("sources");
                }}
              />
            )}
            {page === "projects" && (
              <ProjectsView
                key={
                  snapshot.libraryRoot +
                  snapshot.deployments.map((d) => d.id + d.revisionId).join(":")
                }
                projects={snapshot.projects}
                remove={(items) =>
                  setDialog({ type: "remove-items", kind: "projects", items })
                }
                updated={(project) =>
                  setSnapshot((current) => ({
                    ...current,
                    projects: current.projects.map((p) =>
                      p.id === project.id ? project : p,
                    ),
                  }))
                }
                selectedProjectId={selectedProjectId}
                selectProject={setSelectedProjectId}
                addSkills={(project) =>
                  setDialog({ type: "project-add", project })
                }
                deployments={snapshot.deployments}
                busy={disabled}
                run={run}
                addProject={() => void addProject()}
                discover={() => void discover()}
                changeDeployment={(value, action) =>
                  setDialog({ type: "deployment", value, action })
                }
              />
            )}
            {page === "sources" && (
              <SourcesView
                repositoryHistory={snapshot.repositoryHistory}
                historyChanged={(repositoryHistory) =>
                  setSnapshot((current) => ({ ...current, repositoryHistory }))
                }
                busy={disabled}
                run={run}
                prepared={(value) =>
                  setDialog({ type: "import", value, remote: true })
                }
                downloaded={(values) => recordDownloads(values)}
                seed={sourceSeed}
              />
            )}
            {page === "settings" && (
              <>
                <header className="page-head">
                  <div>
                    <p className="eyebrow">MAKE IT YOURS</p>
                    <h1>{t("设置")}</h1>
                    <p className="subtitle">{t("外观、主题色与本地数据。")}</p>
                  </div>
                </header>
                <LanguageSettings
                  busy={disabled}
                  save={(value) => void saveLocale(value)}
                />
                <AppearanceSettings
                  value={snapshot.appearance}
                  busy={disabled}
                  save={(appearance) => void saveAppearance(appearance)}
                />
                <LibrarySettings
                  libraryRoot={snapshot.libraryRoot}
                  busy={disabled}
                  run={run}
                  choose={() => choose("library")}
                  migrated={async ({ libraryRoot }) => {
                    setSnapshot((current) => ({ ...current, libraryRoot }));
                    setSourceSeed(null);
                    return reload();
                  }}
                />
              </>
            )}
          </main>
        </div>
        {dialog?.type === "batch-install" && (
          <BatchInstallDialog
            skills={dialog.skills}
            projects={snapshot.projects}
            busy={!!busy}
            run={run}
            refresh={reload}
            close={() => setDialog(null)}
          />
        )}
        {dialog?.type === "remove-items" && (
          <Modal
            title={
              dialog.kind === "skills"
                ? t("删除所选技能？")
                : t("删除所选项目？")
            }
            busy={!!busy}
            close={() => setDialog(null)}
          >
            <div className="modal-body">
              <p>
                {dialog.kind === "skills"
                  ? t(
                      "技能将从库列表移除，版本快照和已安装的项目技能保留。重新导入同一来源可以恢复；此操作不释放快照占用的磁盘空间。",
                    )
                  : t(
                      "项目将从管理列表移除，项目文件和已安装技能保留。重新添加同一项目文件夹可以恢复备注和管理记录。",
                    )}
              </p>
              <ul className="batch-items">
                {dialog.items.map((item) => (
                  <li key={item.id}>{item.displayName || item.name}</li>
                ))}
              </ul>
            </div>
            <footer className="modal-footer">
              <button disabled={!!busy} onClick={() => setDialog(null)}>
                {t("取消")}
              </button>
              <button
                className="danger-quiet"
                disabled={!!busy}
                onClick={() => void removeItems()}
              >
                {t("确认删除（{count}）", { count: dialog.items.length })}
              </button>
            </footer>
          </Modal>
        )}
        {dialog?.type === "project-add" && (
          <ProjectSkillPicker
            repositoryHistory={snapshot.repositoryHistory}
            historyChanged={(repositoryHistory) =>
              setSnapshot((current) => ({ ...current, repositoryHistory }))
            }
            project={dialog.project}
            skills={snapshot.skills}
            busy={!!busy}
            run={run}
            downloaded={(values, continueToProject) =>
              recordDownloads(
                values,
                continueToProject ? dialog.project.id : undefined,
              )
            }
            close={() => void closeDialog()}
            select={(revision) => beginInstall(revision, dialog.project.id)}
            importLocal={() => void importLocal(dialog.project.id)}
            prepared={(value) =>
              setDialog({
                type: "import",
                value,
                targetProjectId: dialog.project.id,
                remote: true,
              })
            }
          />
        )}
        {dialog?.type === "import" && (
          <Modal
            title={dialog.remote ? t("预览技能") : t("确认导入技能")}
            busy={!!busy}
            close={() => void closeDialog()}
            wide
          >
            <div className="modal-body">
              <h3>{dialog.value.preview.name}</h3>
              <p>{dialog.value.preview.description}</p>
              <div className="detail-metrics">
                <span>
                  {t("{count} 个文件", {
                    count: dialog.value.preview.fileCount,
                  })}
                </span>
                <span>{sizeLabel(dialog.value.preview.totalBytes)}</span>
                <span>{dialog.value.preview.license || t("未声明许可证")}</span>
                <code>
                  {shortHash(
                    dialog.value.source?.commit || dialog.value.preview.hash,
                  )}
                </code>
              </div>
              {dialog.value.preview.warnings.map((w) => (
                <p className="notice" key={w}>
                  {t(w)}
                </p>
              ))}
              <div className="import-reader">
                <Markdown text={dialog.value.preview.markdown} />
              </div>
            </div>
            <footer className="modal-footer">
              <span className="muted">
                {t("完整目录将保存为快照，原始目录不会改动。")}
              </span>
              <button
                className="primary"
                disabled={!!busy}
                onClick={() => void finishImport()}
              >
                {dialog.targetProjectId
                  ? t("导入并继续")
                  : dialog.remote
                    ? t("下载到技能库")
                    : t("确认导入")}{" "}
                <ArrowRight size={16} />
              </button>
            </footer>
          </Modal>
        )}
        {dialog?.type === "install" && (
          <Modal
            title={t("添加到项目")}
            busy={!!busy}
            close={() => void closeDialog()}
          >
            <div className="modal-body">
              {!snapshot.projects.length ? (
                <p>{t("请先到“项目”页面添加一个项目文件夹。")}</p>
              ) : (
                <>
                  <label className="field">
                    {t("目标项目")}
                    <select
                      value={projectId}
                      disabled={!!busy || !!dialog.targetProjectId}
                      onChange={(e) => setProjectId(e.target.value)}
                    >
                      {snapshot.projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.displayName || p.name} · {p.path}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    {t("Agent 目录")}
                    <select
                      value={agent}
                      disabled={!!busy}
                      onChange={(e) => setAgent(e.target.value)}
                    >
                      <option value="codex">Codex · .agents/skills</option>
                      <option value="cursor">Cursor · .cursor/skills</option>
                      <option value="claude-code">
                        Claude Code · .claude/skills
                      </option>
                    </select>
                  </label>
                  <label className="field">
                    {t("部署方式")}
                    <select
                      value={mode}
                      disabled={!!busy}
                      onChange={(e) => setMode(e.target.value)}
                    >
                      <option value="auto">{t("自动选择（推荐）")}</option>
                      <option value="copy">{t("复制")}</option>
                      <option value="symlink">{t("符号链接")}</option>
                      <option value="junction">Windows junction</option>
                    </select>
                  </label>
                  <p className="footnote">
                    {t("用于共享仓库、远程环境或容器时，建议选择复制。")}
                  </p>
                </>
              )}
            </div>
            <footer className="modal-footer">
              <span className="muted">{t("下一步将预览实际写入路径。")}</span>
              <button
                className="primary"
                disabled={!!busy || !projectId}
                onClick={() => void previewInstall()}
              >
                {t("预览变更")}
                <ArrowRight size={16} />
              </button>
            </footer>
          </Modal>
        )}
        {dialog?.type === "plan" && (
          <Modal
            title={
              dialog.value.previousRevisionId
                ? t("确认升级项目技能")
                : t("确认启用项目技能")
            }
            busy={!!busy}
            close={() => void closeDialog()}
          >
            <div className="modal-body">
              <h3>{dialog.value.name}</h3>
              <p className="path">{dialog.value.targetPath}</p>
              <p>
                {t("部署方式：")}
                {dialog.value.mode}
              </p>
              {dialog.value.conflict && (
                <p className="notice">{t(dialog.value.conflict)}</p>
              )}
              {dialog.value.warnings.map((w) => (
                <p className="notice" key={w}>
                  {t(w)}
                </p>
              ))}
              <p className="footnote">
                {t(
                  "应用前会再次检查版本和目标目录，已有非管理文件不会被覆盖。",
                )}
              </p>
            </div>
            <footer className="modal-footer">
              <span className="muted">
                {t("版本 {hash}", { hash: shortHash(dialog.value.revisionId) })}
              </span>
              <button
                className="primary"
                disabled={!!busy || !!dialog.value.conflict}
                onClick={() => void applyInstall()}
              >
                {t("确认应用")}
              </button>
            </footer>
          </Modal>
        )}
        {dialog?.type === "discover" && (
          <Modal
            title={t("选择要登记的项目")}
            busy={!!busy}
            close={() => void closeDialog()}
          >
            <div className="modal-body">
              <p className="muted">
                {t("限定深度扫描，跳过依赖目录与链接目录。")}
              </p>
              {dialog.values.map((p) => (
                <label className="check-row" key={p.selectionId}>
                  <input
                    type="checkbox"
                    disabled={!!busy}
                    checked={chosenProjects.includes(p.selectionId)}
                    onChange={(e) =>
                      setChosenProjects((prev) =>
                        e.target.checked
                          ? [...prev, p.selectionId]
                          : prev.filter((id) => id !== p.selectionId),
                      )
                    }
                  />
                  <span>
                    <strong>{p.name}</strong>
                    <small className="path">{p.path}</small>
                  </span>
                </label>
              ))}
              {!dialog.values.length && (
                <p>
                  {t(
                    "没有发现 Git 工作区或已知技能目录，也可以直接添加项目文件夹。",
                  )}
                </p>
              )}
            </div>
            <footer className="modal-footer">
              <span>
                {t("{count} 个已选择", { count: chosenProjects.length })}
              </span>
              <button
                className="primary"
                disabled={!!busy || !chosenProjects.length}
                onClick={() => void addDiscovered()}
              >
                {t("登记项目")}
              </button>
            </footer>
          </Modal>
        )}
        {dialog?.type === "deployment" && (
          <Modal
            title={
              dialog.action === "remove"
                ? t("停用这个项目的技能？")
                : t("恢复上一个版本？")
            }
            busy={!!busy}
            close={() => void closeDialog()}
          >
            <div className="modal-body">
              <h3>{dialog.value.name}</h3>
              <p className="path">{dialog.value.targetPath}</p>
              <p>
                {dialog.action === "remove"
                  ? t(
                      "仅停用 Askills 管理的项目入口，技能库内容保留。检测到外部修改时将停止操作。",
                    )
                  : t("把当前项目恢复到上一个受管理版本，其他项目保持不变。")}
              </p>
            </div>
            <footer className="modal-footer">
              <button disabled={!!busy} onClick={() => void closeDialog()}>
                {t("取消")}
              </button>
              <button
                className="primary"
                disabled={!!busy}
                onClick={() => void changeDeployment()}
              >
                {t("确认")}
                {dialog.action === "remove" ? t("停用") : t("回滚")}
              </button>
            </footer>
          </Modal>
        )}
      </div>
    </OperationContext>
  );
}
