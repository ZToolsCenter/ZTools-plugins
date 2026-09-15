import { useState, useCallback, useEffect, useRef } from "react";
import {
  ArrowLeft,
  ClipboardPaste,
  ScanLine,
  Clock,
  Hash,
} from "lucide-react";
import { parseOtpAuthUri } from "@/lib/otp";
import { parseGoogleAuthMigrationPayload } from "@/lib/google-auth-migration";
import { isBase32Secret } from "@/lib/data-transfer";
import { Input } from "@/components/ui/input";
import { usePlatform } from "@/platform/context";
import { readQRFromClipboard, decodeQRFromBase64 } from "@/lib/qr-decode";
import type { NewAccountInput } from "@/lib/types";

interface AddAccountProps {
  onAdd: (input: NewAccountInput) => void;
  onBatchAdd?: (inputs: NewAccountInput[]) => void;
  onCancel: () => void;
  /** Auto-trigger an action on mount: "clipboard" or "capture" */
  initialAction?: "clipboard" | "capture";
}

type OtpType = "totp" | "hotp";
type FormError = { field: "name" | "secret"; message: string } | null;

export function AddAccount({ onAdd, onBatchAdd, onCancel, initialAction }: AddAccountProps) {
  const platform = usePlatform();
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [type, setType] = useState<OtpType>("totp");
  const [importError, setImportError] = useState("");
  const [error, setError] = useState<FormError>(null);
  const mountedRef = useRef(true);
  // 自增标识：每次点击导入/截屏都 +1，旧回调若标识过期则丢弃
  const captureGenRef = useRef(0);
  const clipboardGenRef = useRef(0);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmedName = name.trim();
    const trimmedSecret = secret.replace(/\s/g, "").toUpperCase();

    if (!trimmedName) {
      setError({ field: "name", message: "请输入账户名称" });
      return;
    }
    if (!trimmedSecret) {
      setError({ field: "secret", message: "请输入密钥" });
      return;
    }
    if (!/^[A-Z2-7]+=*$/.test(trimmedSecret)) {
      setError({ field: "secret", message: "密钥格式不正确 (需要 Base32 编码)" });
      return;
    }

    onAdd({
      name: trimmedName,
      issuer: "",
      secret: trimmedSecret,
      type,
      digits: 6,
      period: 30,
      counter: 0,
      algorithm: "SHA-1",
    });
  }, [name, secret, type, onAdd]);

  /** Try to parse any decoded content (text or QR result) into accounts. */
  const processDecodedContent = useCallback(
    (content: string): boolean => {
      const trimmed = content.trim();

      // 1. otpauth:// single URI
      if (trimmed.startsWith("otpauth://")) {
        const parsed = parseOtpAuthUri(trimmed);
        if (parsed) {
          onAdd({ ...parsed });
          return true;
        }
        setImportError("无法解析此 OTP 链接");
        return true;
      }

      // 2. Google Authenticator migration
      if (trimmed.startsWith("otpauth-migration://")) {
        const migration = parseGoogleAuthMigrationPayload(trimmed);
        if (migration?.batchSize && migration.batchSize > 1) {
          setImportError(`这是第 ${migration.batchIndex + 1}/${migration.batchSize} 张迁移二维码。为避免漏账户，请在 Google Authenticator 中减少本次导出账户数量后重试。`);
          return true;
        }
        const entries = migration?.accounts;
        if (entries && entries.length > 0) {
          if (entries.length === 1) {
            onAdd(entries[0]!);
          } else if (onBatchAdd) {
            onBatchAdd(entries);
          } else {
            // fallback: add all one by one
            entries.forEach((e) => onAdd(e));
          }
          return true;
        }
        setImportError("无法解析 Google Authenticator 迁移数据");
        return true;
      }

      // 3. Plain base32 secret
      if (isBase32Secret(trimmed)) {
        setSecret(trimmed.replace(/[\s-]/g, "").toUpperCase());
        setImportError("");
        return true; // 已填入密钥，等待用户补充名称后保存。
      }

      return false;
    },
    [onAdd, onBatchAdd],
  );

  const handleClipboardImport = useCallback(async () => {
    const myGen = ++clipboardGenRef.current;
    setImportError("");

    const isStale = () => myGen !== clipboardGenRef.current || !mountedRef.current;

    try {
      // Read clipboard text
      const clipText = await platform.readClipboardText();

      // Try text content first
      if (clipText) {
        const trimmed = clipText.trim();
        if (
          trimmed.startsWith("otpauth://") ||
          trimmed.startsWith("otpauth-migration://") ||
          isBase32Secret(trimmed)
        ) {
          if (isStale()) return;
          processDecodedContent(trimmed);
          return;
        }
      }

      // Try QR code image from clipboard
      const qrResult = await readQRFromClipboard(platform);
      if (isStale()) return;
      if (qrResult) {
        if (processDecodedContent(qrResult)) return;
        setImportError("二维码内容不是有效的 OTP 数据");
        return;
      }

      setImportError("剪贴板中未找到有效内容 (支持 otpauth 链接、迁移码、二维码图片或 Base32 密钥)");
    } catch {
      if (!isStale()) setImportError("读取剪贴板失败");
    }
  }, [processDecodedContent, platform]);

  const handleScreenCapture = useCallback(async () => {
    const myGen = ++captureGenRef.current;
    setImportError("");

    const isStale = () => myGen !== captureGenRef.current || !mountedRef.current;

    try {
      const base64 = await platform.captureScreen();
      if (isStale()) return;
      if (!base64) {
        setImportError("截屏已取消");
        return;
      }
      try {
        const qrResult = await decodeQRFromBase64(base64);
        if (isStale()) return;
        if (qrResult) {
          if (!processDecodedContent(qrResult)) {
            setImportError("截图中的二维码不是有效的 OTP 数据");
          }
        } else {
          setImportError("未在截图中检测到二维码");
        }
      } catch {
        if (!isStale()) setImportError("解析截图失败");
      }
    } catch {
      if (!isStale()) setImportError("截屏失败或被取消");
    }
  }, [processDecodedContent, platform]);

  // Auto-trigger initial action on mount
  const initialActionRef = useRef(initialAction);
  useEffect(() => {
    if (initialActionRef.current === "clipboard") {
      handleClipboardImport();
    } else if (initialActionRef.current === "capture") {
      handleScreenCapture();
    }
    initialActionRef.current = undefined;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="slide-in flex flex-col">
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <button
          onClick={onCancel}
          className="icon-control rounded-lg p-2 text-fg-muted"
          aria-label="返回"
        >
          <ArrowLeft size={17} />
        </button>
        <h2 className="flex-1 text-[15px] font-serif font-semibold tracking-tight text-fg">
          添加账户
        </h2>
      </div>

      <div className="flex flex-col gap-4 px-4 pt-2">
        {/* Quick import section */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleClipboardImport}
            className="flex flex-1 items-center gap-2.5 rounded-cell border bg-surface px-3.5 py-3 text-left transition-colors hover:border-border-strong hover:bg-surface-hover active:bg-surface-active"
          >
            <ClipboardPaste size={17} className="shrink-0 text-accent" />
            <div className="min-w-0">
              <span className="block text-[12.5px] font-medium text-fg">
                从剪贴板导入
              </span>
              <span className="block text-[11px] text-fg-faint">
                文本链接 / 二维码图片
              </span>
            </div>
          </button>
          <button
            type="button"
            onClick={handleScreenCapture}
            className="flex flex-1 items-center gap-2.5 rounded-cell border bg-surface px-3.5 py-3 text-left transition-colors hover:border-border-strong hover:bg-surface-hover active:bg-surface-active"
          >
            <ScanLine size={17} className="shrink-0 text-accent" />
            <div className="min-w-0">
              <span className="block text-[12.5px] font-medium text-fg">
                屏幕扫码
              </span>
              <span className="block text-[11px] text-fg-faint">
                截取屏幕二维码
              </span>
            </div>
          </button>
        </div>

        {importError && (
          <p role="alert" aria-live="polite" className="fade-in rounded-lg bg-danger-soft px-3 py-2 text-[12px] text-timer-low">
            {importError}
          </p>
        )}

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-[11px] text-fg-faint">手动输入</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        {/* Manual form */}
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          <div>
            <label htmlFor="account-name" className="mb-1.5 block text-[12px] font-medium text-fg-muted">
              账户名称
            </label>
            <Input
              type="text"
              id="account-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="例如 GitHub, Google"
              aria-invalid={error?.field === "name"}
              aria-describedby={error?.field === "name" ? "account-name-error" : undefined}
            />
            {error?.field === "name" && (
              <p id="account-name-error" role="alert" className="fade-in mt-1.5 text-[12px] text-timer-low">
                {error.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="account-secret" className="mb-1.5 block text-[12px] font-medium text-fg-muted">
              密钥
            </label>
            <Input
              type="text"
              id="account-secret"
              value={secret}
              onChange={(e) => {
                setSecret(e.target.value);
                setError(null);
              }}
              placeholder="例如 JBSWY3DPEHPK3PXP"
              className="font-mono tracking-wider"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={error?.field === "secret"}
              aria-describedby={error?.field === "secret" ? "account-secret-error" : undefined}
            />
            {error?.field === "secret" && (
              <p id="account-secret-error" role="alert" className="fade-in mt-1.5 text-[12px] text-timer-low">
                {error.message}
              </p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-medium text-fg-muted">
              类型
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => setType("totp")}
                type="button"
                aria-pressed={type === "totp"}
                className={`flex flex-1 items-center gap-2 rounded-cell border px-3.5 py-2.5 text-[12.5px] font-medium transition-colors ${
                  type === "totp"
                    ? "border-accent-border bg-accent-subtle text-accent"
                    : "bg-surface text-fg-muted hover:bg-surface-hover active:bg-surface-active"
                }`}
              >
                <Clock size={15} />
                基于时间 (TOTP)
              </button>
              <button
                onClick={() => setType("hotp")}
                type="button"
                aria-pressed={type === "hotp"}
                className={`flex flex-1 items-center gap-2 rounded-cell border px-3.5 py-2.5 text-[12.5px] font-medium transition-colors ${
                  type === "hotp"
                    ? "border-accent-border bg-accent-subtle text-accent"
                    : "bg-surface text-fg-muted hover:bg-surface-hover active:bg-surface-active"
                }`}
              >
                <Hash size={15} />
                基于计数器 (HOTP)
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="primary-control mt-1 rounded-cell bg-accent py-2.5 text-[13px] font-medium text-accent-fg active:scale-[0.98]"
          >
            保存
          </button>
        </form>
      </div>
    </div>
  );
}
