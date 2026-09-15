import type { IconTemplateItem } from './editorCatalog'

// 从内置模板 SVG 中提取预览图形，去掉外层 <svg> 后复用模板真实内容渲染缩略图。
export function getTemplatePreviewMarkup(template: IconTemplateItem) {
  const match = template.svg.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i)
  return match ? match[1] : template.svg
}
