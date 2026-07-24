import { useGlocalConfirmDialog } from "../../components/useGlocalConfirmDialog";
import type { FinderResult } from "../core/finderLogic";

interface UseResultActionsOptions {
  onTrashed: (fullPath: string) => void;
}

export interface ResultActions {
  open(item?: FinderResult): void;
  showInFolder(item: FinderResult): void;
  copyFullPath(item: FinderResult): void;
  copyDirectoryPath(item: FinderResult): void;
  copyFile(item: FinderResult): void;
  trash(item: FinderResult): Promise<void>;
}

const { confirm } = useGlocalConfirmDialog();

export function useResultActions({ onTrashed }: UseResultActionsOptions): ResultActions {
  function open(item?: FinderResult) {
    if (item?.fullPath) window.ztools.shellOpenPath(item.fullPath);
  }

  function showInFolder(item: FinderResult) {
    if (item.fullPath) window.ztools.shellShowItemInFolder(item.fullPath);
  }

  function copyFullPath(item: FinderResult) {
    if (item.fullPath) window.ztools.copyText(item.fullPath);
  }

  function copyDirectoryPath(item: FinderResult) {
    if (item.path) window.ztools.copyText(item.path);
  }

  function copyFile(item: FinderResult) {
    if (item.fullPath) window.ztools.copyFile(item.fullPath);
  }

  async function trash(item: FinderResult) {
    if (!item.fullPath) return;

    const confirmed = await confirm({
      title: "删除文件",
      message: `确定要将“${item.name}”移入回收站吗？`,
      confirmText: "删除",
      danger: true,
    });
    if (!confirmed) return;

    await window.ztools.shellTrashItem(item.fullPath);
    onTrashed(item.fullPath);
  }

  return {
    open,
    showInFolder,
    copyFullPath,
    copyDirectoryPath,
    copyFile,
    trash,
  };
}
