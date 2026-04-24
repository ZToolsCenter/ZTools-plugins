import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { copyFileSync } from 'fs'
import { resolve } from 'path'

// 构建完成后把 README.md 复制到 dist/
function copyReadme() {
  return {
    name: 'copy-readme',
    closeBundle() {
      copyFileSync(
        resolve(__dirname, 'README.md'),
        resolve(__dirname, 'dist/README.md')
      )
    }
  }
}

export default defineConfig({
  plugins: [react(), copyReadme()],
  base: './'
})
