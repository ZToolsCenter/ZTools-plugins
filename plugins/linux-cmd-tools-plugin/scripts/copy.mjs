import fs from 'node:fs'
import path from 'node:path'

const src = path.resolve('node_modules/linux-command/command')
const dest = path.resolve('src/command')

fs.mkdirSync(dest, { recursive: true })
fs.cpSync(src, dest, { recursive: true })
