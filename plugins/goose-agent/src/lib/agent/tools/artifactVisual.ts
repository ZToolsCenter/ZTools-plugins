/**
 * Artifact 视觉工具扩展：showHtml / generateImage；
 * 以及 showDiagram 的源码别名归一（source | mermaid | code）。
 */

import {
  getCustomAIBaseURL,
  getRequestCredential,
  resolveActiveProtocol,
} from "@/lib/ai-provider";
import { getCustomSelectedModelId } from "@/lib/ai-provider/modelCatalog";
import { isFsAvailable, writeFile } from "@/lib/fs";
import { assertCanWrite } from "../sandbox";
import type { AgentToolContext } from "./types";

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function sanitizeFilename(name: string, ext: string): string {
  const base = name
    .replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "");
  const trimmed = (base || "artifact").slice(0, 80);
  if (trimmed.toLowerCase().endsWith(`.${ext}`)) return trimmed;
  return `${trimmed}.${ext}`;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * 归一 showDiagram 入参：优先 source，兼容 mermaid / code。
 */
export function resolveDiagramSource(input: Record<string, unknown>): string {
  const candidates = [input.source, input.mermaid, input.code];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return "";
}

export async function executeShowDiagramNormalized(
  input: Record<string, unknown>,
): Promise<unknown> {
  const source = resolveDiagramSource(input);
  if (!source) {
    return {
      ok: false,
      error: "请提供 source（或 mermaid / code）Mermaid 源码",
    };
  }
  return {
    ok: true,
    kind: "diagram",
    title: input.title != null ? asString(input.title) : undefined,
    language: "mermaid" as const,
    source,
  };
}

/**
 * 在对话中展示 HTML Artifact（沙箱 iframe srcdoc + 下载）。
 */
export async function executeShowHtml(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<unknown> {
  const html =
    asString(input.html) ||
    asString(input.content) ||
    asString(input.source);
  if (!html.trim()) {
    return { ok: false, error: "请提供 html 内容" };
  }
  const title = input.title != null ? asString(input.title) : "HTML 预览";
  const filename = sanitizeFilename(
    asString(input.filename) || title || "preview",
    "html",
  );
  const savePath = asString(input.savePath) || asString(input.path) || undefined;

  let savedPath: string | undefined;
  let saveError: string | undefined;
  if (savePath?.trim()) {
    const resolved = assertCanWrite(
      ctx.permissionMode,
      ctx.workspaceRoot,
      savePath,
    );
    if (!resolved.ok) {
      saveError = resolved.message;
    } else if (!isFsAvailable()) {
      saveError = "本机文件桥不可用，无法保存到工作区";
    } else {
      // HTML 以 utf-8 文本写入
      const ok = await writeFile(resolved.absolutePath, html, "utf8");
      if (ok) savedPath = resolved.absolutePath;
      else saveError = "写入工作区失败";
    }
  }

  // 不把超大 HTML 再 base64 一份；UI 直接用 html 字段
  return {
    ok: true,
    kind: "html",
    title,
    filename,
    mimeType: "text/html;charset=utf-8",
    html,
    byteLength: new TextEncoder().encode(html).byteLength,
    savedPath,
    saveError,
  };
}

/**
 * Images API 端点能力缓存（进程内）。
 * - unsupported：404/405 后短路，避免重复打满日志与延迟
 * - supported：成功后标记，仅作观测
 * key = 规范化 baseURL（无尾斜杠）
 */
export type ImagesApiCapability = "supported" | "unsupported";

const imagesApiCapabilityCache = new Map<string, ImagesApiCapability>();

/** 规范化 Images 探测 key（导出供测试） */
export function imagesApiCacheKey(baseURL: string): string {
  return baseURL.replace(/\/+$/, "").toLowerCase();
}

export function getImagesApiCapability(
  baseURL: string,
): ImagesApiCapability | undefined {
  return imagesApiCapabilityCache.get(imagesApiCacheKey(baseURL));
}

export function setImagesApiCapability(
  baseURL: string,
  capability: ImagesApiCapability,
): void {
  imagesApiCapabilityCache.set(imagesApiCacheKey(baseURL), capability);
}

/** 仅测试用：清空缓存 */
export function clearImagesApiCapabilityCache(): void {
  imagesApiCapabilityCache.clear();
}

const IMAGES_UNSUPPORTED_MSG =
  "当前端点未暴露 Images API（/images/generations）。请切换到支持 OpenAI 兼容生图的供应商，或改用其它方式。";

/** OpenAI Images API 生成图（仅 openai 兼容协议且端点可用时） */
export async function executeGenerateImage(
  input: Record<string, unknown>,
  ctx: AgentToolContext,
): Promise<unknown> {
  const prompt = asString(input.prompt) || asString(input.text);
  if (!prompt.trim()) {
    return { ok: false, error: "请提供 prompt（图像描述）" };
  }

  const settings = ctx.aiSettings;
  if (!settings) {
    return {
      ok: false,
      error:
        "当前运行时未注入 AI 配置，无法调用生图接口。请确认模型与凭证已配置。",
    };
  }

  const protocol = resolveActiveProtocol(settings);
  // Images API 是 OpenAI 兼容 REST；Anthropic 不走此路径
  if (protocol === "claude") {
    return {
      ok: false,
      error:
        "当前协议为 Anthropic Claude，不支持 OpenAI Images API。请切换到 OpenAI 兼容端点后再试。",
    };
  }

  const token =
    getRequestCredential(settings, "openai")?.token ??
    getRequestCredential(settings)?.token ??
    "";
  if (!token) {
    return { ok: false, error: "未配置可用凭证，无法调用生图接口" };
  }

  // Images 通常挂在 /v1/images/generations；优先 openai baseURL
  let baseURL: string;
  try {
    baseURL = getCustomAIBaseURL(settings, "openai").replace(/\/+$/, "");
  } catch {
    try {
      baseURL = getCustomAIBaseURL(settings).replace(/\/+$/, "");
    } catch {
      return {
        ok: false,
        error: "无法解析 AI 端点 baseURL，请检查设置中的接口地址。",
      };
    }
  }

  // 负向缓存：同一端点已确认无 Images 时直接失败
  if (getImagesApiCapability(baseURL) === "unsupported") {
    return {
      ok: false,
      error: IMAGES_UNSUPPORTED_MSG,
      imagesApi: "unsupported" as const,
      baseURL,
    };
  }

  const sizeRaw = asString(input.size, "1024x1024");
  const size =
    sizeRaw === "256x256" ||
    sizeRaw === "512x512" ||
    sizeRaw === "1024x1024" ||
    sizeRaw === "1792x1024" ||
    sizeRaw === "1024x1792"
      ? sizeRaw
      : "1024x1024";

  const model =
    asString(input.model) ||
    getCustomSelectedModelId(settings) ||
    "dall-e-3";

  const title = input.title != null ? asString(input.title) : undefined;
  const filename = sanitizeFilename(
    asString(input.filename) || title || "image",
    "png",
  );

  const url = `${baseURL}/images/generations`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size,
        response_format: "b64_json",
      }),
      signal: ctx.signal,
    });

    if (!response.ok) {
      let detail = "";
      try {
        const j = (await response.json()) as {
          error?: { message?: string };
          message?: string;
        };
        detail = j.error?.message || j.message || "";
      } catch {
        detail = await response.text().catch(() => "");
      }
      if (response.status === 404 || response.status === 405) {
        setImagesApiCapability(baseURL, "unsupported");
        return {
          ok: false,
          error: `当前端点未暴露 Images API（${response.status}）。请确认供应商支持 /images/generations。${detail ? ` ${detail}` : ""}`,
          imagesApi: "unsupported" as const,
          baseURL,
        };
      }
      // 401/403 多为鉴权，不写负向缓存（换 key 后可再试）
      if (response.status === 401 || response.status === 403) {
        return {
          ok: false,
          error: `生图鉴权失败（${response.status}）${detail ? `：${detail}` : ""}。请检查 API Key 是否具备 Images 权限。`,
        };
      }
      return {
        ok: false,
        error: `生图失败（${response.status}）${detail ? `：${detail}` : ""}`,
      };
    }

    const json = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const first = json.data?.[0];
    let contentBase64 = first?.b64_json?.trim() || "";
    let remoteUrl = first?.url?.trim() || "";

    if (!contentBase64 && remoteUrl) {
      // 部分供应商只返回 URL
      try {
        const imgRes = await fetch(remoteUrl, { signal: ctx.signal });
        if (imgRes.ok) {
          const ab = await imgRes.arrayBuffer();
          contentBase64 = uint8ToBase64(new Uint8Array(ab));
        }
      } catch {
        // keep url
      }
    }

    if (!contentBase64 && !remoteUrl) {
      return { ok: false, error: "生图接口未返回图像数据" };
    }

    setImagesApiCapability(baseURL, "supported");

    const savePath = asString(input.savePath) || asString(input.path) || undefined;
    let savedPath: string | undefined;
    let saveError: string | undefined;
    if (savePath?.trim() && contentBase64) {
      const resolved = assertCanWrite(
        ctx.permissionMode,
        ctx.workspaceRoot,
        savePath,
      );
      if (!resolved.ok) saveError = resolved.message;
      else if (!isFsAvailable()) saveError = "本机文件桥不可用，无法保存到工作区";
      else {
        const ok = await writeFile(resolved.absolutePath, contentBase64, "base64");
        if (ok) savedPath = resolved.absolutePath;
        else saveError = "写入工作区失败";
      }
    }

    return {
      ok: true,
      kind: "image",
      title: title || prompt.slice(0, 40),
      filename,
      mimeType: "image/png",
      contentBase64: contentBase64 || undefined,
      url: remoteUrl || undefined,
      prompt,
      size,
      model,
      savedPath,
      saveError,
    };
  } catch (err) {
    if (ctx.signal?.aborted) {
      return { ok: false, error: "生图已取消" };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `生图请求失败：${msg}。若供应商未实现 Images API，请改用其它模型端点。`,
    };
  }
}
