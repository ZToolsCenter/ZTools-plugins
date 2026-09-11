/**
 * 把 @blocknote/xl-pdf-exporter 动态 import 的 Inter_18pt / GeistMono
 * 字体 chunk alias 到本模块，避免约 1.8MB TTF 打进 dist。
 *
 * 动态 import 必须能成功（default 导出 data URL）。拉丁字形改由
 * 导出时远程加载的 Noto Sans SC 覆盖；本 stub 不会被打进真正字体。
 */
const EMPTY_FONT_DATA_URL = "data:font/ttf;base64,AA==";

export default EMPTY_FONT_DATA_URL;
