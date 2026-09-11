import { useEffect, useState } from "react";
import { PLUGIN_ACTIVITY_EVENT } from "@/lib/pluginHost";

/**
 * 订阅插件前后台状态，供 AI、计时器和音频暂停使用。
 * @returns 插件当前是否处于激活状态。
 */
export function usePluginActivity(): boolean {
  const [active, setActive] = useState(() => window.__gomokuPluginActive !== false);

  useEffect(() => {
    const handleActivity = (event: Event) => {
      setActive((event as CustomEvent<boolean>).detail !== false);
    };
    window.addEventListener(PLUGIN_ACTIVITY_EVENT, handleActivity);
    return () => window.removeEventListener(PLUGIN_ACTIVITY_EVENT, handleActivity);
  }, []);

  return active;
}
