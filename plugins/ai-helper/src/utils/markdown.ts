const FENCED_CODE_PATTERN = /(^|\n)([ \t]*)(`{3,}|~{3,})([^\n]*)\n[\s\S]*?(?:\n[ \t]*\3[ \t]*(?=\n|$)|$)/g
const INLINE_CODE_PATTERN = /(`+)([^`\n]*?)\1/g
const CODE_LATEX_DELIMITERS = [
  ['\\[', '\uE100'],
  ['\\]', '\uE101'],
  ['\\(', '\uE102'],
  ['\\)', '\uE103']
] as const

interface MarkdownAstNode {
  type?: string
  value?: string
  children?: MarkdownAstNode[]
}

function protectInlineCodeLatex(segment: string): string {
  return CODE_LATEX_DELIMITERS.reduce(
    (result, [delimiter, placeholder]) => result.split(delimiter).join(placeholder),
    segment
  )
}

function restoreInlineCodeLatex(value: string): string {
  return CODE_LATEX_DELIMITERS.reduce(
    (result, [delimiter, placeholder]) => result.split(placeholder).join(delimiter),
    value
  )
}

export function preprocessMarkdownLatex(markdown: string): string {
  if (!markdown) return ''

  const protectedSegments = new Map<string, string>()
  let placeholderIndex = 0

  const protect = (segment: string) => {
    const placeholder = `\uE000AI_HELPER_CODE_${placeholderIndex++}\uE001`
    protectedSegments.set(placeholder, segment)
    return placeholder
  }

  // Formula normalization must not alter examples inside code blocks or inline code.
  let processed = markdown.replace(FENCED_CODE_PATTERN, match => protect(match))
  processed = processed.replace(INLINE_CODE_PATTERN, match => protect(protectInlineCodeLatex(match)))

  processed = processed.replace(/\\\[([\s\S]*?)\\\]/g, (_, expression: string) => `$$${expression}$$`)
  processed = processed.replace(/\\\(\s*([\s\S]*?)\s*\\\)/g, (_, expression: string) => `$${expression}$`)

  // KaTeX expects these environments to be nested inside a display-math environment.
  processed = processed.replace(/\\begin\{align\*?\}/g, '\\begin{aligned}')
  processed = processed.replace(/\\end\{align\*?\}/g, '\\end{aligned}')
  processed = processed.replace(/\\begin\{equation\*?\}/g, '\\begin{aligned}')
  processed = processed.replace(/\\end\{equation\*?\}/g, '\\end{aligned}')
  processed = processed.replace(/(?<!\\)\\tag\s*\{([^{}]+)\}/g, '\\qquad \\text{($1)}')

  protectedSegments.forEach((segment, placeholder) => {
    processed = processed.split(placeholder).join(segment)
  })

  return processed
}

export function restoreProtectedLatexCodePlugin() {
  return (tree: MarkdownAstNode) => {
    const restoreNode = (node: MarkdownAstNode) => {
      if (typeof node.value === 'string') {
        node.value = restoreInlineCodeLatex(node.value)
      }
      node.children?.forEach(restoreNode)
    }

    restoreNode(tree)
  }
}
