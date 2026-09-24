export const flushEditorContent = (immediate = false) => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("goose-note:flush-editor", { detail: { immediate } })
    );
  }
};
