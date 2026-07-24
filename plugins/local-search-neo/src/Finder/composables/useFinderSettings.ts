import { shallowRef } from "vue";

interface UseFinderSettingsOptions {
  focusSubInput: () => void;
}

interface CloseSettingsDrawerOptions {
  restoreFocus?: boolean;
}

const showSettingsDrawer = shallowRef(false);

export function useFinderSettings({ focusSubInput }: UseFinderSettingsOptions) {
  function openSettingsDrawer() {
    showSettingsDrawer.value = true;
  }

  function closeSettingsDrawer({ restoreFocus = true }: CloseSettingsDrawerOptions = {}) {
    const wasOpen = showSettingsDrawer.value;
    showSettingsDrawer.value = false;

    if (wasOpen && restoreFocus) {
      focusSubInput();
    }
  }

  return {
    showSettingsDrawer,
    openSettingsDrawer,
    closeSettingsDrawer,
  };
}
