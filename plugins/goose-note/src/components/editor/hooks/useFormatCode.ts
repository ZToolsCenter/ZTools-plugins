import { useState, useCallback } from 'react'
import type { Options, Plugin } from 'prettier'

export function useFormatCode() {
  const [isLoading, setIsLoading] = useState(false)

  const format = useCallback(async (code: string, language: string) => {
    setIsLoading(true)
    try {
      // Dynamic imports from prettier/standalone and plugins
      // Note: We need to use 'default' for ESM imports if they are default exports, 
      // but prettier plugins often export `parsers` or `options` as named exports or default.
      // Prettier 3 standalone API requires passing plugins array.
      
      const prettier = await import('prettier/standalone')
      const estreePlugin = await import('prettier/plugins/estree')
      
      let parser = ''
      const plugins: Plugin[] = [estreePlugin.default as unknown as Plugin] 
      // estree is needed for JS/TS

      const lang = language.toLowerCase()

      if (['javascript', 'js', 'jsx', 'typescript', 'ts', 'tsx', 'json'].includes(lang)) {
         if (lang === 'json') {
             parser = 'json'
             // Prettier 3 treats babel as the go-to for JS-like ASTs
             const babelPlugin = await import('prettier/plugins/babel')
             plugins.push(babelPlugin.default as unknown as Plugin)
         } else if (lang.includes('ts') || lang.includes('type')) {
             parser = 'typescript'
             const tsPlugin = await import('prettier/plugins/typescript')
             plugins.push(tsPlugin.default as unknown as Plugin)
         } else {
             parser = 'babel'
             const babelPlugin = await import('prettier/plugins/babel')
             plugins.push(babelPlugin.default as unknown as Plugin)
         }
      } else if (['css', 'scss', 'less'].includes(lang)) {
          parser = 'css'
          const postcssPlugin = await import('prettier/plugins/postcss')
          plugins.push(postcssPlugin.default as unknown as Plugin)
      } else if (['html'].includes(lang)) {
          parser = 'html'
          const htmlPlugin = await import('prettier/plugins/html')
          plugins.push(htmlPlugin.default as unknown as Plugin)
      } else if (['markdown', 'md'].includes(lang)) {
          parser = 'markdown'
          const markdownPlugin = await import('prettier/plugins/markdown')
          plugins.push(markdownPlugin.default as unknown as Plugin)
      } else {
          // Fallback or unsupported
          console.warn(`Formatting for language '${language}' is not supported yet.`)
          return null
      }

      if (!parser) return null

      const options: Options = {
        parser,
        plugins,
        printWidth: 80,
        tabWidth: 2,
        semi: true,
        singleQuote: true,
        trailingComma: 'es5',
      }

      const formatted = await prettier.format(code, options)
      return formatted
    } catch (error) {
      console.error('Formatting failed:', error)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { format, isLoading }
}
