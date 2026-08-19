import { mergeCSSClasses } from "@blocknote/core";
import { filterSuggestionItems } from "@blocknote/core/extensions";
import {
  type DefaultReactSuggestionItem,
  useComponentsContext,
  useSuggestionMenuKeyboardHandler,
} from "@blocknote/react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export type GoosePromptSuggestionMenuProps = {
  items: DefaultReactSuggestionItem[];
  onManualPromptSubmit: (userPrompt: string) => void;
  promptText?: string;
  onPromptTextChange?: (userPrompt: string) => void;
  icon?: ReactNode;
  rightSection?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  /** 自动增高上限（px），超出后内部滚动。默认约 6 行。 */
  maxAutoHeightPx?: number;
};

/**
 * 与 editor-ai-menu.css 对齐：
 * --goose-ai-line 20 + --goose-ai-pad-y 8*2 = 36 首行总高
 * 多行上限 ≈ 6 行内容 + 上下 padding
 */
const DEFAULT_LINE_HEIGHT_PX = 20;
const DEFAULT_PAD_Y_PX = 8;
const DEFAULT_MIN_HEIGHT_PX = DEFAULT_PAD_Y_PX * 2 + DEFAULT_LINE_HEIGHT_PX; // 36
const DEFAULT_MAX_AUTO_HEIGHT_PX =
  DEFAULT_LINE_HEIGHT_PX * 6 + DEFAULT_PAD_Y_PX * 2; // 136

/**
 * 行内 AI 提示菜单：多行 textarea + 高度随内容增长。
 * 键盘：Enter 提交 / 选中建议；Shift+Enter 换行。
 */
export function GoosePromptSuggestionMenu(props: GoosePromptSuggestionMenuProps) {
  const Components = useComponentsContext()!;
  const {
    onManualPromptSubmit,
    promptText,
    onPromptTextChange,
    disabled,
    maxAutoHeightPx = DEFAULT_MAX_AUTO_HEIGHT_PX,
  } = props;

  const [internalPromptText, setInternalPromptText] = useState("");
  const promptTextToUse = promptText ?? internalPromptText;

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = event.currentTarget.value;
      if (onPromptTextChange) {
        onPromptTextChange(newValue);
      }
      if (promptText === undefined) {
        setInternalPromptText(newValue);
      }
    },
    [onPromptTextChange, promptText],
  );

  const items: DefaultReactSuggestionItem[] = useMemo(() => {
    return filterSuggestionItems(props.items, promptTextToUse);
  }, [promptTextToUse, props.items]);

  const { selectedIndex, setSelectedIndex, handler } =
    useSuggestionMenuKeyboardHandler(items, (item) => item.onItemClick());

  const activeDescendantId =
    items.length > 0 && selectedIndex >= 0 && selectedIndex < items.length
      ? `bn-suggestion-menu-item-${selectedIndex}`
      : undefined;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // 换行：Shift+Enter（或 IME 组合中不处理）
      if (
        event.key === "Enter" &&
        event.shiftKey &&
        !event.nativeEvent.isComposing
      ) {
        // 允许默认插入换行
        return;
      }

      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
        event.preventDefault();
        if (items.length > 0) {
          handler(event as unknown as KeyboardEvent);
        } else {
          const trimmed = promptTextToUse.trim();
          if (trimmed) {
            onManualPromptSubmit(promptTextToUse);
          }
        }
        return;
      }

      // 多行时：光标不在首行/末行则让上下键在文内移动，不抢建议列表
      if (
        (event.key === "ArrowUp" || event.key === "ArrowDown") &&
        promptTextToUse.includes("\n")
      ) {
        const el = event.currentTarget;
        const value = el.value;
        const start = el.selectionStart ?? 0;
        const atFirstLine = !value.slice(0, start).includes("\n");
        const atLastLine = !value.slice(start).includes("\n");
        if (event.key === "ArrowUp" && !atFirstLine) return;
        if (event.key === "ArrowDown" && !atLastLine) return;
      }

      handler(event as unknown as KeyboardEvent);
    },
    [handler, items.length, onManualPromptSubmit, promptTextToUse],
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [promptTextToUse, setSelectedIndex]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasBeenDisabled = useRef(disabled);

  useEffect(() => {
    if (textareaRef.current && hasBeenDisabled.current && !disabled) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
    if (disabled) {
      hasBeenDisabled.current = true;
    }
  }, [disabled]);

  // 高度随内容增长（border-box 含 padding）；最小值 = 图标槽，保证首行中线对齐
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.boxSizing = "border-box";
    el.style.height = "0px";
    const measured = el.scrollHeight;
    const next = Math.min(
      Math.max(measured, DEFAULT_MIN_HEIGHT_PX),
      maxAutoHeightPx,
    );
    el.style.height = `${next}px`;
    el.style.overflowY = measured > maxAutoHeightPx ? "auto" : "hidden";
  }, [promptTextToUse, disabled, maxAutoHeightPx, props.placeholder]);

  const hasRightSection = props.rightSection != null;

  return (
    <div className="bn-combobox goose-ai-prompt-menu">
      <div
        className={mergeCSSClasses(
          "goose-ai-prompt-field",
          hasRightSection ? "goose-ai-prompt-field--with-right" : "",
          disabled ? "goose-ai-prompt-field--disabled" : "",
        )}
      >
        {props.icon != null && (
          <div className="goose-ai-prompt-field__icon" aria-hidden>
            {props.icon}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="goose-ai-prompt-field__textarea bn-combobox-input"
          name="ai-prompt"
          rows={1}
          value={promptTextToUse || ""}
          placeholder={props.placeholder}
          disabled={props.disabled}
          onKeyDown={handleKeyDown}
          onChange={handleChange}
          autoComplete="off"
          aria-activedescendant={activeDescendantId}
          aria-multiline="true"
          spellCheck={false}
        />
        {hasRightSection && (
          <div className="goose-ai-prompt-field__right">{props.rightSection}</div>
        )}
      </div>
      {items.length > 0 && (
        <Components.SuggestionMenu.Root
          className="bn-combobox-items"
          id="ai-suggestion-menu"
        >
          {items.map((item, i) => (
            <Components.SuggestionMenu.Item
              key={item.title}
              className={mergeCSSClasses(
                "bn-suggestion-menu-item",
                item.size === "small" ? "bn-suggestion-menu-item-small" : "",
              )}
              id={`bn-suggestion-menu-item-${i}`}
              isSelected={i === selectedIndex}
              onClick={item.onItemClick}
              item={item}
            />
          ))}
        </Components.SuggestionMenu.Root>
      )}
    </div>
  );
}
