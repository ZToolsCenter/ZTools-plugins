import { onUnmounted } from "vue";
import { useFinderQuery } from "./useFinderQuery";

interface UseSubInputOptions {
  onInput?: () => void;
}

const inputListeners = new Set<() => void>();
let subInputReady = false;
let programmaticInputValue: string | undefined;

export function useSubInput({ onInput }: UseSubInputOptions = {}) {
  const { queryText, setQueryText } = useFinderQuery();

  if (onInput) {
    inputListeners.add(onInput);
    onUnmounted(() => {
      if (onInput) {
        inputListeners.delete(onInput);
      }
    });
  }

  function bindSubInput(placeholder: string = "全盘搜索") {
    window.ztools.setSubInput(
      ({ text }) => {
        if (programmaticInputValue === text) {
          programmaticInputValue = undefined;
          return;
        }

        programmaticInputValue = undefined;
        setQueryText(text);
        notifyInputListeners();
      },
      placeholder,
      true,
    );
    subInputReady = true;
  }

  /** 当非用户操作需要修改子输入框的值, 不触发重新搜索 */
  function syncSubInputValue() {
    if (!subInputReady) return;
    programmaticInputValue = queryText.value;
    window.ztools.setSubInputValue(queryText.value);
  }

  function focusSubInput() {
    window.ztools.subInputFocus();
  }

  return {
    bindSubInput,
    syncSubInputValue,
    focusSubInput,
  };
}

function notifyInputListeners() {
  inputListeners.forEach((listener) => listener());
}
