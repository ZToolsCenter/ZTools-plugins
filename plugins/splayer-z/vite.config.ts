import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';
import AutoImport from 'unplugin-auto-import/vite';
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers';
import Components from 'unplugin-vue-components/vite';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';

// 主项目路径
const electronRoot = resolve(__dirname, 'SPlayer');
const electronSrc = resolve(electronRoot, 'src');
const electronPublic = resolve(electronRoot, 'public');

// Fastify 服务器插件（用于开发模式）
function fastifyServerPlugin(): Plugin {
  let server: any = null;

  const stopServer = async () => {
    if (server) {
      try {
        await server.close();
        server = null;
        console.log('🛑 Fastify API server stopped');
      } catch (error) {
        console.error('❌ Error stopping Fastify server:', error);
      }
    }
  };

  const startServer = async () => {
    // 先停止旧服务器
    await stopServer();

    try {
      // 动态导入 Fastify 和网易云音乐 API
      const fastify = (await import('fastify')).default;
      const NeteaseCloudMusicApiModule = await import('@neteasecloudmusicapienhanced/api');
      const NeteaseCloudMusicApi = NeteaseCloudMusicApiModule.default || NeteaseCloudMusicApiModule;
      const cookie = await import('@fastify/cookie');
      const multipart = await import('@fastify/multipart');
      
      console.log('📦 NeteaseCloudMusicApi keys:', Object.keys(NeteaseCloudMusicApi).length);

      server = fastify({
        logger: false,
        trustProxy: true,
      });

      // 注册插件
      await server.register(cookie.default);
      await server.register(multipart.default);

      // CORS 支持
      server.addHook('onRequest', async (request: any, reply: any) => {
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
        reply.header('Access-Control-Allow-Headers', '*');
        if (request.method === 'OPTIONS') {
          reply.code(200).send();
        }
      });

      // 注册所有网易云音乐 API
      let registeredCount = 0;
      Object.entries(NeteaseCloudMusicApi).forEach(([name, handler]) => {
        // 跳过非函数的导出
        if (typeof handler !== 'function') return;
        
        const snakeCaseName = name.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
        const route1 = `/api/netease/${snakeCaseName}`;
        const route2 = `/api/netease/${snakeCaseName.replace(/_/g, '/')}`;

        const handleRequest = async (req: any, reply: any) => {
          try {
            const params = {
              ...req.query,
              ...req.body,
            };

            // 处理 cookie 参数
            if (params.cookie) {
              // cookie 参数已经在 query 中,需要解码
              try {
                params.cookie = decodeURIComponent(params.cookie);
              } catch (e) {
                // 如果解码失败,保持原样
              }
            } else if (req.cookies && Object.keys(req.cookies).length > 0) {
              params.cookie = req.cookies;
            }

            const result = await (handler as any)(params);
            reply.send(result.body);
          } catch (error: any) {
            console.error(`❌ API error [${name}]:`, error.message);
            reply.code(500).send({
              code: 500,
              error: error.message
            });
          }
        };

        server.all(route1, handleRequest);
        if (route1 !== route2) {
          server.all(route2, handleRequest);
        }
        registeredCount++;
      });
      
      console.log(`✅ Registered ${registeredCount} API routes`);

      // 健康检查
      server.get('/health', async () => ({ status: 'ok', service: 'SPlayer API (Dev)' }));

      // 启动服务器
      await server.listen({
        port: 36524,
        host: '127.0.0.1'
      });
      console.log('✅ Fastify API server started: http://127.0.0.1:36524');
    } catch (error) {
      console.error('❌ Failed to start Fastify server:', error);
      server = null;
    }
  };

  return {
    name: 'vite-plugin-fastify-server',
    async configureServer(viteServer) {
      // 如果服务器已经在运行,先停止它
      if (server) {
        console.log('🔄 Stopping existing Fastify server before restart...');
        await stopServer();
      }
      
      await startServer();

      // 监听 Vite 服务器关闭事件
      viteServer.httpServer?.on('close', stopServer);
    },
    async closeBundle() {
      // 构建结束时停止服务器
      await stopServer();
    }
  };
}

// 修复图片路径插件
function fixImagePathPlugin(): Plugin {
  return {
    name: 'fix-image-path',
    enforce: 'post',
    generateBundle(_, bundle) {
      // 遍历所有生成的文件
      for (const fileName in bundle) {
        const file = bundle[fileName];
        if (file.type === 'chunk' && fileName.endsWith('.js')) {
          // 替换 /images/ 为 ./images/
          file.code = file.code.replace(/["']\/images\//g, (match) => {
            return match.replace('/images/', './images/');
          });
        }
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [
    vue(),
    wasm(),
    fastifyServerPlugin(),
    fixImagePathPlugin(),
    AutoImport({
      imports: [
        'vue',
        'vue-router',
        '@vueuse/core',
        {
          'naive-ui': ['useDialog', 'useMessage', 'useNotification', 'useLoadingBar'],
        },
      ],
      dts: 'src/auto-imports.d.ts',
    }),
    Components({
      resolvers: [NaiveUiResolver()],
      dts: 'src/components.d.ts',
      dirs: [
        resolve(electronSrc, 'components'),
        'src/components',
      ],
    }),
  ],
  
  resolve: {
    alias: {
      '@': electronSrc,
      '@shared': resolve(electronSrc, 'types/shared.ts'),
      '@plugin': resolve(__dirname, 'src'),
      'lodash': 'lodash-es',
    },
    // 确保依赖去重，避免多个版本
    dedupe: ['vue', '@vueuse/core', '@vueuse/shared', 'pinia', 'naive-ui'],
  },
  
  css: {
    preprocessorOptions: {
      scss: {
        silenceDeprecations: ['legacy-js-api'],
      },
    },
  },
  
  // Tree Shaking 关键：定义构建时常量
  define: {
    __ZTOOLS__: true,
    __ELECTRON__: false,
  },
  
  // 优化依赖配置
  optimizeDeps: {
    exclude: [
      // 只排除 Electron 相关包（这些包在浏览器环境不可用）
      'electron',
      '@electron-toolkit/preload',
      '@electron-toolkit/utils',
      'electron-store',
      'electron-updater',
    ],
  },
  
  build: {
    outDir: 'dist',
    emptyOutDir: true, // 清空输出目录
    minify: 'terser',
    terserOptions: {
      compress: {
        dead_code: true,
        drop_debugger: true,
      },
    },
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
      },
      // 外部化 Electron 特定的包（只在构建时需要）
      external: [
        'electron',
        '@electron-toolkit/preload',
        '@electron-toolkit/utils',
        'electron-store',
        'electron-updater',
      ],
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('naive-ui')) return 'naive-ui';
            if (id.includes('vue')) return 'vue';
            if (id.includes('@vueuse')) return 'vueuse';
            if (id.includes('pinia')) return 'pinia';
            return 'vendor';
          }
          if (id.includes('SPlayer/src')) {
            return 'splayer-core';
          }
        },
      },
    },
  },
  
  server: {
    port: 5173,
    fs: {
      // 允许访问 SPlayer 的 node_modules
      allow: ['..'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:36524',
        changeOrigin: true,
      },
    },
  },
  
  publicDir: resolve(__dirname, 'public'), // 使用 ztools-plugin 自己的 public 目录
});
