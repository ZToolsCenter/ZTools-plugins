import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { play } from "@/lib/audio/sfx";
import { writePersistent } from "@/lib/pluginHost";

/**
 * 切换中英文界面并将选择保存到 ZTools 插件存储。
 * @returns 语言切换按钮。
 */
export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const isZh = (i18n.resolvedLanguage ?? i18n.language ?? "zh").startsWith("zh");

  const toggle = () => {
    const next = isZh ? "en" : "zh";
    void i18n.changeLanguage(next);
    writePersistent("language", next);
    play("ui_click");
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={toggle}
      className="gap-1.5 px-2.5"
      aria-label={t("lang.switch")}
      title={t("lang.switch")}
    >
      <Languages className="h-4 w-4" />
      <span className="text-xs font-semibold">{isZh ? "EN" : "中"}</span>
    </Button>
  );
}
