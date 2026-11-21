import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { blobOnlyEnglishWorkerPlugin } from "./scripts/vite/blobOnlyEnglishWorker";

export default defineConfig({
  plugins: [react(), blobOnlyEnglishWorkerPlugin()],
  base: "./",
  worker: {
    plugins: () => [blobOnlyEnglishWorkerPlugin()]
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false
  },
  server: {
    host: "127.0.0.1",
    port: 5189
  }
});
