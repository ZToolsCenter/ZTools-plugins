import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
} from "react";

interface ImeKeyboardEventLike {
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
}

/**
 * React 的 isComposing 足以覆盖现代浏览器；229 是旧 Chromium/WebView
 * 在输入法处理按键时使用的兼容标记。
 */
export function isImeKeyboardEvent(event: ImeKeyboardEventLike) {
  return (
    event.isComposing === true || event.keyCode === 229 || event.which === 229
  );
}

/** 全局快捷键默认忽略输入法组合态和长按重复；连续导航可显式放行 repeat。 */
export function shouldSkipAppHotkeyEvent(
  event: ImeKeyboardEventLike & { repeat?: boolean },
  allowRepeat = false,
) {
  return isImeKeyboardEvent(event) || (event.repeat === true && !allowRepeat);
}

export function isDuplicateCompositionEndChange(
  compositionEndValue: string | null,
  nextValue: string,
) {
  return compositionEndValue !== null && compositionEndValue === nextValue;
}

/**
 * 受控 input 的 IME 边界：组合期间只原样同步浏览器给出的中间文本，
 * compositionend 立即记录最终文本，并去掉部分旧内核随后补发的重复 change。
 */
export function useImeInput(initialValue: string) {
  const [value, setStateValue] = useState(initialValue);
  const valueRef = useRef(initialValue);
  const isComposingRef = useRef(false);
  const compositionEndValueRef = useRef<string | null>(null);

  const setValue: Dispatch<SetStateAction<string>> = useCallback((next) => {
    const resolved = typeof next === "function" ? next(valueRef.current) : next;
    valueRef.current = resolved;
    compositionEndValueRef.current = null;
    setStateValue(resolved);
  }, []);

  const onChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.currentTarget.value;
    valueRef.current = nextValue;

    if (
      isDuplicateCompositionEndChange(compositionEndValueRef.current, nextValue)
    ) {
      compositionEndValueRef.current = null;
      return;
    }

    compositionEndValueRef.current = null;
    // 不 trim、不替换字符：组合期的拼音中间态必须逐字原样保留。
    setStateValue(nextValue);
  }, []);

  const onCompositionStart = useCallback(
    (_event: CompositionEvent<HTMLInputElement>) => {
      isComposingRef.current = true;
      compositionEndValueRef.current = null;
    },
    [],
  );

  const onCompositionEnd = useCallback(
    (event: CompositionEvent<HTMLInputElement>) => {
      const finalValue = event.currentTarget.value;
      isComposingRef.current = false;
      valueRef.current = finalValue;
      compositionEndValueRef.current = finalValue;
      setStateValue(finalValue);
    },
    [],
  );

  const isComposing = useCallback(
    (event?: KeyboardEvent<HTMLInputElement>) =>
      isComposingRef.current ||
      (event
        ? isImeKeyboardEvent(event.nativeEvent) || isImeKeyboardEvent(event)
        : false),
    [],
  );

  return {
    value,
    valueRef,
    setValue,
    isComposing,
    inputProps: {
      onChange,
      onCompositionStart,
      onCompositionEnd,
    },
  };
}
