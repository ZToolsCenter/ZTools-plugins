import { onUnmounted, type Ref } from "vue";
import type { RunSearchOptions } from "./useFinderSearch";
import { useFinderQuery } from "./useFinderQuery";
import { useSubInput } from "./useSubInput";

export interface FinderEnterAction {
  payload: string;
  option?: {
    fullPath?: string;
  };
}

interface UseFinderEnterActionOptions {
  selectedPath: Ref<string>;
  search: (options?: RunSearchOptions) => void;
}

type EnterActionHandler = (action: FinderEnterAction) => void;

let activeHandler: EnterActionHandler | undefined;
let pendingAction: FinderEnterAction | undefined;

export function useFinderEnterAction(options?: UseFinderEnterActionOptions) {
  const { setQueryText } = useFinderQuery();
  const { syncSubInputValue } = useSubInput();

  if (options) {
    const handler: EnterActionHandler = (action) => {
      const fullPath = action.option?.fullPath;

      setQueryText(action.payload);
      syncSubInputValue();
      options.selectedPath.value = fullPath ?? "";
      options.search({ preserveSelection: !!fullPath });
    };

    activeHandler = handler;
    flushPendingAction();

    onUnmounted(() => {
      if (activeHandler === handler) {
        activeHandler = undefined;
      }
    });
  }

  function handleEnterAction(action: FinderEnterAction) {
    if (activeHandler) {
      activeHandler(action);
      return;
    }

    pendingAction = action;
    setQueryText(action.payload);
    syncSubInputValue();
  }

  return {
    handleEnterAction,
  };
}

function flushPendingAction() {
  if (!pendingAction || !activeHandler) return;

  const action = pendingAction;
  pendingAction = undefined;
  activeHandler(action);
}
