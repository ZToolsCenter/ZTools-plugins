import { Base64 } from "js-base64";

export const BASE64_REGEX =
  /: "(([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{4}|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==))"/g;

/**
 * 更严格的base64检测函数（包含UTF-8解码验证）
 * @param str 待检测的字符串
 * @returns boolean 是否为有效的base64编码
 */
export function checkBase64Strict(str: string): boolean {
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
    decoder.decode(uint8Array);

    return true;
  } catch (error) {
    return false;
  }
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
