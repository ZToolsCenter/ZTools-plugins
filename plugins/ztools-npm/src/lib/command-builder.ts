import type { PackageManager } from './types'

export interface Coord {
  name: string
  version?: string
}

export interface InstallOptions {
  dev?: boolean
  global?: boolean
}

export function buildInstallCommand(
  coord: Coord,
  manager: PackageManager = 'npm',
  opts: InstallOptions = {}
): string {
  const target = coord.version ? `${coord.name}@${coord.version}` : coord.name
  switch (manager) {
    case 'pnpm':
      if (opts.global) return `pnpm add -g ${target}`
      return `pnpm add ${opts.dev ? '-D ' : ''}${target}`
    case 'yarn':
      if (opts.global) return `yarn global add ${target}`
      return `yarn add ${opts.dev ? '-D ' : ''}${target}`
    case 'npm':
    default:
      if (opts.global) return `npm install -g ${target}`
      if (opts.dev) return `npm install -D ${target}`
      return `npm install ${target}`
  }
}
