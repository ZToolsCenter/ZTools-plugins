import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: false,
    target: "node18",
    lib: {
      entry: fileURLToPath(new URL("./preload/index.ts", import.meta.url)),
      formats: ["cjs"],
      fileName: () => "preload.js",
    },
    outDir: "dist",
    rollupOptions: {
      external: [/^node:/],
      output: {
        exports: "none",
        inlineDynamicImports: true,
      },
    },
  },
});
