/**
 * 纯 Web API 的滚动活跃状态 hook，无任何平台依赖，可随编辑器包跨端使用。
 * 从 src/hooks/useGlobalScrollActivity.ts 搬入编辑器包，消除对宿主 hooks 目录的跨包引用。
 */
import { useEffect, useRef, useSyncExternalStore } from "react";

type ScrollActivitySnapshot = {
  isScrolling: boolean;
  scrollTick: number;
};

type ScrollListener = () => void;

const DEFAULT_IDLE_MS = 120;

let snapshot: ScrollActivitySnapshot = {
  isScrolling: false,
  scrollTick: 0,
};

let isListening = false;
let rafId: number | null = null;
let idleTimerId: number | null = null;
let shouldStartScrolling = false;
let subscriberCounter = 0;

const subscribers = new Set<ScrollListener>();
const idleMsBySubscriber = new Map<number, number>();

const emit = (nextSnapshot: ScrollActivitySnapshot) => {
  if (
    snapshot.isScrolling === nextSnapshot.isScrolling &&
    snapshot.scrollTick === nextSnapshot.scrollTick
  ) {
    return;
  }
  snapshot = nextSnapshot;
  subscribers.forEach((listener) => listener());
};

const getCurrentIdleMs = () => {
  if (idleMsBySubscriber.size === 0) return DEFAULT_IDLE_MS;
  let minIdleMs = Number.POSITIVE_INFINITY;
  idleMsBySubscriber.forEach((value) => {
    minIdleMs = Math.min(minIdleMs, value);
  });
  return Number.isFinite(minIdleMs) ? minIdleMs : DEFAULT_IDLE_MS;
};

const clearIdleTimer = () => {
  if (idleTimerId === null) return;
  window.clearTimeout(idleTimerId);
  idleTimerId = null;
};

const scheduleIdleTimeout = () => {
  clearIdleTimer();
  idleTimerId = window.setTimeout(() => {
    idleTimerId = null;
    shouldStartScrolling = false;
    if (!snapshot.isScrolling) return;
    emit({
      isScrolling: false,
      scrollTick: snapshot.scrollTick,
    });
  }, getCurrentIdleMs());
};

const processScrollInFrame = () => {
  rafId = null;
  if (!shouldStartScrolling) return;

  if (!snapshot.isScrolling) {
    emit({
      isScrolling: true,
      scrollTick: snapshot.scrollTick + 1,
    });
  }
};

const onScroll = () => {
  shouldStartScrolling = true;
  if (rafId === null) {
    rafId = window.requestAnimationFrame(processScrollInFrame);
  }
  scheduleIdleTimeout();
};

const ensureListener = () => {
  if (isListening || typeof window === "undefined") return;
  window.addEventListener("scroll", onScroll, {
    capture: true,
    passive: true,
  });
  isListening = true;
};

const cleanupListener = () => {
  if (!isListening || subscribers.size > 0 || typeof window === "undefined") {
    return;
  }

  window.removeEventListener("scroll", onScroll, { capture: true });
  isListening = false;
  shouldStartScrolling = false;

  if (rafId !== null) {
    window.cancelAnimationFrame(rafId);
    rafId = null;
  }

  clearIdleTimer();

  if (snapshot.isScrolling) {
    snapshot = {
      isScrolling: false,
      scrollTick: snapshot.scrollTick,
    };
  }
};

const clampIdleMs = (idleMs: number | undefined) => {
  if (!Number.isFinite(idleMs)) return DEFAULT_IDLE_MS;
  return Math.max(0, Math.floor(idleMs!));
};

const subscribeStore = (listener: ScrollListener) => {
  subscribers.add(listener);
  ensureListener();

  return () => {
    subscribers.delete(listener);
    cleanupListener();
  };
};

const getSnapshot = () => snapshot;

export function useGlobalScrollActivity(options?: { idleMs?: number }) {
  const subscriptionIdRef = useRef<number | null>(null);
  if (subscriptionIdRef.current === null) {
    subscriptionIdRef.current = ++subscriberCounter;
  }

  const idleMs = clampIdleMs(options?.idleMs);

  useEffect(() => {
    const subscriptionId = subscriptionIdRef.current!;
    idleMsBySubscriber.set(subscriptionId, idleMs);

    if (snapshot.isScrolling) {
      scheduleIdleTimeout();
    }

    return () => {
      idleMsBySubscriber.delete(subscriptionId);
      if (snapshot.isScrolling) {
        scheduleIdleTimeout();
      }
    };
  }, [idleMs]);

  return useSyncExternalStore(subscribeStore, getSnapshot, getSnapshot);
}
