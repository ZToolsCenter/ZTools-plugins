import { useEffect } from "react";
import { Toaster as Sonner, toast as sonnerToast } from "sonner";
import type { ExternalToast } from "sonner";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToasterProps = React.ComponentProps<typeof Sonner>;
type ToastMessage = Parameters<typeof sonnerToast>[0];

const defaultToastClassNames = {
  // 注意：
  // 1. 不要加 `toast` 标记类 —— @heroui/styles 定义了同名 .toast 组件类
  //    （position:absolute/left:0/right:0/pointer-events 等），会劫持 sonner 的布局
  //    并让关闭按钮点击失效。
  // 2. 不要加 !opacity-100 —— sonner 靠 opacity:0 隐藏过期/超出堆叠数的
  //    toast（data-visible=false），强制不透明会让"幽灵 toast"留在屏幕上且点不动。
  // 3. 宽度由 goose-toast.css 控制：max-content + max-width，避免固定 356px。
  toast:
    // uTools 旧内核不支持 hsl(var(--x)/alpha)，避免 bg-*/95、border-*/70 退化成实色
    "group goose-toast !bg-[rgba(255,255,255,0.95)] dark:!bg-[rgba(18,18,20,0.92)] !text-foreground !border !border-[rgba(15,23,42,0.12)] dark:!border-[rgba(255,255,255,0.14)] !shadow-[0_10px_26px_rgba(2,6,23,0.14)] dark:!shadow-[0_10px_28px_rgba(2,6,23,0.42)] backdrop-blur-md !rounded-xl !px-4 !py-2.5 !font-medium !text-sm !overflow-hidden",
  title: "!text-foreground !opacity-100 !font-semibold",
  description: "!text-muted-foreground",
  actionButton:
    "!bg-primary !text-primary-foreground hover:!brightness-95 !rounded-lg !px-3.5 !h-8 !text-xs !font-semibold !border !border-[rgba(15,23,42,0.12)] transition-all duration-150",
  cancelButton:
    "!bg-muted !text-muted-foreground hover:!brightness-95 !rounded-lg !px-3 !h-8 !text-xs !font-medium",
  // 轻量关闭：无粗边框，默认细 X，hover 才淡底高亮
  // hover 背景必须用 rgba，禁止 foreground/8 —— 旧内核会退化成实心黑圆
  closeButton:
    "goose-toast-close !absolute !left-auto !right-1.5 !top-1/2 !transform-none !translate-x-0 !-translate-y-1/2 !h-[22px] !w-[22px] !rounded-full !border-0 !bg-transparent !opacity-55 hover:!opacity-100 !text-muted-foreground hover:!text-foreground !transition-all !duration-150 !cursor-pointer !shadow-none",
  error:
    "goose-toast-error !border-[rgba(200,25,46,0.18)] dark:!border-[rgba(255,109,125,0.18)]",
  success: "goose-toast-success",
  icon: "goose-toast-icon",
} satisfies NonNullable<ToasterProps["toastOptions"]>["classNames"];

function ErrorToastIcon() {
  return (
    <span className="goose-toast-error-mark" aria-hidden="true">
      !
    </span>
  );
}

function CloseToastIcon() {
  return <X className="pointer-events-none h-3 w-3" strokeWidth={2.25} />;
}

function successToast(message: ToastMessage, data?: ExternalToast) {
  const { className, classNames, ...rest } = data ?? {};
  return sonnerToast.success(message, {
    ...rest,
    className: cn("goose-toast-success", className),
    classNames: {
      ...classNames,
      toast: cn("goose-toast-success", classNames?.toast),
      success: cn("goose-toast-success", classNames?.success),
      actionButton: cn(
        "goose-toast-success-action",
        classNames?.actionButton,
      ),
    },
  });
}

const Toaster = ({ className, toastOptions, icons, ...props }: ToasterProps) => {
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      const closeBtn = target?.closest?.(
        "[data-sonner-toast] [data-close-button]",
      ) as HTMLElement | null;
      if (closeBtn) {
        e.preventDefault();
        closeBtn.click();
      }
    };
    document.addEventListener("pointerdown", handler, true);
    return () => document.removeEventListener("pointerdown", handler, true);
  }, []);

  return (
    <Sonner
      theme="system"
      position="bottom-right"
      offset={14}
      mobileOffset={14}
      closeButton
      swipeDirections={["left", "right", "top"]}
      className={cn("toaster group goose-toaster z-[22000]", className)}
      // 关闭 sonner 默认 richColors，错误视觉完全由全局 goose-toast-error 接管
      richColors={false}
      icons={{
        ...icons,
        close: <CloseToastIcon />,
        error: <ErrorToastIcon />,
      }}
      toastOptions={{
        duration: 2600,
        ...toastOptions,
        classNames: {
          ...toastOptions?.classNames,
          toast: cn(defaultToastClassNames.toast, toastOptions?.classNames?.toast),
          title: cn(defaultToastClassNames.title, toastOptions?.classNames?.title),
          description: cn(
            defaultToastClassNames.description,
            toastOptions?.classNames?.description,
          ),
          actionButton: cn(
            defaultToastClassNames.actionButton,
            toastOptions?.classNames?.actionButton,
          ),
          cancelButton: cn(
            defaultToastClassNames.cancelButton,
            toastOptions?.classNames?.cancelButton,
          ),
          closeButton: cn(
            defaultToastClassNames.closeButton,
            toastOptions?.classNames?.closeButton,
          ),
          error: cn(defaultToastClassNames.error, toastOptions?.classNames?.error),
          success: cn(
            defaultToastClassNames.success,
            toastOptions?.classNames?.success,
          ),
          icon: cn(defaultToastClassNames.icon, toastOptions?.classNames?.icon),
        },
      }}
      {...props}
    />
  );
};

/**
 * 全局唯一 toast 入口。
 * 错误态强制走 goose-toast-error（红字 + 圆底!，干净无装饰纹理），
 * 业务侧不得绕过这套视觉。
 */
const toast = Object.assign(
  (message: ToastMessage, data?: ExternalToast) => sonnerToast(message, data),
  {
    success: successToast,
    info: (message: ToastMessage, data?: ExternalToast) =>
      sonnerToast.info(message, data),
    warning: (message: ToastMessage, data?: ExternalToast) =>
      sonnerToast.warning(message, data),
    error: (message: ToastMessage, data?: ExternalToast) => {
      const { icon: _ignoredIcon, ...rest } = data ?? {};
      return sonnerToast.error(message, {
        ...rest,
        // 业务侧不得覆盖错误图标 / 错误样式类
        icon: <ErrorToastIcon />,
        className: cn("goose-toast-error", rest.className),
        classNames: {
          ...rest.classNames,
          toast: cn("goose-toast-error", rest.classNames?.toast),
          error: cn("goose-toast-error", rest.classNames?.error),
          title: cn("goose-toast-error-title", rest.classNames?.title),
          description: cn(
            "goose-toast-error-description",
            rest.classNames?.description,
          ),
          icon: cn("goose-toast-icon", rest.classNames?.icon),
          closeButton: cn(
            "goose-toast-error-close",
            rest.classNames?.closeButton,
          ),
        },
      });
    },
    message: (message: ToastMessage, data?: ExternalToast) =>
      sonnerToast.message(message, data),
    loading: (message: ToastMessage, data?: ExternalToast) =>
      sonnerToast.loading(message, data),
    custom: sonnerToast.custom.bind(sonnerToast),
    promise: sonnerToast.promise.bind(sonnerToast),
    dismiss: sonnerToast.dismiss.bind(sonnerToast),
    getHistory: sonnerToast.getHistory.bind(sonnerToast),
    getToasts: sonnerToast.getToasts.bind(sonnerToast),
  },
);

export { Toaster, toast };
