// 将 package-lock.json 的根版本号（顶层 version 与 packages."" 条目）更新为指定版本。
// 用法：node scripts/bump-lock-version.mjs <version>
// 独立成脚本是为了避开 PowerShell 内联 node -e 的引号/转义陷阱。
import { readFileSync, writeFileSync } from 'node:fs'

const version = process.argv[2]
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('用法：node scripts/bump-lock-version.mjs <x.y.z>')
  process.exit(1)
}

const path = 'package-lock.json'
let content = readFileSync(path, 'utf8')

// 顶层 "version"（仅 2 空格缩进），不动依赖包的版本号
content = content.replace(/^ {2}"version": "[^"]+"/m, `  "version": "${version}"`)

// packages."" 根条目的版本号
content = content.replace(
  /(""\s*:\s*\{\s*"name"\s*:\s*"prompt-forge",\s*"version"\s*:\s*")[^"]+(")/,
  `$1${version}$2`,
)

writeFileSync(path, content)
console.log(`package-lock.json → ${version}`)
