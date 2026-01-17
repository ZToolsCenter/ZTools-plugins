const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')

window.utools = {
  ...window.ztools,
  getAppVersion: () => {
    return '7.3.1'
  },
  onMainPush: (param1, param2) => {
    console.log(param1, param2)
  }
}

window.features = {
  code: '',
  type: '',
  payload: '',
  from: ''
}
utools.onPluginEnter(({ code, type, payload }) => {
  features = { code, type, payload }
})

// 上传图片获取base64格式url
window.getBase64 = url => {
  return new Promise((resolve, reject) => {
    fs.readFile(url, (err, data) => {
      if (err) {
        reject(err)
      } else {
        const ext = path.extname(url).toLowerCase()
        let type = url.endsWith('.svg')
          ? 'image/svg+xml'
          : `image/${ext.slice(1)}`
        const imgSrc = 'data:' + type + ';base64,' + data.toString('base64')
        resolve(imgSrc)
      }
    })
  })
}

// 文件读取
window.readFile = path => {
  return new Promise((resolve, reject) => {
    fs.readFile(path, (err, data) => {
      if (err) {
        reject(err)
      } else {
        resolve(data)
      }
    })
  })
}

// 文件写入 二进制encoding设置为null
window.writeFile = (path, data, encoding = 'utf-8') => {
  return new Promise((resolve, reject) => {
    fs.writeFile(path, data, encoding, err => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}
// 创建文件夹
window.mkdir = path => {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(path)) {
      fs.mkdir(path, err => {
        if (err) reject(err)
      })
    }
    resolve(path)
  })
}

// 读取备份文件夹
window.readBackup = folderPath => {
  return new Promise((resolve, reject) => {
    fs.readdir(folderPath, (err, files) => {
      if (err) reject(err)
      let backupJson = {},
        backupFiles = []
      files.forEach(file => {
        const filePath = path.join(folderPath, file)
        // 检查是否是json文件
        if (path.extname(filePath).match(/\.(json)$/i)) {
          backupJson = fs.readFileSync(filePath, 'utf-8')
        }
        // 检查是否是图片附件
        if (
          file.startsWith('pic_') &&
          path.extname(filePath).match(/\.(png|jpg|jpeg|svg|bmp|webp|gif)$/i)
        ) {
          const ext = path.extname(file).toLowerCase()
          const type =
            ext === '.svg' ? 'image/svg+xml' : `image/${ext.slice(1)}`
          const fileData = {
            name: file.replace(ext, ''),
            type,
            uint8Array: fs.readFileSync(filePath),
          }
          backupFiles.push(fileData)
        }
      })
      resolve({ backupJson, backupFiles })
    })
  })
}

window.browserOpen = (url, browser = null) => {
  if (!browser) {
    utools.shellOpenExternal(url)
    return
  }
  if (utools.isMacOS()) {
    openInMacOS(url, browser)
  } else if (utools.isLinux()) {
    openInLinux(url, browser)
  } else {
    openInWindows(url, browser)
  }
}
function openInMacOS(url, browser) {
  let command = ''
  switch (browser) {
    case 'chrome':
      command = `open -a "Google Chrome" "${url}"`
      break
    case 'chrome-incognito':
      command = `open -a "Google Chrome" --args --incognito "${url}"`
      break
    case 'edge':
      command = `open -a "Microsoft Edge" "${url}"`
      break
    case 'edge-inprivate':
      command = `open -a "Microsoft Edge" --args --inprivate "${url}"`
      break
    case 'safari':
      command = `open -a "Safari" "${url}"`
      break
    case 'firefox':
      command = `open -a "Firefox" "${url}"`
      break
    default:
      command = `open "${url}"`
  }

  // exec(command)
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`执行的错误: ${error}`)
      return
    }
    if (stderr) {
      console.error(`执行的错误输出: ${stderr}`)
      return
    }
    // console.log(`执行的输出: ${stdout}`);
  })
  // spawn('open', ['-a', browser, url]);
}

function openInLinux(url, browser) {
  let command
  switch (browser) {
    case 'chrome':
      command = 'google-chrome'
      break
    case 'chrome-incognito':
      command = 'google-chrome --incognito'
      break
    case 'edge':
      command = 'microsoft-edge'
      break
    case 'edge-inprivate':
      command = 'microsoft-edge --inprivate'
      break
    case 'firefox':
      command = 'firefox'
      break
    default:
      command = 'xdg-open'
  }
  exec(`${command} "${url}"`)
  // spawn(command, [url]);
}

function openInWindows(url, browser) {
  let command = ''

  switch (browser) {
    case 'chrome':
      command = `start chrome "${url}"`
      break
    case 'chrome-incognito':
      command = `start chrome --incognito "${url}"`
      break
    case 'edge':
      command = `start msedge "${url}"`
      break
    case 'edge-inprivate':
      command = `start msedge --inprivate "${url}"`
      break
    case 'firefox':
      command = `start firefox "${url}"`
      break
    case 'ie':
      command = `start iexplore "${url}"`
      break
    default:
      command = `start "${url}"`
  }
  // 执行命令
  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`执行的错误: ${error}`)
      return
    }
    if (stderr) {
      console.error(`执行的错误输出: ${stderr}`)
      return
    }
    // console.log(`执行的输出: ${stdout}`);
  })
  // exec(command);
}

// 删除 .el-form--default 元素的前三个子元素
function removeFormElements() {
  console.log('监听')
  const el = document.querySelector('.el-form--default');

  if (el && el.children.length == 6) {
    // 删除前三个子元素
    for (let i = 0; i < 3; i++) {
      if (el.firstElementChild) {
        el.removeChild(el.firstElementChild);
      }
    }
    console.log('已删除 .el-form--default 的前三个子元素');
  }
}

// 持续监听 DOM 变化
function startFormElementsObserver() {
  // 使用 MutationObserver 持续监听 DOM 变化
  const observer = new MutationObserver((mutations) => {
    removeFormElements();
  });

  // 开始监听
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // 立即执行一次
  removeFormElements();

  console.log('已启动 .el-form--default 元素监听');
}

// 在 DOM 加载完成后启动监听
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startFormElementsObserver);
} else {
  // DOM 已经加载完成，立即启动监听
  startFormElementsObserver();
}
