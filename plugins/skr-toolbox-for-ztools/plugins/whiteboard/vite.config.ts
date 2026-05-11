import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

// https://vitejs.dev/config/
export default defineConfig({
	base: './',
	plugins: [tsconfigPaths(), react()],
	server: {
		open: true,
		port: 5178,
	},
	optimizeDeps: { exclude: ['@tldraw/assets'] },
})
