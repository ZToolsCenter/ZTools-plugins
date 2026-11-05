import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, '..')
const svgPath = path.join(projectRoot, 'assets/logo.svg')
const pngPath = path.join(projectRoot, 'src-ztools/logo.png')

const svg = fs.readFileSync(svgPath, 'utf8')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 2 })
await page.goto('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg))
const root = await page.locator('svg').first()
await root.screenshot({ path: pngPath, omitBackground: true })
await browser.close()
console.log('logo written:', pngPath)
