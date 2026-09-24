import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    vue(),
    ...(mode === 'test' ? [] : [nodePolyfills({
      include: ['buffer', 'process', 'util', 'stream', 'events', 'http', 'https', 'url', 'querystring', 'zlib', 'crypto', 'punycode', 'string_decoder', 'path', 'fs', 'os', 'net', 'tls', 'dgram', 'domain', 'assert', 'constants', 'timers', 'console', 'vm', 'repl', 'readline', 'tty', 'dns', 'module', 'child_process', 'perf_hooks']
    })])
  ],
  base: './',
  server: {
    port: 5180
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/]
    },
    rollupOptions: {
      output: {
        assetFileNames: '[name].[ext]',
        chunkFileNames: '[name].js',
        entryFileNames: '[name].js',
        manualChunks: undefined
      }
    }
  }
}))
