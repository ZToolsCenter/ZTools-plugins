import { useContext, useState } from "react";
import { FolderOpen } from "lucide-react";
import { useI18n } from "../../app/i18n";
import { OperationContext } from "../../app/OperationContext";
import { Modal } from "../../components/Modal";
import { useCall, errorMessage, sizeLabel } from "../../lib/ipc/client";
import type {
  DirectorySelection,
  LibraryMigrationPlan,
  LibraryMigrationResult,
  RunOperation,
} from "../../lib/ipc/types";

type PendingMigration = { selectionId: string; plan: LibraryMigrationPlan };

export function LibrarySettings({
  libraryRoot,
  busy,
  run,
  choose,
  migrated,
}: {
  libraryRoot: string;
  busy: boolean;
  run: RunOperation;
  choose: () => Promise<DirectorySelection | null>;
  migrated: (result: LibraryMigrationResult) => Promise<unknown>;
}) {
  const { t, locale } = useI18n();
  const call = useCall();
  const { notify } = useContext(OperationContext);
  const [pending, setPending] = useState<PendingMigration | null>(null);

  async function preview() {
    const result = await run(t("检查 skills 库迁移目标"), async () => {
      const selection = await choose();
      if (!selection) return null;
      try {
        const plan = await call<LibraryMigrationPlan>(
          "preview_library_migration",
          { selectionId: selection.id },
        );
        if (plan.sourcePath === plan.targetPath) {
          await call("discard_selections", { selectionIds: [selection.id] });
          notify(t("选择的目录已是当前 skills 库位置。"));
          return null;
        }
        return { selectionId: selection.id, plan };
      } catch (error) {
        // Invalid previews have no dialog to own the directory grant.
        try {
          await call("discard_selections", { selectionIds: [selection.id] });
        } catch {
          // Preserve the validation error for the user.
        }
        throw error;
      }
    });
    if (result) setPending(result);
  }

  async function close() {
    if (!pending) return;
    try {
      await run(t("取消迁移预览"), async () => {
        await call("discard_selections", {
          selectionIds: [pending.selectionId],
        });
      });
    } finally {
      // Recovery can block all native commands, including grant cleanup. Do not
      // trap the user in a modal; an unreleased grant will expire in the backend.
      setPending(null);
    }
  }

  async function apply() {
    if (!pending) return;
    const result = await run(t("迁移并校验 skills 库"), async () => {
      const value = await call<LibraryMigrationResult>("set_library_root", {
        selectionId: pending.selectionId,
      });
      // Recovery may finish the switch before a retried command runs, making its
      // previousRoot equal the active root. Keep the original preview's source;
      // never describe the active library as a backup the user can delete.
      const message =
        pending.plan.sourcePath !== value.libraryRoot
          ? t(
              "skills 库位置已更新。原目录保留在 {path}；确认使用正常后，可自行删除备份。",
              { path: pending.plan.sourcePath },
            )
          : t("技能库位置已更新。");
      setPending(null);
      try {
        await migrated(value);
      } catch (error) {
        throw new Error(
          t("{message} 数据刷新失败：{error}。请点击右上角“刷新”重新加载。", {
            message,
            error: errorMessage(error, locale),
          }),
        );
      }
      return message;
    });
    if (result) notify(result);
  }

  return (
    <>
      <section className="settings-section" aria-label={t("本地技能库")}>
        <h2>{t("本地技能库")}</h2>
        <p className="path">{libraryRoot || t("尚未连接桌面后端")}</p>
        <button disabled={busy} onClick={() => void preview()}>
          <FolderOpen size={16} />
          {t("选择技能库位置")}
        </button>
        <p className="footnote">
          {t(
            "选择新目录后预览迁移。已有 skills 和版本会一起迁移，并更新受管理的项目链接。",
          )}
        </p>
      </section>
      {pending && (
        <Modal
          title={t("更改 skills 库位置")}
          busy={busy}
          close={() => void close()}
        >
          <div className="modal-body">
            <div className="migration-paths">
              <div>
                <h3>{t("当前位置")}</h3>
                <p className="path">{pending.plan.sourcePath}</p>
              </div>
              <div>
                <h3>{t("新位置")}</h3>
                <p className="path">{pending.plan.targetPath}</p>
              </div>
            </div>
            <div className="detail-metrics">
              <span>
                {t("{count} 个技能", { count: pending.plan.skillCount })}
              </span>
              <span>
                {t("{count} 个版本", { count: pending.plan.revisionCount })}
              </span>
              <span>
                {t("{count} 个项目安装", {
                  count: pending.plan.deploymentCount,
                })}
              </span>
              <span>{sizeLabel(pending.plan.totalBytes)}</span>
            </div>
            <p>
              {t(
                "迁移会复制并校验全部库内容，然后切换到新目录。目标必须为空目录或空的 Askills 库，不能合并已有库。",
              )}
            </p>
            <p>
              {t(
                "原目录会保留作备份。迁移成功并确认使用正常后，可自行删除原目录。",
              )}
            </p>
            <p className="footnote">
              {t("复制期间可以取消；进入切换阶段后会先安全完成操作。")}
            </p>
          </div>
          <footer className="modal-footer">
            <button disabled={busy} onClick={() => void close()}>
              {t("取消")}
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void apply()}
            >
              {t("确认迁移")}
            </button>
          </footer>
        </Modal>
      )}
    </>
  );
}
