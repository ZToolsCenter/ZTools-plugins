import {fileURLToPath, URL} from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

import {defineConfig} from 'vite'
import vue from '@vitejs/plugin-vue'
import copy from 'rollup-plugin-copy';

// 删除指定目录的函数
function removeDirectory(dirPath) {
    if (fs.existsSync(dirPath)) {
        fs.rmSync(dirPath, { recursive: true, force: true });
        console.log(`已删除目录: ${dirPath}`);
    }
}

// https://vite.dev/config/
export default defineConfig({
    plugins: [
        vue(),
        copy({
            targets: [
                {src: 'logo.png', dest: 'dist/'},
                {src: 'preload.js', dest: 'dist/'},
                {src: 'plugin.json', dest: 'dist/'},
                {src: 'src/release_npm/node_modules', dest: 'dist/'},
            ],
            hook: 'writeBundle' // 指定在哪个生命周期钩子上执行复制操作
        }),
        {
            name: 'remove-unused-modules',
            closeBundle() {
                const dirsToRemove = [
                    path.resolve(__dirname, 'dist/node_modules/cpu-features'),
                    path.resolve(__dirname, 'dist/node_modules/nan')
                ];
                
                dirsToRemove.forEach(dir => removeDirectory(dir));
            }
        }
    ],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url))
        }
    },
    base: './',

    css: {
        preprocessorOptions: {
            scss: {
                api: "modern-compiler"
            }
        }
    }
})
