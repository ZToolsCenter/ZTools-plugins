import { Base64 } from "js-base64";

// 支持 URL-safe Base64 (-, _) 和数组上下文 ([, ,:)
export const BASE64_REGEX =
  /(?:[:,]\s*|\[)\s*"(([A-Za-z0-9+/\-_]{4})*([A-Za-z0-9+/\-_]{4}|[A-Za-z0-9+/\-_]{3}=|[A-Za-z0-9+/\-_]{2}==))"/g;

/**
 * 标准化 Base64 字符串：去除空白、转换 URL 安全字符、补齐填充
 */
export function normalizeBase64(input: string): string {
  let str = input.trim().replace(/\s/g, "");
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = str.length % 4;
  if (pad === 2) str += "==";
  else if (pad === 3) str += "=";
  return str;
}

/**
 * 校验并解码 Base64 字符串（支持 URL 安全 Base64）
 */
export function validateAndDecodeBase64(input: string): {
  success: boolean;
  decoded: string;
  error?: string;
} {
  if (!input.trim()) {
    return { success: false, decoded: "", error: "请输入 Base64 编码字符串" };
  }

  const normalized = normalizeBase64(input);

  try {
    const raw = Base64.atob(normalized);
    const uint8Array = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      uint8Array[i] = raw.charCodeAt(i);
    }
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const decoded = decoder.decode(uint8Array);
    return { success: true, decoded };
  } catch {
    return {
      success: false,
      decoded: "",
      error: "无效的 Base64 编码格式，请检查输入内容",
    };
  }
}

/**
 * 更严格的base64检测函数（包含UTF-8解码验证）
 * @param str 待检测的字符串
 * @returns boolean 是否为有效的base64编码
 */
export function checkBase64Strict(str: string): boolean {
  return decodeBase64Strict(str) !== "";
}

/**
 * 更严格的base64 decode（包含UTF-8解码验证）
 * @param str 待检测的字符串 失败返回空
 * @returns string 失败返回空
 */
export function decodeBase64Strict(str: string): string {
  try {
    // 尝试将解码后的内容作为UTF-8字符串解析
    const decoded = Base64.atob(str);

    // 使用TextDecoder进行UTF-8解码验证
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const uint8Array = new Uint8Array(decoded.length);

    for (let i = 0; i < decoded.length; i++) {
      uint8Array[i] = decoded.charCodeAt(i);
    }

    // 如果这里没有抛出异常，说明是有效的UTF-8序列
    return decoder.decode(uint8Array);
  } catch (error) {
    return "";
  }
}
