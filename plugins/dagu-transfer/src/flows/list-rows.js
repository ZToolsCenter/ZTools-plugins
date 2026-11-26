// 两个列表流程共用的行构造与收尾动作。

import { targetDestination } from '../core/targets.js';

// 这些阶段下，列表里的行可以用上下键选择、回车触发。
export const SELECTABLE_PHASES = new Set(['targets', 'pick', 'path', 'failed', 'no-targets', 'no-input', 'done']);

export function targetRow(target) {
  return { key: `target:${target.id}`, kind: 'target', target, title: target.name, subtitle: targetDestination(target) };
}

export function setupRow(subtitle = '管理上传目标与下载目录') {
  return { key: 'setup', kind: 'setup', title: '打开配置', subtitle };
}

export function errorText(error) {
  return error instanceof Error ? error.message : String(error ?? '未知错误');
}

// 一次操作完成后的收起：隐藏启动器主窗口并退出插件视图。
export async function collapse(host) {
  await host?.hideMainWindow?.();
  await host?.outPlugin?.(false);
}
