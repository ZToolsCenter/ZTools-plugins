const MERMAID_FONT =
  '"Noto Sans SC","PingFang SC","Hiragino Sans GB","Microsoft YaHei",Arial,sans-serif';

export async function renderMermaidSvgForExport(
  source: string,
  mode: "light" | "dark",
) {
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    theme: mode === "dark" ? "dark" : "default",
    securityLevel: "strict",
    fontFamily: MERMAID_FONT,
    suppressErrorRendering: true,
  });
  const id = `mermaid-native-${crypto.randomUUID()}`;
  const { svg } = await mermaid.render(id, source);
  return svg;
}
