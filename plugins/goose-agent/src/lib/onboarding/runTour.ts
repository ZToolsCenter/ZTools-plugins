/**
 * Driver.js 三步界面导览封装。
 * 有 Key 进工作台后由 useOnboardingTour 自动播 1 次；无主表面常驻入口；设置可重置。
 * 锚点：`[data-tour="workspace|composer|settings"]`
 */
import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import "@/components/onboarding/tour.css";
import { markTourFinished } from "./tourState";

export const TOUR_SELECTORS = {
  workspace: '[data-tour="workspace"]',
  composer: '[data-tour="composer"]',
  settings: '[data-tour="settings"]',
} as const;

let activeDriver: Driver | null = null;

export function isTourActive(): boolean {
  return Boolean(activeDriver?.isActive());
}

/** 清理 driver 可能残留的 body class / overlay / 高亮类，保证可再次启动 */
function scrubTourDomResidue(): void {
  if (typeof document === "undefined") return;
  document.body.classList.remove(
    "driver-active",
    "driver-fade",
    "driver-simple",
    "driver-no-scroll",
  );
  document.body.style.removeProperty("--driver-animation-duration");
  document
    .querySelectorAll(".driver-overlay, .driver-popover, #driver-dummy-element")
    .forEach((el) => {
      try {
        el.remove();
      } catch {
        // ignore
      }
    });
  document.querySelectorAll(".driver-active-element").forEach((el) => {
    const parent = el.parentElement;
    if (parent && parent !== document.body) {
      parent.classList.remove(
        "driver-active-element-parent",
        "driver-active-element-parent-no-scroll",
      );
    }
    el.classList.remove("driver-active-element", "driver-no-interaction");
    el.removeAttribute("aria-haspopup");
    el.removeAttribute("aria-expanded");
    el.removeAttribute("aria-controls");
  });
}

export function destroyTour(): void {
  if (activeDriver) {
    try {
      activeDriver.destroy();
    } catch {
      // ignore
    }
    activeDriver = null;
  }
  // destroy 异常或半途时仍清掉遮罩 / body class，避免挡住主界面
  scrubTourDomResidue();
}

/**
 * 工作台是否可见且锚点可量测。
 * 设置/变更叠层时 workbench 为 `hidden`，此时不应开播（否则会误 mark 完成态）。
 */
export function isWorkbenchTourReady(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.querySelector(TOUR_SELECTORS.workspace);
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

export interface StartTourOptions {
  /** 关闭/完成是否写持久化（默认 true）；自动播写完成态，避免再自动弹 */
  persistResult?: boolean;
}

/**
 * 启动 3 步导览。若已有实例在播则先销毁。
 * @returns 是否成功启动（锚点缺失时仍尝试，skipMissingElement）
 */
export function startInterfaceTour(options: StartTourOptions = {}): boolean {
  const persistResult = options.persistResult !== false;
  destroyTour();

  let completed = false;
  let settled = false;

  const settle = (didComplete: boolean) => {
    if (settled) return;
    settled = true;
    if (persistResult) {
      markTourFinished({ completed: didComplete });
    }
    activeDriver = null;
  };

  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark");

  const d = driver({
    animate: true,
    allowClose: true,
    overlayOpacity: isDark ? 0.62 : 0.48,
    stagePadding: 8,
    stageRadius: 10,
    smoothScroll: true,
    showProgress: true,
    progressText: "{{current}} / {{total}}",
    nextBtnText: "下一步",
    prevBtnText: "上一步",
    doneBtnText: "完成",
    popoverClass: "ga-driver-popover",
    skipMissingElement: true,
    steps: [
      {
        element: TOUR_SELECTORS.workspace,
        popover: {
          title: "工作区",
          description:
            "在此添加本地文件夹。Agent 可按权限模式在工作区内读写文件；无工作区时仍可对话。",
          side: "right",
          align: "start",
        },
      },
      {
        element: TOUR_SELECTORS.composer,
        popover: {
          title: "输入与权限",
          description:
            "在此输入消息并发送。下方可切换模型，以及只读工作区 / 工作区读写 / 完整权限。",
          side: "top",
          align: "center",
        },
      },
      {
        element: TOUR_SELECTORS.settings,
        popover: {
          title: "设置",
          description:
            "打开设置 → AI，可配置供应商与凭证（密钥或账号登录）。随时可从这里调整。",
          side: "bottom",
          align: "end",
        },
      },
    ],
    onDestroyStarted: (_el, _step, { driver: inst }) => {
      // 用户点完成或走到最后一步关闭
      if (inst.isLastStep()) {
        completed = true;
      }
      inst.destroy();
    },
    onDestroyed: () => {
      settle(completed);
    },
    onCloseClick: (_el, _step, { driver: inst }) => {
      completed = false;
      inst.destroy();
    },
    onDoneClick: (_el, _step, { driver: inst }) => {
      completed = true;
      inst.destroy();
    },
  });

  activeDriver = d;
  d.drive();
  return true;
}
