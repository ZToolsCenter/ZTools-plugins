import { config as defaultConfig } from '@epic-web/config/eslint'
import jsxA11y from 'eslint-plugin-jsx-a11y'

/** @type {import("eslint").Linter.Config} */
export default [
	...defaultConfig,
	jsxA11y.flatConfigs.recommended,
	{
		ignores: ['src/routeTree.gen.ts'],
	},
]
