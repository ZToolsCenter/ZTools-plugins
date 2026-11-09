import type { MirrorImageRetrySummary } from "../preload/mirror-image-retry-types";

export type ImageRetryStatusBridge = Readonly<{
  getImageRetryStatus?: () => Promise<MirrorImageRetrySummary>;
  requestImageRetry?: () => void;
}>;

export type ImageRetryStatusState = {
  summary: MirrorImageRetrySummary | null;
  loading: boolean;
  readUnsupported: boolean;
  readError: boolean;
  retryUnsupported: boolean;
  retrying: boolean;
  cooldown: boolean;
  notice: "requested" | "request-error" | null;
};

export type ImageRetryStatusEvents = Pick<
  EventTarget,
  "addEventListener" | "removeEventListener"
>;

export type ImageRetryVisibilityEvents = ImageRetryStatusEvents & Readonly<{
  visibilityState: string;
}>;

export type ImageRetryStatusControllerDependencies = Readonly<{
  getBridge: () => ImageRetryStatusBridge | undefined;
  windowEvents: ImageRetryStatusEvents;
  documentEvents: ImageRetryVisibilityEvents;
}>;

export type ImageRetryStatusPresentation = Readonly<{
  message: string;
  counts: readonly string[];
  detail: string | null;
  notice: string | null;
  busy: boolean;
  canRetry: boolean;
  retryDisabled: boolean;
  retryDisabledReason: string | null;
}>;

const REFRESH_DEBOUNCE_MS = 80;
const RETRY_COOLDOWN_MS = 650;

export function createImageRetryStatusState(): ImageRetryStatusState {
  return {
    summary: null,
    loading: true,
    readUnsupported: false,
    readError: false,
    retryUnsupported: false,
    retrying: false,
    cooldown: false,
    notice: null,
  };
}

export function isMirrorImageRetrySummary(
  value: unknown,
): value is MirrorImageRetrySummary {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const summary = value as Record<string, unknown>;
  const allowedKeys = new Set(["pending", "failed", "total", "capacity"]);
  const keys = Object.keys(summary);
  if (keys.length !== allowedKeys.size || keys.some((key) => !allowedKeys.has(key))) {
    return false;
  }

  const pending = summary.pending;
  const failed = summary.failed;
  const total = summary.total;
  const capacity = summary.capacity;
  const validCount = (count: unknown): count is number =>
    typeof count === "number" && Number.isSafeInteger(count) && count >= 0;

  if (
    !validCount(pending) || !validCount(failed) || !validCount(total) ||
    !validCount(capacity) || capacity === 0 || total > capacity
  ) {
    return false;
  }

  const combined = pending + failed;
  return Number.isSafeInteger(combined) && total === combined;
}

export function imageRetryStatusPresentation(
  state: ImageRetryStatusState,
): ImageRetryStatusPresentation {
  const notice = state.notice === "requested"
    ? "已请求重试"
    : state.notice === "request-error"
      ? "无法请求重试，请稍后再试。"
      : null;
  const base = {
    counts: [],
    notice,
    busy: state.loading,
    canRetry: false,
    retryDisabled: false,
    retryDisabledReason: null,
  } satisfies Omit<ImageRetryStatusPresentation, "message" | "detail">;

  if (state.readUnsupported) {
    return {
      ...base,
      message: "当前版本暂不支持查看图片保存状态。",
      detail: null,
      busy: false,
    };
  }
  if (state.readError) {
    return {
      ...base,
      message: "暂时无法读取图片保存状态，请稍后重试。",
      detail: null,
      busy: false,
    };
  }

  const summary = state.summary;
  if (state.loading) {
    const canRetry = summary !== null &&
      summary.pending + summary.failed > 0 && !state.retryUnsupported;
    return {
      ...base,
      message: summary === null
        ? "正在读取图片保存状态…"
        : "正在刷新图片保存状态…",
      detail: canRetry ? null : state.retryUnsupported
        ? "当前版本暂不支持重试图片保存。"
        : null,
      canRetry,
      retryDisabled: canRetry,
      retryDisabledReason: canRetry ? "正在读取最新状态，请稍候。" : null,
    };
  }

  if (summary === null) {
    return {
      ...base,
      message: "正在读取图片保存状态…",
      detail: null,
    };
  }

  const hasRetryItems = summary.pending + summary.failed > 0;
  if (!hasRetryItems) {
    return {
      ...base,
      message: "当前没有待重试图片",
      detail: state.retryUnsupported ? "当前版本暂不支持重试图片保存。" : null,
    };
  }

  const canRetry = !state.retryUnsupported;
  return {
    ...base,
    message: "部分图片尚未保存，原图片仍可访问时可重试；重试不会恢复已失效的源图片",
    counts: [`待重试 ${summary.pending} 张`, `保存失败 ${summary.failed} 张`],
    detail: canRetry
      ? "重试会按已保存的隐私规则处理。"
      : "当前版本暂不支持重试图片保存。",
    canRetry,
    retryDisabled: state.retrying || state.cooldown,
    retryDisabledReason: state.retrying
      ? "正在读取最新状态，请稍候。"
      : state.cooldown
        ? "请稍候再试。"
        : null,
  };
}

export function createImageRetryStatusController(
  state: ImageRetryStatusState,
  dependencies: ImageRetryStatusControllerDependencies,
): Readonly<{
  start: () => Promise<void>;
  refresh: () => Promise<void>;
  retry: () => Promise<void>;
  dispose: () => void;
}> {
  let started = false;
  let disposed = false;
  let refreshRevision = 0;
  let startupRefresh: Promise<void> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let cooldownTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleRefresh = (): void => {
    if (disposed) return;
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      void refresh();
    }, REFRESH_DEBOUNCE_MS);
  };
  const onVisibilityChange = (): void => {
    if (dependencies.documentEvents.visibilityState === "visible") {
      scheduleRefresh();
    }
  };

  async function refresh(): Promise<void> {
    if (disposed) return;

    const bridge = dependencies.getBridge();
    if (typeof bridge?.getImageRetryStatus !== "function") {
      refreshRevision += 1;
      state.summary = null;
      state.loading = false;
      state.readUnsupported = true;
      state.readError = false;
      state.retryUnsupported = typeof bridge?.requestImageRetry !== "function";
      return;
    }

    const revision = ++refreshRevision;
    state.loading = true;
    state.readUnsupported = false;
    state.readError = false;
    state.retryUnsupported = typeof bridge.requestImageRetry !== "function";

    try {
      const summary: unknown = await bridge.getImageRetryStatus();
      if (disposed || revision !== refreshRevision) return;
      if (!isMirrorImageRetrySummary(summary)) {
        state.summary = null;
        state.readError = true;
        return;
      }
      state.summary = summary;
    } catch {
      if (disposed || revision !== refreshRevision) return;
      state.summary = null;
      state.readError = true;
    } finally {
      if (!disposed && revision === refreshRevision) state.loading = false;
    }
  }

  async function retry(): Promise<void> {
    if (disposed || state.retrying || state.cooldown) return;

    const bridge = dependencies.getBridge();
    if (typeof bridge?.requestImageRetry !== "function") {
      state.retryUnsupported = true;
      return;
    }

    state.retrying = true;
    state.notice = null;
    let requested = false;
    try {
      bridge.requestImageRetry();
      state.notice = "requested";
      requested = true;
    } catch {
      state.notice = "request-error";
    }

    try {
      if (requested) await refresh();
    } finally {
      if (!disposed) {
        state.retrying = false;
        state.cooldown = true;
        if (cooldownTimer !== undefined) clearTimeout(cooldownTimer);
        cooldownTimer = setTimeout(() => {
          cooldownTimer = undefined;
          if (!disposed) state.cooldown = false;
        }, RETRY_COOLDOWN_MS);
      }
    }
  }

  function start(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (started) return startupRefresh ?? Promise.resolve();
    started = true;
    dependencies.windowEvents.addEventListener("pasteboard-pro:history-changed", scheduleRefresh);
    dependencies.windowEvents.addEventListener("pasteboard-pro:history-mirrored", scheduleRefresh);
    dependencies.windowEvents.addEventListener("focus", scheduleRefresh);
    dependencies.documentEvents.addEventListener("visibilitychange", onVisibilityChange);
    startupRefresh = refresh();
    return startupRefresh;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    refreshRevision += 1;
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    if (cooldownTimer !== undefined) clearTimeout(cooldownTimer);
    dependencies.windowEvents.removeEventListener("pasteboard-pro:history-changed", scheduleRefresh);
    dependencies.windowEvents.removeEventListener("pasteboard-pro:history-mirrored", scheduleRefresh);
    dependencies.windowEvents.removeEventListener("focus", scheduleRefresh);
    dependencies.documentEvents.removeEventListener("visibilitychange", onVisibilityChange);
  }

  return { start, refresh, retry, dispose };
}
