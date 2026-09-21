// SFC 编译与模板绑定校验 —— node tests/check-sfc.mjs [file]
//
// 为什么需要：Vite 构建**不会**因为模板里引用了 <script setup> 未暴露的标识符而报错
// （运行时才渲染为空）。本脚本用 @vue/compiler-sfc 编译模板，并检查是否出现了
// `_ctx.xxx` 形式的属性访问——那正是「绑定未暴露」的信号。
//
// 用法: node tests/check-sfc.mjs src/App.vue
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const file = resolve(process.argv[2] || 'src/App.vue')
const source = readFileSync(file, 'utf8')

const { descriptor, errors } = parse(source, { filename: file })
if (errors.length) {
  console.error('✗ SFC 解析失败:')
  for (const e of errors) console.error('   ', e.message || e)
  process.exit(1)
}
console.log(`✓ SFC 解析通过（${file}）`)

if (!descriptor.scriptSetup && !descriptor.script) {
  console.log('  （无 <script>，跳过脚本/模板编译）')
  process.exit(0)
}

const script = compileScript(descriptor, { id: 'sfccheck' })
const bindings = script.bindings || {}
console.log(`✓ <script setup> 编译通过，顶层绑定 ${Object.keys(bindings).length} 个`)

if (!descriptor.template) {
  console.log('  （无 <template>，跳过模板编译）')
  process.exit(0)
}

const tpl = compileTemplate({
  source: descriptor.template.content,
  filename: file,
  id: 'sfccheck',
  compilerOptions: { bindingMetadata: bindings }
})
if (tpl.errors.length) {
  console.error('✗ 模板编译失败:')
  for (const e of tpl.errors) console.error('   ', e.message || e)
  process.exit(1)
}
console.log('✓ 模板编译通过')

// 模板中未解析的顶层标识符会退化成 `_ctx.foo`。白名单内的是 Vue 内置/正常运行时属性。
const ALLOWED = new Set([
  '$slots', '$attrs', '$props', '$emit', '$refs', '$el', '$options', '$forceUpdate',
  '$nextTick', '$watch', '$data', '$root', '$parent', '$children'
])
const unresolved = new Set()
for (const m of tpl.code.matchAll(/_ctx\.([A-Za-z_$][\w$]*)/g)) {
  if (!ALLOWED.has(m[1])) unresolved.add(m[1])
}

if (unresolved.size) {
  console.error(`✗ 有 ${unresolved.size} 个模板绑定未被 <script setup> 暴露：`)
  for (const name of [...unresolved].sort()) console.error(`    _ctx.${name}`)
  process.exit(1)
}
console.log('✓ 模板所有绑定均已由 <script setup> 暴露（无 _ctx.xxx 回落）')
