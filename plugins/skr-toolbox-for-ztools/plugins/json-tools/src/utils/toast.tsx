import { addToast, ToastProps } from "@heroui/react";

export type ToastType =
  | "default"
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "danger";

export interface ToastOptions extends Omit<ToastProps, "color"> {
  duration?: number;
}

// Toast 工具类
class ToastUtil {
  private show(
    type: ToastType,
    title: string,
    description?: string,
    options?: ToastOptions,
  ) {
    return addToast({
      title,
      description,
      color: type,
      timeout: options?.duration || 2000,
      ...options,
    });
  }

  // 默认 toast
  default(title: string, description?: string, options?: ToastOptions) {
    return this.show("default", title, description, options);
  }

  // 主要 toast
  primary(title: string, description?: string, options?: ToastOptions) {
    return this.show("primary", title, description, options);
  }

  // 次要 toast
  secondary(title: string, description?: string, options?: ToastOptions) {
    return this.show("secondary", title, description, options);
  }

  // 成功 toast
  success(title: string, description?: string, options?: ToastOptions) {
    return this.show("success", title, description, options);
  }

  // 警告 toast
  warning(title: string, description?: string, options?: ToastOptions) {
    return this.show("warning", title, description, options);
  }

  // 错误 toast
  error(title: string, description?: string, options?: ToastOptions) {
    return this.show("danger", title, description, options);
  }
}

const toast = new ToastUtil();

export default toast;
