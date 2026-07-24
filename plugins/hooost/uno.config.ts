import { defineConfig, presetAttributify, presetTypography, presetWind3 } from 'unocss'
import presetIcons from '@unocss/preset-icons'
import { FileSystemIconLoader } from '@iconify/utils/lib/loader/node-loaders'
import { fileURLToPath, URL } from 'node:url'

import transformerDirectives from '@unocss/transformer-directives'

export default defineConfig({
  // 扫描文件配置
  content: {
    filesystem: ['src/**/*.{vue,js,ts}'],
  },
  presets: [
    // 基础预设 - 提供所有基础工具类（包含 Tailwind CSS 兼容的类名）
    presetWind3(),

    // 属性化预设 - 允许在 HTML 属性中使用工具类
    presetAttributify(),

    // 排版预设 - 提供排版相关的工具类
    presetTypography(),

    // 图标预设
    presetIcons({
      collections: {
        // 自定义图标集合
        z: FileSystemIconLoader(
          fileURLToPath(new URL('./src/assets/icons', import.meta.url)),
          (svg: any) => {
            return svg
              .replace(/(<svg.*?fill=)"(?!none)(.*?)"/, '$1"currentColor"')
              .replace(/(<svg.*?stroke=)"(?!none)(.*?)"/, '$1"currentColor"')
          }
        ),
      },
      // 启用常用图标集合
      extraProperties: {
        display: 'inline-block',
        'vertical-align': 'middle',
      },
    }),
  ],
  transformers: [
    // @apply 支持
    transformerDirectives(),
  ],
  theme: {},
  // 快捷方式
  shortcuts: {},
})
