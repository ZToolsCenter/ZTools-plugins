import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, join, relative, sep } from 'node:path'
import { check } from './check.mjs'
import packaging from '../build-config/ztools/package.cjs'
import { createHash } from 'node:crypto'
const manifest = check()
const outputRoot = resolve('dist-ztools')
mkdirSync(outputRoot, { recursive: true })
const temporary = mkdtempSync(join(outputRoot, 'assembly-'))
const staging = join(temporary, manifest.name)
const output = join(outputRoot, `${manifest.name}-${manifest.version}.zip`)
try {
  packaging.assemble({ source: resolve('src-ztools'), destination: staging })
  // Stable entry order and timestamps make equal build inputs produce equal ZIPs.
  const script = `Add-Type -AssemblyName System.IO.Compression
  $source = $env:LX_PACKAGE_SOURCE
  $stream = [System.IO.File]::Open($env:LX_PACKAGE_OUTPUT, [System.IO.FileMode]::Create)
  $archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    Get-ChildItem -LiteralPath $source -File -Recurse | Sort-Object FullName | ForEach-Object {
      $name = $_.FullName.Substring($source.Length + 1).Replace('\\', '/')
      $entry = $archive.CreateEntry($name, [System.IO.Compression.CompressionLevel]::Optimal)
      $entry.LastWriteTime = [DateTimeOffset]::Parse('2000-01-01T00:00:00Z')
      $inputStream = [System.IO.File]::OpenRead($_.FullName)
      $entryStream = $entry.Open()
      try { $inputStream.CopyTo($entryStream) } finally { $inputStream.Dispose(); $entryStream.Dispose() }
    }
  } finally { $archive.Dispose(); $stream.Dispose() }`
  execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { env: { ...process.env, LX_PACKAGE_SOURCE: staging, LX_PACKAGE_OUTPUT: output }, stdio: 'inherit' })
  const sha256 = createHash('sha256').update(readFileSync(output)).digest('hex')
  writeFileSync(output + '.sha256', `${sha256}  ${manifest.name}-${manifest.version}.zip\n`)
} finally {
  const within = relative(outputRoot, resolve(temporary))
  if (!within || within.startsWith('..') || within.includes(sep) || !within.startsWith('assembly-')) throw new Error('拒绝清理非打包临时目录')
  rmSync(temporary, { recursive: true, force: true })
}
console.log(output)
