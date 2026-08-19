import { useEffect, type MutableRefObject } from "react";

type UseEditorShortcutsOptions = {
  shiftPressedRef: MutableRefObject<boolean>;
};

export function useEditorShortcuts({
  shiftPressedRef,
}: UseEditorShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        shiftPressedRef.current = true;
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        shiftPressedRef.current = false;
      }
    };
    const handleWindowBlur = () => {
      shiftPressedRef.current = false;
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", handleWindowBlur, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleWindowBlur, true);
    };
  }, [shiftPressedRef]);
}
