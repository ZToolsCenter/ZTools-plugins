import { useI18n } from "../../app/i18n";
import { useContext, useEffect, useRef, useState } from "react";
import {
  GitFork as Github,
  ArrowDownToLine,
  Search,
  Eye,
  Check,
} from "lucide-react";
import { useCall, errorMessage, shortHash } from "../../lib/ipc/client";
import { prepareDownload } from "../../lib/ipc/download";
import { OperationContext } from "../../app/OperationContext";
import type {
  Catalog,
  PreparedImport,
  RunOperation,
  Skill,
} from "../../lib/ipc/types";
export function SourcesView({
  busy,
  run,
  prepared,
  downloaded,
  repositoryHistory,
  historyChanged,
  seed,
  embedded = false,
}: {
  busy: boolean;
  run: RunOperation;
  prepared: (value: PreparedImport) => void;
  downloaded: (values: Skill[], continueToProject: boolean) => void;
  repositoryHistory: string[];
  historyChanged: (values: string[]) => void;
  seed: Skill | null;
  embedded?: boolean;
}) {
  const { t, locale } = useI18n();
  const call = useCall();
  const [repository, setRepository] = useState(seed?.source.url || "");
  const repositoryInput = useRef<HTMLInputElement>(null);
  const [reference, setReference] = useState(seed?.source.reference || "");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [method, setMethod] = useState<"api" | "git">("api");
  const [gitVersion, setGitVersion] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<
    Record<
      string,
      {
        state: "downloading" | "done" | "error";
        message?: string;
      }
    >
  >({});
  const operation = useContext(OperationContext);
  useEffect(() => {
    setSelected([]);
    setResults({});
  }, [catalog]);
  useEffect(() => {
    if (seed) {
      setRepository(seed.source.url || "");
      setReference(seed.source.reference || "");
      setCatalog(null);
    }
  }, [seed]);
  async function resolve() {
    setCatalog(null);
    const result = await run(
      method === "git"
        ? t("使用本机 Git 拉取固定版本")
        : t("解析 GitHub 固定版本"),
      async () => {
        const history = await call<string[]>("remember_repository", {
          repository,
        });
        historyChanged(history);
        return call<Catalog>(
          method === "git" ? "resolve_git" : "resolve_github",
          {
            repository,
            reference,
          },
        );
      },
    );
    if (result) setCatalog(result);
  }
  async function preview(path: string) {
    if (!catalog) return;
    const result = await run(t("正在获取技能预览"), () =>
      prepareDownload(call, catalog.id, path, operation.reportProgress),
    );
    if (result) prepared(result);
  }
  async function download(paths: string[]) {
    if (!catalog || !paths.length) return;
    const outcome = await run(
      t("正在下载 {count} 个技能到技能库", { count: paths.length }),
      async () => {
        const saved: Skill[] = [];
        let failures = 0;
        for (const path of paths) {
          if (operation.isCancellationRequested()) break;
          setResults((values) => ({
            ...values,
            [path]: { state: "downloading" },
          }));
          let pending: PreparedImport | undefined;
          try {
            pending = await prepareDownload(
              call,
              catalog.id,
              path,
              operation.reportProgress,
            );
            if (operation.isCancellationRequested())
              throw new Error(t("下载已取消"));
            const skill = await call<Skill>("finish_import", {
              importId: pending.id,
            });
            pending = undefined;
            saved.push(skill);
            setResults((values) => ({ ...values, [path]: { state: "done" } }));
            setSelected((values) => values.filter((value) => value !== path));
          } catch (error) {
            failures++;
            setResults((values) => ({
              ...values,
              [path]: { state: "error", message: errorMessage(error, locale) },
            }));
            if (pending) {
              try {
                await call("discard_import", { importId: pending.id });
              } catch {
                /* bounded backend preview expiry also cleans it */
              }
            }
            if (operation.isCancellationRequested()) break;
          }
        }
        return {
          saved,
          failures,
          cancelled: operation.isCancellationRequested(),
        };
      },
    );
    if (!outcome) return;
    if (outcome.saved.length)
      downloaded(
        outcome.saved,
        paths.length === 1 && outcome.failures === 0 && !outcome.cancelled,
      );
    const summary = t("{status}已保存 {saved} / {total} 个技能{failures}。", {
      status: outcome.cancelled ? t("下载已停止。") : t("下载结束。"),
      saved: outcome.saved.length,
      total: paths.length,
      failures: outcome.failures
        ? t("，{count} 项未完成，可在列表重试", { count: outcome.failures })
        : "",
    });
    if (!outcome.saved.length && outcome.failures && !outcome.cancelled)
      operation.fail(summary);
    else operation.notify(summary);
  }
  function toggle(path: string) {
    setSelected((values) =>
      values.includes(path)
        ? values.filter((v) => v !== path)
        : [...values, path],
    );
  }
  return (
    <>
      {!embedded && (
        <header className="page-head">
          <div>
            <p className="eyebrow">DISCOVER & BRING HOME</p>
            <h1>{t("来源")}</h1>
            <p className="subtitle">
              {t("从 GitHub 获取技能，保存到自己的本地库。")}
            </p>
          </div>
          <span className="pill">
            <Github size={15} />
            {t("GitHub 来源")}
          </span>
        </header>
      )}
      <section className="source-form">
        <div className="source-methods" role="group" aria-label={t("获取方式")}>
          <button
            aria-pressed={method === "api"}
            className={method === "api" ? "primary" : ""}
            disabled={busy}
            onClick={() => {
              setMethod("api");
              setCatalog(null);
            }}
          >
            GitHub API
          </button>
          <button
            aria-pressed={method === "git"}
            className={method === "git" ? "primary" : ""}
            disabled={busy}
            onClick={() => {
              setMethod("git");
              setCatalog(null);
            }}
          >
            {t("本地 Git")}
          </button>
        </div>
        {method === "git" ? (
          <div className="source-method-note">
            <p className="footnote">
              {t(
                "使用已安装的 Git，沿用本机代理和凭据配置。在独立临时仓库拉取固定提交，不合并或改动你的项目；无需 GitHub API 配额。请填写 HTTPS 仓库地址，交互登录提示不会弹出。",
              )}
            </p>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void run(t("检查本机 Git"), async () => {
                  const value = await call<string>("get_git_version");
                  setGitVersion(value);
                })
              }
            >
              {t("检查 Git 安装")}
            </button>
            {gitVersion && <span className="muted">{gitVersion}</span>}
          </div>
        ) : (
          <p className="footnote">
            {t("通过 GitHub API 获取公共仓库，不需要安装 Git。")}
          </p>
        )}
        <div className="source-title">
          <Github size={24} />
          <div>
            <h2>
              {seed
                ? t("检查 {skill} 的来源版本", {
                    skill: seed.name,
                  })
                : t("导入 GitHub 技能")}
            </h2>
            <p className="muted">
              {t("输入仓库地址，选择版本，再预览需要导入的技能。")}
            </p>
          </div>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void resolve();
          }}
        >
          <label className="field">
            {t("仓库地址")}
            <input
              ref={repositoryInput}
              required
              disabled={busy}
              placeholder="https://github.com/owner/repository"
              value={repository}
              onChange={(e) => {
                setRepository(e.target.value);
                setCatalog(null);
              }}
            />
          </label>
          <div className="form-inline">
            <label className="field">
              {t("分支、标签或 commit（可选）")}
              <input
                disabled={busy}
                placeholder={t("留空使用默认分支")}
                value={reference}
                onChange={(e) => {
                  setReference(e.target.value);
                  setCatalog(null);
                }}
              />
            </label>
            <button
              className="primary"
              disabled={busy || !repository.trim()}
              type="submit"
            >
              <Search size={16} />
              {t("查找技能")}
            </button>
          </div>
        </form>
        <p className="footnote">
          {t(
            "下载固定到完整 commit。不会执行仓库脚本，项目不会跟随来源自动升级。",
          )}
        </p>
      </section>
      {catalog && (
        <section className="catalog">
          <div className="detail-heading">
            <h2>
              {t("找到 {count} 个技能", { count: catalog.candidates.length })}
            </h2>
            <span className="badge">{shortHash(catalog.commit)}</span>
          </div>
          <p className="path">
            {catalog.repository} · {catalog.reference}
          </p>
          {!!catalog.candidates.length && (
            <div className="source-selection-bar">
              <span>{t("已选择 {count} 项", { count: selected.length })}</span>
              <button
                disabled={busy}
                onClick={() =>
                  setSelected(
                    catalog.candidates
                      .filter((c) => results[c.path]?.state !== "done")
                      .map((c) => c.path),
                  )
                }
              >
                {t("全选")}
              </button>
              <button
                disabled={busy || !selected.length}
                onClick={() => setSelected([])}
              >
                {t("清空选择")}
              </button>
              <button
                className="primary"
                disabled={busy || !selected.length}
                onClick={() => void download(selected)}
              >
                {t("下载所选（")}
                {selected.length}
                {t("）")}
              </button>
            </div>
          )}
          {!catalog.candidates.length && (
            <p className="subtle-empty">{t("该版本没有找到 SKILL.md。")}</p>
          )}
          {catalog.candidates.map((candidate) => (
            <div
              key={candidate.path}
              className={`candidate-row${selected.includes(candidate.path) ? " candidate-selected" : ""}`}
            >
              <div>
                <strong>{candidate.name}</strong>
                <p className="path">{candidate.path || t("仓库根目录")}</p>
                {results[candidate.path]?.state === "error" && (
                  <p className="candidate-error">
                    {results[candidate.path].message}
                  </p>
                )}
              </div>
              <div className="candidate-actions">
                <button
                  disabled={busy || results[candidate.path]?.state === "done"}
                  onClick={() => void download([candidate.path])}
                >
                  <ArrowDownToLine size={15} />{" "}
                  {results[candidate.path]?.state === "done"
                    ? t("已下载")
                    : results[candidate.path]?.state === "downloading"
                      ? t("下载中…")
                      : t("下载")}
                </button>
                <button
                  disabled={busy}
                  onClick={() => void preview(candidate.path)}
                >
                  <Eye size={15} />
                  {t("预览")}
                </button>
                <button
                  disabled={busy || results[candidate.path]?.state === "done"}
                  aria-pressed={selected.includes(candidate.path)}
                  onClick={() => toggle(candidate.path)}
                >
                  <Check size={15} />
                  {selected.includes(candidate.path)
                    ? t("取消选择")
                    : t("多选")}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
      <section
        className="source-examples repository-history"
        aria-label={t("历史记录（最近10条）")}
      >
        <h3>{t("历史记录（最近10条）")}</h3>
        {repositoryHistory.length ? (
          <div className="example-buttons">
            {repositoryHistory.map((address) => (
              <button
                key={address}
                disabled={busy}
                title={address}
                data-repository={address}
                onClick={() => {
                  setRepository(address);
                  setReference("");
                  setCatalog(null);
                  repositoryInput.current?.focus();
                }}
              >
                <Github size={16} />
                <span>{address.replace(/^https:\/\/github\.com\//i, "")}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="footnote">{t("暂无历史记录")}</p>
        )}
      </section>
      <section
        className="source-examples"
        aria-label={t("可以从这些社区仓库开始")}
      >
        <h3>{t("可以从这些社区仓库开始")}</h3>
        <div className="example-buttons">
          {["wshobson/agents", "fxckcode/tauri-skills"].map((repo) => (
            <button
              disabled={busy}
              key={repo}
              onClick={() => {
                setRepository(`https://github.com/${repo}`);
                setReference("");
                setCatalog(null);
              }}
            >
              <Github size={16} /> {repo}
            </button>
          ))}
        </div>
        <p className="footnote">
          {t("这些是本项目开发 skills 的来源，属于第三方社区内容。")}
        </p>
      </section>
    </>
  );
}
