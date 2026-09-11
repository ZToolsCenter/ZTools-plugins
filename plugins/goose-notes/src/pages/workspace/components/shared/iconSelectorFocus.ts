interface AutoFocusEvent {
  preventDefault: () => void;
}

interface FocusTarget {
  focus: (options?: FocusOptions) => void;
}

/**
 * Radix Popover 默认会聚焦内容区内第一个可聚焦控件。图标选择器的
 * 首个控件可能随着布局调整而变化，因此显式把初始焦点放到当前分类，
 * 避免工具按钮仅因浮层打开就触发 Tooltip。
 */
export function focusIconSelectorOnOpen(
  event: AutoFocusEvent,
  activeCategoryButton: FocusTarget | null,
): void {
  event.preventDefault();
  activeCategoryButton?.focus({ preventScroll: true });
}
