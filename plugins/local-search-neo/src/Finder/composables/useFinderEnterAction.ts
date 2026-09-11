import { onUnmounted, type Ref } from "vue";
import type { RunSearchOptions } from "./useFinderSearch";
import { useFinderQuery } from "./useFinderQuery";
import { useSubInput } from "./useSubInput";

export type FinderEnterAction = {
  prefix?: string;
  query?: string;
  placeholder?: string;
  fullPath?: string;
};

interface UseFinderEnterActionOptions {
  activePath: Ref<string>;
  search: (options?: RunSearchOptions) => void;
}

type EnterActionHandler = (action: FinderEnterAction) => void;

let activeHandler: EnterActionHandler | undefined;
let pendingAction: FinderEnterAction | undefined;

export function useFinderEnterAction(options?: UseFinderEnterActionOptions) {
  const { setQueryText, prefixFilter } = useFinderQuery();
  const { syncSubInputValue, bindSubInput } = useSubInput();

  if (options) {
    const handler: EnterActionHandler = (action) => {
      const fullPath = action.fullPath;

      prefixFilter.value = action.prefix ?? "";
      bindSubInput(action.placeholder);
      setQueryText(action.query ?? "");
      syncSubInputValue();
      options.activePath.value = fullPath ?? "";
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
    setQueryText(action.query ?? "");
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
