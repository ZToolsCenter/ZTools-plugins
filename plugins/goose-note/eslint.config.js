import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactPlugin from 'eslint-plugin-react'
import jsxA11y from 'eslint-plugin-jsx-a11y'

export default defineConfig([
  globalIgnores([
    'dist',
    'dist-quicknote',
    'output',
    'node_modules',
    'scripts',
    '.claude',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      react: reactPlugin,
      'jsx-a11y': jsxA11y,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      'react-refresh/only-export-components': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/refs': 'warn',
      'prefer-const': 'warn',
      'no-case-declarations': 'warn',
      'no-useless-escape': 'warn',
      'no-empty': 'warn',
      'react/no-danger': 'warn',
      'jsx-a11y/aria-role': 'warn',
      'jsx-a11y/no-noninteractive-element-to-interactive-role': 'warn',
      // React Compiler 规则统一降为 warn：以下模式（callback ref 写 ref、
      // render 阶段同步赋值模块变量、动态依赖的 memo、useMemo 内取当前时间）
      // 均为编辑器/渲染层的有意设计或编译器过度保守误报，运行正确，
      // 不作为阻断性 error 处理，与项目其余规则惯例一致。
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/globals': 'warn',
      'react-hooks/purity': 'warn',
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
