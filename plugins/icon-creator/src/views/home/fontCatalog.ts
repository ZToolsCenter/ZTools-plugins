/**
 * 文本字体目录：属性面板「文本」区的字体下拉选项与新建文本的默认字体。
 * fontFamily 直接使用系统字体名（不做 webfont 加载），实际渲染取决于查看端
 * 系统安装情况，跨设备可能回退到相近字体；发布图标建议先文字转曲固化字形。
 */

/** 新建文本对象的默认字体（Windows 覆盖率高、中文显示友好的系统字体）。 */
export const DEFAULT_TEXT_FONT_FAMILY = 'Microsoft YaHei'

/** 属性面板字体下拉的选项类型（与 ZSelect options 结构一致）。 */
export interface FontFamilyOption {
  label: string
  value: string
}

/** 常见系统字体清单：中文字体在前、英文字体在后，value 即写入 fabric 的 fontFamily 字符串。 */
export const FONT_FAMILY_OPTIONS: FontFamilyOption[] = [
  { label: '思源黑体', value: 'Source Han Sans SC' },
  { label: '微软雅黑', value: 'Microsoft YaHei' },
  { label: '苹方', value: 'PingFang SC' },
  { label: '黑体', value: 'SimHei' },
  { label: '宋体', value: 'SimSun' },
  { label: '楷体', value: 'KaiTi' },
  { label: 'Arial', value: 'Arial' },
  { label: 'Helvetica', value: 'Helvetica' },
  { label: 'Times New Roman', value: 'Times New Roman' },
  { label: 'Courier New', value: 'Courier New' },
  { label: 'Verdana', value: 'Verdana' },
  { label: 'Georgia', value: 'Georgia' },
  { label: 'Impact', value: 'Impact' },
  { label: 'Comic Sans MS', value: 'Comic Sans MS' },
  { label: 'Inter', value: 'Inter' },
  { label: 'Roboto', value: 'Roboto' }
]
