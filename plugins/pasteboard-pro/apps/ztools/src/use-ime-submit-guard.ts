import { onBeforeUnmount } from "vue";

/** Preserve IME's Enter commit while ignoring the browser's implicit form submit. */
export function useImeSubmitGuard() {
  let suppressImplicitSubmit = false;
  let resetTimer: number | undefined;

  function noteKeydown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || (!event.isComposing && event.keyCode !== 229)) return;
    suppressImplicitSubmit = true;
    if (resetTimer !== undefined) window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      suppressImplicitSubmit = false;
      resetTimer = undefined;
    }, 0);
  }

  onBeforeUnmount(() => {
    if (resetTimer !== undefined) window.clearTimeout(resetTimer);
  });

  return { noteKeydown, shouldSuppressSubmit: () => suppressImplicitSubmit };
}
