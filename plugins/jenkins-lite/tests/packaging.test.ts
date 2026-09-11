import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error JavaScript packaging helper
import { toPackagedManifest } from '../scripts/prepare-package.mjs'

function readJson(path: string) {
  return JSON.parse(readFileSync(resolve(path), 'utf8'))
}

describe('plugin packaging metadata', () => {
  it('uses the published Jenkins Lite id throughout the project', () => {
    const packageJson = readJson('package.json')
    const pluginJson = readJson('plugin.json')
    const devPluginJson = readJson('public/plugin.json')

    expect(packageJson.name).toBe('jenkins-lite')
    expect(pluginJson.name).toBe('jenkins-lite')
    expect(devPluginJson.name).toBe('jenkins-lite')
  })

  it('points development mode at the configured Vite port', () => {
    const pluginJson = readJson('plugin.json')
    const devPluginJson = readJson('public/plugin.json')

    expect(pluginJson.development.main).toBe('http://localhost:5180')
    expect(devPluginJson.development.main).toBe('http://localhost:5180')
  })

  it('removes development-only metadata from the packaged manifest', () => {
    const pluginJson = readJson('plugin.json')
    const packagedManifest = toPackagedManifest(pluginJson)

    expect(packagedManifest.name).toBe('jenkins-lite')
    expect(packagedManifest.main).toBe('index.html')
    expect(packagedManifest).not.toHaveProperty('development')
  })

  it('marks the packaged plugin root as CommonJS for preload.js', () => {
    expect(existsSync(resolve('public/package.json'))).toBe(true)
    expect(readJson('public/package.json').type).toBe('commonjs')
  })
})
