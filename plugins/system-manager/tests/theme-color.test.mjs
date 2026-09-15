import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import { navigationStyle } from '../scripts/navigation-assets.mjs'
import { root } from '../scripts/config.mjs'

const styleFiles = Object.freeze([
  'public/dashboard/styles.css',
  'modules/startup-manager/src/styles.css',
  'modules/lan-device-discovery/src/styles.css',
  'modules/application-uninstaller/src/styles.css',
  'modules/system-cleaner/public/styles.css',
  'modules/system-diagnostic-report/src/styles.css',
])

const semanticNames = Object.freeze(['--success', '--healthy', '--warning', '--danger', '--error'])

test('frontend styles consume injected primary color without replacing semantic status colors', async () => {
  const sources = await Promise.all(styleFiles.map(async (relative) => [
    relative,
    await readFile(path.join(root, relative), 'utf8'),
  ]))

  for (const [relative, source] of sources) {
    assert.match(source, /--accent:\s*var\(--plugin-primary-color,\s*#315f78\)/, relative)
    assert.match(source, /--(?:accent|focus):\s*var\(--plugin-primary-color,\s*#83abc0\)/, relative)
    for (const semantic of semanticNames) {
      const declarations = source.match(new RegExp(`${semantic}\\s*:[^;]+`, 'g')) || []
      assert.ok(declarations.every((declaration) => !declaration.includes('--plugin-primary-color')), `${relative}: ${semantic} must remain semantic`)
    }
  }
})

test('SuiteBar link and focus colors consume the injected primary color with theme fallbacks', () => {
  assert.match(navigationStyle, /\.system-manager-home-link\s*\{[^}]*color:\s*var\(--plugin-primary-color,\s*#315f78\)/s)
  assert.match(navigationStyle, /\.system-manager-home-link:focus-visible\s*\{[^}]*outline(?:-color)?:\s*(?:3px solid )?var\(--plugin-primary-color,\s*#315f78\)/s)
  assert.match(navigationStyle, /\.system-manager-home-link\s*\{\s*color:\s*var\(--plugin-primary-color,\s*#83abc0\)/s)
  assert.match(navigationStyle, /\.system-manager-home-link:focus-visible\s*\{\s*outline-color:\s*var\(--plugin-primary-color,\s*#83abc0\)/s)
})
