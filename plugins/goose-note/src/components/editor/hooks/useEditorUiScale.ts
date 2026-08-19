import { useEffect, useState } from "react";
import { EDITOR_UI_SCALE_CHANGE_EVENT } from "@/lib/appearance";
import {
  getEditorUiScale,
  normalizeEditorUiScale,
} from "@/components/editor/utils/editorContextUi";

export function useEditorUiScale(): number {
  const [scale, setScale] = useState(getEditorUiScale);

  useEffect(() => {
    const handleScaleChange = (event: Event) => {
      const detail = (event as CustomEvent<{ scale?: unknown }>).detail;
      setScale(
        detail?.scale == null
          ? getEditorUiScale()
          : normalizeEditorUiScale(detail.scale),
      );
    };

    window.addEventListener(EDITOR_UI_SCALE_CHANGE_EVENT, handleScaleChange);
    return () =>
      window.removeEventListener(
        EDITOR_UI_SCALE_CHANGE_EVENT,
        handleScaleChange,
      );
  }, []);

  return scale;
}
