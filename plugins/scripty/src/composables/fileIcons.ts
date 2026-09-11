/**
 * File/folder icon resolution backed by material-icon-theme.
 *
 * The library's `generateManifest()` gives us the same lookup tables VS Code uses
 * (exact file names, longest-matching extension, folder names). We resolve a
 * filename to an icon *name*, then map that name to a bundled SVG asset URL.
 *
 * The SVGs ship with their own brand colors, so they are rendered as <img> — never
 * inlined and recolored via currentColor.
 */
import { generateManifest } from 'material-icon-theme'

/**
 * Eagerly resolve every SVG the package ships to a bundled asset URL. Vite emits
 * each matched file as an asset and inlines its resolved URL here, so lookups are
 * a synchronous Map read with no runtime fetch of the manifest's iconPath.
 */
const iconModules = import.meta.glob('../../node_modules/material-icon-theme/icons/*.svg', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

/** Bare icon name ("javascript") -> bundled asset URL. */
const urlByIconName = new Map<string, string>()
for (const [path, url] of Object.entries(iconModules)) {
  const file = path.split('/').pop() ?? ''
  urlByIconName.set(file.replace(/\.svg$/, ''), url)
}

/** Manifest is pure data (no fs access), safe to generate once in the browser. */
const manifest = generateManifest()

/** Maps a manifest icon name (or its iconDefinitions path) to a bundled asset URL. */
function iconNameToUrl(name: string | undefined): string | undefined {
  if (!name) return undefined
  const direct = urlByIconName.get(name)
  if (direct) return direct
  // Fall back to the iconDefinitions path in case the name carries a suffix.
  const def = manifest.iconDefinitions?.[name]
  if (!def) return undefined
  const file = def.iconPath.split('/').pop() ?? ''
  return urlByIconName.get(file.replace(/\.svg$/, ''))
}

/** Guaranteed generic fallbacks; the package always ships file.svg / folder.svg. */
const FALLBACK_FILE = iconNameToUrl(manifest.file) ?? iconNameToUrl('file')
const FALLBACK_FOLDER = iconNameToUrl(manifest.folder) ?? iconNameToUrl('folder')
const FALLBACK_FOLDER_OPEN = iconNameToUrl(manifest.folderExpanded) ?? iconNameToUrl('folder-open')

/** Resolves a file's icon URL from its full name (with extension), matching VS Code's rules. */
export function fileIconUrl(fileName: string): string {
  const lower = fileName.toLowerCase()
  // 1. Exact file name (e.g. "dockerfile", ".gitignore").
  let name = manifest.fileNames?.[lower]
  // 2. Longest matching extension: "app.d.ts" tries "d.ts" before "ts".
  if (!name) {
    const parts = lower.split('.')
    for (let i = 1; i < parts.length; i++) {
      const hit = manifest.fileExtensions?.[parts.slice(i).join('.')]
      if (hit) {
        name = hit
        break
      }
    }
  }
  return iconNameToUrl(name) ?? (FALLBACK_FILE as string)
}

/** Resolves a folder's icon URL from its name, using the open variant when expanded. */
export function folderIconUrl(folderName: string, expanded = false): string {
  const lower = folderName.toLowerCase()
  const named = expanded ? manifest.folderNamesExpanded?.[lower] : manifest.folderNames?.[lower]
  const fallback = (expanded ? FALLBACK_FOLDER_OPEN : FALLBACK_FOLDER) as string
  return iconNameToUrl(named) ?? fallback
}
