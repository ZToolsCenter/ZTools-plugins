import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers';

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      imports: [
        'vue',
        {
          'naive-ui': ['useDialog', 'useMessage', 'useNotification', 'useLoadingBar'],
        },
      ],
    }),
    Components({
      resolvers: [NaiveUiResolver()],
    }),
  ],
  base: './',
  resolve: {
    alias: {
      '@': '/src',
    },
  },

  // ✅ Vite 8 正确移除 console 方式
  build: {
    minify: 'oxc', // 用 Vite 8 自带的 oxc 代替 esbuild
    treeShake: true,
  },

  // ✅ 移除 console.log（Vite 8 新标准）
  oxc: {
    transform: {
      react: {
        importSource: 'react',
      },
      // 👇 自动删除 console + debugger
      dropDebugger: true,
      dropConsole: true,
    },
  },
});
