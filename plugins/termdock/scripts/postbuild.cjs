const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const sourceModules = path.join(root, 'node_modules')
const targetModules = path.join(root, 'dist', 'node_modules')
const runtimePackages = ['ssh2', 'basic-ftp', 'iconv-lite']
const copied = new Set()
const readmePath = path.join(root, 'README.md')
const distReadmePath = path.join(root, 'dist', 'README.md')

if (fs.existsSync(readmePath)) {
  fs.copyFileSync(readmePath, distReadmePath)
}

fs.rmSync(targetModules, { recursive: true, force: true })
fs.mkdirSync(targetModules, { recursive: true })

for (const packageName of runtimePackages) {
  copyPackageWithDependencies(packageName)
}

console.log(`Copied ${copied.size} preload runtime packages to dist/node_modules`)

function copyPackageWithDependencies(packageName) {
  if (copied.has(packageName)) {
    return
  }
  copied.add(packageName)

  const sourceDir = packageDir(sourceModules, packageName)
  const targetDir = packageDir(targetModules, packageName)
  const packageJsonPath = path.join(sourceDir, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Missing dependency: ${packageName}`)
  }

  fs.mkdirSync(path.dirname(targetDir), { recursive: true })
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(sourceDir, source)
      if (!relative) {
        return true
      }
      return !relative.startsWith('.git')
        && !relative.includes(`${path.sep}.cache${path.sep}`)
        && !relative.includes(`${path.sep}test${path.sep}`)
        && !relative.includes(`${path.sep}tests${path.sep}`)
    }
  })

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.optionalDependencies
  }

  for (const dependencyName of Object.keys(deps)) {
    copyPackageWithDependencies(dependencyName)
  }
}

function packageDir(base, packageName) {
  if (packageName.startsWith('@')) {
    const [scope, name] = packageName.split('/')
    return path.join(base, scope, name)
  }
  return path.join(base, packageName)
}
