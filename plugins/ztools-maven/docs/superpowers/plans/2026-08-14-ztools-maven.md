# ztools-maven Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a ZTools plugin that searches Maven Central, browses historical versions, and one-click copies `<dependency>` XML to clipboard, with two feature entry points (`maven-ui` interactive panel, `maven-search` over-cmd quick copy).

**Architecture:** Vue 3 + Vite + TypeScript SPA loaded into ZTools. Pure-function lib (`src/lib/`) for parsing/versioning/XML. Vue composables for theme + cache. Preload `services.js` (Node) wraps Maven Central Solr + GraphQL with fallback. Components render two panels routed by feature code.

**Tech Stack:** Vue 3, Vite, TypeScript, Vitest, @vue/test-utils, jsdom, @playwright/test.

**Spec:** `docs/superpowers/specs/2026-08-14-ztools-maven-design.md`

**Plan file:** `docs/superpowers/plans/2026-08-14-ztools-maven.md`

---

## File Structure

| File | Responsibility | Approx LoC |
|---|---|---|
| `src/lib/types.ts` | Shared types: `MavenArtifact`, `MavenVersion`, `ParsedQuery`, `PomOptions`, `CacheEntry<T>`, `SearchResult<T>` | ~50 |
| `src/lib/search-parser.ts` | `parseSearch(input: string): ParsedQuery` | ~60 |
| `src/lib/version-tag.ts` | `tagVersion`, `isLatest`, `dedupeVersions` | ~80 |
| `src/lib/pom-builder.ts` | `buildDependency`, `buildJarUrl` | ~60 |
| `src/lib/useTheme.ts` | Theme detection → `data-theme` attribute | ~30 |
| `src/lib/useMavenCache.ts` | `Map`-backed cache composable | ~50 |
| `public/preload/services.js` | `mavenSearch`, `mavenVersions` (Node fetch) | ~120 |
| `src/MavenUi/index.vue` | `MavenUiPanel`: search + result list + version panel + menu | ~250 |
| `src/MavenSearch/index.vue` | `MavenSearchPanel`: payload → search → copy | ~150 |
| `src/App.vue` | Route two new features | ~40 |
| `src/main.css` | CSS variables for light/dark themes | ~80 |
| `public/plugin.json` | Register `maven-ui` + `maven-search` features | (modify) |
| `tests/helpers/ztools-stub.ts` | Shared `installZtoolsStub()` for tests | ~80 |
| `tests/unit/*.spec.ts` (×3) | Pure function unit tests | ~200 total |
| `tests/integration/services.spec.ts` | Preload services with mocked fetch | ~150 |
| `tests/component/*.spec.ts` (×2) | Vue component tests | ~250 total |
| `tests/e2e/happy-path.spec.ts` | Playwright end-to-end | ~80 |

---

## Chunk 1: Test Infrastructure + Shared Types

Sets up testing tooling and the central types module that all other chunks depend on.

### Task 1.1: Add test dependencies to package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add dev dependencies**

Append to `devDependencies` in `package.json`:

```json
"vitest": "^2.1.0",
"@vue/test-utils": "^2.4.6",
"jsdom": "^25.0.0",
"@playwright/test": "^1.47.0",
"@vitest/coverage-v8": "^2.1.0",
"@types/node": "^22.0.0"
```

Append to `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest",
"test:unit": "vitest run tests/unit",
"test:integration": "vitest run tests/integration",
"test:component": "vitest run tests/component",
"test:e2e": "playwright test"
```

- [ ] **Step 2: Install dependencies**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npm install`
Expected: All packages installed, no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add vitest, playwright, jsdom test dependencies"
```

### Task 1.2: Configure vitest in vite.config.js

**Files:**
- Modify: `vite.config.js`

- [ ] **Step 1: Add vitest config block**

Read `vite.config.js`. It currently exports the Vite config. Add a `test` block at the top level of the config object using `vitest/config`'s `defineConfig`:

Replace `vite.config.js` content with:

```js
/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // Note: the original config had `base: './'` for relative-asset builds.
  // Dropping it here is intentional — ZTools loads the dev server directly,
  // and production builds go through a different pipeline. Restore only if
  // assets fail to load in production.
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.spec.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
  },
})
```

- [ ] **Step 2: Verify config loads**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npx vitest --version`
Expected: prints `vitest X.Y.Z` (no error about config)

- [ ] **Step 3: Commit**

```bash
git add vite.config.js
git commit -m "chore: configure vitest with jsdom environment"
```

### Task 1.3: Create ztools-stub helper

**Files:**
- Create: `tests/helpers/ztools-stub.ts`

- [ ] **Step 1: Write the stub module**

Create `tests/helpers/ztools-stub.ts`:

```ts
import { vi } from 'vitest'

export interface ServicesStub {
  mavenSearch: ReturnType<typeof vi.fn>
  mavenVersions: ReturnType<typeof vi.fn>
}

export interface ZtoolsStub {
  clipboard: {
    writeContent: ReturnType<typeof vi.fn>
  }
  showNotification: ReturnType<typeof vi.fn>
  isDarkColors: ReturnType<typeof vi.fn>
  hideMainWindow: ReturnType<typeof vi.fn>
  onPluginEnter: ReturnType<typeof vi.fn>
  setSubInput: ReturnType<typeof vi.fn>
  http: {
    setHeaders: ReturnType<typeof vi.fn>
  }
}

export interface Stubs {
  services: ServicesStub
  ztools: ZtoolsStub
}

export function installZtoolsStub(overrides: Partial<Stubs> = {}): Stubs {
  const services: ServicesStub = overrides.services ?? {
    mavenSearch: vi.fn().mockResolvedValue({ data: [], source: 'solr' }),
    mavenVersions: vi.fn().mockResolvedValue({ data: [], source: 'solr' }),
  }
  const ztools: ZtoolsStub = overrides.ztools ?? {
    clipboard: {
      writeContent: vi.fn().mockResolvedValue(true),
    },
    showNotification: vi.fn(),
    isDarkColors: vi.fn().mockReturnValue(false),
    hideMainWindow: vi.fn().mockResolvedValue(true),
    onPluginEnter: vi.fn(),
    setSubInput: vi.fn(),
    http: {
      setHeaders: vi.fn().mockReturnValue(true),
    },
  }

  ;(globalThis as any).services = services
  ;(globalThis as any).ztools = ztools

  return { services, ztools }
}

// installZtoolsStub is re-entrant — calling it again (e.g., in `beforeEach`)
// replaces the prior stubs cleanly. Pair with `uninstallZtoolsStub` in
// `afterEach` if a test needs to assert the absence of `window.services`.
export function uninstallZtoolsStub() {
  delete (globalThis as any).services
  delete (globalThis as any).ztools
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npx tsc --noEmit -p tsconfig.json`
Expected: no errors (runs against the whole project under its tsconfig)

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/ztools-stub.ts
git commit -m "test: add ztools stub helper for tests"
```

### Task 1.4: Create shared types module

**Files:**
- Create: `src/lib/types.ts`

- [ ] **Step 1: Write the types file**

Create `src/lib/types.ts`:

```ts
// Shared types across parser, components, preload, and tests.

export interface MavenArtifact {
  id: string              // "g:a"
  g: string               // groupId
  a: string               // artifactId
  latestVersion: string   // latest version (from Solr default rows)
  timestamp: number       // ms epoch from Solr; 0 if placeholder
}

export interface MavenVersion {
  v: string               // version string
  timestamp: number       // ms epoch; 0 if placeholder
  status: VersionStatus   // classified tag
  isLatest: boolean       // true iff first record w/ timestamp>0
}

export type VersionStatus = 'stable' | 'snapshot' | 'alpha' | 'beta'

// Discriminated union — `kind` is REQUIRED.
export type ParsedQuery =
  | { kind: 'freeText'; freeText: string }
  | { kind: 'scoped'; g?: string; a?: string; v?: string }
  | { kind: 'rawQuery'; rawQuery: string }

export interface PomOptions {
  scope?: string
  classifier?: string
  optional?: boolean
}

// Generic envelope for service responses.
export type SearchResult<T> = {
  data: T[]
  source: 'solr' | 'graphql'
}

// Cache entry — `source: null` allowed for compatibility / untracked fetches.
export type CacheEntry<T> = {
  data: T[]
  source: 'solr' | 'graphql' | null
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npx vue-tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): add shared type definitions"
```

---

## Chunk 2: Core Pure-Function Lib

The three pure-function modules with 100% test coverage target. No Vue, no fetch, no DOM.

### Task 2.1: search-parser with tests

**Files:**
- Create: `src/lib/search-parser.ts`
- Test: `tests/unit/search-parser.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/search-parser.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseSearch } from '../../src/lib/search-parser'

describe('parseSearch', () => {
  it('parses single free-text token', () => {
    expect(parseSearch('spring-core')).toEqual({
      kind: 'freeText',
      freeText: 'spring-core',
    })
  })

  it('parses g:a scoped query', () => {
    expect(parseSearch('org.springframework:spring-core')).toEqual({
      kind: 'scoped',
      g: 'org.springframework',
      a: 'spring-core',
    })
  })

  it('parses g:a:v fully scoped query', () => {
    expect(parseSearch('org.springframework:spring-core:6.0.0')).toEqual({
      kind: 'scoped',
      g: 'org.springframework',
      a: 'spring-core',
      v: '6.0.0',
    })
  })

  it('parses g: only prefix', () => {
    expect(parseSearch('g:org.springframework')).toEqual({
      kind: 'scoped',
      g: 'org.springframework',
    })
  })

  it('uses rawQuery when AND/OR/NOT is present (whole string)', () => {
    expect(
      parseSearch('g:org.springframework AND a:spring-core OR a:spring-test')
    ).toEqual({
      kind: 'rawQuery',
      rawQuery: 'g:org.springframework AND a:spring-core OR a:spring-test',
    })
  })

  it('uses rawQuery when parentheses are present', () => {
    expect(parseSearch('(g:org.springframework AND a:spring) OR a:other')).toEqual({
      kind: 'rawQuery',
      rawQuery: '(g:org.springframework AND a:spring) OR a:other',
    })
  })

  it('AND case-insensitive', () => {
    expect(parseSearch('foo and bar')).toEqual({
      kind: 'rawQuery',
      rawQuery: 'foo and bar',
    })
  })

  it('trims whitespace around tokens', () => {
    expect(parseSearch('  spring-core  ')).toEqual({
      kind: 'freeText',
      freeText: 'spring-core',
    })
  })

  it('returns empty freeText for empty input', () => {
    expect(parseSearch('')).toEqual({
      kind: 'freeText',
      freeText: '',
    })
  })

  it('returns empty freeText for whitespace-only input', () => {
    expect(parseSearch('   ')).toEqual({
      kind: 'freeText',
      freeText: '',
    })
  })

  it('does not lowercase groupId (case-sensitive)', () => {
    expect(parseSearch('Org.SpringFramework:spring-core')).toEqual({
      kind: 'scoped',
      g: 'Org.SpringFramework',
      a: 'spring-core',
    })
  })

  it('handles multiple colons in version segment', () => {
    // Versions can contain colons? Unlikely but defensive: keep as v.
    // 4+ segments merge extras into v with ':' preserved.
    expect(parseSearch('g:a:b:c')).toEqual({
      kind: 'scoped',
      g: 'g',
      a: 'a',
      v: 'b:c',
    })
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npx vitest run tests/unit/search-parser.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement parseSearch**

Create `src/lib/search-parser.ts`:

```ts
import type { ParsedQuery } from './types'

const SOLR_OPERATORS = /\b(AND|OR|NOT)\b/i
const HAS_PARENS = /[()]/

export function parseSearch(input: string): ParsedQuery {
  const trimmed = input.trim()

  // Empty / whitespace-only → freeText with empty string.
  if (trimmed === '') {
    return { kind: 'freeText', freeText: '' }
  }

  // rawQuery mode triggered by Solr operators or parentheses.
  if (SOLR_OPERATORS.test(trimmed) || HAS_PARENS.test(trimmed)) {
    return { kind: 'rawQuery', rawQuery: trimmed }
  }

  // Scoped mode via `:` delimiter.
  const parts = trimmed.split(':')
  if (parts.length === 1) {
    return { kind: 'freeText', freeText: parts[0].trim() }
  }

  if (parts.length === 2) {
    return {
      kind: 'scoped',
      g: parts[0].trim(),
      a: parts[1].trim(),
    }
  }

  // 3+ segments: g:a:v[:extra]. Extra segments merge into v.
  const [g, a, ...rest] = parts
  return {
    kind: 'scoped',
    g: g.trim(),
    a: a.trim(),
    v: rest.map(s => s.trim()).join(':'),
  }
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npx vitest run tests/unit/search-parser.spec.ts`
Expected: all 12 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/search-parser.ts tests/unit/search-parser.spec.ts
git commit -m "feat(parser): implement smart search input parser with rawQuery mode"
```

### Task 2.2: version-tag with tests

**Files:**
- Create: `src/lib/version-tag.ts`
- Test: `tests/unit/version-tag.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/version-tag.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { tagVersion, hasTimestamp, pickLatest, dedupeVersions, formatTimestamp } from '../../src/lib/version-tag'
import type { MavenVersion } from '../../src/lib/types'

describe('tagVersion', () => {
  it.each([
    ['6.0.0', 'stable'],
    ['6.0.0.RELEASE', 'stable'],
    ['6.0.0.Final', 'stable'],
    ['6.0.0.GA', 'stable'],
    ['1.0.0-alpha', 'alpha'],
    ['1.0.0-alpha.1', 'alpha'],
    ['1.0.0-beta', 'beta'],
    ['2.0.0.Beta', 'beta'],
    ['1.0.0-rc1', 'beta'],         // rc → beta
    ['1.0.0.RC1', 'beta'],
    ['1.0.0-rc-1', 'beta'],        // dash-separated RC
    ['1.0.0-M1', 'beta'],          // milestone → beta
    ['1.0.0-milestone', 'beta'],
    ['1.0.0-SNAPSHOT', 'snapshot'],
    ['9.9.9-weird-thing', 'stable'], // fallback
  ])('tags %s as %s', (v, expected) => {
    expect(tagVersion(v)).toBe(expected)
  })
})

describe('hasTimestamp', () => {
  it('returns true when timestamp > 0', () => {
    expect(hasTimestamp({ v: '1.0.0', timestamp: 1000, status: 'stable', isLatest: false })).toBe(true)
  })

  it('returns false when timestamp is 0 (placeholder)', () => {
    expect(hasTimestamp({ v: 'RELEASE', timestamp: 0, status: 'stable', isLatest: false })).toBe(false)
  })
})

describe('pickLatest', () => {
  it('returns the version with max timestamp (excluding placeholders)', () => {
    const versions: MavenVersion[] = [
      { v: '2.0.0', timestamp: 1000, status: 'stable', isLatest: false },
      { v: '1.0.0', timestamp: 500, status: 'stable', isLatest: false },
    ]
    expect(pickLatest(versions)?.v).toBe('2.0.0')
  })

  it('skips records with timestamp 0', () => {
    const versions: MavenVersion[] = [
      { v: 'RELEASE', timestamp: 0, status: 'stable', isLatest: false },
      { v: '1.0.0', timestamp: 500, status: 'stable', isLatest: false },
    ]
    expect(pickLatest(versions)?.v).toBe('1.0.0')
  })

  it('returns null if no record has timestamp > 0', () => {
    const versions: MavenVersion[] = [
      { v: 'RELEASE', timestamp: 0, status: 'stable', isLatest: false },
    ]
    expect(pickLatest(versions)).toBeNull()
  })
})

describe('dedupeVersions', () => {
  it('dedupes 1.0.0.RELEASE keeping the canonical 1.0.0 form', () => {
    const versions: MavenVersion[] = [
      { v: '1.0.0.RELEASE', timestamp: 1000, status: 'stable', isLatest: false },
      { v: '1.0.0', timestamp: 500, status: 'stable', isLatest: false },
    ]
    const result = dedupeVersions(versions)
    expect(result).toHaveLength(1)
    expect(result[0].v).toBe('1.0.0.RELEASE')
    expect(result[0].timestamp).toBe(1000)
  })

  it('keeps higher-timestamp when canonical form wins', () => {
    const versions: MavenVersion[] = [
      { v: '1.0.0', timestamp: 1000, status: 'stable', isLatest: false },
      { v: '1.0.0.RELEASE', timestamp: 500, status: 'stable', isLatest: false },
    ]
    const result = dedupeVersions(versions)
    expect(result).toHaveLength(1)
    expect(result[0].v).toBe('1.0.0')
    expect(result[0].timestamp).toBe(1000)
  })

  it('preserves unique versions', () => {
    const versions: MavenVersion[] = [
      { v: '2.0.0', timestamp: 2000, status: 'stable', isLatest: false },
      { v: '1.0.0', timestamp: 1000, status: 'stable', isLatest: false },
    ]
    expect(dedupeVersions(versions)).toHaveLength(2)
  })

  it('treats RELEASE/Final/GA case-insensitively', () => {
    const versions: MavenVersion[] = [
      { v: '1.0.0.RELEASE', timestamp: 500, status: 'stable', isLatest: false },
      { v: '1.0.0.final', timestamp: 1000, status: 'stable', isLatest: false },
      { v: '1.0.0.Final', timestamp: 750, status: 'stable', isLatest: false },
    ]
    const result = dedupeVersions(versions)
    expect(result).toHaveLength(1)
    expect(result[0].v).toBe('1.0.0.final')
    expect(result[0].timestamp).toBe(1000)
  })
})

describe('formatTimestamp', () => {
  it('formats ms epoch to YYYY-MM', () => {
    // 2024-06-15T00:00:00Z
    expect(formatTimestamp(1718409600000)).toBe('2024-06')
  })

  it('returns "—" for timestamp 0', () => {
    expect(formatTimestamp(0)).toBe('—')
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npx vitest run tests/unit/version-tag.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement version-tag**

Create `src/lib/version-tag.ts`:

```ts
import type { MavenVersion, VersionStatus } from './types'

function classifyQualifier(q: string): VersionStatus | null {
  const lower = q.toLowerCase()
  if (lower.startsWith('snapshot')) return 'snapshot'
  if (lower.startsWith('alpha')) return 'alpha'
  if (lower.startsWith('beta') || lower.startsWith('rc') || lower.startsWith('m') || lower === 'milestone') {
    return 'beta'
  }
  if (lower === 'release' || lower === 'final' || lower === 'ga') {
    return 'stable'
  }
  return null
}

export function tagVersion(v: string): VersionStatus {
  // Split version on '-' or '.' to find qualifiers.
  const segments = v.split(/[-.]/)
  for (const seg of segments) {
    const status = classifyQualifier(seg)
    if (status) return status
  }
  return 'stable' // fallback per spec §8.
}

// Per-record check: does this version have a real publication timestamp?
export function hasTimestamp(rec: MavenVersion): boolean {
  return rec.timestamp > 0
}

// Pick the latest published version (max timestamp > 0), or null if all are placeholders.
export function pickLatest(versions: MavenVersion[]): MavenVersion | null {
  let best: MavenVersion | null = null
  for (const v of versions) {
    if (!hasTimestamp(v)) continue
    if (!best || v.timestamp > best.timestamp) best = v
  }
  return best
}

const CANONICAL_STRIP_RE = /\.(RELEASE|Final|GA|release|final|ga)$/

function canonicalize(v: string): string {
  return v.replace(CANONICAL_STRIP_RE, '')
}

export function dedupeVersions(versions: MavenVersion[]): MavenVersion[] {
  const groups = new Map<string, MavenVersion>()
  for (const v of versions) {
    const key = canonicalize(v.v)
    const existing = groups.get(key)
    if (!existing || v.timestamp > existing.timestamp) {
      groups.set(key, v)
    }
  }
  return Array.from(groups.values())
}

// Format ms epoch as "YYYY-MM" in UTC. TZ choice is pinned to UTC to match
// Solr's response semantics (Solr timestamps are UTC ms-epoch).
export function formatTimestamp(ts: number): string {
  if (ts <= 0) return '—'
  const d = new Date(ts)
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${yyyy}-${mm}`
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npx vitest run tests/unit/version-tag.spec.ts`
Expected: all tests pass (test runner shows total count: 1 `describe tagVersion` with 16 `it.each` rows + 2 `hasTimestamp` + 3 `pickLatest` + 4 `dedupeVersions` + 2 `formatTimestamp` = 27 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/version-tag.ts tests/unit/version-tag.spec.ts
git commit -m "feat(version-tag): classify versions, dedupe canonical forms, format timestamps"
```

### Task 2.3: pom-builder with tests

**Files:**
- Create: `src/lib/pom-builder.ts`
- Test: `tests/unit/pom-builder.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/pom-builder.spec.ts`:

```ts
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
    const xml = buildDependency({ g: 'g', a: 'a', v: '1', scope: 'test' })
    expect(xml).toContain('    <scope>test</scope>')
  })

  it('includes classifier when provided', () => {
    const xml = buildDependency({ g: 'g', a: 'a', v: '1', classifier: 'sources' })
    expect(xml).toContain('    <classifier>sources</classifier>')
  })

  it('includes optional when true', () => {
    const xml = buildDependency({ g: 'g', a: 'a', v: '1', optional: true })
    expect(xml).toContain('    <optional>true</optional>')
  })

  it('omits optional when false', () => {
    const xml = buildDependency({ g: 'g', a: 'a', v: '1', optional: false })
    expect(xml).not.toContain('<optional>')
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
    const xml = buildDependency({
      g: 'g', a: 'a', v: '1',
      scope: 'compile',
      classifier: 'sources',
      optional: true,
    })
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npx vitest run tests/unit/pom-builder.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement pom-builder**

Create `src/lib/pom-builder.ts`:

```ts
import type { PomOptions } from './types'

export interface Coord {
  g: string
  a: string
  v: string
}

function xmlEscape(s: string): string {
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
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npx vitest run tests/unit/pom-builder.spec.ts`
Expected: all tests pass (test runner shows total count: 7 `buildDependency` + 1 `buildGradleCoord` + 3 `buildJarUrl` = 11 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/pom-builder.ts tests/unit/pom-builder.spec.ts
git commit -m "feat(pom-builder): render XML dependency, Gradle coord, JAR URL with escaping"
```

### Task 2.4: Verify 100% coverage on lib

**Files:**
- None (verification only)

- [ ] **Step 1: Run coverage on lib**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npx vitest run tests/unit --coverage`
Expected: All three lib modules show 100% line/branch coverage. If any module falls short, **iterate before proceeding**: add missing test cases to the corresponding `*.spec.ts`, re-run, and confirm 100% before committing. Do not commit partial coverage on a "100% target" module.

- [ ] **Step 2: Commit coverage config if added**

If `vitest.config.ts` or `package.json` was modified to enable coverage, commit it:

```bash
git add vitest.config.ts package.json  # only if changed
git commit -m "chore: enable coverage reporting"
```

---

## Chunk 3: Composables

Vue 3 composables for theme detection and cache management.

### Task 3.1: useTheme composable

**Files:**
- Create: `src/lib/useTheme.ts`
- Test: `tests/unit/useTheme.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/useTheme.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { applyTheme, detectDark } from '../../src/lib/useTheme'

describe('detectDark', () => {
  beforeEach(() => {
    delete (globalThis as any).ztools
    delete (globalThis as any).window
  })

  it('returns true when ztools.isDarkColors() is true', () => {
    ;(globalThis as any).window = { ztools: { isDarkColors: () => true } }
    expect(detectDark()).toBe(true)
  })

  it('falls back to matchMedia when ztools absent and media matches', () => {
    ;(globalThis as any).window = {
      matchMedia: (q: string) => ({ matches: q.includes('dark') }),
    }
    expect(detectDark()).toBe(true)
  })

  it('falls back to matchMedia when ztools absent and media does not match', () => {
    ;(globalThis as any).window = {
      matchMedia: (q: string) => ({ matches: !q.includes('dark') }),
    }
    expect(detectDark()).toBe(false)
  })

  it('prefers ztools over matchMedia when both present', () => {
    ;(globalThis as any).window = {
      ztools: { isDarkColors: () => false },
      matchMedia: (q: string) => ({ matches: q.includes('dark') }),
    }
    expect(detectDark()).toBe(false)
  })
})

describe('applyTheme', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = ''
  })

  it('writes data-theme="dark" when dark', () => {
    ;(globalThis as any).window = { ztools: { isDarkColors: () => true } }
    applyTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('writes data-theme="light" when not dark', () => {
    ;(globalThis as any).window = {
      ztools: { isDarkColors: () => false },
      matchMedia: () => ({ matches: false }),
    }
    applyTheme()
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('does not register any listeners (one-shot only)', () => {
    const addSpy = vi.fn()
    ;(globalThis as any).window = {
      ztools: { isDarkColors: () => false },
      matchMedia: () => ({ matches: false, addEventListener: addSpy }),
    }
    applyTheme()
    expect(addSpy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npx vitest run tests/unit/useTheme.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement useTheme**

Create `src/lib/useTheme.ts`:

```ts
export function detectDark(): boolean {
  // Authoritative source: ZTools host.
  if (typeof window !== 'undefined' && (window as any).ztools?.isDarkColors?.()) {
    return true
  }
  // Fallback: prefers-color-scheme media query.
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return true
  }
  return false
}

export function applyTheme(): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = detectDark() ? 'dark' : 'light'
}

export function useTheme() {
  // Per spec §11: no listeners, no broadcast; apply once on mount.
  applyTheme()
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npx vitest run tests/unit/useTheme.spec.ts`
Expected: all 7 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/useTheme.ts tests/unit/useTheme.spec.ts
git commit -m "feat(theme): useTheme composable following ztools.isDarkColors()"
```

### Task 3.2: useMavenCache composable

**Files:**
- Create: `src/lib/useMavenCache.ts`

- [ ] **Step 1: Write failing test**

Create `tests/unit/useMavenCache.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createMavenCache } from '../../src/lib/useMavenCache'

describe('createMavenCache', () => {
  it('returns null on miss', () => {
    const cache = createMavenCache()
    expect(cache.getSearch('spring')).toBeNull()
  })

  it('stores and retrieves search entries', () => {
    const cache = createMavenCache()
    const entry = { data: [{ id: 'a', g: 'g', a: 'a', latestVersion: '1', timestamp: 1000 }], source: 'solr' as const }
    cache.setSearch('g:a', entry)
    expect(cache.getSearch('g:a')).toEqual(entry)
  })

  it('stores and retrieves version entries', () => {
    const cache = createMavenCache()
    const entry = { data: [{ v: '1.0.0', timestamp: 1000, status: 'stable' as const, isLatest: true }], source: 'solr' as const }
    cache.setVersions('g:a', entry)
    expect(cache.getVersions('g:a')).toEqual(entry)
  })

  it('isolates search and version caches by key', () => {
    const cache = createMavenCache()
    const searchEntry = { data: [], source: 'solr' as const }
    const versionEntry = { data: [], source: 'solr' as const }
    cache.setSearch('same', searchEntry)
    cache.setVersions('same', versionEntry)
    expect(cache.getSearch('same')).toEqual(searchEntry)
    expect(cache.getVersions('same')).toEqual(versionEntry)
  })

  it('overwrites on duplicate key', () => {
    const cache = createMavenCache()
    cache.setSearch('k', { data: [], source: 'solr' })
    cache.setSearch('k', { data: [{ id: 'new', g: 'g', a: 'a', latestVersion: '1', timestamp: 1000 }], source: 'graphql' })
    const got = cache.getSearch('k')
    expect(got?.source).toBe('graphql')
  })

  it('normalizes whitespace in key (trim)', () => {
    const cache = createMavenCache()
    const entry = { data: [], source: 'solr' as const }
    cache.setSearch('  spring-core  ', entry)
    expect(cache.getSearch('spring-core')).toEqual(entry)
  })

  it('versions cache source is independent from search cache source', () => {
    const cache = createMavenCache()
    cache.setVersions('g:a', { data: [], source: 'solr' })
    const got = cache.getVersions('g:a')
    expect(got?.source).toBe('solr') // mavenVersions always Solr; never GraphQL
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npx vitest run tests/unit/useMavenCache.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement useMavenCache**

Create `src/lib/useMavenCache.ts`:

```ts
import type { MavenArtifact, MavenVersion, CacheEntry } from './types'

export interface MavenCache {
  getSearch(key: string): CacheEntry<MavenArtifact> | null
  setSearch(key: string, entry: CacheEntry<MavenArtifact>): void
  getVersions(key: string): CacheEntry<MavenVersion> | null
  setVersions(key: string, entry: CacheEntry<MavenVersion>): void
}

export function createMavenCache(): MavenCache {
  const searchCache = new Map<string, CacheEntry<MavenArtifact>>()
  const versionCache = new Map<string, CacheEntry<MavenVersion>>()

  const trim = (k: string) => k.trim()

  return {
    getSearch(key) {
      return searchCache.get(trim(key)) ?? null
    },
    setSearch(key, entry) {
      searchCache.set(trim(key), entry)
    },
    getVersions(key) {
      return versionCache.get(trim(key)) ?? null
    },
    setVersions(key, entry) {
      versionCache.set(trim(key), entry)
    },
  }
}

// Vue composable wrapper — instance-bound to component lifecycle.
export function useMavenCache(): MavenCache {
  return createMavenCache()
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npx vitest run tests/unit/useMavenCache.spec.ts`
Expected: all 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/lib/useMavenCache.ts tests/unit/useMavenCache.spec.ts
git commit -m "feat(cache): useMavenCache composable with Map-backed search/version stores"
```

---

## Chunk 4: Preload Services (Node Network Layer)

The Node-side module that fetches Maven Central. This lives in `public/preload/services.js` and runs in ZTools' preload context with full Node access.

### Task 4.1: Add HTTP header setup and base fetch

**Files:**
- Modify: `public/preload/services.js`

- [ ] **Step 1: Set UA header on preload startup**

Edit `public/preload/services.js`. Replace its contents with:

```js
const SOLR_BASE = 'https://search.maven.org/solrsearch/select'
const GRAPHQL_URL = 'https://central.sonatype.com/graphql'
const TIMEOUT_MS = 5000

// Set User-Agent header (avoid Maven Central rate-limiting bare node-fetch UA).
if (window.ztools?.http?.setHeaders) {
  window.ztools.http.setHeaders({ 'User-Agent': 'ztools-maven/1.0' })
}

async function fetchJson(url, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add public/preload/services.js
git commit -m "feat(preload): set UA header and add fetchJson helper"
```

### Task 4.2: Implement mavenSearch + mavenVersions

**Files:**
- Modify: `public/preload/services.js`
- Test: `tests/integration/services.spec.ts`

- [ ] **Step 1: Write failing integration tests**

Create `tests/integration/services.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest'

// Mock global fetch and window before loading services.js.
// services.js runs at import time (side-effects: sets window.services).
const mockFetch = vi.fn()
;(globalThis as any).fetch = mockFetch
;(globalThis as any).window = {
  ztools: {
    http: { setHeaders: vi.fn().mockReturnValue(true) },
    clipboard: { writeContent: vi.fn() },
    isDarkColors: () => false,
    showNotification: vi.fn(),
    hideMainWindow: vi.fn(),
  },
}

await import('../../public/preload/services.js')
const services = (globalThis as any).services

beforeAll(() => {
  if (!services) throw new Error('services.js did not register window.services')
})

describe('services.mavenSearch', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('hits Solr with freeText query and returns solr source', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        response: { numFound: 1, docs: [{ id: 'g:a', g: 'g', a: 'a', v: '1.0', timestamp: 1000 }] },
      }),
    })
    const result = await services.mavenSearch({ kind: 'freeText', freeText: 'spring' })
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('q=spring'),
      expect.any(Object)
    )
    expect(result.source).toBe('solr')
    expect(result.data).toHaveLength(1)
  })

  it('falls back to GraphQL on Solr 500 with POST and search field', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: { search: { components: [{ id: 'g:a', namespace: 'g', name: 'a', version: '1.0' }] } },
        }),
      })
    const result = await services.mavenSearch({ kind: 'freeText', freeText: 'spring' })
    expect(result.source).toBe('graphql')
    // Verify GraphQL request shape.
    const [, init] = mockFetch.mock.calls[1]
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body).query).toMatch(/search/)
  })

  it('does NOT fall back to GraphQL for rawQuery (Solr-only)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    await expect(
      services.mavenSearch({ kind: 'rawQuery', rawQuery: 'g:x AND a:y' })
    ).rejects.toThrow(/简化查询/)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('returns empty array on Solr 200 with 0 results (no fallback)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ response: { numFound: 0, docs: [] } }),
    })
    const result = await services.mavenSearch({ kind: 'freeText', freeText: 'nothing' })
    expect(result.data).toEqual([])
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('hits Solr with scoped g:a query (URL-encoded)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ response: { numFound: 1, docs: [{ id: 'org.x:y', g: 'org.x', a: 'y', v: '1', timestamp: 0 }] } }),
    })
    await services.mavenSearch({ kind: 'scoped', g: 'org.x', a: 'y' })
    const url = mockFetch.mock.calls[0][0]
    expect(url).toMatch(/q=g%3Aorg\.x\+AND\+a%3Ay/)
  })

  it('retries once with 1.5s backoff on Solr 429, then throws', async () => {
    vi.useFakeTimers()
    mockFetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) })
    const promise = services.mavenSearch({ kind: 'freeText', freeText: 'spring' })
    // Advance through the 1.5s retry delay.
    await vi.advanceTimersByTimeAsync(1600)
    await expect(promise).rejects.toThrow()
    expect(mockFetch).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('returns MavenArtifact-shaped data with timestamp fallback to 0', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        response: { numFound: 1, docs: [{ id: 'g:a', g: 'g', a: 'a', v: '1.0' }] }, // no timestamp
      }),
    })
    const result = await services.mavenSearch({ kind: 'freeText', freeText: 'spring' })
    expect(result.data[0].timestamp).toBe(0)
  })
})

describe('services.mavenVersions', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('hits Solr with core=gav and rows=200', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ response: { numFound: 1, docs: [{ v: '1.0', timestamp: 1000 }] } }),
    })
    await services.mavenVersions('g', 'a')
    const url = mockFetch.mock.calls[0][0]
    expect(url).toMatch(/core=gav/)
    expect(url).toMatch(/rows=200/)
  })

  it('returns empty array when Solr returns 0 results', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ response: { numFound: 0, docs: [] } }),
    })
    const result = await services.mavenVersions('g', 'a')
    expect(result.data).toEqual([])
  })

  it('URL-encodes g and a parameters', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ response: { numFound: 0, docs: [] } }),
    })
    await services.mavenVersions('org.springframework', 'spring-core')
    const url = mockFetch.mock.calls[0][0]
    expect(url).toContain('g%3Aorg.springframework')
    expect(url).toContain('a%3Aspring-core')
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npx vitest run tests/integration/services.spec.ts`
Expected: FAIL — services.mavenSearch undefined or tests fail on URL/retry assertions

- [ ] **Step 3: Implement mavenSearch + mavenVersions**

Replace `public/preload/services.js` content:

```js
const SOLR_BASE = 'https://search.maven.org/solrsearch/select'
const GRAPHQL_URL = 'https://central.sonatype.com/graphql'
const TIMEOUT_MS = 5000
const RETRY_DELAY_MS = 1500

if (window.ztools?.http?.setHeaders) {
  window.ztools.http.setHeaders({ 'User-Agent': 'ztools-maven/1.0' })
}

// Structured error class — carries URL, status, timing for UI error details (spec §10).
class ServiceError extends Error {
  constructor(message, meta) {
    super(message)
    this.name = 'ServiceError'
    this.url = meta.url
    this.status = meta.status
    this.durationMs = meta.durationMs
    this.body = meta.body
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// Unified fetch with abort + timing + structured error.
async function fetchJson(url, init = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const start = Date.now()
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const durationMs = Date.now() - start
    if (!res.ok) {
      let body
      try { body = await res.text() } catch {}
      throw new ServiceError(`HTTP ${res.status}`, { url, status: res.status, durationMs, body })
    }
    return { json: await res.json(), durationMs }
  } finally {
    clearTimeout(timer)
  }
}

function buildSolrQ(query) {
  if (query.kind === 'freeText') return query.freeText
  if (query.kind === 'rawQuery') return query.rawQuery
  if (query.kind === 'scoped') {
    const parts = []
    if (query.g) parts.push(`g:${query.g}`)
    if (query.a) parts.push(`a:${query.a}`)
    return parts.join(' AND ')
  }
  throw new Error('unknown query kind')
}

function buildSolrUrl(q, extra = {}) {
  const params = new URLSearchParams({ q, rows: '20', wt: 'json', ...extra })
  return `${SOLR_BASE}?${params}`
}

// One-shot-with-retry wrapper for 429. Other statuses throw immediately.
async function fetchSolrWithRetry(url) {
  try {
    return await fetchJson(url)
  } catch (err) {
    if (err instanceof ServiceError && err.status === 429) {
      await sleep(RETRY_DELAY_MS)
      return fetchJson(url)
    }
    throw err
  }
}

async function searchSolr(query) {
  const url = buildSolrUrl(buildSolrQ(query))
  const { json } = await fetchSolrWithRetry(url)
  return {
    data: (json.response?.docs ?? []).map(d => ({
      id: d.id,
      g: d.g,
      a: d.a,
      latestVersion: d.v,
      timestamp: d.timestamp ?? 0,
    })),
    source: 'solr',
  }
}

async function searchGraphQL(query) {
  let searchText = ''
  if (query.kind === 'freeText') searchText = query.freeText
  else if (query.kind === 'scoped') {
    // Trim trailing empty segments (e.g., { g: 'x' } alone joins to 'x:').
    searchText = [query.g, query.a].filter(Boolean).join(':').replace(/:$/, '')
  }
  const body = {
    query: `query($q: String!, $l: Int!) {
      search(query: $q, limit: $l) {
        components { id namespace name version }
      }
    }`,
    variables: { q: searchText, l: 20 },
  }
  const { json } = await fetchJson(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const components = json?.data?.search?.components ?? []
  return {
    data: components.map(c => ({
      id: c.id,
      g: c.namespace,
      a: c.name,
      latestVersion: c.version,
      timestamp: 0, // GraphQL doesn't expose timestamp
    })),
    source: 'graphql',
  }
}

async function mavenSearch(query) {
  if (query.kind === 'rawQuery') {
    // rawQuery does NOT fall back to GraphQL (Solr-specific syntax).
    return await searchSolr(query)
  }
  try {
    return await searchSolr(query)
  } catch (err) {
    if (err instanceof ServiceError && err.message.includes('HTTP 4xx')) throw err // client errors don't fall back
    return await searchGraphQL(query)
  }
}

async function mavenVersions(g, a) {
  const q = `g:${g} AND a:${a}`
  const url = buildSolrUrl(q, { core: 'gav', rows: '200' })
  const { json } = await fetchSolrWithRetry(url)
  return {
    data: (json.response?.docs ?? []).map(d => ({
      v: d.v,
      timestamp: d.timestamp ?? 0,
    })),
    source: 'solr',
  }
}

window.services = {
  mavenSearch,
  mavenVersions,
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npx vitest run tests/integration/services.spec.ts`
Expected: all tests pass (test runner shows total count: 7 `mavenSearch` + 3 `mavenVersions` = 10 tests)

- [ ] **Step 5: Commit**

```bash
git add public/preload/services.js tests/integration/services.spec.ts
git commit -m "feat(preload): implement mavenSearch + mavenVersions with Solr primary, GraphQL fallback for non-rawQuery, 429 retry, structured ServiceError"
```

---

## Chunk 5: Vue Components + Routing + CSS

The UI layer. Two component files, App.vue routing, main.css with full theme variable set.

### Task 5.1: Add CSS variable set to main.css

**Files:**
- Modify: `src/main.css`

- [ ] **Step 1: Replace main.css with theme tokens + minimal reset**

Replace `src/main.css` content:

```css
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f5;
  --bg-hover: #ececec;
  --text-primary: #1a1a1a;
  --text-secondary: #666666;
  --text-muted: #999999;
  --border: #e0e0e0;
  --accent: #0066cc;
  --accent-hover: #0052a3;
  --status-stable: #2e7d32;
  --status-snapshot: #f57c00;
  --status-alpha: #d32f2f;
  --status-beta: #7b1fa2;
  --error-bg: #fff3f3;
  --error-border: #ffcdd2;
  --shadow: rgba(0, 0, 0, 0.08);
  --radius: 6px;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

[data-theme="dark"] {
  --bg-primary: #1e1e1e;
  --bg-secondary: #2a2a2a;
  --bg-hover: #353535;
  --text-primary: #e6e6e6;
  --text-secondary: #a0a0a0;
  --text-muted: #707070;
  --border: #3a3a3a;
  --accent: #4d9fff;
  --accent-hover: #6cb1ff;
  --status-stable: #66bb6a;
  --status-snapshot: #ffa726;
  --status-alpha: #ef5350;
  --status-beta: #ab47bc;
  --error-bg: #2d1f1f;
  --error-border: #5a2828;
  --shadow: rgba(0, 0, 0, 0.4);
}

@media (prefers-color-scheme: dark) {
  :root { /* First-paint fallback when JS/theme not yet applied. */
    --bg-primary: #1e1e1e;
    --bg-secondary: #2a2a2a;
    --bg-hover: #353535;
    --text-primary: #e6e6e6;
    --text-secondary: #a0a0a0;
    --text-muted: #707070;
    --border: #3a3a3a;
    --accent: #4d9fff;
    --accent-hover: #6cb1ff;
    --status-stable: #66bb6a;
    --status-snapshot: #ffa726;
    --status-alpha: #ef5350;
    --status-beta: #ab47bc;
    --error-bg: #2d1f1f;
    --error-border: #5a2828;
    --shadow: rgba(0, 0, 0, 0.4);
  }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: var(--font-sans);
  background: var(--bg-primary);
  color: var(--text-primary);
}

button {
  font-family: inherit;
  cursor: pointer;
}
```

- [ ] **Step 2: Verify build still works**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npm run build`
Expected: build succeeds (this only checks compile, not visual)

- [ ] **Step 3: Commit**

```bash
git add src/main.css
git commit -m "feat(css): light + dark theme variable sets with media-query first-paint fallback"
```

### Task 5.2: Create MavenUiPanel component

**Files:**
- Create: `src/MavenUi/index.vue`

- [ ] **Step 1: Write the component**

Create `src/MavenUi/index.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue'
import { useTheme } from '../lib/useTheme'
import { useMavenCache } from '../lib/useMavenCache'
import { parseSearch } from '../lib/search-parser'
import { tagVersion, dedupeVersions, formatTimestamp, pickLatest } from '../lib/version-tag'
import { buildDependency, buildGradleCoord, buildJarUrl } from '../lib/pom-builder'
import type { MavenArtifact, MavenVersion } from '../lib/types'

const props = defineProps<{ enterAction: any }>()

useTheme()
const cache = useMavenCache()

const searchInput = ref('')
const debouncedInput = ref('')
let debounceTimer: any = null
const results = ref<MavenArtifact[]>([])
const selectedIdx = ref(0)
const selectedArtifact = ref<MavenArtifact | null>(null)
const versions = ref<MavenVersion[]>([])
const versionIdx = ref(0)
const versionsTotal = ref(0)          // total count from Solr
const versionsStart = ref(0)         // pagination offset
const versionsHasMore = ref(false)
const loading = ref(false)
const error = ref<{ msg: string; details?: any } | null>(null)

// Action menu state (Mode A).
const menuOpen = ref(false)
const menuFocusIdx = ref(0)
const MENU_ITEMS = [
  { label: '复制 XML', shortcut: 'Enter', build: (c: any, v: string) => buildDependency(c, { scope: 'compile' }) },
  { label: '复制坐标', shortcut: 'g', build: (c: any, v: string) => buildGradleCoord(c) },
  { label: '复制 JAR URL', shortcut: 'u', build: (c: any, v: string) => buildJarUrl(c) },
]

// Help overlay (Cmd/Ctrl+K).
const helpOpen = ref(false)

const queryKey = computed(() => debouncedInput.value.trim().toLowerCase())

function cacheKey(query: any): string {
  if (query.kind === 'scoped') return `${query.g ?? ''}:${query.a ?? ''}`
  if (query.kind === 'rawQuery') return query.rawQuery
  return query.freeText
}

async function doSearch() {
  const input = debouncedInput.value.trim()
  if (!input) { results.value = []; return }
  const parsed = parseSearch(input)
  const key = cacheKey(parsed)
  const cached = cache.getSearch(key)
  if (cached) {
    results.value = cached.data
    return
  }
  loading.value = true
  error.value = null
  try {
    const r = await (window as any).services.mavenSearch(parsed)
    cache.setSearch(key, r)
    results.value = r.data
    selectedIdx.value = 0
  } catch (e: any) {
    error.value = { msg: '搜索失败', details: e }
    results.value = []
  } finally {
    loading.value = false
  }
}

async function selectArtifact(a: MavenArtifact) {
  selectedArtifact.value = a
  versionsStart.value = 0
  await loadVersions(a, 0, false)
}

async function loadVersions(a: MavenArtifact, start: number, append: boolean) {
  const key = `${a.g}:${a.a}`
  let r
  if (start === 0) {
    const cached = cache.getVersions(key)
    if (cached) {
      r = cached
    } else {
      loading.value = true
      try {
        r = await (window as any).services.mavenVersions(a.g, a.a)
        cache.setVersions(key, r)
      } catch (e: any) {
        error.value = { msg: '获取版本失败', details: e }
        versions.value = []
        loading.value = false
        return
      } finally {
        loading.value = false
      }
    }
  } else {
    // Pagination: not cached — always fetch.
    loading.value = true
    try {
      r = await (window as any).services.mavenVersions(a.g, a.a, start)
    } catch (e: any) {
      error.value = { msg: '加载更多失败', details: e }
      loading.value = false
      return
    } finally {
      loading.value = false
    }
  }
  const tagged = (r.data as any[]).map(v => ({
    v: v.v, timestamp: v.timestamp, status: tagVersion(v.v), isLatest: false,
  }))
  const deduped = dedupeVersions(tagged)
  const latest = deduped.findIndex(v => v === pickLatest(deduped))
  if (latest >= 0) deduped[latest] = { ...deduped[latest], isLatest: true }
  const sorted = deduped.sort((a, b) => b.timestamp - a.timestamp)
  versions.value = append ? [...versions.value, ...sorted] : sorted
  versionIdx.value = versions.value.findIndex(v => v.isLatest)
  versionsStart.value = start + sorted.length
  versionsHasMore.value = sorted.length === 200 // assume more if full page
}

async function copyContent(content: string) {
  await (window as any).ztools.clipboard.writeContent({
    type: 'text', content, shouldPaste: true,
  })
  ;(window as any).ztools.showNotification('已复制 Maven 依赖')
  ;(window as any).ztools.hideMainWindow()
}

function openMenu() {
  if (!selectedArtifact.value || !versions.value[versionIdx.value]) return
  menuOpen.value = true
  menuFocusIdx.value = 0
}

function closeMenu() {
  menuOpen.value = false
}

function confirmMenu() {
  const a = selectedArtifact.value
  const v = versions.value[versionIdx.value]
  if (!a || !v) return
  const item = MENU_ITEMS[menuFocusIdx.value]
  const coord = { g: a.g, a: a.a, v: v.v }
  copyContent(item.build(coord, v.v))
  closeMenu()
}

function copyGradle() {
  const a = selectedArtifact.value, v = versions.value[versionIdx.value]
  if (!a || !v) return
  copyContent(buildGradleCoord({ g: a.g, a: a.a, v: v.v }))
}

function copyJar() {
  const a = selectedArtifact.value, v = versions.value[versionIdx.value]
  if (!a || !v) return
  copyContent(buildJarUrl({ g: a.g, a: a.a, v: v.v }))
}

function onSearchChange(text: string) {
  searchInput.value = text
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debouncedInput.value = text
    doSearch()
  }, 300)
}

function onResultKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { selectedIdx.value = Math.min(selectedIdx.value + 1, results.value.length - 1); e.preventDefault() }
  else if (e.key === 'ArrowUp') { selectedIdx.value = Math.max(selectedIdx.value - 1, 0); e.preventDefault() }
  else if (e.key === 'ArrowRight' && results.value[selectedIdx.value]) { selectArtifact(results.value[selectedIdx.value]); e.preventDefault() }
  else if (e.key === 'Enter' && results.value[selectedIdx.value]) { selectArtifact(results.value[selectedIdx.value]); e.preventDefault() }
}

function onVersionKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { versionIdx.value = Math.min(versionIdx.value + 1, versions.value.length - 1); e.preventDefault() }
  else if (e.key === 'ArrowUp') { versionIdx.value = Math.max(versionIdx.value - 1, 0); e.preventDefault() }
  else if (e.key === 'ArrowLeft') { selectedArtifact.value = null; e.preventDefault() }
  else if (e.key === 'Enter' || e.key === 'c') { openMenu(); e.preventDefault() }
  else if (e.key === 'g') { copyGradle(); e.preventDefault() }
  else if (e.key === 'u') { copyJar(); e.preventDefault() }
}

function onMenuKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { closeMenu(); e.preventDefault() }
  else if (e.key === 'Tab') {
    e.preventDefault()
    if (e.shiftKey) {
      menuFocusIdx.value = (menuFocusIdx.value - 1 + MENU_ITEMS.length) % MENU_ITEMS.length
    } else {
      menuFocusIdx.value = (menuFocusIdx.value + 1) % MENU_ITEMS.length
    }
  } else if (e.key === 'Enter') { confirmMenu(); e.preventDefault() }
}

function onGlobalKey(e: KeyboardEvent) {
  if (menuOpen.value) return // menu captures first
  if (e.key === 'Escape') { (window as any).ztools.hideMainWindow() }
  else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { helpOpen.value = !helpOpen.value; e.preventDefault() }
  else if (e.key === '/' && !menuOpen.value) {
    const el = document.getElementById('maven-search-input') as HTMLInputElement
    el?.focus(); e.preventDefault()
  }
}

async function copyErrorDetails() {
  if (!error.value?.details) return
  const d = error.value.details
  const text = [
    `Message: ${d.message ?? '(none)'}`,
    `URL: ${d.url ?? '(none)'}`,
    `Status: ${d.status ?? '(none)'}`,
    `Duration: ${d.durationMs ?? '(none)'}ms`,
    `Body: ${d.body ?? '(none)'}`,
  ].join('\n')
  await (window as any).ztools.clipboard.writeContent({ type: 'text', content: text, shouldPaste: false })
  ;(window as any).ztools.showNotification('已复制错误信息')
}

onMounted(() => {
  ;(window as any).ztools.setSubInput(onSearchChange, '搜索 Maven 包…', true)
  window.addEventListener('keydown', onGlobalKey)
})
</script>

<template>
  <div class="maven-panel">
    <!-- Help overlay (Cmd/Ctrl+K). -->
    <div v-if="helpOpen" class="help-overlay" @click.self="helpOpen = false">
      <div class="help-box">
        <h3>快捷键</h3>
        <ul>
          <li><kbd>/</kbd> 聚焦搜索</li>
          <li><kbd>↑</kbd>/<kbd>↓</kbd> 列表内移动</li>
          <li><kbd>→</kbd> 进入版本列表</li>
          <li><kbd>←</kbd> 回到结果列表</li>
          <li><kbd>Enter</kbd>/<kbd>c</kbd> 打开操作菜单</li>
          <li><kbd>g</kbd> 直接复制 Gradle</li>
          <li><kbd>u</kbd> 直接复制 JAR URL</li>
          <li><kbd>Tab</kbd>/<kbd>Shift+Tab</kbd> 切换菜单按钮</li>
          <li><kbd>Esc</kbd> 关闭菜单 / 退出</li>
          <li><kbd>Cmd/Ctrl+K</kbd> 显示/隐藏此帮助</li>
        </ul>
      </div>
    </div>

    <!-- Action menu (Mode A). -->
    <div v-if="menuOpen" class="menu-overlay" @click.self="closeMenu" @keydown="onMenuKey" tabindex="0">
      <div class="menu-box">
        <button
          v-for="(item, i) in MENU_ITEMS"
          :key="item.label"
          :class="{ focused: i === menuFocusIdx }"
          @click="confirmMenu"
        >
          {{ item.label }} <span class="hint">({{ item.shortcut }})</span>
        </button>
      </div>
    </div>

    <!-- Error box (spec §10). -->
    <div v-if="error" class="error-box">
      <details>
        <summary>查看错误详情 ▾</summary>
        <pre>{{ error.details?.message }}
URL: {{ error.details?.url }}
Status: {{ error.details?.status }}
Duration: {{ error.details?.durationMs }}ms
Body: {{ error.details?.body }}</pre>
        <button @click="copyErrorDetails">复制错误信息</button>
      </details>
    </div>

    <!-- Result list (Mode A step 5). -->
    <div v-if="!selectedArtifact" class="results">
      <div v-if="loading">加载中…</div>
      <div v-else-if="!results.length && searchInput" class="empty">
        没找到相关包，确认关键字？
        <a :href="`https://www.google.com/search?q=maven%20${encodeURIComponent(searchInput)}`" target="_blank">用 Google 搜 “maven {{ searchInput }}”</a>
      </div>
      <ul tabindex="0" @keydown="onResultKey">
        <li
          v-for="(a, i) in results"
          :key="a.id"
          :class="{ active: i === selectedIdx }"
          @click="selectArtifact(a)"
        >
          <span class="id">{{ a.id }}</span>
          <span class="version">{{ a.latestVersion }}</span>
        </li>
      </ul>
    </div>

    <!-- Version list (Mode A step 6). -->
    <div v-else class="versions" @keydown="onVersionKey" tabindex="0">
      <header>
        <button @click="selectedArtifact = null">← 返回</button>
        <span class="id">{{ selectedArtifact.id }}</span>
      </header>
      <ul>
        <li
          v-for="(v, i) in versions"
          :key="v.v"
          :class="{ active: i === versionIdx, latest: v.isLatest }"
          @click="versionIdx = i"
        >
          <span class="ver">{{ v.v }}</span>
          <span class="time">{{ formatTimestamp(v.timestamp) }}</span>
          <span :class="['status', v.status]">{{ v.status }}</span>
          <span v-if="v.isLatest" class="latest-badge">LATEST</span>
        </li>
      </ul>
      <button v-if="versionsHasMore" class="more" @click="selectedArtifact && loadVersions(selectedArtifact, versionsStart, true)">
        加载更多
      </button>
      <footer>
        <span>Tab 切换 · Enter 确认 · Esc 取消 · g/u 直接复制 · Cmd+K 帮助</span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.maven-panel { padding: 12px; background: var(--bg-primary); color: var(--text-primary); position: relative; }
ul { list-style: none; padding: 0; margin: 0; }
li { padding: 6px 10px; cursor: pointer; border-radius: var(--radius); }
li.active { background: var(--bg-hover); }
.id { font-family: var(--font-mono); color: var(--text-primary); }
.version { margin-left: 8px; color: var(--text-secondary); font-size: 0.9em; }
.time { color: var(--text-muted); font-size: 0.85em; margin-left: 8px; }
.status { margin-left: 8px; font-size: 0.75em; padding: 1px 6px; border-radius: 3px; }
.status.stable { background: var(--status-stable); color: white; }
.status.alpha { background: var(--status-alpha); color: white; }
.status.beta { background: var(--status-beta); color: white; }
.status.snapshot { background: var(--status-snapshot); color: white; }
.latest-badge { margin-left: 8px; color: var(--accent); font-weight: bold; }
.error-box { padding: 8px; background: var(--error-bg); border: 1px solid var(--error-border); border-radius: var(--radius); margin-bottom: 8px; }
.error-box pre { font-size: 0.8em; max-height: 200px; overflow: auto; white-space: pre-wrap; }
header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
footer { margin-top: 8px; color: var(--text-muted); font-size: 0.8em; }
.empty { color: var(--text-muted); padding: 12px; text-align: center; }
.empty a { color: var(--accent); display: block; margin-top: 6px; }
button { background: transparent; color: var(--accent); border: 1px solid var(--border); padding: 4px 8px; border-radius: var(--radius); }
button:hover { background: var(--bg-hover); }
.more { margin-top: 8px; display: block; width: 100%; }

.menu-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 100; }
.menu-box { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px; min-width: 200px; }
.menu-box button { display: block; width: 100%; text-align: left; margin-bottom: 4px; }
.menu-box button.focused { background: var(--bg-hover); outline: 2px solid var(--accent); }
.menu-box .hint { color: var(--text-muted); font-size: 0.8em; margin-left: 6px; }

.help-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 200; }
.help-box { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; min-width: 280px; }
.help-box h3 { margin-top: 0; }
.help-box ul { padding-left: 0; list-style: none; }
.help-box li { padding: 3px 0; }
kbd { background: var(--bg-hover); padding: 1px 6px; border-radius: 3px; font-family: var(--font-mono); font-size: 0.85em; }
</style>
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npx vue-tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/MavenUi/index.vue
git commit -m "feat(ui): MavenUiPanel with search, result list, version panel, keyboard nav"
```

### Task 5.3: Create MavenSearchPanel component

**Files:**
- Create: `src/MavenSearch/index.vue`

- [ ] **Step 1: Write the component**

Create `src/MavenSearch/index.vue`:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useTheme } from '../lib/useTheme'
import { useMavenCache } from '../lib/useMavenCache'
import { parseSearch } from '../lib/search-parser'
import { tagVersion, dedupeVersions, formatTimestamp, pickLatest } from '../lib/version-tag'
import { buildDependency } from '../lib/pom-builder'
import type { MavenArtifact, MavenVersion } from '../lib/types'

const props = defineProps<{ enterAction: any }>()

useTheme()
const cache = useMavenCache()

const keyword = ref('')
const results = ref<MavenArtifact[]>([])
const selectedIdx = ref(0)
const selectedArtifact = ref<MavenArtifact | null>(null)
const versions = ref<MavenVersion[]>([])
const versionIdx = ref(0)
const loading = ref(false)
const error = ref<any>(null)
const helpOpen = ref(false)

function cacheKey(parsed: any): string {
  if (parsed.kind === 'scoped') return `${parsed.g ?? ''}:${parsed.a ?? ''}`
  if (parsed.kind === 'rawQuery') return parsed.rawQuery
  return parsed.freeText
}

async function doSearch() {
  if (!keyword.value.trim()) return
  error.value = null
  loading.value = true
  try {
    const parsed = parseSearch(keyword.value)
    const r = await (window as any).services.mavenSearch(parsed)
    cache.setSearch(cacheKey(parsed), r)
    results.value = r.data
    selectedIdx.value = 0
  } catch (e: any) {
    error.value = e
    results.value = []
  } finally {
    loading.value = false
  }
}

async function pickArtifact(a: MavenArtifact) {
  selectedArtifact.value = a
  const key = `${a.g}:${a.a}`
  const cached = cache.getVersions(key)
  if (cached) {
    versions.value = tagAndDedupe(cached.data)
    return
  }
  loading.value = true
  try {
    const r = await (window as any).services.mavenVersions(a.g, a.a)
    cache.setVersions(key, r)
    versions.value = tagAndDedupe(r.data)
    versionIdx.value = versions.value.findIndex(v => v === pickLatest(versions.value))
  } catch (e: any) {
    error.value = e
  } finally {
    loading.value = false
  }
}

function tagAndDedupe(raw: any[]): MavenVersion[] {
  const tagged = raw.map(v => ({
    v: v.v, timestamp: v.timestamp,
    status: tagVersion(v.v), isLatest: false,
  }))
  const deduped = dedupeVersions(tagged)
  const latest = deduped.findIndex(v => v === pickLatest(deduped))
  if (latest >= 0) deduped[latest] = { ...deduped[latest], isLatest: true }
  return deduped.sort((a, b) => b.timestamp - a.timestamp)
}

async function pickVersion(v: MavenVersion) {
  if (!selectedArtifact.value) return
  const xml = buildDependency(
    { g: selectedArtifact.value.g, a: selectedArtifact.value.a, v: v.v },
    { scope: 'compile' }
  )
  await (window as any).ztools.clipboard.writeContent({
    type: 'text', content: xml, shouldPaste: true,
  })
  ;(window as any).ztools.showNotification(`已复制：${selectedArtifact.value.id}:${v.v}`)
  ;(window as any).ztools.hideMainWindow()
}

// Mode B: c/g/u all default-copy (spec §12 — quick mode unifies keys).
async function defaultCopy() {
  if (selectedArtifact.value && versions.value[versionIdx.value]) {
    await pickVersion(versions.value[versionIdx.value])
  } else if (!selectedArtifact.value && results.value[selectedIdx.value]) {
    await pickArtifact(results.value[selectedIdx.value])
  }
}

function onKey(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    helpOpen.value = !helpOpen.value; e.preventDefault(); return
  }
  if (e.key === 'ArrowDown' && !selectedArtifact.value) {
    selectedIdx.value = Math.min(selectedIdx.value + 1, results.value.length - 1); e.preventDefault()
  } else if (e.key === 'ArrowUp' && !selectedArtifact.value) {
    selectedIdx.value = Math.max(selectedIdx.value - 1, 0); e.preventDefault()
  } else if (e.key === 'ArrowDown' && selectedArtifact.value) {
    versionIdx.value = Math.min(versionIdx.value + 1, versions.value.length - 1); e.preventDefault()
  } else if (e.key === 'ArrowUp' && selectedArtifact.value) {
    versionIdx.value = Math.max(versionIdx.value - 1, 0); e.preventDefault()
  } else if (e.key === 'Enter' || e.key === 'c' || e.key === 'g' || e.key === 'u') {
    // Mode B: Enter/c/g/u all trigger default-copy path (spec §12).
    defaultCopy(); e.preventDefault()
  } else if (e.key === 'Escape') {
    if (selectedArtifact.value) selectedArtifact.value = null
    else (window as any).ztools.hideMainWindow()
  }
}

async function copyErrorDetails() {
  if (!error.value) return
  const d = error.value
  const text = [
    `Message: ${d.message ?? '(none)'}`,
    `URL: ${d.url ?? '(none)'}`,
    `Status: ${d.status ?? '(none)'}`,
  ].join('\n')
  await (window as any).ztools.clipboard.writeContent({ type: 'text', content: text, shouldPaste: false })
  ;(window as any).ztools.showNotification('已复制错误信息')
}

function switchToUiMode() {
  // Best-effort: open the maven-ui panel by triggering its command.
  // ZTools API doesn't have a direct cross-feature jump without payload;
  // we hide this window and instruct the user via notification.
  (window as any).ztools.showNotification('请输入 "maven" 进入主面板')
  ;(window as any).ztools.hideMainWindow()
}

onMounted(() => {
  keyword.value = String(props.enterAction?.payload ?? '')
  window.addEventListener('keydown', onKey)
  if (keyword.value) doSearch()
})
</script>

<template>
  <div class="maven-quick">
    <!-- Help overlay. -->
    <div v-if="helpOpen" class="help-overlay" @click.self="helpOpen = false">
      <div class="help-box">
        <h3>快捷键</h3>
        <ul>
          <li><kbd>↑</kbd>/<kbd>↓</kbd> 列表内移动</li>
          <li><kbd>Enter</kbd>/<kbd>c</kbd>/<kbd>g</kbd>/<kbd>u</kbd> 默认复制</li>
          <li><kbd>Esc</kbd> 返回 / 退出</li>
          <li><kbd>Cmd/Ctrl+K</kbd> 显示/隐藏此帮助</li>
        </ul>
      </div>
    </div>

    <div v-if="error" class="error-box">
      <details>
        <summary>查看错误详情 ▾</summary>
        <pre>{{ error.message }}
URL: {{ error.url }}
Status: {{ error.status }}</pre>
        <button @click="copyErrorDetails">复制错误信息</button>
      </details>
    </div>

    <div v-if="!keyword" class="empty">
      请先输入要搜索的关键字
      <button class="link" @click="switchToUiMode">切换到主面板 (maven)</button>
    </div>
    <div v-else-if="loading">加载中…</div>
    <div v-else-if="!selectedArtifact">
      <ul>
        <li
          v-for="(a, i) in results"
          :key="a.id"
          :class="{ active: i === selectedIdx }"
          @click="pickArtifact(a)"
        >{{ a.id }} <span class="latest">{{ a.latestVersion }}</span></li>
      </ul>
      <p class="hint">↑↓ 选择 · Enter 进入</p>
    </div>
    <div v-else>
      <header>{{ selectedArtifact.id }}</header>
      <ul>
        <li
          v-for="(v, i) in versions"
          :key="v.v"
          :class="{ active: i === versionIdx }"
          @click="pickVersion(v)"
        >
          <span>{{ v.v }}</span>
          <span class="time">{{ formatTimestamp(v.timestamp) }}</span>
          <span :class="['status', v.status]">{{ v.status }}</span>
        </li>
      </ul>
      <p class="hint">↑↓ 选择 · Enter/c/g/u 复制 · Esc 返回</p>
    </div>
  </div>
</template>

<style scoped>
.maven-quick { padding: 12px; background: var(--bg-primary); color: var(--text-primary); position: relative; }
ul { list-style: none; padding: 0; margin: 0; }
li { padding: 6px 10px; cursor: pointer; border-radius: var(--radius); }
li.active { background: var(--bg-hover); }
.latest { color: var(--text-secondary); font-size: 0.9em; margin-left: 6px; }
.time { color: var(--text-muted); font-size: 0.85em; margin-left: 8px; }
.status { margin-left: 8px; font-size: 0.75em; padding: 1px 6px; border-radius: 3px; }
.status.stable { background: var(--status-stable); color: white; }
.status.alpha { background: var(--status-alpha); color: white; }
.status.beta { background: var(--status-beta); color: white; }
.status.snapshot { background: var(--status-snapshot); color: white; }
.error-box { padding: 8px; background: var(--error-bg); border: 1px solid var(--error-border); border-radius: var(--radius); margin-bottom: 8px; }
.error-box pre { font-size: 0.8em; max-height: 200px; overflow: auto; white-space: pre-wrap; }
.empty { color: var(--text-muted); padding: 12px; text-align: center; }
.empty .link { display: block; margin: 8px auto 0; }
header { font-family: var(--font-mono); font-weight: bold; margin-bottom: 8px; }
.hint { color: var(--text-muted); font-size: 0.8em; margin-top: 8px; }
button { background: transparent; color: var(--accent); border: 1px solid var(--border); padding: 4px 8px; border-radius: var(--radius); }
button:hover { background: var(--bg-hover); }

.help-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 100; }
.help-box { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; min-width: 240px; }
.help-box h3 { margin-top: 0; }
.help-box ul { padding-left: 0; }
.help-box li { padding: 3px 0; cursor: default; }
kbd { background: var(--bg-hover); padding: 1px 6px; border-radius: 3px; font-family: var(--font-mono); font-size: 0.85em; }
</style>
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npx vue-tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/MavenSearch/index.vue
git commit -m "feat(ui): MavenSearchPanel for over-cmd quick copy from clipboard payload"
```

### Task 5.4: Add routes in App.vue

**Files:**
- Modify: `src/App.vue`

- [ ] **Step 1: Add new component imports and routes**

Edit `src/App.vue`. Replace its content with:

```vue
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Hello from './Hello/index.vue'
import Read from './Read/index.vue'
import Write from './Write/index.vue'
import MavenUi from './MavenUi/index.vue'
import MavenSearch from './MavenSearch/index.vue'

const route = ref('')
const enterAction = ref<any>({})

onMounted(() => {
  window.ztools.onPluginEnter((action) => {
    route.value = action.code
    enterAction.value = action
  })
  window.ztools.onPluginOut(() => {
    route.value = ''
  })
})
</script>

<template>
  <Hello v-if="route === 'hello'" :enter-action="enterAction" />
  <Read v-if="route === 'read'" :enter-action="enterAction" />
  <Write v-if="route === 'write'" :enter-action="enterAction" />
  <MavenUi v-if="route === 'maven-ui'" :enter-action="enterAction" />
  <MavenSearch v-if="route === 'maven-search'" :enter-action="enterAction" />
</template>
```

- [ ] **Step 2: Verify build works**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npm run build`
Expected: build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/App.vue
git commit -m "feat(routing): wire MavenUi and MavenSearch panels into App.vue"
```

### Task 5.5: Component tests for both panels

**Files:**
- Create: `tests/component/MavenUi.spec.ts`
- Create: `tests/component/MavenSearch.spec.ts`

- [ ] **Step 1: Write MavenUi test**

Create `tests/component/MavenUi.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { installZtoolsStub, uninstallZtoolsStub } from '../helpers/ztools-stub'
import MavenUi from '../../src/MavenUi/index.vue'

describe('MavenUiPanel', () => {
  beforeEach(() => {
    uninstallZtoolsStub()
    installZtoolsStub()
  })

  it('renders empty state initially', () => {
    const w = mount(MavenUi, { props: { enterAction: {} } })
    expect(w.text()).toContain('搜索 Maven 包')
  })

  it('shows error box with structured details when search fails', async () => {
    const err = Object.assign(new Error('HTTP 500'), { url: 'https://x', status: 500, durationMs: 100, body: 'oops' })
    installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockRejectedValue(err),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    const cb = (window as any).ztools.setSubInput.mock.calls[0][0]
    cb('spring-core')
    await new Promise(r => setTimeout(r, 400))
    await w.vm.$nextTick()
    expect(w.text()).toContain('搜索失败')
    expect(w.text()).toContain('HTTP 500')
  })

  it('opens action menu on Enter/c in version list (Mode A)', async () => {
    const stubs = installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({
          data: [{ id: 'g:a', g: 'g', a: 'a', latestVersion: '1.0', timestamp: 1000 }],
          source: 'solr',
        }),
        mavenVersions: vi.fn().mockResolvedValue({
          data: [{ v: '1.0.0', timestamp: 1000 }],
          source: 'solr',
        }),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    await w.find('.results li').trigger('click')
    await w.vm.$nextTick()
    await w.find('.versions').trigger('keydown', { key: 'Enter' })
    expect(w.text()).toContain('复制 XML')
    expect(w.text()).toContain('复制坐标')
    expect(w.text()).toContain('复制 JAR URL')
  })

  it('Tab cycles menu focus (Mode A)', async () => {
    installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({ data: [{ id: 'g:a', g: 'g', a: 'a', latestVersion: '1.0', timestamp: 1000 }], source: 'solr' }),
        mavenVersions: vi.fn().mockResolvedValue({ data: [{ v: '1.0.0', timestamp: 1000 }], source: 'solr' }),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    await w.find('.results li').trigger('click')
    await w.vm.$nextTick()
    await w.find('.versions').trigger('keydown', { key: 'Enter' })
    await w.find('.menu-overlay').trigger('keydown', { key: 'Tab' })
    await w.find('.menu-overlay').trigger('keydown', { key: 'Enter' })
    expect((window as any).ztools.clipboard.writeContent).toHaveBeenCalled()
  })

  it('g shortcut bypasses menu and copies Gradle directly (Mode A)', async () => {
    installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({ data: [{ id: 'g:a', g: 'g', a: 'a', latestVersion: '1.0', timestamp: 1000 }], source: 'solr' }),
        mavenVersions: vi.fn().mockResolvedValue({ data: [{ v: '1.0.0', timestamp: 1000 }], source: 'solr' }),
      } as any,
    })
    const w = mount(MavenUi, { props: { enterAction: {} } })
    await w.find('.results li').trigger('click')
    await w.vm.$nextTick()
    await w.find('.versions').trigger('keydown', { key: 'g' })
    const calls = (window as any).ztools.clipboard.writeContent.mock.calls
    expect(calls[0][0].content).toBe('g:a:1.0.0')
  })

  it('Cmd/Ctrl+K toggles help overlay', async () => {
    const w = mount(MavenUi, { props: { enterAction: {} } })
    expect(w.find('.help-overlay').exists()).toBe(false)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
    await w.vm.$nextTick()
    expect(w.find('.help-overlay').exists()).toBe(true)
  })
})
```

- [ ] **Step 2: Write MavenSearch test**

Create `tests/component/MavenSearch.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { installZtoolsStub, uninstallZtoolsStub } from '../helpers/ztools-stub'
import MavenSearch from '../../src/MavenSearch/index.vue'

describe('MavenSearchPanel', () => {
  beforeEach(() => {
    uninstallZtoolsStub()
    installZtoolsStub()
  })

  it('shows empty state with fallback link when payload is empty', () => {
    const w = mount(MavenSearch, { props: { enterAction: { payload: '' } } })
    expect(w.text()).toContain('请先输入要搜索的关键字')
    expect(w.text()).toContain('切换到主面板')
  })

  it('triggers search on mount when payload present', async () => {
    const stubs = installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({
          data: [{ id: 'g:a', g: 'g', a: 'a', latestVersion: '1.0', timestamp: 1000 }],
          source: 'solr',
        }),
      } as any,
    })
    mount(MavenSearch, { props: { enterAction: { payload: 'spring-core' } } })
    await new Promise(r => setTimeout(r, 50))
    expect(stubs.services.mavenSearch).toHaveBeenCalled()
  })

  it('c/g/u trigger default copy in Mode B (per spec §12)', async () => {
    const stubs = installZtoolsStub({
      services: {
        mavenSearch: vi.fn().mockResolvedValue({
          data: [{ id: 'g:a', g: 'g', a: 'a', latestVersion: '1.0', timestamp: 1000 }],
          source: 'solr',
        }),
        mavenVersions: vi.fn().mockResolvedValue({
          data: [{ v: '1.0.0', timestamp: 1000 }],
          source: 'solr',
        }),
      } as any,
    })
    const w = mount(MavenSearch, { props: { enterAction: { payload: 'g' } } })
    await new Promise(r => setTimeout(r, 50))
    await w.vm.$nextTick()
    await w.find('ul li').trigger('click')
    await w.vm.$nextTick()
    // Now in version list. Press 'c'.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }))
    await w.vm.$nextTick()
    const calls = stubs.ztools.clipboard.writeContent.mock.calls
    expect(calls.length).toBeGreaterThan(0)
    expect(calls[0][0].content).toContain('<dependency>')
    expect(stubs.ztools.hideMainWindow).toHaveBeenCalled()
  })

  it('Cmd/Ctrl+K toggles help overlay', async () => {
    const w = mount(MavenSearch, { props: { enterAction: { payload: 'x' } } })
    expect(w.find('.help-overlay').exists()).toBe(false)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))
    await w.vm.$nextTick()
    expect(w.find('.help-overlay').exists()).toBe(true)
  })
})
```

- [ ] **Step 3: Run tests, verify they pass**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npx vitest run tests/component`
Expected: all tests pass (MavenUi: 6 tests; MavenSearch: 4 tests)

- [ ] **Step 4: Commit**

```bash
git add tests/component/MavenUi.spec.ts tests/component/MavenSearch.spec.ts
git commit -m "test: component tests for action menu (Mode A), c/g/u keys (Mode B), help overlay, error details"
```

---

## Chunk 6: plugin.json + E2E

Final chunk: register features in plugin.json and add Playwright E2E.

### Task 6.1: Add features to plugin.json

**Files:**
- Modify: `public/plugin.json`

- [ ] **Step 1: Add maven-ui and maven-search features**

Edit `public/plugin.json`. **Verify the current line numbers** with `Read` before anchoring edits — `plugin.json` may have shifted since this plan was written. Locate the closing `]` of the existing `features` array (currently after the `write` feature object) and insert the two new entries before it:

```json
    {
      "code": "maven-ui",
      "explain": "Maven 包检索",
      "icon": "logo.png",
      "cmds": ["maven", "mvn search"]
    },
    {
      "code": "maven-search",
      "explain": "快速复制 Maven 依赖",
      "icon": "logo.png",
      "mainHide": true,
      "cmds": [
        {
          "type": "over",
          "label": "搜索 Maven 依赖",
          "minLength": 1,
          "maxLength": 200
        }
      ]
    },
```

> The two features match spec §3 and §16 exactly: `maven-ui` uses string cmds (no `mainHide`), `maven-search` uses `over` type with `minLength: 1` / `maxLength: 200` and `mainHide: true`.

- [ ] **Step 2: Validate JSON**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && node -e "JSON.parse(require('fs').readFileSync('public/plugin.json', 'utf-8'))"`
Expected: no parse error

- [ ] **Step 3: Assert feature constraints in plugin.json**

Add a small smoke check (run inline; no new test file needed):

```bash
cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && node -e "
const p = require('./public/plugin.json');
const f = p.features.find(x => x.code === 'maven-search');
const over = f.cmds.find(c => c.type === 'over');
if (over.minLength !== 1 || over.maxLength !== 200) throw new Error('over cmd bounds wrong');
if (f.mainHide !== true) throw new Error('maven-search mainHide missing');
if (!p.features.find(x => x.code === 'maven-ui')) throw new Error('maven-ui missing');
console.log('plugin.json OK');
"
```
Expected: prints `plugin.json OK`

- [ ] **Step 4: Commit**

```bash
git add public/plugin.json
git commit -m "feat(plugin): register maven-ui and maven-search features"
```

### Task 6.2: Configure Playwright

**Files:**
- Create: `playwright.config.ts`

- [ ] **Step 1: Create playwright config**

Create `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 30000,
  },
})
```

- [ ] **Step 2: Verify config loads**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npx playwright --version`
Expected: prints `Version X.Y.Z` (no error)

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts
git commit -m "chore: configure Playwright with vite dev server"
```

### Task 6.3: Write E2E happy path

**Files:**
- Create: `tests/e2e/happy-path.spec.ts`

- [ ] **Step 1: Write the E2E**

Create `tests/e2e/happy-path.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

/**
 * NOTE on stub reuse:
 * `tests/helpers/ztools-stub.ts` is a Vitest module that imports `vi`.
 * Playwright runs the app in a real browser context — `vi` is undefined
 * there. We inline an equivalent browser-safe stub via `addInitScript`.
 * The shape mirrors `installZtoolsStub()` from the helper so a future
 * refactor could transpile the helper to IIFE and reuse it.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const searchResults = {
      data: [
        { id: 'org.springframework:spring-core', g: 'org.springframework', a: 'spring-core', latestVersion: '6.0.0', timestamp: 1666176915000 },
      ],
      source: 'solr',
    }
    const versionResults = {
      data: [
        { v: '6.0.0', timestamp: 1666176915000 },
        { v: '5.3.20', timestamp: 1661000000000 },
      ],
      source: 'solr',
    }
    let writeContentCalls: any[] = []
    let enterCb: any
    ;(window as any).services = {
      mavenSearch: () => Promise.resolve(searchResults),
      mavenVersions: () => Promise.resolve(versionResults),
    }
    ;(window as any).ztools = {
      onPluginEnter: (cb: any) => { enterCb = cb },
      onPluginOut: () => {},
      setSubInput: () => {},
      showNotification: () => {},
      hideMainWindow: () => {},
      isDarkColors: () => false,
      clipboard: {
        writeContent: (call: any) => { writeContentCalls.push(call); return Promise.resolve(true) },
      },
      http: { setHeaders: () => true },
    }
    ;(window as any).__triggerEnter = (code: string, payload: string) => {
      if (enterCb) enterCb({ code, payload })
    }
    ;(window as any).__getWriteCalls = () => writeContentCalls
  })
})

test('maven-ui: search → pick → action menu → confirm → copy XML', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => (window as any).__triggerEnter('maven-ui', ''))
  await page.waitForSelector('.maven-panel')
  await page.locator('.results li').first().click()
  await page.waitForSelector('.versions')
  // Press Enter → action menu opens.
  await page.locator('.versions').focus()
  await page.keyboard.press('Enter')
  await page.waitForSelector('.menu-overlay')
  // Press Enter again to confirm "复制 XML" (default focus).
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => (window as any).__getWriteCalls().length > 0)
  const calls = await page.evaluate(() => (window as any).__getWriteCalls())
  expect(calls[0].type).toBe('text')
  expect(calls[0].shouldPaste).toBe(true)
  expect(calls[0].content).toContain('<dependency>')
  expect(calls[0].content).toContain('org.springframework')
  expect(calls[0].content).toContain('spring-core')
  expect(calls[0].content).toContain('6.0.0')
})

test('maven-search: over-cmd payload → pick package → press c → default copy', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => (window as any).__triggerEnter('maven-search', 'spring-core'))
  await page.waitForSelector('.maven-quick')
  await page.locator('.maven-quick ul li').first().click()
  await page.waitForSelector('.maven-quick header')
  // Press 'c' to trigger default copy (Mode B unifies c/g/u).
  await page.keyboard.press('c')
  await page.waitForFunction(() => (window as any).__getWriteCalls().length > 0)
  const calls = await page.evaluate(() => (window as any).__getWriteCalls())
  expect(calls[0].type).toBe('text')
  expect(calls[0].shouldPaste).toBe(true)
  expect(calls[0].content).toContain('<dependency>')
  expect(calls[0].content).toContain('org.springframework:spring-core:6.0.0')
})
```

- [ ] **Step 2: Run E2E**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npx playwright test`
Expected: both tests pass (smoke-level — no clipboard assertion in real browser)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/happy-path.spec.ts
git commit -m "test(e2e): smoke tests for both features via Playwright"
```

### Task 6.4: Final verification

- [ ] **Step 1: Run all tests**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npm run test`
Expected: all unit + integration + component tests pass

- [ ] **Step 2: Build production bundle**

Run: `cd /Users/kangshaoqi/自研项目/ztools\ 插件/ztools-maven && npm run build`
Expected: `dist/` produced, no errors

- [ ] **Step 3: Update README with install steps and feature list**

Replace the feature list in `README.md` (search for the `## ✨ 功能特性` section) with:

```markdown
## ✨ 功能特性

### Maven 包检索（maven-ui）
- 触发指令：`maven` / `mvn search`
- 搜索 Maven Central 上的 Java 构件
- 浏览历史版本（含发布时间、stable/snapshot/alpha/beta 标签）
- 一键复制 `<dependency>` XML / Gradle 坐标 / JAR URL

### 快速复制依赖（maven-search）
- 触发指令：在 ZTools 主搜索框输入任意关键字
- 自动搜索 → 选择包 → 选择版本 → 自动复制并粘贴到当前应用
- 适合"搜索 → 立即粘贴"的快速场景

### 开发与构建

```bash
npm install
npm run dev      # 开发模式 (http://localhost:5173)
npm run build    # 生产构建 (输出到 dist/)
npm test         # 单元 + 集成 + 组件测试
npm run test:e2e # Playwright 端到端测试
```

### 安装到 ZTools

```bash
npm run build
cp -r dist/* <ZTools 插件目录>/ztools-maven/
```

> 生产构建前确保 `vite.config.js` 中 `base: './'` 已恢复（详见 Chunk 5 Task 5.2 注释）。
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: update README with feature list, dev/build/test commands, install steps"
```

---

## Out of Scope (Reminder)

Per spec §14, the following are explicitly NOT in this plan:

- ❌ Private repository (Nexus/Artifactory) support
- ❌ JAR file download
- ❌ Gradle as default output (only via `g` shortcut)
- ❌ JAR `pom.xml` / `aar` URL output (v1 main JAR only)
- ❌ Persistent cache, favorites, search history
- ❌ Dependency conflict analysis
- ❌ Manual theme toggle / real-time theme updates
- ❌ Real API key authentication
- ❌ i18n (v1 strings hardcoded zh-CN)
