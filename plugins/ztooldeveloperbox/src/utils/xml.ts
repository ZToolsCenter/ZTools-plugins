function getParseError(doc: Document): string | null {
  const errorNode = doc.querySelector('parsererror')
  if (!errorNode) return null
  return errorNode.textContent?.trim() || 'XML 解析失败'
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/\r/g, '&#xD;')
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function getXmlDeclaration(xml: string): string | null {
  const match = xml.trim().match(/^<\?xml[\s\S]*?\?>/)
  return match ? match[0] : null
}

function buildOpenTag(el: Element, selfClosing = false): string {
  const attrs = Array.from(el.attributes)
    .map((attr) => ` ${attr.name}="${escapeAttribute(attr.value)}"`)
    .join('')
  return selfClosing ? `<${el.tagName}${attrs} />` : `<${el.tagName}${attrs}>`
}

function getMeaningfulChildNodes(node: Node): ChildNode[] {
  return Array.from(node.childNodes).filter((child) => {
    if (child.nodeType !== Node.TEXT_NODE) return true
    return Boolean(child.textContent?.trim())
  })
}

function formatNode(node: Node, depth: number, lines: string[], indent: string): void {
  const prefix = indent.repeat(depth)

  if (node.nodeType === Node.DOCUMENT_NODE) {
    for (const child of Array.from(node.childNodes)) {
      formatNode(child, depth, lines, indent)
    }
    return
  }

  if (node.nodeType === Node.DOCUMENT_TYPE_NODE) {
    const docType = node as DocumentType
    let declaration = `<!DOCTYPE ${docType.name}`
    if (docType.publicId) {
      declaration += ` PUBLIC "${docType.publicId}"`
    }
    if (docType.systemId) {
      declaration += docType.publicId ? ` "${docType.systemId}"` : ` SYSTEM "${docType.systemId}"`
    }
    lines.push(`${prefix}${declaration}>`)
    return
  }

  if (node.nodeType === Node.COMMENT_NODE) {
    lines.push(`${prefix}<!--${node.textContent}-->`)
    return
  }

  if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
    const pi = node as ProcessingInstruction
    const data = pi.data ? ` ${pi.data}` : ''
    lines.push(`${prefix}<?${pi.target}${data}?>`)
    return
  }

  if (node.nodeType === Node.CDATA_SECTION_NODE) {
    lines.push(`${prefix}<![CDATA[${node.textContent ?? ''}]]>`)
    return
  }

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? ''
    if (text.trim()) {
      lines.push(`${prefix}${escapeText(text)}`)
    }
    return
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return

  const element = node as Element
  const children = getMeaningfulChildNodes(element)

  if (children.length === 0) {
    lines.push(`${prefix}${buildOpenTag(element, true)}`)
    return
  }

  if (children.length === 1 && children[0].nodeType === Node.TEXT_NODE) {
    const text = children[0].textContent ?? ''
    lines.push(`${prefix}${buildOpenTag(element)}${escapeText(text)}</${element.tagName}>`)
    return
  }

  if (children.length === 1 && children[0].nodeType === Node.CDATA_SECTION_NODE) {
    lines.push(`${prefix}${buildOpenTag(element)}<![CDATA[${children[0].textContent ?? ''}]]></${element.tagName}>`)
    return
  }

  lines.push(`${prefix}${buildOpenTag(element)}`)
  for (const child of children) {
    formatNode(child, depth + 1, lines, indent)
  }
  lines.push(`${prefix}</${element.tagName}>`)
}

function compressNode(node: Node, parts: string[]): void {
  if (node.nodeType === Node.DOCUMENT_NODE) {
    for (const child of Array.from(node.childNodes)) {
      compressNode(child, parts)
    }
    return
  }

  if (node.nodeType === Node.DOCUMENT_TYPE_NODE) {
    const docType = node as DocumentType
    let declaration = `<!DOCTYPE ${docType.name}`
    if (docType.publicId) {
      declaration += ` PUBLIC "${docType.publicId}"`
    }
    if (docType.systemId) {
      declaration += docType.publicId ? ` "${docType.systemId}"` : ` SYSTEM "${docType.systemId}"`
    }
    parts.push(`${declaration}>`)
    return
  }

  if (node.nodeType === Node.COMMENT_NODE) {
    parts.push(`<!--${node.textContent}-->`)
    return
  }

  if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) {
    const pi = node as ProcessingInstruction
    const data = pi.data ? ` ${pi.data}` : ''
    parts.push(`<?${pi.target}${data}?>`)
    return
  }

  if (node.nodeType === Node.CDATA_SECTION_NODE) {
    parts.push(`<![CDATA[${node.textContent ?? ''}]]>`)
    return
  }

  if (node.nodeType === Node.TEXT_NODE) {
    parts.push(escapeText(node.textContent ?? ''))
    return
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return

  const element = node as Element
  const children = getMeaningfulChildNodes(element)

  if (children.length === 0) {
    parts.push(buildOpenTag(element, true))
    return
  }

  parts.push(buildOpenTag(element))
  for (const child of children) {
    compressNode(child, parts)
  }
  parts.push(`</${element.tagName}>`)
}

function parseXml(xml: string): Document {
  const trimmed = xml.trim()
  if (!trimmed) {
    throw new Error('请输入 XML 内容')
  }

  const doc = new DOMParser().parseFromString(trimmed, 'application/xml')
  const parseError = getParseError(doc)
  if (parseError) {
    throw new Error(parseError)
  }
  return doc
}

export function formatXml(xml: string, indent = '  '): string {
  const doc = parseXml(xml)
  const lines: string[] = []
  const declaration = getXmlDeclaration(xml)

  if (declaration) {
    lines.push(declaration)
  }

  for (const child of Array.from(doc.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      formatNode(child, 0, lines, indent)
      continue
    }
    if (
      child.nodeType === Node.COMMENT_NODE ||
      child.nodeType === Node.PROCESSING_INSTRUCTION_NODE ||
      child.nodeType === Node.DOCUMENT_TYPE_NODE
    ) {
      formatNode(child, 0, lines, indent)
    }
  }

  return lines.join('\n')
}

export function compressXml(xml: string): string {
  const doc = parseXml(xml)
  const parts: string[] = []
  const declaration = getXmlDeclaration(xml)

  if (declaration) {
    parts.push(declaration)
  }

  for (const child of Array.from(doc.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      compressNode(child, parts)
      continue
    }
    if (
      child.nodeType === Node.COMMENT_NODE ||
      child.nodeType === Node.PROCESSING_INSTRUCTION_NODE ||
      child.nodeType === Node.DOCUMENT_TYPE_NODE
    ) {
      compressNode(child, parts)
    }
  }

  return parts.join('')
}
