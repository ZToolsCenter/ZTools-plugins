import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: 'preload/index.ts',
      formats: ['cjs'],
      fileName: () => 'preload.cjs',
    },
    outDir: 'dist',
    rollupOptions: {
      external: ['electron'],
    },
  },
});
