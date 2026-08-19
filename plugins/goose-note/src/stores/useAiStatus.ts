import { create } from "zustand";

export type AiActivityPhase = "idle" | "streaming" | "done";

interface AiStatusState {
  phase: AiActivityPhase;
  doneToken: number;
  beginStreaming: () => void;
  finishStreaming: (options?: { celebrate?: boolean }) => void;
  reset: () => void;
}

const DONE_DURATION_MS = 1200;

let doneTimer: ReturnType<typeof setTimeout> | null = null;

const clearDoneTimer = () => {
  if (doneTimer !== null) {
    clearTimeout(doneTimer);
    doneTimer = null;
  }
};

export const useAiStatus = create<AiStatusState>((set, get) => ({
  phase: "idle",
  doneToken: 0,
  beginStreaming: () => {
    clearDoneTimer();
    set({ phase: "streaming" });
  },
  finishStreaming: ({ celebrate = true } = {}) => {
    clearDoneTimer();
    if (!celebrate) {
      set({ phase: "idle" });
      return;
    }
    set({ phase: "done", doneToken: get().doneToken + 1 });
    doneTimer = setTimeout(() => {
      doneTimer = null;
      if (useAiStatus.getState().phase === "done") {
        set({ phase: "idle" });
      }
    }, DONE_DURATION_MS);
  },
  reset: () => {
    clearDoneTimer();
    set({ phase: "idle" });
  },
}));
