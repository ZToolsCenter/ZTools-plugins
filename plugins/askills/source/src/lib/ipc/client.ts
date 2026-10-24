import { invoke, isTauri } from "@tauri-apps/api/core";
import { useMemo } from "react";
import type { Locale } from "./types";
import { diagnostic, nativeError } from "../../app/i18n/diagnostics";
import { pluginHost, type HostInvoke } from "../host";
export function isDesktop(): boolean {
  return isTauri() || !!pluginHost();
}
export function call<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const host = pluginHost();
  if (host) return host.invoke<T>(command, args);
  if (!isTauri())
    return Promise.reject(new Error("请在 Askills 桌面应用中执行本地操作。"));
  return invoke<T>(command, args);
}
/** Components retain their originating visit across asynchronous continuations. */
export function useCall(): HostInvoke {
  const host = pluginHost();
  return useMemo(() => (host ? host.bindInvoke() : call), [host]);
}
export function errorMessage(error: unknown, locale: Locale = "zh-CN"): string {
  if (error && typeof error === "object" && "message" in error) {
    const code = "code" in error ? String(error.code) + " · " : "";
    return (
      code +
      nativeError(
        "code" in error ? String(error.code) : "",
        String(error.message),
        locale,
      )
    );
  }
  return diagnostic(String(error), locale);
}
export const shortHash = (value: string | null | undefined) =>
  value?.slice(0, 10) || "本地快照";
export function sizeLabel(bytes: number) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
