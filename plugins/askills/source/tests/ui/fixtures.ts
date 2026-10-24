import type { Page } from "@playwright/test";
import type {
  DeploymentPlan,
  Deployment,
  PreparedImport,
  Project,
  Revision,
  Skill,
  SkillDocument,
  Snapshot,
  Appearance,
  Locale,
} from "../../src/lib/ipc/types";

type Invocation = { command: string; args: Record<string, unknown> };
type FixtureOptions = {
  emptyLibrary?: boolean;
  importFailures?: number;
  registrationFailure?: boolean;
  deploymentConflict?: boolean;
  extraProject?: boolean;
  gitUnavailable?: boolean;
  sourceCandidateCount?: number;
  downloadDelayMs?: number;
  downloadFailures?: Record<string, number>;
  repositoryHistory?: string[];
  resolveFailure?: boolean;
  appearance?: Partial<Appearance>;
  fontListFailure?: boolean;
  systemFonts?: string[];
  appearanceSaveFailure?: boolean;
  locale?: Locale;
  localeSaveFailure?: boolean;
  removalFailure?: boolean;
  deploymentFailureSkill?: string;
  duplicateSkillName?: boolean;
  librarySelectionCancelled?: boolean;
  librarySamePath?: boolean;
  migrationFailure?: boolean;
  migrationPreviewFailure?: boolean;
  migrationDelayMs?: number;
  migrationRecoveredBeforeRetry?: boolean;
  migrationSnapshotFailure?: boolean;
  discardSelectionFailure?: boolean;
  migrationReadyBeforeCancel?: boolean;
  cancellationReplyDelayMs?: number;
  laterRefreshDelayMs?: number;
};

declare global {
  interface Window {
    isTauri: boolean;
    __TAURI_INTERNALS__: {
      invoke: (
        command: string,
        args: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    __ASKILLS_TEST__: {
      invocations: Invocation[];
      committedImports: number;
      committedSkillPaths: string[];
      completedCancellations: number;
      fontListFailure: boolean;
    };
    __markdownExecuted?: boolean;
  }
}

const localSource = {
  kind: "local",
  url: null,
  reference: null,
  commit: null,
  subpath: null,
  localPath: "D:/Example/skills/rust-async-patterns",
};
const rust: Skill = {
  id: "skill-rust",
  name: "rust-async-patterns",
  displayName: null,
  description: "掌握 Rust 异步任务、取消和错误处理，构建可靠的并发程序。",
  license: "MIT",
  latestRevisionId: "revision-rust-1",
  source: localSource,
  revisionCount: 1,
  createdAt: "1792281600",
};
const security: Skill = {
  ...rust,
  id: "skill-security",
  name: "tauri-security",
  description: "检查 Tauri 原生接口、权限范围和不可信内容边界。",
  latestRevisionId: "revision-security-1",
  source: {
    kind: "github",
    url: "https://github.com/example/skills",
    reference: "main",
    commit: "c".repeat(40),
    subpath: "skills/tauri-security",
    localPath: null,
  },
};

function revision(skill: Skill, hash: string): Revision {
  return {
    id: skill.latestRevisionId,
    skillId: skill.id,
    hash: hash.repeat(64),
    path: `D:/Example/library/${skill.id}/${hash.repeat(64)}`,
    source: skill.source,
    fileCount: 4,
    totalBytes: 4096,
    createdAt: skill.createdAt,
  };
}

/**
 * Only the IPC boundary is replaced. No native dialog, local filesystem, shell,
 * GitHub request, or personal project is touched by these browser fixtures.
 */
export async function installBackendFixture(
  page: Page,
  options: FixtureOptions = {},
) {
  await page.addInitScript(
    ({ options, rust, security, revisions }) => {
      let appearance: Appearance = {
        mode: "system",
        accentColor: "#005fb8",
        fontFamily: "Microsoft YaHei",
        ...(JSON.parse(
          localStorage.getItem("askills-test-appearance") || "null",
        ) || options.appearance),
      };
      let failedAppearance = false;
      let locale: Locale =
        (localStorage.getItem("askills-test-locale") as Locale) ||
        options.locale ||
        "zh-CN";
      let failedLocale = false;
      let libraryRoot = "D:/Example/Askills Library";
      let failedMigration = false;
      let migrationCancelled = false;
      let failedMigrationSnapshot = false;
      let snapshotCount = 0;
      let repositoryHistory: string[] =
        JSON.parse(
          localStorage.getItem("askills-test-repository-history") || "null",
        ) ||
        options.repositoryHistory ||
        [];
      const skills = options.emptyLibrary ? [] : [rust, security];
      if (options.duplicateSkillName) security.name = rust.name;
      const removedSkills = new Set<string>();
      const removedProjects = new Set<string>();
      let removalFailed = false;
      let deploymentFailed = false;
      let planNumber = 0;
      const projects: Project[] = [
        {
          id: "project-askills",
          name: "Askills 示例",
          path: "D:/Example/Askills",
        },
      ];
      if (options.extraProject)
        projects.push({
          id: "project-second",
          name: "第二个项目",
          path: "D:/Example/Second",
        });
      const deployments: Deployment[] = [];
      const plans = new Map<string, DeploymentPlan>();
      const documents: Record<string, string> = {
        "skill-rust":
          '# Rust 异步技能\n\n使用 Tokio 管理任务生命周期，清楚地区分并发与并行。\n\n## 实施顺序\n\n1. 为每个任务定义取消边界。\n2. 保留错误上下文。\n3. 验证资源是否释放。\n\n```rust\nlet result = task.await?;\n```\n\n![跟踪图片](https://tracking.invalid/pixel.png)\n\n[外部文档](https://example.invalid/docs)\n\n<script>window.__markdownExecuted = true</script>\n<img src=x onerror="window.__markdownExecuted=true">',
        "skill-security":
          "# Tauri 安全检查\n\n仅授权必要的本地接口，校验所有跨进程输入。",
      };
      const state = {
        invocations: [] as Invocation[],
        committedImports: 0,
        committedSkillPaths: [] as string[],
        completedCancellations: 0,
        fontListFailure: options.fontListFailure ?? false,
      };
      window.__ASKILLS_TEST__ = state;
      window.isTauri = true;
      let failedImports = 0;
      let failedRegistration = false;
      let selectionNumber = 0;
      let previewNumber = 0;
      let operationInFlight = false;
      let downloadCancelled = false;
      const downloadAttempts = new Map<string, number>();
      const progress = new Map<
        string,
        {
          completedFiles: number;
          totalFiles: number;
          completedBytes: number;
          totalBytes: number;
          currentFile: string;
          stage: "download";
        }
      >();
      const sourceCandidates = Array.from(
        { length: options.sourceCandidateCount ?? 1 },
        (_, index) => ({
          path:
            index === 0
              ? "skills/rust"
              : index === 1
                ? "skills/tauri-security"
                : `skills/example-${index + 1}`,
          name:
            index === 0
              ? rust.name
              : index === 1
                ? security.name
                : `example-skill-${index + 1}`,
          fileCount: 4,
          totalBytes: 4096,
        }),
      );
      const selected = new Map<string, string>();
      const previews = new Map<string, PreparedImport>();
      const discoveries = [
        {
          selectionId: "discover-alpha",
          name: "Alpha 项目",
          path: "D:/Example/Alpha",
          reason: "Git 工作区",
        },
        {
          selectionId: "discover-beta",
          name: "Beta 项目",
          path: "D:/Example/Beta",
          reason: "Git 工作区",
        },
      ];
      const error = (code: string, message: string) => ({ code, message });
      const sourceSkill = (source: Skill["source"] | null): Skill => {
        if (!source?.subpath || source.subpath === "skills/rust") return rust;
        if (source.subpath === "skills/tauri-security") return security;
        const candidate = sourceCandidates.find(
          (item) => item.path === source.subpath,
        )!;
        return {
          ...rust,
          id: `skill-${candidate.name}`,
          name: candidate.name,
          description: `测试 ${candidate.name} 的独立导入。`,
          latestRevisionId: `revision-${candidate.name}-1`,
        };
      };
      const prepare = (source: Skill["source"] | null): PreparedImport => {
        const skill = sourceSkill(source);
        const value: PreparedImport = {
          id: `preview-${++previewNumber}`,
          source,
          preview: {
            name: skill.name,
            description: skill.description,
            license: "MIT",
            hash: "d".repeat(64),
            fileCount: 4,
            totalBytes: 4096,
            markdown:
              documents[skill.id] ||
              `# ${skill.name}\n\nRead the reference before running this skill.`,
            warnings: [],
          },
        };
        previews.set(value.id, value);
        return value;
      };

      window.__TAURI_INTERNALS__ = {
        invoke: async (command, args = {}) => {
          state.invocations.push({ command, args });
          const isCancellation = command === "cancel_operation";
          const bypassBusy =
            isCancellation ||
            command === "get_download_progress" ||
            command === "list_system_fonts";
          // Mirror the native global busy gate so accidental Promise.all IPC fails.
          if (!bypassBusy) {
            if (operationInFlight)
              throw error("Busy", "模拟后端拒绝并发 IPC 操作");
            operationInFlight = true;
          }
          try {
            await new Promise((resolve) => setTimeout(resolve, 5));
            switch (command) {
              case "open_repository":
                return null;
              case "get_snapshot": {
                snapshotCount++;
                if (snapshotCount >= 3 && options.laterRefreshDelayMs)
                  await new Promise((resolve) =>
                    setTimeout(resolve, options.laterRefreshDelayMs),
                  );
                if (
                  libraryRoot === "D:/Example/library" &&
                  options.migrationSnapshotFailure &&
                  !failedMigrationSnapshot
                ) {
                  failedMigrationSnapshot = true;
                  throw error("ReadFailed", "模拟迁移后的数据刷新失败");
                }
                const snapshot: Snapshot = {
                  skills: skills.filter((s) => !removedSkills.has(s.id)),
                  projects: projects.filter((p) => !removedProjects.has(p.id)),
                  deployments,
                  libraryRoot,
                  recovery: [],
                  repositoryHistory,
                  appearance,
                  locale,
                };
                return structuredClone(snapshot);
              }
              case "set_locale": {
                if (options.localeSaveFailure && !failedLocale) {
                  failedLocale = true;
                  throw error("WriteFailed", "模拟设置保存失败");
                }
                if (args.locale !== "en" && args.locale !== "zh-CN")
                  throw error("InvalidLocale", "界面语言无效");
                locale = args.locale;
                localStorage.setItem("askills-test-locale", locale);
                return locale;
              }
              case "list_system_fonts": {
                if (state.fontListFailure) {
                  throw error(
                    "FontEnumerationFailed",
                    "无法读取本机字体，请重试",
                  );
                }
                return (
                  options.systemFonts ?? ["Arial", "Microsoft YaHei", "SimSun"]
                );
              }
              case "set_appearance": {
                if (options.appearanceSaveFailure && !failedAppearance) {
                  failedAppearance = true;
                  throw error("WriteFailed", "模拟设置保存失败");
                }
                const value = args.appearance as Appearance;
                if (
                  !["system", "light", "dark"].includes(value.mode) ||
                  !/^#[\da-f]{6}$/i.test(value.accentColor)
                )
                  throw error("InvalidAppearance", "个性化设置无效");
                appearance = {
                  ...value,
                  accentColor: value.accentColor.toLowerCase(),
                };
                localStorage.setItem(
                  "askills-test-appearance",
                  JSON.stringify(appearance),
                );
                return { ...appearance };
              }
              case "remember_repository": {
                const value = String(args.repository)
                  .trim()
                  .replace(/^https:\/\/github\.com\//i, "")
                  .replace(/\/+$/, "")
                  .replace(/\.git$/, "");
                if (!/^[a-z0-9-]{1,39}\/[a-z0-9_.-]{1,100}$/i.test(value))
                  throw error(
                    "github_repository",
                    "请输入有效的 GitHub 仓库地址",
                  );
                const address = `https://github.com/${value.toLowerCase()}`;
                repositoryHistory = [
                  address,
                  ...repositoryHistory.filter((item) => item !== address),
                ].slice(0, 10);
                localStorage.setItem(
                  "askills-test-repository-history",
                  JSON.stringify(repositoryHistory),
                );
                return [...repositoryHistory];
              }
              case "get_document": {
                const item = revisions.find(
                  (item) => item.id === args.revisionId,
                );
                if (!item) throw error("RevisionNotFound", "版本不存在");
                const skill = skills.find((skill) => skill.id === item.skillId);
                if (!skill) throw error("SkillNotFound", "技能不存在");
                const document: SkillDocument = {
                  skill,
                  revision: item,
                  markdown: documents[skill.id],
                  warnings: [],
                };
                return structuredClone(document);
              }
              case "get_revisions":
                return structuredClone(
                  revisions
                    .filter((item) => item.skillId === args.skillId)
                    .reverse(),
                );
              case "scan_project":
                return [];
              case "set_skill_display_name": {
                const skill = skills.find((s) => s.id === args.skillId);
                if (!skill) throw error("SkillNotFound", "技能不存在");
                skill.displayName = String(args.displayName).trim() || null;
                return structuredClone(skill);
              }
              case "set_project_display_name": {
                const project = projects.find((p) => p.id === args.projectId);
                if (!project) throw error("ProjectNotFound", "项目不存在");
                project.displayName = String(args.displayName).trim() || null;
                return structuredClone(project);
              }
              case "remove_library_skills":
              case "remove_projects": {
                if (options.removalFailure && !removalFailed) {
                  removalFailed = true;
                  throw error("WriteFailed", "模拟删除保存失败");
                }
                const ids = (
                  command === "remove_library_skills"
                    ? args.skillIds
                    : args.projectIds
                ) as string[];
                const target =
                  command === "remove_library_skills"
                    ? removedSkills
                    : removedProjects;
                for (const id of ids) target.add(id);
                return null;
              }
              case "pick_directory": {
                if (
                  args.purpose === "library" &&
                  options.librarySelectionCancelled
                )
                  return null;
                const id = `selection-${++selectionNumber}`;
                selected.set(id, String(args.purpose));
                return { id, path: `D:/Example/${args.purpose}` };
              }
              case "preview_library_migration": {
                if (selected.get(String(args.selectionId)) !== "library")
                  throw error("SelectionExpired", "目录选择已失效");
                if (options.migrationPreviewFailure)
                  throw error(
                    "DirectoryNotEmpty",
                    "目标目录包含已有文件，请选择空目录",
                  );
                return {
                  sourcePath: libraryRoot,
                  targetPath: options.librarySamePath
                    ? libraryRoot
                    : "D:/Example/library",
                  skillCount: skills.length,
                  revisionCount: options.emptyLibrary ? 0 : revisions.length,
                  deploymentCount: deployments.length,
                  totalBytes: options.emptyLibrary ? 0 : 8192,
                };
              }
              case "set_library_root": {
                if (selected.get(String(args.selectionId)) !== "library")
                  throw error("SelectionExpired", "目录选择已失效");
                migrationCancelled = false;
                await new Promise((resolve) =>
                  setTimeout(resolve, options.migrationDelayMs || 0),
                );
                if (migrationCancelled && !options.migrationReadyBeforeCancel)
                  throw error("Cancelled", "迁移已取消");
                if (options.migrationFailure && !failedMigration) {
                  failedMigration = true;
                  throw error("PermissionDenied", "模拟迁移失败，请重试");
                }
                const previousRoot =
                  options.migrationRecoveredBeforeRetry && failedMigration
                    ? "D:/Example/library"
                    : libraryRoot;
                libraryRoot = "D:/Example/library";
                selected.delete(String(args.selectionId));
                return { libraryRoot, previousRoot };
              }
              case "prepare_import": {
                if (selected.get(String(args.selectionId)) !== "import")
                  throw error("SelectionExpired", "目录选择已失效");
                selected.delete(String(args.selectionId));
                return structuredClone(prepare(null));
              }
              case "discard_import":
                previews.delete(String(args.importId));
                return null;
              case "finish_import": {
                const preview = previews.get(String(args.importId));
                if (!preview) throw error("PreviewExpired", "导入预览已失效");
                if (failedImports++ < (options.importFailures || 0))
                  throw error("PermissionDenied", "模拟写入失败，请重试");
                state.committedImports++;
                state.committedSkillPaths.push(
                  preview.source?.subpath || "local",
                );
                const base = sourceSkill(preview.source);
                const current = skills.find((skill) => skill.id === base.id);
                const nextNumber = current ? current.revisionCount + 1 : 1;
                const next: Skill = {
                  ...base,
                  source: preview.source || base.source,
                  displayName: current?.displayName || null,
                  revisionCount: nextNumber,
                  latestRevisionId: `revision-${base.id.slice(6)}-${nextNumber}`,
                };
                const index = skills.findIndex((skill) => skill.id === base.id);
                if (index >= 0) skills[index] = next;
                else skills.push(next);
                if (
                  !revisions.some((item) => item.id === next.latestRevisionId)
                )
                  revisions.push({
                    ...revisions[0],
                    id: next.latestRevisionId,
                    skillId: next.id,
                    source: next.source,
                    hash: "d".repeat(64),
                  });
                documents[next.id] = preview.preview.markdown;
                previews.delete(preview.id);
                return structuredClone(next);
              }
              case "preview_deployment": {
                const revision = revisions.find(
                  (r) => r.id === args.revisionId,
                );
                const skill = skills.find((s) => s.id === revision?.skillId);
                const project = projects.find((p) => p.id === args.projectId);
                if (!skill || !project)
                  throw error("InvalidPlan", "未知项目或技能版本");
                const plan: DeploymentPlan = {
                  id: `plan-${++planNumber}`,
                  projectId: String(args.projectId),
                  revisionId: String(args.revisionId),
                  skillId: skill.id,
                  name: skill.name,
                  agent: String(args.agent),
                  mode: String(args.mode),
                  targetPath: `${project.path}/.agents/skills/${skill.name}`,
                  previousRevisionId: null,
                  conflict: options.deploymentConflict
                    ? "目标已有非 Askills 管理的目录，不能覆盖。"
                    : null,
                  warnings: [],
                };
                plans.set(plan.id, plan);
                return structuredClone(plan);
              }
              case "apply_deployment": {
                const plan = plans.get(String(args.planId));
                if (!plan || plan.conflict)
                  throw error("UnexpectedMutation", "未确认或冲突计划");
                if (
                  plan.skillId === options.deploymentFailureSkill &&
                  !deploymentFailed
                ) {
                  deploymentFailed = true;
                  throw error("WriteFailed", "模拟安装失败");
                }
                plans.delete(plan.id);
                const item: Deployment = {
                  ...plan,
                  id: `deployment-${plan.id}`,
                  status: "installed",
                };
                deployments.push(item);
                return structuredClone(item);
              }
              case "discover_projects":
                selected.delete(String(args.selectionId));
                for (const item of discoveries)
                  selected.set(item.selectionId, "project");
                return structuredClone(discoveries);
              case "discard_selections": {
                if (options.discardSelectionFailure)
                  throw error(
                    "MigrationRecoveryRequired",
                    "迁移目标需要恢复，暂时无法释放目录授权",
                  );
                for (const id of (args.selectionIds as string[]) || [])
                  selected.delete(id);
                return null;
              }
              case "register_project": {
                const id = String(args.selectionId);
                if (selected.get(id) !== "project")
                  throw error(
                    "SelectionExpired",
                    "成功项的目录选择已经消耗，不能重复登记",
                  );
                if (
                  id === "discover-beta" &&
                  options.registrationFailure &&
                  !failedRegistration
                ) {
                  failedRegistration = true;
                  throw error("PermissionDenied", "Beta 模拟登记失败，请重试");
                }
                const found = discoveries.find(
                  (item) => item.selectionId === id,
                );
                if (!found)
                  throw error("UnexpectedSelection", "未预期的项目目录");
                selected.delete(id);
                const project = { id, name: found.name, path: found.path };
                projects.push(project);
                return project;
              }
              case "get_git_version":
                if (options.gitUnavailable)
                  throw error(
                    "GitNotInstalled",
                    "未找到本机 Git，请安装 Git 并重新启动 Askills，或切换 GitHub API",
                  );
                return "git version 2.55.0.windows.3";
              case "resolve_git":
                if (options.gitUnavailable)
                  throw error(
                    "GitNotInstalled",
                    "未找到本机 Git，请安装 Git 并重新启动 Askills，或切换 GitHub API",
                  );
              // Both transports expose the same catalog shape; the opaque id
              // preserves which backend prepared it.
              case "resolve_github":
                if (options.resolveFailure)
                  throw error("NetworkUnavailable", "模拟来源网络不可用");
                return {
                  id: command === "resolve_git" ? "catalog-git" : "catalog-one",
                  repository: String(args.repository),
                  reference: String(args.reference),
                  commit: "e".repeat(40),
                  candidates: sourceCandidates,
                };
              case "prepare_github": {
                const skillPath = String(args.skillPath);
                if (
                  !["catalog-one", "catalog-git"].includes(
                    String(args.catalogId),
                  ) ||
                  !sourceCandidates.some(
                    (candidate) => candidate.path === skillPath,
                  )
                )
                  throw error("InvalidCandidate", "未知技能候选");
                if (typeof args.requestId !== "string" || !args.requestId)
                  throw error("InvalidRequestId", "下载必须关联独立进度请求");
                const requestId = args.requestId;
                const attempt = (downloadAttempts.get(skillPath) || 0) + 1;
                downloadAttempts.set(skillPath, attempt);
                downloadCancelled = false;
                const fileNames = [
                  "SKILL.md",
                  "references/guide.md",
                  "scripts/example.sh",
                  ".askills-source-licenses/LICENSE",
                ];
                progress.set(requestId, {
                  completedFiles: 0,
                  totalFiles: 4,
                  completedBytes: 0,
                  totalBytes: 4096,
                  currentFile: fileNames[0],
                  stage: "download",
                });
                for (let index = 0; index < fileNames.length; index++) {
                  await new Promise((resolve) =>
                    setTimeout(resolve, (options.downloadDelayMs || 0) / 4),
                  );
                  if (downloadCancelled) throw error("cancelled", "下载已取消");
                  if (
                    index === 1 &&
                    attempt <= (options.downloadFailures?.[skillPath] || 0)
                  )
                    throw error(
                      "DownloadFailed",
                      `${skillPath} 模拟下载失败，请重试`,
                    );
                  progress.set(requestId, {
                    completedFiles: index + 1,
                    totalFiles: 4,
                    completedBytes: (index + 1) * 1024,
                    totalBytes: 4096,
                    currentFile: fileNames[index],
                    stage: "download",
                  });
                }
                return structuredClone(
                  prepare({
                    ...security.source,
                    commit: "e".repeat(40),
                    subpath: skillPath,
                  }),
                );
              }
              case "get_download_progress":
                return structuredClone(
                  progress.get(String(args.requestId)) || null,
                );
              case "cancel_operation":
                downloadCancelled = true;
                migrationCancelled = true;
                await new Promise((resolve) =>
                  setTimeout(resolve, options.cancellationReplyDelayMs || 0),
                );
                state.completedCancellations++;
                return null;
              default:
                throw error("UnexpectedCommand", `测试未定义 IPC：${command}`);
            }
          } finally {
            if (!bypassBusy) operationInFlight = false;
          }
        },
      };
    },
    {
      options,
      rust,
      security,
      revisions: [revision(rust, "a"), revision(security, "b")],
    },
  );
}

export async function invocations(page: Page, command: string) {
  return page.evaluate(
    (command) =>
      window.__ASKILLS_TEST__.invocations.filter(
        (item) => item.command === command,
      ),
    command,
  );
}
