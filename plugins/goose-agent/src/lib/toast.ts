/**
 * Toast 兼容门面：HeroUI v3 Toast + sonner 风格 API。
 * 业务统一 `import { toast } from "@/lib/toast"`。
 * HeroUI 用 `danger` 表示错误；本门面提供 `error` 别名以降低迁移成本。
 */
import { Toast, toast as herouiToast } from "@heroui/react";
import type { ReactNode } from "react";

/** sonner 风格 action；内部映射为 HeroUI actionProps */
export type ToastAction = {
  label: ReactNode;
  onClick?: () => void;
};

/** 与 HeroUI options 对齐，并兼容 sonner 的 action */
export type ToastOptions = {
  description?: ReactNode;
  indicator?: ReactNode;
  isLoading?: boolean;
  timeout?: number;
  onClose?: () => void;
  /** sonner 兼容：映射为 HeroUI `actionProps` */
  action?: ToastAction;
  /** 透传 HeroUI actionProps（优先于 action） */
  actionProps?: {
    children?: ReactNode;
    onPress?: () => void;
    [key: string]: unknown;
  };
};

export type ToastPromiseOptions<T = unknown> = {
  loading: ReactNode;
  success: ((data: T) => ReactNode) | ReactNode;
  error: ((error: Error) => ReactNode) | ReactNode;
};

function toHeroUIOptions(options?: ToastOptions) {
  if (!options) return undefined;
  const { action, actionProps, ...rest } = options;
  const mappedActionProps =
    actionProps ??
    (action
      ? {
          children: action.label,
          onPress: action.onClick,
        }
      : undefined);
  return {
    ...rest,
    ...(mappedActionProps ? { actionProps: mappedActionProps } : null),
  };
}

type ToastFn = {
  (message: ReactNode, options?: ToastOptions): string;
  /** sonner 兼容：中性提示，等同默认 toast */
  message(message: ReactNode, options?: ToastOptions): string;
  success(message: ReactNode, options?: ToastOptions): string;
  /** HeroUI 原生：错误态 */
  danger(message: ReactNode, options?: ToastOptions): string;
  /** sonner 兼容：映射到 danger */
  error(message: ReactNode, options?: ToastOptions): string;
  info(message: ReactNode, options?: ToastOptions): string;
  warning(message: ReactNode, options?: ToastOptions): string;
  promise<T>(
    promise: Promise<T> | (() => Promise<T>),
    options: ToastPromiseOptions<T>,
  ): string;
  close(key: string): void;
  pauseAll(): void;
  resumeAll(): void;
  clear(): void;
  getQueue: typeof herouiToast.getQueue;
};

const toast: ToastFn = Object.assign(
  (message: ReactNode, options?: ToastOptions) =>
    herouiToast(message, toHeroUIOptions(options)),
  {
    message: (message: ReactNode, options?: ToastOptions) =>
      herouiToast(message, toHeroUIOptions(options)),
    success: (message: ReactNode, options?: ToastOptions) =>
      herouiToast.success(message, toHeroUIOptions(options)),
    danger: (message: ReactNode, options?: ToastOptions) =>
      herouiToast.danger(message, toHeroUIOptions(options)),
    error: (message: ReactNode, options?: ToastOptions) =>
      herouiToast.danger(message, toHeroUIOptions(options)),
    info: (message: ReactNode, options?: ToastOptions) =>
      herouiToast.info(message, toHeroUIOptions(options)),
    warning: (message: ReactNode, options?: ToastOptions) =>
      herouiToast.warning(message, toHeroUIOptions(options)),
    promise: herouiToast.promise.bind(herouiToast) as ToastFn["promise"],
    close: herouiToast.close.bind(herouiToast),
    pauseAll: herouiToast.pauseAll.bind(herouiToast),
    resumeAll: herouiToast.resumeAll.bind(herouiToast),
    clear: herouiToast.clear.bind(herouiToast),
    getQueue: herouiToast.getQueue.bind(herouiToast),
  },
);

/** App 根节点挂载：`<Toast.Provider placement="top end" className="goose-toaster" />` */
const ToastProvider = Toast.Provider;

export { toast, Toast, ToastProvider };
