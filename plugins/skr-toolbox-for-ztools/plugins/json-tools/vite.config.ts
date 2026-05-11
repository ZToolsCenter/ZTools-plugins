import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import monacoEditorPlugin from "vite-plugin-monaco-editor-esm";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { VitePWA } from "vite-plugin-pwa";

const ReactCompilerConfig = {};
// https://vitejs.dev/config/

export default defineConfig({
  server: {
    host: "0.0.0.0", // 使用 '0.0.0.0' 允许从任何 IP 访问
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: "modern-compiler", // or 'modern'
      },
    },
  },
  base: "./",
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", ReactCompilerConfig]],
      },
    }),
    tsconfigPaths(),
    monacoEditorPlugin({
      languageWorkers: ["editorWorkerService", "json", "typescript"],
    }),
    nodePolyfills(),
    VitePWA({
      registerType: "prompt", // 改为 prompt，让我们自己控制更新
      strategies: "generateSW",
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "logo.png"],
      workbox: {
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024, // 20MB
        globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        cleanupOutdatedCaches: true, // 清理过期的缓存
        skipWaiting: false, // 不自动跳过等待
        clientsClaim: false, // 不自动控制所有客户端
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-cache",
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
            },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
            handler: "CacheFirst",
            options: {
              cacheName: "images-cache",
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
            },
          },
          {
            urlPattern: /\.(?:js|css)$/,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "static-resources",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true, // 在开发环境中启用 PWA
        type: "module",
      },
      manifest: {
        name: "JSON Tools - 多功能JSON处理助手",
        short_name: "JSON Tools",
        description: "强大的JSON工具集，支持格式化、验证、转换、编辑等多种功能",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        theme_color: "#f5f5f5",
        categories: ["productivity", "developer", "utilities"],
        handle_links: "auto",
        icons: [
          {
            src: "pwa-64x64.png",
            sizes: "64x64",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "maskable-icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
        shortcuts: [
          {
            name: "格式化 JSON",
            short_name: "格式化",
            description: "快速格式化 JSON 数据",
            url: "/?tool=format",
            icons: [
              {
                src: "pwa-96x96.png",
                sizes: "96x96",
              },
            ],
          },
        ],
      },
    }),
  ],
  optimizeDeps: {
    include: ["vanilla-jsoneditor-cn"],
  },
});
