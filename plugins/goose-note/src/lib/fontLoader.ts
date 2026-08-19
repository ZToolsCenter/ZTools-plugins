import type { CustomFonts } from "@/stores/useSettings";

export const DEFAULT_FONT_NAMES = {
  default: "Inter",
  serif: "仓耳今楷",
  mono: "DM Mono",
} as const;

const REMOTE_FONT_SOURCES = {
  "HarmonyOS Sans SC":
    "https://cdn.jsdelivr.net/gh/eachann1024/Resources@d6dc229cd882dc0983dc5ce7cf28fb85047a4a76/%E9%B8%BF%E8%92%99%E9%BB%91%E4%BD%93-HarmonyOS%20Sans%20SC.woff2",
  仓耳今楷:
    "https://cdn.jsdelivr.net/gh/eachann1024/Resources@d6dc229cd882dc0983dc5ce7cf28fb85047a4a76/%E4%BB%93%E8%80%B3%E4%BB%8A%E6%A5%B703W04.woff2",
} as const;

const FONT_CACHE_NAME = "goose-note-fonts-v1";
const persistentFontLoads = new Map<string, Promise<boolean>>();

const trimFontName = (font: string) =>
  font.trim().replace(/^["']+|["']+$/g, "");

const splitFontList = (font: string | null | undefined) =>
  font ? font.split(",").map(trimFontName).filter(Boolean) : [];

const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
  "inherit",
  "initial",
  "unset",
]);

const formatFontFamily = (family: string) => {
  const trimmed = trimFontName(family);
  if (!trimmed) return null;
  if (GENERIC_FAMILIES.has(trimmed)) return trimmed;
  return `"${trimmed}"`;
};

const normalizeFontList = (families: string[]) =>
  Array.from(
    new Set(
      families
        .map(formatFontFamily)
        .filter((value): value is string => Boolean(value)),
    ),
  );

const buildFontStack = (
  customList: string[],
  defaultFont: string,
  baseFallbacks: string[],
  platformFallbacks: string[],
  generic: string,
) =>
  joinFonts(
    normalizeFontList([
      ...(customList.length ? customList : [defaultFont]),
      ...baseFallbacks,
      ...platformFallbacks,
      generic,
    ]),
  );

const getPlatformFallbacks = () => {
  const platform =
    typeof navigator !== "undefined" ? navigator.platform || "" : "";
  const isMac = /Mac|iPod|iPhone|iPad/.test(platform);
  const isWin = /Win/.test(platform);

  if (isMac) {
    return {
      ui: ["-apple-system", "BlinkMacSystemFont", '"Helvetica Neue"', "Arial"],
      serif: ["Georgia", "Times"],
      mono: ["Menlo", "Monaco"],
    };
  }

  if (isWin) {
    return {
      ui: ['"Segoe UI"', "Roboto", '"Helvetica Neue"', "Arial"],
      serif: ['"Times New Roman"', "Georgia", "Times"],
      mono: ["Consolas", '"Liberation Mono"', '"Courier New"'],
    };
  }

  return {
    ui: ["Roboto", '"Helvetica Neue"', "Arial"],
    serif: ["Georgia", "Times"],
    mono: ['"Liberation Mono"', '"Courier New"'],
  };
};

const joinFonts = (fonts: string[]) => fonts.filter(Boolean).join(", ");

/**
 * 应用启动时调用，后台静默预加载远程字体
 * 浏览器会自动缓存，下次访问秒加载
 */
export function preloadFonts() {
  if (typeof document === "undefined") return;
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "font";
  link.type = "font/woff2";
  link.href = REMOTE_FONT_SOURCES["HarmonyOS Sans SC"];
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);

  // 大体积仓耳今楷不走 link preload，否则每次打开都会再触发一次 CDN 匹配。
  void ensurePersistentRemoteFont(DEFAULT_FONT_NAMES.serif);
}

const openFontCache = async () => {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.open(FONT_CACHE_NAME);
  } catch (error) {
    console.warn("[fontLoader] 持久字体缓存不可用，回退浏览器缓存", error);
    return null;
  }
};

const fetchFontResponse = async (url: string, bypassCache = false) => {
  const cache = await openFontCache();
  if (!bypassCache && cache) {
    const cached = await cache.match(url);
    if (cached) return { response: cached, cache, fromPersistentCache: true };
  }

  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`字体下载失败 (${response.status})`);
  }
  if (cache) {
    try {
      await cache.put(url, response.clone());
    } catch (error) {
      console.warn("[fontLoader] 字体写入持久缓存失败", error);
    }
  }
  return { response, cache, fromPersistentCache: false };
};

const installRemoteFont = async (
  family: keyof typeof REMOTE_FONT_SOURCES,
  url: string,
  bypassCache = false,
) => {
  const { response, cache, fromPersistentCache } = await fetchFontResponse(
    url,
    bypassCache,
  );
  try {
    const face = new FontFace(family, await response.arrayBuffer(), {
      style: "normal",
      weight: "400",
    });
    await face.load();
    document.fonts.add(face);
    return true;
  } catch (error) {
    // 缓存项被截断或损坏时只清理该字体，重新拉取一次。
    if (fromPersistentCache && cache && !bypassCache) {
      await cache.delete(url).catch(() => false);
      return installRemoteFont(family, url, true);
    }
    throw error;
  }
};

/**
 * 将大体积远程字体写入 Cache Storage，再从持久字节安装 FontFace。
 * 同一进程内并发请求会复用同一 Promise，不会重复下载或解码。
 */
export function ensurePersistentRemoteFont(
  family: keyof typeof REMOTE_FONT_SOURCES,
) {
  if (
    typeof document === "undefined" ||
    typeof FontFace === "undefined" ||
    !("fonts" in document)
  ) {
    return Promise.resolve(false);
  }

  const existing = persistentFontLoads.get(family);
  if (existing) return existing;

  const load = installRemoteFont(family, REMOTE_FONT_SOURCES[family]).catch(
    (error) => {
      // 系统本地 @font-face 仍作为最后兜底：缓存 API 或 CDN 异常不应阻止工作区打开。
      console.warn(`[fontLoader] ${family} 持久加载失败`, error);
      persistentFontLoads.delete(family);
      return false;
    },
  );
  persistentFontLoads.set(family, load);
  return load;
}

/** 在选中内置仓耳今楷的页面首帧前备好字体。 */
export async function ensureEditorFontAvailable(
  fontFamily: "default" | "serif" | "mono" | undefined,
  customFonts: CustomFonts,
) {
  if (fontFamily !== "serif") return;

  const serifFamilies = splitFontList(customFonts.serif.font);
  const usesBuiltInSerif =
    serifFamilies.length === 0 ||
    serifFamilies.includes(DEFAULT_FONT_NAMES.serif);
  if (usesBuiltInSerif) {
    await ensurePersistentRemoteFont(DEFAULT_FONT_NAMES.serif);
    return;
  }

  // 用户填写的系统字体不需要进入网络缓存，但仍等它完成匹配再切换。
  await waitForFonts(serifFamilies);
}

export function applyFontVariables(customFonts: CustomFonts) {
  if (typeof document === "undefined") return;
  const fallbacks = getPlatformFallbacks();
  const root = document.documentElement;
  const customDefaultList = splitFontList(customFonts.default.font);
  const customSerifList = splitFontList(customFonts.serif.font);
  const customMonoList = splitFontList(customFonts.mono.font);

  root.style.setProperty(
    "--font-default",
    buildFontStack(
      customDefaultList,
      DEFAULT_FONT_NAMES.default,
      ["Inter", "HarmonyOS Sans SC"],
      fallbacks.ui,
      "sans-serif",
    ),
  );
  root.style.setProperty(
    "--font-serif",
    buildFontStack(
      customSerifList,
      DEFAULT_FONT_NAMES.serif,
      ["仓耳今楷", "Cambria"],
      fallbacks.serif,
      "serif",
    ),
  );
  root.style.setProperty(
    "--font-mono",
    buildFontStack(
      customMonoList,
      DEFAULT_FONT_NAMES.mono,
      ["DM Mono"],
      fallbacks.mono,
      "monospace",
    ),
  );
}

export function getEditorFontFamilies(
  fontFamily: "default" | "serif" | "mono" | undefined,
  customFonts: CustomFonts,
) {
  const targetType = fontFamily ?? "default";
  const targetFontMap = {
    default: customFonts.default.font || DEFAULT_FONT_NAMES.default,
    serif: customFonts.serif.font || DEFAULT_FONT_NAMES.serif,
    mono: customFonts.mono.font || DEFAULT_FONT_NAMES.mono,
  };
  const fallbackMap = {
    default: ["Inter", "HarmonyOS Sans SC"],
    serif: ["仓耳今楷"],
    mono: ["DM Mono"],
  };

  const families = [
    ...splitFontList(targetFontMap[targetType]),
    ...fallbackMap[targetType],
  ];

  return Array.from(new Set(families));
}

export async function waitForFonts(families: string[]) {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  const uniqueFamilies = Array.from(new Set(families))
    .map(trimFontName)
    .filter(Boolean);
  if (!uniqueFamilies.length) return;

  await Promise.allSettled(
    uniqueFamilies.map((family) => document.fonts.load(`1em "${family}"`)),
  );
}
