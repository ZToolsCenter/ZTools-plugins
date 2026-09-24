import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  base: './', // 使用相对路径
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    minify: true,
    sourcemap: false,
    target: 'es2015', // 确保兼容性
    cssTarget: 'chrome61', // CSS 兼容性
    rollupOptions: {
      external: ['remixicon/fonts/remixicon.woff2', 'remixicon/fonts/remixicon.woff', 'remixicon/fonts/remixicon.ttf', 'remixicon/fonts/remixicon.eot'],
      input: {
        main: resolve(__dirname, 'index.html')
      },
      output: {
        // 确保生成的文件名不包含 hash，ZTools 需要固定文件名
        chunkFileNames: 'assets/js/[name].js',
        entryFileNames: 'assets/js/[name].js',
        assetFileNames: ({name}) => {
          if (/\.(gif|jpe?g|png|svg)$/.test(name ?? '')) {
            return 'assets/images/[name][extname]';
          }
          if (/\.css$/.test(name ?? '')) {
            return 'assets/css/[name][extname]';
          }
          if (/\.(woff2?|eot|ttf|otf)$/.test(name ?? '')) {
            return 'assets/fonts/[name][extname]';
          }
          return 'assets/[name][extname]';
        }
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  server: {
    proxy: {
      '/api/baidu': {
        target: 'https://image.baidu.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/baidu/, '')
      },
      '/api.btstu.cn': {
        target: 'https://api.btstu.cn',
        changeOrigin: true,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      },
      '/fabiaoqing': {
        target: 'https://fabiaoqing.com',
        changeOrigin: true,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      },
      '/doutu': {
        target: 'https://www.doutula.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/doutu/, '')
      },
      '/api/doutu': {
        target: 'https://doutu.lccyy.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/doutu/, '/doutu/items'),
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      },
      '/api/video': {
        target: 'http://api.mmp.cc',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/video/, '/api'),
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      },
    }
  },
  experimental: {
    renderBuiltUrl(filename, { hostType }) {
      return './' + filename; // 确保所有URL都使用相对路径
    }
  }
})