import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({ base: './', plugins: [vue()], build: { target: 'chrome110', sourcemap: false, emptyOutDir: true, manifest: true } });
