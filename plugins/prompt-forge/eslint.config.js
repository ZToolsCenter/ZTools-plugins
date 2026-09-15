import tsParser from '@typescript-eslint/parser'
import tseslint from '@typescript-eslint/eslint-plugin'
import vue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

const typescriptRules = {
  ...tseslint.configs.recommended.rules,
  '@typescript-eslint/no-explicit-any': 'off',
}

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: typescriptRules,
  },
  {
    files: ['src/**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: 'latest',
        extraFileExtensions: ['.vue'],
        sourceType: 'module',
      },
    },
    plugins: { '@typescript-eslint': tseslint, vue },
    rules: {
      ...typescriptRules,
      ...vue.configs['flat/recommended'].rules,
      'vue/multi-word-component-names': 'off',
    },
  },
]
