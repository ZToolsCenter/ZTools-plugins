import { Plus, ClipboardPaste, ScanLine, KeyRound } from "lucide-react";

interface EmptyStateProps {
  onAdd: () => void;
  onClipboardImport: () => void;
  onScreenCapture: () => void;
}

export function EmptyState({ onAdd, onClipboardImport, onScreenCapture }: EmptyStateProps) {
  return (
    <div className="slide-in flex flex-1 flex-col px-5 pb-5 pt-6">
      {/* Hero */}
      <div className="mb-6 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[20px] bg-accent-subtle">
          <div className="relative">
            <KeyRound
              size={28}
              className="text-accent"
              strokeWidth={1.6}
            />
          </div>
        </div>
        <h2 className="text-[16px] font-semibold leading-snug text-fg">
          安全验证，触手可及
        </h2>
        <p className="mx-auto mt-1.5 max-w-[240px] text-[12.5px] leading-relaxed text-fg-muted">
          添加你的双因素认证账户，一键复制验证码，告别手机切换
        </p>
      </div>

      {/* Getting started card */}
      <div className="rounded-cell border bg-surface p-4">
        <p className="mb-3 text-[11.5px] font-medium uppercase tracking-wider text-fg-faint">
          快速开始
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onAdd}
            className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface-hover active:bg-surface-active"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg transition-transform group-active:scale-95">
              <Plus size={18} strokeWidth={2.2} />
            </div>
            <div className="min-w-0">
              <span className="block text-[13px] font-medium text-fg">
                手动添加账户
              </span>
              <span className="block text-[11.5px] text-fg-faint">
                输入账户名称和密钥
              </span>
            </div>
          </button>

          <button
            onClick={onClipboardImport}
            className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface-hover active:bg-surface-active"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-subtle text-accent transition-transform group-active:scale-95">
              <ClipboardPaste size={17} strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <span className="block text-[13px] font-medium text-fg">
                从剪贴板导入
              </span>
              <span className="block text-[11.5px] text-fg-faint">
                粘贴 otpauth 链接或二维码图片
              </span>
            </div>
          </button>

          <button
            onClick={onScreenCapture}
            className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface-hover active:bg-surface-active"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-subtle text-accent transition-transform group-active:scale-95">
              <ScanLine size={17} strokeWidth={1.8} />
            </div>
            <div className="min-w-0">
              <span className="block text-[13px] font-medium text-fg">
                屏幕扫码
              </span>
              <span className="block text-[11.5px] text-fg-faint">
                截取屏幕上的二维码自动识别
              </span>
            </div>
          </button>
        </div>
      </div>

      {/* Subtle footer hint */}
      <p className="mt-4 text-center text-[11px] leading-relaxed text-fg-faint">
        所有数据加密存储在本地，不会上传到任何服务器
      </p>
    </div>
  );
}
