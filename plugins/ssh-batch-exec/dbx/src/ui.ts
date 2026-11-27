// 作者：木子
// 插件内提示与确认框：DBX iframe 不保证支持原生 alert/confirm。

import { reactive } from "vue";

export interface ToastItem {
  id: number;
  text: string;
  kind: "info" | "success" | "error";
}

interface ConfirmState {
  visible: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  resolve: ((value: boolean) => void) | null;
}

export const uiState = reactive({
  toasts: [] as ToastItem[],
  confirm: {
    visible: false,
    title: "",
    message: "",
    confirmText: "确认",
    cancelText: "取消",
    resolve: null,
  } as ConfirmState,
});

let toastId = 0;

export function toast(text: string, kind: ToastItem["kind"] = "info", duration = 3200): void {
  const id = ++toastId;
  uiState.toasts.push({ id, text, kind });
  window.setTimeout(() => dismissToast(id), duration);
}

export function dismissToast(id: number): void {
  const index = uiState.toasts.findIndex((item) => item.id === id);
  if (index >= 0) uiState.toasts.splice(index, 1);
}

export function confirmDialog(
  message: string,
  title = "请确认",
  options: { confirmText?: string; cancelText?: string } = {},
): Promise<boolean> {
  const state = uiState.confirm;
  state.resolve?.(false);
  state.visible = true;
  state.title = title;
  state.message = message;
  state.confirmText = options.confirmText || "确认";
  state.cancelText = options.cancelText || "取消";
  return new Promise<boolean>((resolve) => {
    state.resolve = resolve;
  });
}

export function resolveConfirm(value: boolean): void {
  const state = uiState.confirm;
  state.visible = false;
  const resolve = state.resolve;
  state.resolve = null;
  resolve?.(value);
}
