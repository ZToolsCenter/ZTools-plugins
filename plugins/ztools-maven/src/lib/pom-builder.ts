import type { PomOptions } from './types'

export interface Coord {
  g: string
  a: string
  v: string
}

function xmlEscape(s: string): string {
  // & must be replaced first; otherwise the entities introduced below
  // (e.g. '&lt;', '&quot;') would themselves be re-escaped to '&amp;lt;' etc.
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function buildDependency(coord: Coord, opts: PomOptions = {}): string {
  const lines = [
    '<dependency>',
    `    <groupId>${xmlEscape(coord.g)}</groupId>`,
    `    <artifactId>${xmlEscape(coord.a)}</artifactId>`,
    `    <version>${xmlEscape(coord.v)}</version>`,
  ]
  if (opts.scope) lines.push(`    <scope>${xmlEscape(opts.scope)}</scope>`)
  if (opts.classifier) lines.push(`    <classifier>${xmlEscape(opts.classifier)}</classifier>`)
  if (opts.optional) lines.push(`    <optional>true</optional>`)
  lines.push('</dependency>')
  return lines.join('\n')
}

export function buildGradleCoord(coord: Coord): string {
  return `${coord.g}:${coord.a}:${coord.v}`
}

export function buildJarUrl(coord: Coord, opts: PomOptions = {}): string {
  const groupPath = coord.g.replace(/\./g, '/')
  const base = 'https://repo1.maven.org/maven2'
  const filename = opts.classifier
    ? `${coord.a}-${coord.v}-${opts.classifier}.jar`
    : `${coord.a}-${coord.v}.jar`
  return `${base}/${groupPath}/${coord.a}/${coord.v}/${filename}`
}