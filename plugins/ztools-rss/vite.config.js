import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 构建时剥离 plugin.json 的 development 字段
// development.main 指向 dev server，仅用于 npm run dev；打包产物不应携带
function stripDevConfig() {
  return {
    name: 'strip-plugin-dev-config',
    closeBundle() {
      const file = resolve(__dirname, 'dist/plugin.json')
      try {
        const json = JSON.parse(readFileSync(file, 'utf-8'))
        if (json.development) {
          delete json.development
          writeFileSync(file, JSON.stringify(json, null, 2), 'utf-8')
        }
      } catch (_) {
        /* ignore */
      }
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), stripDevConfig()],
  base: './'
})
