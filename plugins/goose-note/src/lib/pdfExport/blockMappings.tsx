/**
 * PDF 导出 block mapping。
 *
 * 在 pdfDefaultSchemaMappings.blockMapping 之上覆盖项目自定义 block：
 *   - callout      —— 左侧色条 + 浅色背景 + emoji icon
 *   - file (自定义) —— 📎 + 文件名/链接
 *   - codeBlock    —— monospace 等宽字体；math/mermaid 语言走 fallback 文本渲染
 */

import type { Text } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { resolveCalloutIcon } from "@/components/editor/blocks/callout/calloutIcons";

const PIXELS_PER_POINT = 0.75;
const FONT_SIZE = 16;

/**
 * 用工厂返回 mapping。这样可以在内部 await dynamic-import @react-pdf/renderer
 * 与 @blocknote/xl-pdf-exporter 默认 mapping，避免在模块顶层引入。
 */
export async function createPdfBlockMappings() {
  const [{ View, Text, Link }, { pdfDefaultSchemaMappings }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("@blocknote/xl-pdf-exporter"),
  ]);

  const defaultBlockMapping = pdfDefaultSchemaMappings.blockMapping as Record<
    string,
    (...args: any[]) => any
  >;

  const monoFontSize = FONT_SIZE * PIXELS_PER_POINT;

  // ----- callout -----
  const calloutMapping = (block: any, exporter: any): ReactElement<typeof Text> => {
    const icon = resolveCalloutIcon(block.props?.icon as string | undefined);
    return (
      <View
        wrap={false}
        key={"callout" + block.id}
        style={{
          flexDirection: "row",
          gap: 8 * PIXELS_PER_POINT,
          paddingTop: 8 * PIXELS_PER_POINT,
          paddingBottom: 8 * PIXELS_PER_POINT,
          paddingLeft: 12 * PIXELS_PER_POINT,
          paddingRight: 12 * PIXELS_PER_POINT,
          borderLeftWidth: 3,
          borderLeftColor: "#888",
          backgroundColor: "#f5f5f5",
          borderTopRightRadius: 4,
          borderBottomRightRadius: 4,
        }}
      >
        <Text style={{ marginRight: 4 }}>{icon}</Text>
        <Text style={{ flex: 1 }}>{exporter.transformInlineContent(Array.isArray(block.content) ? block.content : [])}</Text>
      </View>
    ) as unknown as ReactElement<typeof Text>;
  };

  // ----- 自定义 file —— 委派给默认 mapping（默认实现已经渲染 file icon + name + link） -----
  const fileMapping = (block: any, exporter: any, nestingLevel: number) => {
    if (typeof defaultBlockMapping.file === "function") {
      // 项目的 customFileBlock 用了默认 file 的 propSchema（name/url/caption/...），结构兼容。
      return defaultBlockMapping.file(block, exporter, nestingLevel);
    }
    // 兜底：手写一个简单的 📎 + 文件名
    const name = (block.props?.name as string) || "未命名文件";
    const url = (block.props?.url as string) || "";
    return (
      <View
        wrap={false}
        key={"file" + block.id}
        style={{
          flexDirection: "row",
          gap: 6 * PIXELS_PER_POINT,
          padding: 6 * PIXELS_PER_POINT,
          backgroundColor: "#f5f5f5",
          borderRadius: 4,
        }}
      >
        <Text>📎</Text>
        {url ? (
          <Link src={url}>
            <Text>{name}</Text>
          </Link>
        ) : (
          <Text>{name}</Text>
        )}
      </View>
    ) as unknown as ReactElement<typeof Text>;
  };

  // ----- codeBlock —— math / mermaid 走 fallback，其他走默认 mono 渲染 -----
  const codeBlockMapping = (block: any, exporter: any, nestingLevel: number, numberedListIndex?: number, children?: any) => {
    const language = ((block.props?.language as string) || "").toLowerCase();
    const textContent = Array.isArray(block.content)
      ? (block.content as Array<{ text?: string }>).map((it) => it.text || "").join("")
      : "";

    if (language === "math" || language === "latex") {
      // 数学公式 fallback：原样展示 LaTeX 源码
      return (
        <View
          wrap={false}
          key={"math" + block.id}
          style={{
            padding: 12 * PIXELS_PER_POINT,
            backgroundColor: "#fafafa",
            borderRadius: 4,
            borderLeftWidth: 3,
            borderLeftColor: "#5b8def",
          }}
        >
          <Text style={{ fontSize: monoFontSize * 0.75, color: "#5b8def", marginBottom: 4 }}>
            ƒ Math
          </Text>
          <Text style={{ fontSize: monoFontSize }}>{textContent || " "}</Text>
        </View>
      ) as unknown as ReactElement<typeof Text>;
    }

    if (language === "mermaid") {
      return (
        <View
          wrap={false}
          key={"mermaid" + block.id}
          style={{
            padding: 12 * PIXELS_PER_POINT,
            backgroundColor: "#fafafa",
            borderRadius: 4,
            borderLeftWidth: 3,
            borderLeftColor: "#7aa874",
          }}
        >
          <Text style={{ fontSize: monoFontSize * 0.75, color: "#7aa874", marginBottom: 4 }}>
            📊 Mermaid
          </Text>
          <Text style={{ fontSize: monoFontSize }}>{textContent || " "}</Text>
        </View>
      ) as unknown as ReactElement<typeof Text>;
    }

    // 默认 codeBlock 渲染
    if (typeof defaultBlockMapping.codeBlock === "function") {
      return defaultBlockMapping.codeBlock(block, exporter, nestingLevel, numberedListIndex, children);
    }

    // 兜底
    return (
      <View
        wrap={false}
        key={"codeBlock" + block.id}
        style={{
          padding: 12 * PIXELS_PER_POINT,
          border: "1px solid #ddd",
          borderRadius: 4,
        }}
      >
        <Text style={{ fontSize: monoFontSize }}>{textContent}</Text>
      </View>
    ) as unknown as ReactElement<typeof Text>;
  };

  return {
    ...defaultBlockMapping,
    callout: calloutMapping,
    file: fileMapping,
    codeBlock: codeBlockMapping,
  };
}
