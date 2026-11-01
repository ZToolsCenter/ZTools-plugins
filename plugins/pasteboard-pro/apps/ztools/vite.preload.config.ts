import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: false,
    minify: false,
    target: "node18",
    lib: {
      entry: {
        preload: fileURLToPath(new URL("./preload/index.ts", import.meta.url)),
        "history-worker": fileURLToPath(new URL("./preload/history-worker.ts", import.meta.url)),
        "content-scan-worker": fileURLToPath(new URL("./preload/content-scan-worker.ts", import.meta.url)),
      },
      formats: ["cjs"],
      fileName: (_format, name) => name === "preload" ? "preload.js" : `${name}.cjs`,
    },
    outDir: "dist",
    rollupOptions: {
      external: [/^node:/],
      output: {
        exports: "none",
        chunkFileNames: "chunks/[name]-[hash].cjs",
      },
    },
  },
});
