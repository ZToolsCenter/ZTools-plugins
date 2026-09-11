/**
 * Dynamically generate plugin icons (SVG → PNG).
 * Change SAMPLE_LETTER to customize the demo glyph used in icons.
 * Renders each icon in a worker thread for parallel CPU work.
 */
const fs = require('fs')
const path = require('path')
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads')

const PNG_SIZE = 128

if (!isMainThread) {
  const { Resvg } = require('@resvg/resvg-js')
  const { svg, out, size } = workerData
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: true },
  })
  const png = resvg.render().asPng()
  fs.writeFileSync(out, png)
  parentPort.postMessage({ out, bytes: png.length })
} else {
  /** Example letter shown in icons */
  const SAMPLE_LETTER = 't'

  const publicDir = path.join(__dirname, '..', 'public')
  const FONT = 'Segoe UI, Arial, sans-serif'

  function normalizeLetter(raw) {
    const ch = String(raw ?? '').trim()
    if (!ch) {
      throw new Error('SAMPLE_LETTER must be a non-empty character')
    }
    const letter = [...ch][0]
    const lower = letter.toLowerCase()
    const upper = letter.toUpperCase()
    if (lower === upper) {
      console.warn(`Warning: "${letter}" has no case distinction; icons may look identical.`)
    }
    return { lower, upper }
  }

  function esc(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  function svgRoot(bg, body) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="14" fill="${bg}"/>
${body}
</svg>`
  }

  function letterText(x, y, text, fontSize) {
    return `  <text x="${x}" y="${y}" text-anchor="middle" font-family="${FONT}" font-size="${fontSize}" font-weight="700" fill="#fff">${esc(text)}</text>`
  }

  function arrow(y, stroke, strokeWidth = 3, headSize = 4) {
    const mid = y
    const tip = mid
    return [
      `  <path d="M28 ${mid}h8" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round"/>`,
      `  <path d="M34 ${tip - headSize}l${headSize} ${headSize}-${headSize} ${headSize}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    ].join('\n')
  }

  function buildSvgs({ lower, upper }) {
    return {
      logo: svgRoot('#2563EB', letterText(32, 42, `${upper}${lower}`, 28)),
      smart: svgRoot(
        '#2563EB',
        [
          `  <path d="M20 38l12-20 12 20" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
          `  <path d="M24 38h16" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`,
          `  <path d="M18 48h28" stroke="#93C5FD" stroke-width="3" stroke-linecap="round"/>`,
        ].join('\n'),
      ),
      upper: svgRoot(
        '#1D4ED8',
        [
          letterText(18, 40, lower, 24),
          arrow(32, '#BFDBFE'),
          letterText(48, 40, upper, 24),
        ].join('\n'),
      ),
      lower: svgRoot(
        '#0EA5E9',
        [
          letterText(18, 40, upper, 24),
          arrow(32, '#BAE6FD'),
          letterText(48, 40, lower, 24),
        ].join('\n'),
      ),
      invert: svgRoot(
        '#7C3AED',
        [
          letterText(18, 26, upper, 18),
          arrow(20, '#E9D5FF', 2.5, 3),
          letterText(48, 26, lower, 18),
          letterText(18, 50, lower, 18),
          arrow(44, '#E9D5FF', 2.5, 3),
          letterText(48, 50, upper, 18),
        ].join('\n'),
      ),
      title: svgRoot('#059669', letterText(32, 40, `${upper}${lower} ${upper}${lower}`, 22)),
      camel: svgRoot('#D97706', letterText(32, 42, `a${upper}a${upper}`, 24)),
      pascal: svgRoot('#EA580C', letterText(32, 42, `${upper}a${upper}a`, 24)),
      snake: svgRoot('#64748B', letterText(32, 40, `${lower}_${lower}_${lower}`, 26)),
      screaming: svgRoot('#BE123C', letterText(32, 40, `${upper}_${upper}_${upper}`, 20)),
    }
  }

  /** 在独立线程中渲染并写入一张 PNG */
  function writePngConcurrent(name, svg) {
    const out = path.join(publicDir, `${name}.png`)
    return new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: { svg, out, size: PNG_SIZE },
      })
      worker.on('message', (msg) => {
        console.log(`Wrote ${path.relative(process.cwd(), msg.out)} (${msg.bytes} bytes)`)
        resolve(msg)
      })
      worker.on('error', reject)
      worker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`Icon worker exited with code ${code} (${name})`))
      })
    })
  }

  async function main() {
    fs.mkdirSync(publicDir, { recursive: true })
    const sample = normalizeLetter(SAMPLE_LETTER)
    const svgs = buildSvgs(sample)
    const started = Date.now()

    await Promise.all(
      Object.entries(svgs).map(([name, svg]) => writePngConcurrent(name, svg)),
    )

    console.log(
      `Done in ${Date.now() - started}ms. SAMPLE_LETTER = "${SAMPLE_LETTER}" → upper "${sample.upper}" / lower "${sample.lower}"`,
    )
  }

  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
