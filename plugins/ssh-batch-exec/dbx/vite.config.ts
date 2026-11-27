import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  // DBX 工作台以静态文件方式加载，所有资源必须使用相对路径。
  base: "./",
  plugins: [vue()],
  build: {
    outDir: "ui",
    emptyOutDir: true,
  },
});
