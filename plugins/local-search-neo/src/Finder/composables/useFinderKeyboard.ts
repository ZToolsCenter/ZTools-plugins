import { nextTick, onMounted, onUnmounted } from "vue";

interface UseFinderKeyboardOptions {
  isNavigationBlocked: () => boolean;
  closeTransientOverlays: () => void;
  focusSubInput: () => void;
  moveSelection: (direction: -1 | 1) => void;
  openSelection: () => void;
  showSelectionInFolder: () => void;
  scrollSelectedIntoView: () => void;
}

export function useFinderKeyboard({
  isNavigationBlocked,
  closeTransientOverlays,
  focusSubInput,
  moveSelection,
  openSelection,
  showSelectionInFolder,
  scrollSelectedIntoView,
}: UseFinderKeyboardOptions) {
  function handleKeydown(event: KeyboardEvent) {
    if (isNativeEditingTarget(event.target)) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (isNavigationBlocked()) return;
      event.preventDefault();
      moveSelection(event.key === "ArrowDown" ? 1 : -1);
      nextTick(() => scrollSelectedIntoView());
      return;
    }

    if (event.key === "Enter") {
      if (isNavigationBlocked()) return;
      handleEnterKey(event);
      return;
    }

    if (shouldFocusSubInput(event)) {
      closeTransientOverlays();
      focusSubInput();
    }
  }

  function handleEnterKey(event: KeyboardEvent) {
    if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      showSelectionInFolder();
      return;
    }

    if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      openSelection();
    }
  }

  onMounted(() => window.addEventListener("keydown", handleKeydown));
  onUnmounted(() => window.removeEventListener("keydown", handleKeydown));
}

function shouldFocusSubInput(event: KeyboardEvent) {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") return true;
  if (event.key === "Backspace" || event.key === "Delete") return true;
  return event.key.length === 1;
}

function isNativeEditingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
