export function useFinderFocus(focusSubInput: () => void) {
  function releaseFinderFocus() {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement.closest(".finder-shell")) {
      activeElement.blur();
    }
    focusSubInput();
  }

  return {
    releaseFinderFocus,
  };
}
