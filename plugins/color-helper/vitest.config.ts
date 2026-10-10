import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // utils/platform.ts 在模块顶层读 window.platform, node 环境会直接抛
    // "window is not defined" —— 这里提供 DOM 与 localStorage
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
  },
});
