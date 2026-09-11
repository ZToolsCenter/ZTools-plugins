interface FormattingToolbarState {
  active: false;
  setActive(active: boolean): void;
}

const state: FormattingToolbarState = {
  active: false,
  setActive: () => {},
};

/** native-editor 不提供 AI 工具栏；保留共享 Composer 所需的只读选择器契约。 */
export function useFormattingToolbarAi<T>(
  selector: (value: FormattingToolbarState) => T,
): T {
  return selector(state);
}
