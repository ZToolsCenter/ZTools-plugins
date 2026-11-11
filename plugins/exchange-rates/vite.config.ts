import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";

function emitDistPluginJson(): Plugin {
  return {
    name: "emit-dist-plugin-json",
    closeBundle() {
      const source = JSON.parse(readFileSync(resolve("plugin.json"), "utf8")) as Record<string, unknown>;
      const dist = {
        ...source,
        main: "index.html",
        logo: "logo.png",
        preload: "preload.js",
      };
      mkdirSync(resolve("dist"), { recursive: true });
      writeFileSync(resolve("dist/plugin.json"), JSON.stringify(dist, null, 2));
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [vue(), emitDistPluginJson()],
});
