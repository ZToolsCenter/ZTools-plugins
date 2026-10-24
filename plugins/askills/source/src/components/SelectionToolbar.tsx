import { useState, type ReactNode } from "react";
import { useI18n } from "../app/i18n";

export function useSelection() {
  const [active, setActive] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  return {
    active,
    ids,
    enter: (id: string) => {
      setActive(true);
      setIds((current) => (current.includes(id) ? current : [...current, id]));
    },
    toggle: (id: string) =>
      setIds((current) =>
        current.includes(id)
          ? current.filter((value) => value !== id)
          : [...current, id],
      ),
    select: setIds,
    exit: () => {
      setActive(false);
      setIds([]);
    },
  };
}
export function SelectionToolbar({
  count,
  busy,
  selectAll,
  clear,
  exit,
  children,
}: {
  count: number;
  busy: boolean;
  selectAll: () => void;
  clear: () => void;
  exit: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="selection-toolbar" role="region" aria-label={t("多选操作")}>
      <strong>{t("已选择 {count} 项", { count })}</strong>
      <button disabled={busy} onClick={selectAll}>
        {t("全选")}
      </button>
      <button disabled={busy || !count} onClick={clear}>
        {t("清空选择")}
      </button>
      {children}
      <button disabled={busy} onClick={exit}>
        {t("退出多选")}
      </button>
    </div>
  );
}
