const fs = require('fs')
const path = require('path')

if (window.ztools) {
  window.utools = window.ztools
}


const preload = {
  fs: {
    readFileSync(path) {
      return fs.readFileSync(path, {
        encoding: 'utf8'
      })
    },
    writeFileSync(path, data) {
      return fs.writeFileSync(path, data, {
        encoding: 'utf8'
      })
    }
  },
  path: {
    dirname: path.dirname,
    basename: path.basename,
    extname: path.extname
  },
  close: () => {
    process.exit()
  }
}

window.preload = preload
