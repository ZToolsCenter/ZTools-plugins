import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { DEFAULT_APPEARANCE, fontStack } from "../../app/appearance";
import { useI18n } from "../../app/i18n";
import { errorMessage, useCall } from "../../lib/ipc/client";
import type { Appearance } from "../../lib/ipc/types";

export function FontSettings({
  value,
  busy,
  save,
}: {
  value: Appearance;
  busy: boolean;
  save: (appearance: Appearance) => void;
}) {
  const call = useCall();
  const { t, locale } = useI18n();
  const [fonts, setFonts] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    call<string[]>("list_system_fonts")
      .then(
        (names) => {
          if (active) setFonts(names);
        },
        (reason: unknown) => {
          if (active) setError(reason);
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [call, refresh]);

  const family = value.fontFamily || DEFAULT_APPEARANCE.fontFamily;
  const matches = (fonts ?? []).filter((name) =>
    name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const choices = Array.from(
    new Set([DEFAULT_APPEARANCE.fontFamily, family, ...matches]),
  );
  const unavailable =
    fonts !== null &&
    !error &&
    !loading &&
    family !== DEFAULT_APPEARANCE.fontFamily &&
    !fonts.includes(family);
  return (
    <div className="font-settings">
      <div className="font-settings-heading">
        <label htmlFor="interface-font">{t("界面字体")}</label>
        <button
          type="button"
          disabled={busy || loading}
          onClick={() => setRefresh((n) => n + 1)}
        >
          <RefreshCw size={15} />
          {t("刷新字体列表")}
        </button>
      </div>
      <input
        type="search"
        aria-label={t("搜索本机字体")}
        placeholder={t("搜索本机字体")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <select
        id="interface-font"
        value={family}
        disabled={busy || loading}
        onChange={(event) => save({ ...value, fontFamily: event.target.value })}
      >
        {choices.map((name) => (
          <option key={name} value={name}>
            {name === DEFAULT_APPEARANCE.fontFamily
              ? t("微软雅黑（默认）")
              : name}
          </option>
        ))}
      </select>
      <div aria-live="polite">
        {loading && <p className="footnote">{t("正在读取本机字体…")}</p>}
        {!!error && (
          <p className="candidate-error" role="alert">
            {errorMessage(error, locale)}
          </p>
        )}
        {!loading && !error && query.trim() && matches.length === 0 && (
          <p className="footnote">
            {t("没有匹配的字体，已保留当前字体和默认选项。")}
          </p>
        )}
        {unavailable && (
          <p className="footnote">
            {t("当前字体未安装，已自动使用默认字体显示。")}
          </p>
        )}
      </div>
      <p
        className="font-preview"
        style={{ fontFamily: fontStack(family) }}
        aria-label={t("字体预览")}
      >
        {t("字体预览")} · 让你的 Agent 懂得更多
        <br />
        Askills · ABC abc 0123456789
      </p>
      <p className="footnote">
        {t("使用本机已安装的字体，选择后自动保存。安装新字体后可刷新列表。")}
      </p>
    </div>
  );
}
