import ts from 'typescript'
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname, relative, extname } from 'node:path'

const source = resolve('vendor/lx/src')
const output = resolve('src-ztools/preload/upstream')
const built = new Set()
const dbOverride = resolve('src-ztools/preload/runtime/database.cjs')
function resolveSource(file) {
  for (const candidate of [file, `${file}.ts`, `${file}.js`, `${file}/index.ts`, `${file}/index.js`]) if (existsSync(candidate) && statSync(candidate).isFile()) return resolve(candidate)
  throw new Error(`Unresolved LX runtime dependency: ${file}`)
}
function compile(input) {
  input = resolveSource(input)
  const target = resolve(output, relative(source, input).replace(/\.(ts|js)$/, '.cjs'))
  if (built.has(input)) return target
  built.add(input)
  mkdirSync(dirname(target), { recursive: true })
  if (extname(input) === '.json') { writeFileSync(target, readFileSync(input)); return target }
  if (input === resolve(source, 'main/worker/dbService/db.ts')) {
    writeFileSync(target, `// LX database backend adapted for ZTools.\nmodule.exports=require(${JSON.stringify(relative(dirname(target), dbOverride).replaceAll('\\', '/'))})\n`)
    return target
  }
  if (input === resolve(source, 'common/mainIpc.ts')) {
    const adapter = relative(dirname(target), resolve('src-ztools/preload/runtime/main-ipc.cjs')).replaceAll('\\', '/')
    writeFileSync(target, `module.exports=require(${JSON.stringify(adapter)})\n`)
    return target
  }
  if (input === resolve(source, 'main/utils/index.ts')) {
    const adapter = relative(dirname(target), resolve('src-ztools/preload/runtime/app-utils.cjs')).replaceAll('\\', '/')
    writeFileSync(target, `module.exports=require(${JSON.stringify(adapter)})\n`)
    return target
  }
  if (input === resolve(source, 'renderer/store/index.ts')) {
    const adapter = relative(dirname(target), resolve('src-ztools/preload/runtime/proxy.cjs')).replaceAll('\\', '/')
    writeFileSync(target, `module.exports=require(${JSON.stringify(adapter)})\n`)
    return target
  }
  const originalSource = readFileSync(input, 'utf8').replace("path.join(os.tmpdir(), 'lxmusic_temp')", 'global.lx.tempDir')
  const text = ts.transpileModule(originalSource, { fileName: input, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, removeComments: false,
  } }).outputText
  const result = text.replace(/require\((['"])([^'"]+)\1\)/g, (match, quote, specifier) => {
    let dependency
    if (specifier === 'electron-log/node') return `require(${JSON.stringify(relative(dirname(target), resolve('src-ztools/preload/runtime/log.cjs')).replaceAll('\\', '/'))})`
    if (specifier.startsWith('@common/')) dependency = resolve(source, 'common', specifier.slice(8))
    else if (specifier.startsWith('@main/')) dependency = resolve(source, 'main', specifier.slice(6))
    else if (specifier.startsWith('@renderer/')) dependency = resolve(source, 'renderer', specifier.slice(10))
    else if (specifier.startsWith('.')) dependency = resolve(dirname(input), specifier)
    else return match
    const dependencyTarget = compile(dependency)
    let spec = relative(dirname(target), dependencyTarget).replaceAll('\\', '/')
    if (!spec.startsWith('.')) spec = './' + spec
    return `require(${JSON.stringify(spec)})`
  })
  const contextModule = relative(dirname(target), resolve('src-ztools/preload/runtime/context.cjs')).replaceAll('\\', '/')
  writeFileSync(target, `// Readable LX source adaptation. Upstream 323e4bac; Apache-2.0.\nconst lxRuntimeContext=require(${JSON.stringify(contextModule)});\n${result.replace(/global\.lx\b/g, 'lxRuntimeContext.lx').replaceAll('process.versions.app', JSON.stringify('2.12.6')).replace("console.log('---start---', url);", '')}`)
  return target
}
for (const entry of ['main/worker/dbService/modules/index.ts', 'main/worker/dbService/tables.ts', 'main/worker/dbService/migrate.ts', 'common/defaultSetting.ts', 'common/defaultHotKey.ts', 'common/utils/nodejs.ts', 'common/theme/index.json', 'common/ipcNames.ts', 'main/event/index.ts', 'main/modules/commonRenderers/list/rendererEvent.ts', 'main/modules/commonRenderers/list/winRendererEvent.ts', 'main/modules/commonRenderers/dislike/rendererEvent.ts', 'main/modules/commonRenderers/dislike/winRendererEvent.ts', 'main/modules/winMain/rendererEvent/music.ts', 'main/modules/winMain/rendererEvent/download.ts', 'renderer/utils/request.js', 'renderer/worker/main/common.ts', 'renderer/worker/main/list.ts', 'renderer/worker/main/music.ts']) compile(resolve(source, entry))
console.log(`Adapted ${built.size} readable LX runtime modules (no bundling/minification)`)
