import { type FC, useMemo } from "react";
import { FormattingToolbarExtension } from "@blocknote/core/extensions";
import { flip, offset, shift } from "@floating-ui/react";
import {
  GenericPopover,
  useBlockNoteEditor,
  useExtension,
  useExtensionState,
  type FloatingUIOptions,
  type FormattingToolbarProps,
  type GenericPopoverReference,
} from "@blocknote/react";

import { getFormattingToolbarReferenceRect } from "@/components/editor/utils/formattingToolbarReference";
import { getFormattingSelectionMode } from "./helpers";

type GooseFormattingToolbarControllerProps = {
  formattingToolbar: FC<FormattingToolbarProps>;
  floatingUIOptions?: FloatingUIOptions;
  portalElement?: HTMLElement | null;
  /**
   * Optional external gate. When set and floatingUIOptions does not define
   * `useFloatingOptions.open`, show = store && open.
   */
  open?: boolean;
};

/**
 * BlockNote FormattingToolbarController with a multi-block-aware anchor:
 * toolbars sit above/below the full selected-blocks bbox and stay horizontally
 * centered (prefer top, flip to bottom; never textAlignment-driven start/end).
 */
export function GooseFormattingToolbarController({
  formattingToolbar: Component,
  floatingUIOptions: propsFloatingUIOptions,
  portalElement,
  open: openProp,
}: GooseFormattingToolbarControllerProps) {
  const editor = useBlockNoteEditor();
  const formattingToolbar = useExtension(FormattingToolbarExtension, {
    editor,
  });
  const storeOpen = useExtensionState(FormattingToolbarExtension, {
    editor,
  });

  // Prefer caller's floating open (EditorComposer ANDs store + selection + AI);
  // else optional open prop gates the store; else store alone.
  const floatingOpen = propsFloatingUIOptions?.useFloatingOptions?.open;
  const show =
    typeof floatingOpen === "boolean"
      ? floatingOpen
      : openProp !== undefined
        ? storeOpen && openProp
        : storeOpen;

  const reference = useMemo<GenericPopoverReference | undefined>(() => {
    const dom = editor.domElement;
    const contextEl =
      (dom?.firstElementChild instanceof Element
        ? dom.firstElementChild
        : null) ?? (dom instanceof Element ? dom : null);

    const getBoundingClientRect = () => {
      const mode = getFormattingSelectionMode(editor);
      const rect = getFormattingToolbarReferenceRect(editor, mode);
      return rect ?? new DOMRect();
    };

    if (contextEl) {
      return {
        element: contextEl,
        getBoundingClientRect,
        // Multi-block geometry changes every drag frame; never cache a stale box.
        cacheMountedBoundingClientRect: false,
      };
    }

    return {
      element: undefined,
      getBoundingClientRect,
    };
  }, [editor, editor.domElement]);

  const floatingUIOptions = useMemo<FloatingUIOptions>(() => {
    const callerFloating = propsFloatingUIOptions?.useFloatingOptions;
    const effectiveOpen =
      typeof callerFloating?.open === "boolean" ? callerFloating.open : show;

    return {
      ...propsFloatingUIOptions,
      useFloatingOptions: {
        // Prefer above selection; flip below when no room. Do NOT use
        // textAlignmentToPlacement (top-start) — multi-block must stay centered.
        placement: "top",
        middleware: [
          offset(10),
          flip({ fallbackPlacements: ["bottom"] }),
          shift(),
        ],
        ...callerFloating,
        open: effectiveOpen,
        // Needed as hooks like `useDismiss` call `onOpenChange` to change open.
        onOpenChange: (nextOpen, event, reason) => {
          callerFloating?.onOpenChange?.(nextOpen, event, reason);
          formattingToolbar.store.setState(nextOpen);
          if (reason === "escape-key") {
            editor.focus();
          }
        },
      },
      focusManagerProps: {
        disabled: true,
        ...propsFloatingUIOptions?.focusManagerProps,
      },
      elementProps: {
        style: {
          zIndex: 40,
        },
        ...propsFloatingUIOptions?.elementProps,
      },
    };
  }, [show, propsFloatingUIOptions, formattingToolbar.store, editor]);

  return (
    <GenericPopover
      reference={reference}
      portalElement={portalElement}
      {...floatingUIOptions}
    >
      {show ? <Component /> : null}
    </GenericPopover>
  );
}
