// 转义 SVG 属性值中的特殊字符，供手工插入背景 rect 时保持 XML 合法。
export function svgEscapeText(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// 清理 Fabric 原始 SVG 中对最终图标交付没有帮助的注释、空属性和内部标识。
export function stripFabricSVGNoise(svg: string) {
  return svg
    .replace(/<\?xml[\s\S]*?\?>\s*/i, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s*(?:data-fabric|data-original|vector-effect)="[^"]*"/gi, '')
    .replace(/\s*(?:id|name)="(?:Layer|图层|对象|SVG 元素|editor-object)[^"]*"/gi, '')
    .replace(/\s+style="\s*"/gi, '')
    .replace(/\s+stroke-dasharray="(?:none|null|undefined|)"/gi, '')
    .replace(/\s+font-family="Times New Roman"/gi, '')
}

// 压缩标签间空白和重复空格，降低 SVG 体积但不改写路径或颜色数据。
export function trimSVGWhitespace(svg: string) {
  return svg
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+>/g, '>')
    .trim()
}

// 重建标准 SVG 根节点，确保导出资源始终带有规范 viewBox、宽高和可选背景层。
export function ensureOptimizedSVGRoot(svg: string, width: number, height: number, backgroundMarkup = '') {
  const bodyMatch = svg.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i)
  const body = bodyMatch ? bodyMatch[2] : svg
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${backgroundMarkup}${body}</svg>`
}
