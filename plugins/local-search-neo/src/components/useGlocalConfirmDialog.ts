import { reactive } from "vue";

interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

const state = reactive({
  open: false,
  title: "",
  message: "",
  confirmText: "确定",
  cancelText: "取消",
  danger: false,
});

let resolveCurrent: ((value: boolean) => void) | undefined;

function confirm(options: ConfirmDialogOptions) {
  close(false);
  Object.assign(state, {
    open: true,
    title: options.title,
    message: options.message,
    confirmText: options.confirmText ?? "确定",
    cancelText: options.cancelText ?? "取消",
    danger: options.danger ?? false,
  });

  return new Promise<boolean>((resolve) => {
    resolveCurrent = resolve;
  });
}

function accept() {
  close(true);
}

function cancel() {
  close(false);
}

function close(result: boolean) {
  if (resolveCurrent) {
    resolveCurrent(result);
    resolveCurrent = undefined;
  }
  state.open = false;
}

export function useGlocalConfirmDialog() {
  return {
    state,
    confirm,
    accept,
    cancel,
  };
}
