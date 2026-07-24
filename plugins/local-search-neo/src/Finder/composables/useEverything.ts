import { computed, shallowRef } from "vue";

const everythingStatus = shallowRef(window.services.everything.getStartupStatus());

let everythingStatusTimer: number | undefined;
const everythingReady = computed(() => everythingStatus.value.state === "ready");
const everythingPending = computed(() => isEverythingStartupPending(everythingStatus.value.state));

type UseEverythingProps = {
  runSearch: () => void;
};

export function useEverything({ runSearch }: UseEverythingProps) {
  async function ensureEverythingReady() {
    syncEverythingStatus();
    startEverythingStatusPolling();

    try {
      await window.services.everything.ensureReady();
    } catch {
      // 具体错误会通过 getStartupStatus 暴露给界面。
    } finally {
      syncEverythingStatus();
      if (!everythingPending.value) stopEverythingStatusPolling();
    }

    if (everythingReady.value) {
      runSearch();
    }
  }

  return {
    everythingStatus,
    everythingPending,
    everythingReady,
    ensureEverythingReady,
    startEverythingStatusPolling,
    stopEverythingStatusPolling,
  };
}

function syncEverythingStatus() {
  everythingStatus.value = window.services.everything.getStartupStatus();
}

function startEverythingStatusPolling() {
  if (everythingStatusTimer) return;

  everythingStatusTimer = window.setInterval(() => {
    syncEverythingStatus();
    if (!everythingPending.value) stopEverythingStatusPolling();
  }, 300);
}

function stopEverythingStatusPolling() {
  if (!everythingStatusTimer) return;

  window.clearInterval(everythingStatusTimer);
  everythingStatusTimer = undefined;
}

function isEverythingStartupPending(
  state: ReturnType<typeof window.services.everything.getStartupStatus>["state"],
) {
  return state === "idle" || state === "checking" || state === "starting" || state === "waiting";
}
