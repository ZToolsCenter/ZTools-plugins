/**
 * 项目统一多值/选项分隔符：顿号、中文逗号、英文逗号、竖线。
 * 不把空格当分隔符，避免拆开「New York」「成绩 管理」这类选项。
 */
export const VALUE_SPLIT_PATTERN = /[、，,|]/
export const VALUE_SPLIT_LABEL = '、 ， , |'
export const DEFAULT_MULTI_SEP = '、'

export function splitMultiValue(text: string | null | undefined): string[] {
  if (text == null) return []
  return String(text)
    .split(VALUE_SPLIT_PATTERN)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function joinMultiValue(values: string[], sep = DEFAULT_MULTI_SEP): string {
  return values.join(sep)
}
