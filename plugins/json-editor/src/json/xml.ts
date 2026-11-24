type XmlValue = string | { [key: string]: XmlValue | XmlValue[] }

function readXmlNode(node: Document | Element): XmlValue {
  const attributes = node.nodeType === Node.ELEMENT_NODE ? Array.from((node as Element).attributes) : []
  if (!attributes.length && !node.hasChildNodes()) return ''

  const result = Object.create(null) as Record<string, XmlValue | XmlValue[]>
  for (const attribute of attributes) result['@' + attribute.name] = attribute.value

  const onlyChild = node.childNodes.length === 1 ? node.firstChild : null
  if (onlyChild?.nodeType === Node.TEXT_NODE) {
    const text = onlyChild.nodeValue?.trim() ?? ''
    if (!attributes.length) return text
    if (text) result['#text'] = text
    return result
  }

  for (const child of Array.from(node.children)) {
    const key = child.nodeName
    const value = readXmlNode(child)
    const previous = result[key]
    if (previous === undefined) result[key] = value
    else if (Array.isArray(previous)) previous.push(value)
    else result[key] = [previous, value]
  }
  return result
}

export function xmlToJson(text: string): XmlValue {
  return readXmlNode(new DOMParser().parseFromString(text, 'text/xml'))
}

function escapeXml(value: unknown): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function xmlTag(name: string, value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => xmlTag(name, item)).join('')
  if (value === null) return `<${name}/>`
  if (typeof value !== 'object') return `<${name}>${escapeXml(value)}</${name}>`

  let attributes = ''
  let content = ''
  let hasChildren = false
  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('@')) {
      const attribute = key.slice(1).replace(/\//g, '-')
      attributes += ` ${attribute}="${escapeXml(child).replace(/"/g, '&quot;')}"`
      continue
    }
    hasChildren = true
    if (key === '#text') content += escapeXml(child)
    else if (key === '#cdata') content += `<![CDATA[${String(child).replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`
    else content += xmlTag(key, child)
  }

  return hasChildren
    ? `<${name}${attributes}>${content}</${name}>`
    : `<${name}${attributes}/>`
}

function buildXml(value: unknown): string {
  if (Array.isArray(value)) return `<root>${xmlTag('element', value)}</root>`
  if (value === null || typeof value !== 'object') return xmlTag('root', value)

  const entries = Object.entries(value)
  if (entries.length === 1) {
    const [[key, child]] = entries
    const content = xmlTag(key, child)
    return Array.isArray(child) ? `<root>${content}</root>` : content
  }
  const content = entries.map(([key, child]) => xmlTag(key, child)).join('')
  return `<root>${content}</root>`
}

const xmlStylesheet = `
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform" version="1.0">
  <xsl:strip-space elements="*"/>
  <xsl:template match="para[content-style][not(text())]">
    <xsl:value-of select="normalize-space(.)"/>
  </xsl:template>
  <xsl:template match="node()|@*">
    <xsl:copy><xsl:apply-templates select="node()|@*"/></xsl:copy>
  </xsl:template>
  <xsl:output indent="yes"/>
</xsl:stylesheet>`

function indentXml(element: Element, serializer: XMLSerializer, depth = 0): string {
  const indent = '  '.repeat(depth)
  const children = Array.from(element.childNodes)
  if (!element.children.length || children.some((node) => node.nodeType !== Node.ELEMENT_NODE)) {
    return indent + serializer.serializeToString(element)
  }

  const opening = serializer.serializeToString(element.cloneNode(false)).replace(/\/>$/, '>')
  return [
    indent + opening,
    ...Array.from(element.children, (child) => indentXml(child, serializer, depth + 1)),
    `${indent}</${element.nodeName}>`,
  ].join('\n')
}

export function jsonToXml(value: unknown): string {
  if (value !== null && typeof value !== 'object') return buildXml(value)

  const parser = new DOMParser()
  const xml = parser.parseFromString(buildXml(value), 'application/xml')
  if (xml.getElementsByTagNameNS('http://www.mozilla.org/newlayout/xml/parsererror.xml', 'parsererror').length) {
    throw new Error('JSON 包含无法转换为 XML 的字段名')
  }

  const serializer = new XMLSerializer()
  if (typeof XSLTProcessor === 'function') {
    const processor = new XSLTProcessor()
    processor.importStylesheet(parser.parseFromString(xmlStylesheet, 'application/xml'))
    const transformed = processor.transformToDocument(xml)
    if (transformed) return serializer.serializeToString(transformed)
  }
  return indentXml(xml.documentElement, serializer)
}
