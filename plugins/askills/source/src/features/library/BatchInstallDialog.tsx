import { useContext, useState } from "react";
import { useI18n } from "../../app/i18n";
import { OperationContext } from "../../app/OperationContext";
import { Modal } from "../../components/Modal";
import { useCall, errorMessage } from "../../lib/ipc/client";
import type {
  DeploymentPlan,
  Project,
  RunOperation,
  Skill,
} from "../../lib/ipc/types";

type Row = {
  skill: Skill;
  plan?: DeploymentPlan;
  error?: string;
  done?: boolean;
};
export function BatchInstallDialog({
  skills,
  projects,
  busy,
  run,
  refresh,
  close,
}: {
  skills: Skill[];
  projects: Project[];
  busy: boolean;
  run: RunOperation;
  refresh: () => Promise<unknown>;
  close: () => void;
}) {
  const { t, locale } = useI18n();
  const call = useCall();
  const operation = useContext(OperationContext);
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const [agent, setAgent] = useState("codex");
  const [mode, setMode] = useState("auto");
  const [rows, setRows] = useState<Row[]>(() =>
    skills.map((skill) => ({ skill })),
  );
  const [stage, setStage] = useState<"configure" | "preview" | "result">(
    "configure",
  );
  const done = rows.filter((row) => row.done).length;
  const ready = rows.filter((row) => row.plan && !row.error && !row.done);
  async function preview() {
    await run(t("检查项目并生成安装计划"), async () => {
      const next: Row[] = rows.map((row) =>
        row.done ? row : { skill: row.skill },
      );
      for (const row of next) {
        if (row.done) continue;
        if (operation.isCancellationRequested()) break;
        try {
          row.plan = await call<DeploymentPlan>("preview_deployment", {
            projectId,
            revisionId: row.skill.latestRevisionId,
            agent,
            mode,
          });
          if (row.plan.conflict) row.error = t(row.plan.conflict);
        } catch (error) {
          row.error = errorMessage(error, locale);
        }
      }
      // Two different sources can share a name. Neither plan may write the same
      // target within this batch, even if both previews saw an empty directory.
      const targets = new Map<string, Row[]>();
      for (const row of next)
        if (row.plan) {
          const key = row.plan.targetPath.toLocaleLowerCase();
          targets.set(key, [...(targets.get(key) || []), row]);
        }
      for (const group of targets.values())
        if (group.length > 1) {
          for (const row of group)
            if (!row.done)
              row.error = t(
                "所选技能的安装路径重复，请分别安装并选择要保留的来源。",
              );
        }
      setRows(next);
      setStage("preview");
    });
  }
  async function apply() {
    await run(t("批量添加技能到项目"), async () => {
      const next = rows.map((row) => ({ ...row }));
      for (const row of next) {
        if (operation.isCancellationRequested()) break;
        if (!row.plan || row.error || row.done) continue;
        try {
          await call("apply_deployment", { planId: row.plan.id });
          row.done = true;
        } catch (error) {
          row.error = errorMessage(error, locale);
        }
        setRows(next.map((item) => ({ ...item })));
      }
      setRows(next);
      setStage("result");
      await refresh();
      const completed = next.filter((row) => row.done).length;
      operation.notify(
        t("已添加 {count} / {total} 个技能。", {
          count: completed,
          total: rows.length,
        }),
      );
      if (completed === rows.length) close();
    });
  }
  return (
    <Modal title={t("添加到项目")} busy={busy} close={close}>
      <div className="modal-body">
        {!projects.length ? (
          <p>{t("请先到“项目”页面添加一个项目文件夹。")}</p>
        ) : (
          <>
            <label className="field">
              {t("目标项目")}
              <select
                disabled={busy || done > 0}
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setStage("configure");
                }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName || p.name} · {p.path}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {t("Agent 目录")}
              <select
                disabled={busy || done > 0}
                value={agent}
                onChange={(e) => {
                  setAgent(e.target.value);
                  setStage("configure");
                }}
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
                disabled={busy || done > 0}
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value);
                  setStage("configure");
                }}
              >
                <option value="auto">{t("自动选择（推荐）")}</option>
                <option value="copy">{t("复制")}</option>
                <option value="symlink">{t("符号链接")}</option>
                <option value="junction">Windows junction</option>
              </select>
            </label>
          </>
        )}
        <ul className="batch-items">
          {rows.map((row) => (
            <li key={row.skill.id}>
              <strong>{row.skill.displayName || row.skill.name}</strong>
              {stage !== "configure" && (
                <>
                  {row.plan && (
                    <>
                      <p className="path">{row.plan.targetPath}</p>
                      <small>
                        {t("部署方式：")}
                        {row.plan.mode}
                      </small>
                    </>
                  )}
                  {row.done ? (
                    <p>{t("已添加")}</p>
                  ) : row.error ? (
                    <p className="notice">{row.error}</p>
                  ) : !row.plan ? (
                    <p>{t("等待预览")}</p>
                  ) : null}
                  {row.plan?.warnings.map((warning) => (
                    <p className="notice" key={warning}>
                      {t(warning)}
                    </p>
                  ))}
                </>
              )}
            </li>
          ))}
        </ul>
        <p className="footnote">
          {t("逐项检查后应用；失败项保留供重试，已成功项不会重复安装。")}
        </p>
      </div>
      <footer className="modal-footer">
        <button disabled={busy} onClick={close}>
          {t("关闭")}
        </button>
        <button
          disabled={busy || !projectId || done === rows.length}
          onClick={() => void preview()}
        >
          {stage === "configure" ? t("预览变更") : t("重新预览未完成项")}
        </button>
        {stage === "preview" && (
          <button
            className="primary"
            disabled={busy || !ready.length}
            onClick={() => void apply()}
          >
            {t("确认添加（{count}）", { count: ready.length })}
          </button>
        )}
      </footer>
    </Modal>
  );
}
