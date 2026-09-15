/**
 * 有 API Key 且进入工作台后：streaming 结束 / idle 短延迟自动播界面导览 1 次。
 * 仅 phase=pending 时自动；done/skipped 后不再自动。无主表面常驻入口。
 * 再播：设置「重置界面导览」→ phase=pending + goose-agent:tour-reset
 * （清 fired + bump epoch 重调度；不立刻 startInterfaceTour）。
 */
import { useEffect, useRef, useState } from "react";
import { hasConfiguredApiKey } from "@/lib/onboarding/checklist";
import {
  isTourActive,
  isWorkbenchTourReady,
  startInterfaceTour,
} from "@/lib/onboarding/runTour";
import { shouldAutoStartTour } from "@/lib/onboarding/tourState";
import { useSettings } from "@/stores/settings";

/** idle 后延迟再播，避免与消息落盘 / 布局抖动抢焦点 */
export const AUTO_TOUR_DELAY_MS = 700;

/** 工作台仍 hidden（设置叠层）时的重试间隔 */
const TOUR_READY_RETRY_MS = 400;

export function useOnboardingTour(isStreaming: boolean) {
  const ai = useSettings((s) => s.ai);
  const hasApiKey = hasConfiguredApiKey(ai);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  /** 重置导览时递增，作为自动播 effect 依赖，避免已有 Key 时 effect 不重跑 */
  const [resetEpoch, setResetEpoch] = useState(0);

  // 设置重置：清 fired 闸 + bump epoch 以重调度真实 timer 路径
  useEffect(() => {
    const onReset = () => {
      firedRef.current = false;
      setResetEpoch((n) => n + 1);
    };
    window.addEventListener("goose-agent:tour-reset", onReset);
    return () => window.removeEventListener("goose-agent:tour-reset", onReset);
  }, []);

  useEffect(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    // 有 Key 进工作台即可自动播；不要求工作区 / 首条消息
    if (!hasApiKey) {
      firedRef.current = false;
      return;
    }
    if (isStreaming) return;
    if (firedRef.current) return;
    if (!shouldAutoStartTour()) return;
    if (isTourActive()) return;

    const attempt = (delayMs: number) => {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (firedRef.current) return;
        if (!shouldAutoStartTour() || isTourActive()) return;
        // 再次确认仍有 Key（实时）
        if (!hasConfiguredApiKey(useSettings.getState().ai)) return;
        // 设置/变更叠层时 workbench 为 hidden：不消费 fired，稍后重试
        if (!isWorkbenchTourReady()) {
          attempt(TOUR_READY_RETRY_MS);
          return;
        }
        firedRef.current = true;
        startInterfaceTour({ persistResult: true });
      }, delayMs);
    };

    attempt(AUTO_TOUR_DELAY_MS);

    return () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [hasApiKey, isStreaming, ai, resetEpoch]);
}
