import { defineConfig, mergeConfig } from "vite";
import baseConfig from "./vite.config";
import { debugMinify, debugSourcemap } from "./vite.debug";
import { codeSplittingGroups } from "./vite.chunks";

export default mergeConfig(baseConfig, {
  base: "./",
  build: {
    outDir: "dist-utools",
    // GOOSE_DEBUG=1 → true（独立 .map，sources 指向 src/）；正式 → 'hidden'
    sourcemap: debugSourcemap,
    // GOOSE_DEBUG=1 → false（不压缩，开发者工具直读源码）；正式 → 默认压缩
    minify: debugMinify,
    rollupOptions: {
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
        entryFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
    // Vite 8 底层是 rolldown：分包必须走 rolldown 原生 codeSplitting
    rolldownOptions: {
      output: {
        codeSplitting: { groups: codeSplittingGroups },
      },
    },
    chunkSizeWarningLimit: 1000,
    reportCompressedSize: false,
  },
});
