const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const dist = path.join(root, 'dist')

for (const name of ['plugin.json', 'preload.js', 'logo.png']) {
  const src = path.join(root, name)
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(dist, name))
    console.log('copied', name, '-> dist/')
  } else {
    console.warn('missing', name)
  }
}
