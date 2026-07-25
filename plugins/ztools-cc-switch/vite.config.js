import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  base: './',
  plugins: [
    vue(),
    viteStaticCopy({
      targets: [
        { src: 'plugin.json', dest: '.' },
        { src: 'logo.svg', dest: '.' },
        { src: 'README.md', dest: '.' },
        { src: 'LICENSE', dest: '.' },
        { src: 'THIRD_PARTY_NOTICES.md', dest: '.' },
        { src: 'public/default-rules.json', dest: '.' },
        { src: 'preload/*.js', dest: 'preload' },
        { src: 'preload/bin/**/*', dest: 'preload/bin' },
        // ZTools runs preload as readable CommonJS. Keep its production Node
        // dependencies beside preload instead of bundling or relying on the host.
        { src: 'preload/node_modules', dest: 'preload' },
        { src: 'preload/package.json', dest: 'preload' },
        { src: 'preload/package-lock.json', dest: 'preload' },
        { src: 'rust-sidecar/Cargo.toml', dest: 'rust-sidecar' },
        { src: 'rust-sidecar/Cargo.lock', dest: 'rust-sidecar' },
        { src: 'rust-sidecar/src/main.rs', dest: 'rust-sidecar/src' }
      ]
    })
  ],
  server: {
    port: 5179,
    strictPort: true
  }
})
