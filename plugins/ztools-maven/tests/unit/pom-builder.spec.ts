import { describe, it, expect } from 'vitest'
import { buildDependency, buildGradleCoord, buildJarUrl } from '../../src/lib/pom-builder'

describe('buildDependency', () => {
  it('renders minimal required tags', () => {
    const xml = buildDependency({ g: 'org.springframework', a: 'spring-core', v: '6.0.0' })
    expect(xml).toBe(
      '<dependency>\n' +
      '    <groupId>org.springframework</groupId>\n' +
      '    <artifactId>spring-core</artifactId>\n' +
      '    <version>6.0.0</version>\n' +
      '</dependency>'
    )
  })
  it('includes scope when provided', () => {
    expect(buildDependency({ g: 'g', a: 'a', v: '1' }, { scope: 'test' })).toContain('    <scope>test</scope>')
  })
  it('includes classifier when provided', () => {
    expect(buildDependency({ g: 'g', a: 'a', v: '1' }, { classifier: 'sources' })).toContain('    <classifier>sources</classifier>')
  })
  it('includes optional when true', () => {
    expect(buildDependency({ g: 'g', a: 'a', v: '1' }, { optional: true })).toContain('    <optional>true</optional>')
  })
  it('omits optional when false', () => {
    expect(buildDependency({ g: 'g', a: 'a', v: '1' }, { optional: false })).not.toContain('<optional>')
  })
  it('escapes XML special chars in field values', () => {
    const xml = buildDependency({ g: 'g<>&"\'', a: 'a', v: '1' })
    expect(xml).toContain('&lt;')
    expect(xml).toContain('&gt;')
    expect(xml).toContain('&amp;')
    expect(xml).toContain('&quot;')
    expect(xml).toContain('&apos;')
  })
  it('renders all optional fields together', () => {
    const xml = buildDependency({ g: 'g', a: 'a', v: '1', scope: 'compile', classifier: 'sources', optional: true }, { scope: 'compile', classifier: 'sources', optional: true })
    expect(xml).toContain('<scope>compile</scope>')
    expect(xml).toContain('<classifier>sources</classifier>')
    expect(xml).toContain('<optional>true</optional>')
  })
})

describe('buildGradleCoord', () => {
  it('joins g:a:v with colons', () => {
    expect(buildGradleCoord({ g: 'org.x', a: 'y', v: '1.0' })).toBe('org.x:y:1.0')
  })
})

describe('buildJarUrl', () => {
  it('builds main JAR URL without classifier', () => {
    expect(buildJarUrl({ g: 'org.springframework', a: 'spring-core', v: '6.0.0' }))
      .toBe('https://repo1.maven.org/maven2/org/springframework/spring-core/6.0.0/spring-core-6.0.0.jar')
  })
  it('appends classifier to filename', () => {
    expect(buildJarUrl({ g: 'g', a: 'a', v: '1' }, { classifier: 'sources' }))
      .toBe('https://repo1.maven.org/maven2/g/a/1/a-1-sources.jar')
  })
  it('converts dots in groupId to slashes', () => {
    expect(buildJarUrl({ g: 'com.google.guava', a: 'guava', v: '32.0' }))
      .toBe('https://repo1.maven.org/maven2/com/google/guava/guava/32.0/guava-32.0.jar')
  })
})