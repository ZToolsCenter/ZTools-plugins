/**
 * Beautiful UI 状态动效预设（仅 State indication）。
 * 仅在 Agent 进行中挂载；idle 无 shimmer / loader。
 */

export const buiComposerLoader = {
  variant: "Drive",
  label: "正在生成",
} as const;

export const buiThinkingLoader = {
  variant: "Drive",
  label: "思考中",
} as const;

export const buiToolLoader = {
  variant: "Dots",
  label: "处理中",
} as const;

export const buiSubagentLoader = {
  variant: "Drive",
  label: "运行中",
} as const;

export const buiSidebarLoader = {
  variant: "Drive",
  size: "sm",
} as const;

export type BuiComposerLoaderPreset = typeof buiComposerLoader;
export type BuiThinkingLoaderPreset = typeof buiThinkingLoader;
export type BuiToolLoaderPreset = typeof buiToolLoader;
export type BuiSubagentLoaderPreset = typeof buiSubagentLoader;
export type BuiSidebarLoaderPreset = typeof buiSidebarLoader;
