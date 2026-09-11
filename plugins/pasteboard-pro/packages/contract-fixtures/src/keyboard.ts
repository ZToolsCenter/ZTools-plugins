import type {
  PasteStackAction,
  PasteStackDirection,
  PasteStackState,
  SelectionAction,
  SelectionState,
} from "@pasteboard-pro/core";
import { deepFreeze } from "#freeze";

export type HostAgnosticKeyboardEvent = Readonly<{
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}>;

export type SelectionKeyboardStep = Readonly<{
  event: HostAgnosticKeyboardEvent;
  action: SelectionAction;
  expectedSelected: readonly string[];
  expectedAnchor?: string;
  expectedFocus?: string;
}>;

export const selectionKeyboardFixture = deepFreeze({
  orderedIds: ["text-old", "image-new", "url-middle"],
  initial: {
    selected: ["text-old"],
    anchor: "text-old",
    focus: "text-old",
  },
  steps: [
    {
      event: { key: "ArrowRight", metaKey: false, shiftKey: true, altKey: false },
      action: {
        type: "extend",
        orderedIds: ["text-old", "image-new", "url-middle"],
        direction: 1,
      },
      expectedSelected: ["text-old", "image-new"],
      expectedAnchor: "text-old",
      expectedFocus: "image-new",
    },
    {
      event: { key: "ArrowRight", metaKey: false, shiftKey: true, altKey: false },
      action: {
        type: "extend",
        orderedIds: ["text-old", "image-new", "url-middle"],
        direction: 1,
      },
      expectedSelected: ["text-old", "image-new", "url-middle"],
      expectedAnchor: "text-old",
      expectedFocus: "url-middle",
    },
    {
      event: { key: "ArrowLeft", metaKey: false, shiftKey: true, altKey: false },
      action: {
        type: "extend",
        orderedIds: ["text-old", "image-new", "url-middle"],
        direction: -1,
      },
      expectedSelected: ["text-old", "image-new"],
      expectedAnchor: "text-old",
      expectedFocus: "image-new",
    },
    {
      event: { key: "a", metaKey: true, shiftKey: false, altKey: false },
      action: {
        type: "select-all",
        orderedIds: ["text-old", "image-new", "url-middle"],
      },
      expectedSelected: ["text-old", "image-new", "url-middle"],
      expectedAnchor: "text-old",
      expectedFocus: "url-middle",
    },
    {
      event: { key: "Escape", metaKey: false, shiftKey: false, altKey: false },
      action: { type: "clear" },
      expectedSelected: [],
    },
  ],
} satisfies {
  orderedIds: readonly string[];
  initial: SelectionState;
  steps: readonly SelectionKeyboardStep[];
});

export type PasteStackKeyboardStep = Readonly<{
  action: PasteStackAction;
  expectedItemIds: readonly string[];
  expectedDirection: PasteStackDirection;
}>;

export const pasteStackKeyboardFixture = deepFreeze({
  initial: {
    direction: "forward",
    itemIds: ["text-old", "image-new", "url-middle"],
  },
  steps: [
    {
      action: { type: "consume" },
      expectedItemIds: ["image-new", "url-middle"],
      expectedDirection: "forward",
    },
    {
      action: { type: "set-direction", direction: "reverse" },
      expectedItemIds: ["image-new", "url-middle"],
      expectedDirection: "reverse",
    },
    {
      action: { type: "consume" },
      expectedItemIds: ["image-new"],
      expectedDirection: "reverse",
    },
    {
      action: { type: "append", itemIds: ["files-item", "image-new"] },
      expectedItemIds: ["image-new", "files-item"],
      expectedDirection: "reverse",
    },
    {
      action: { type: "remove", itemId: "image-new" },
      expectedItemIds: ["files-item"],
      expectedDirection: "reverse",
    },
  ],
} satisfies {
  initial: PasteStackState;
  steps: readonly PasteStackKeyboardStep[];
});
