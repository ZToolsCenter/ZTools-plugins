import { useI18n } from "../../app/i18n";
import type { Locale } from "../../lib/ipc/types";

export function LanguageSettings({
  busy,
  save,
}: {
  busy: boolean;
  save: (locale: Locale) => void;
}) {
  const { t, locale } = useI18n();
  return (
    <section className="settings-section">
      <h2>{t("语言与阅读")}</h2>
      <label className="field">
        {t("界面语言")}
        <select
          aria-label={t("界面语言")}
          value={locale}
          disabled={busy}
          onChange={(event) => save(event.target.value as Locale)}
        >
          <option value="zh-CN">简体中文</option>
          <option value="en">English</option>
        </select>
      </label>
      <p>{t("可切换中文和英文界面，技能正文按原文展示。")}</p>
      <p className="footnote">{t("界面语言保存在本地，重启后保留。")}</p>
    </section>
  );
}
