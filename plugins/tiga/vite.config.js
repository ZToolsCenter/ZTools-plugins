import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // 自动导入 Element Plus 的 API（如 ElMessage、ElMessageBox）
    AutoImport({
      resolvers: [ElementPlusResolver()],
    }),
    // 自动按需注册 Element Plus 组件（如 <el-button>、<el-card>）
    Components({
      resolvers: [ElementPlusResolver()],
    }),
  ],
  base: './'
})
