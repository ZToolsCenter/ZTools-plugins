import { useEffect } from "react";
import * as LucideIcons from "lucide-react";
import { FeatureToastCard } from "@/components/ui/feature-toast-card";
import { useSettings } from "@/stores/useSettings";
import { toast } from "@/components/ui/sonner";

const NOTICE_ID = "ai-writing-assistant";
const NOTICE_TOAST_ID = "ai-feature-notice";

function openAISettings() {
  window.dispatchEvent(
    new CustomEvent("goose-note:open-settings", {
      detail: { tab: "ai" },
    }),
  );
}

function createNoticeContent(handleClose: () => void) {
  const settingsRef = { current: false };
  const closeRef = { current: false };
  return (
    <FeatureToastCard
      icon={<LucideIcons.Sparkles className="h-5 w-5" />}
      title="✨ AI 写作助手已上线"
      actions={[
        {
          label: "设置",
          onPointerDown: (e) => { e.preventDefault(); settingsRef.current = true; openAISettings(); handleClose(); },
          onClick: () => { if (settingsRef.current) { settingsRef.current = false; return; } openAISettings(); handleClose(); },
        },
        {
          label: "我知道了",
          onPointerDown: (e) => { e.preventDefault(); closeRef.current = true; handleClose(); },
          onClick: () => { if (closeRef.current) { closeRef.current = false; return; } handleClose(); },
          variant: "ghost",
          className: "text-muted-foreground hover:text-foreground",
        },
      ]}
    >
      <p>· 输入框内按空格 → 唤起 AI</p>
      <p>· 选中文字 → 一键润色改写</p>
      <p>支持 DeepSeek、GLM、MiniMax 等供应商一键接入，前往设置填写 API Key 即可。</p>
    </FeatureToastCard>
  );
}

export function AIFeatureNotice() {
  const dismissed = useSettings(
    (s) => s.dismissedNotices[NOTICE_ID] === true,
  );
  const hydrated = useSettings((s) => s._hasHydrated === true);
  const dismissNotice = useSettings((s) => s.dismissNotice);

  useEffect(() => {
    // 等 hydration 完成后再决定是否弹窗，避免读到默认值
    if (!hydrated || dismissed) return;

    const handleClose = () => {
      dismissNotice(NOTICE_ID);
      toast.dismiss(NOTICE_TOAST_ID);
    };

    toast.custom(() => createNoticeContent(handleClose), {
      id: NOTICE_TOAST_ID,
      duration: Infinity,
      dismissible: false,
    });

    return () => {
      toast.dismiss(NOTICE_TOAST_ID);
    };
  }, [dismissed, hydrated, dismissNotice]);

  return null;
}
