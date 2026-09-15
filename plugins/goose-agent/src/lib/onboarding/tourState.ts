/**
 * 界面导览持久化：仅 tour 态（pending / done / skipped）。
 * 逻辑键 `tour` → 物理 `ga:tour`（经 gaStateStorage）。
 * 有 Key 进工作台且 pending 时自动播 1 次；无主表面常驻入口；设置 reset → pending。
 * 清单完成态不在此存储。
 */
import { gaStateStorage } from "@/stores/settings/gaStorage";

/** zustand / gaStateStorage 逻辑键（无 ga: 前缀） */
export const TOUR_STORAGE_KEY = "tour";

export type TourPhase = "pending" | "done" | "skipped";

export interface TourPersisted {
  phase: TourPhase;
}

const DEFAULT: TourPersisted = { phase: "pending" };

function parseStored(raw: string | null): TourPersisted {
  if (!raw) return { ...DEFAULT };
  try {
    const data = JSON.parse(raw) as unknown;
    if (typeof data === "string") {
      if (data === "pending" || data === "done" || data === "skipped") {
        return { phase: data };
      }
      return { ...DEFAULT };
    }
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const phase = (data as { phase?: unknown }).phase;
      if (phase === "pending" || phase === "done" || phase === "skipped") {
        return { phase };
      }
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT };
}

function readTourRaw(): string | null {
  // 本仓 gaStateStorage 同步；Zustand StateStorage 类型允许 Promise
  const raw = gaStateStorage.getItem(TOUR_STORAGE_KEY) as string | null;
  return raw;
}

export function getTourPhase(): TourPhase {
  return parseStored(readTourRaw()).phase;
}

export function setTourPhase(phase: TourPhase): void {
  const payload: TourPersisted = { phase };
  void gaStateStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(payload));
}

/** 自动导览是否仍应触发（仅 pending） */
export function shouldAutoStartTour(): boolean {
  return getTourPhase() === "pending";
}

/** 关闭/跳过 → skipped；走完 → done。不覆盖为 pending。 */
export function markTourFinished(opts: { completed: boolean }): void {
  setTourPhase(opts.completed ? "done" : "skipped");
}

/**
 * 重置导览为首次可自动触发（phase=pending）。
 * 无主表面常驻入口时，这是开发侧再播唯一入口。
 * 不清除 API Key / 工作区 / 会话。设置「开发」区调用。
 */
export function resetOnboardingTour(): void {
  setTourPhase("pending");
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("goose-agent:tour-reset"));
  }
}
