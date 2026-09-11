import { useState, useCallback } from 'react'
import type { Options, Plugin } from 'prettier'

export function useFormatCode() {
  const [isLoading, setIsLoading] = useState(false)

  const format = useCallback(async (code: string, language: string) => {
    setIsLoading(true)
    try {
      const lang = language.toLowerCase()

      if (lang === 'json') {
        try {
          return JSON.stringify(JSON.parse(code), null, 2)
        } catch {
          return null
        }
      }

      const prettier = await import('prettier/standalone')
      const estreePlugin = await import('prettier/plugins/estree')

      let parser = ''
      const plugins: Plugin[] = [estreePlugin.default as unknown as Plugin]

      if (['javascript', 'js', 'jsx', 'typescript', 'ts', 'tsx'].includes(lang)) {
        const babelPlugin = await import('prettier/plugins/babel')
        plugins.push(babelPlugin.default as unknown as Plugin)
        parser = lang.includes('ts') || lang.includes('type') ? 'babel-ts' : 'babel'
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
