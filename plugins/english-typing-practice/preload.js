const { ipcRenderer } = require('electron')

localStorage.setItem("seenUpdate", true)

const DEBUG_FLAG = false

const APP_MODE = Object.freeze({
  NORMAL: 'normal',
  CONCEAL: 'moyu',
})

let __appWinRef = void 0 // 应用窗口
let __settingWinRef = void 0 // 设置窗口

function getWinId(winRef) {
  if (!hasWinInstance(winRef)) return null
  return winRef.webContents.id
}

function hasWinInstance(winRef) {
  console.log('winRef.isDestroyed', winRef?.isDestroyed)
  let hasInstance = !!winRef?.isDestroyed
  if (winRef?.isDestroyed) {
    const result = winRef.isDestroyed()
    hasInstance = result === null ? false : !result
  }
  console.log('hasInstance', hasInstance)
  console.log('winRef?.isDestroyed()', winRef?.isDestroyed())
  return hasInstance
}

// ------------------------------------------------------------

function saveOrUpdateDb(key, data) {
  if (!data) {
    return
  }
  let keyData = window.ztools.db.get(key)
  if (!keyData) {
    window.ztools.db.put({
      _id: key,
      data: data,
    })
    return
  }
  ztools.db.put({
    _id: key,
    data: data,
    _rev: keyData._rev,
  })
}

function filterData(mode, key) {
  let arr = window.ztools.db.get('default')['data']
  return arr.filter((v) => v['mode'] == mode)[0][key]
}

// ------------------------------------------------------------

// 创建应用窗口
function createWindow() {
  if (hasWinInstance(__appWinRef)) {
    console.log('应用窗口已存在')
    __appWinRef.show()
    return null
  }

  let winParams = {}

  try {
    const winInfo = JSON.parse(ztools.dbStorage.getItem('appWinInfo4Normal'))
    // console.log('win info:', winInfo)
    const newWinParams = {
      width: winInfo.size.w,
      height: winInfo.size.h,
      x: winInfo.pos.x,
      y: winInfo.pos.y,
    }
    winParams = newWinParams
  } catch (error) {
    // console.log('窗口信息解析失败', error)
    const defaultWinParams = {
      // center: true,
      width: 800,
      height: 640,
    }
    winParams = defaultWinParams
  }

  __appWinRef = ztools.createBrowserWindow(
    'index.html',
    {
      title: 'Typing',
      minHeight: 100,
      minWidth: 150,
      autoHideMenuBar: true,
      webPreferences: {
        preload: 'preload-app.js',
      },
      ...winParams,
    },
    function (args) {
      DEBUG_FLAG && __appWinRef.webContents.openDevTools({ mode: 'detach' })
      __appWinRef.show()
    },
  )
  return __appWinRef
}
function createConcealWindow(concealState) {
  const { opacity_value, IgnoreMouseEvents, AlwaysOnTop_State, Fullscreen_State } = concealState
  let winParams = {}

  try {
    const winInfo = JSON.parse(ztools.dbStorage.getItem('appWinInfo4Conceal'))
    const newWinParams = {
      width: winInfo.size.w,
      height: winInfo.size.h,
      x: winInfo.pos.x,
      y: winInfo.pos.y,
    }
    winParams = newWinParams
  } catch (error) {
    // console.log('窗口信息解析失败', error)
    const defaultWinParams = {
      // center: true,
      width: 800,
      height: 640,
    }
    winParams = defaultWinParams
  }

  __appWinRef = ztools.createBrowserWindow(
    'index.html',
    {
      show: true,
      title: 'Typing🐟',
      opacity: opacity_value, //透明度
      acceptFirstMouse: true, //是否允许单击页面来激活窗口
      minHeight: 100,
      minWidth: 150,
      // frame: false,
      hasShadow: false,
      webPreferences: {
        preload: './preload-app.js',
      },
      ...winParams,
    },
    () => {
      __appWinRef.show()
      __appWinRef.setOpacity(opacity_value)
      // 鼠标穿透
      __appWinRef.setIgnoreMouseEvents(IgnoreMouseEvents)
      // 置顶
      __appWinRef.setAlwaysOnTop(AlwaysOnTop_State)
      // 窗口全屏
      // ubWindow.setSimpleFullScreen(Fullscreen_State)
      __appWinRef.setFullScreen(Fullscreen_State)
      __appWinRef.setHasShadow(false)
      // __singleWin.setFrameless(true)
      DEBUG_FLAG && __appWinRef.webContents.openDevTools({ mode: 'detach' })
    },
  )
}

function createSettingWindow() {
  if (hasWinInstance(__settingWinRef)) {
    __settingWinRef.show()
    return null
  }
  __settingWinRef = ztools.createBrowserWindow(
    'setting.html',
    {
      title: 'Setting',
      width: 700,
      height: 540,
      minHeight: 200,
      minWidth: 300,
      center: true,
      autoHideMenuBar: true,
      webPreferences: {
        preload: 'preload-setting.js',
      },
    },
    function (args) {
      DEBUG_FLAG && __settingWinRef.webContents.openDevTools({ mode: 'detach' })
      __settingWinRef.show()
      // console.log('ref :', __appWinRef, getWinId(__appWinRef))
      // console.log('info:', __appWinRef, getWinInfo(__appWinRef))

      const info = getWinInfo(__appWinRef)
      __settingWinRef.webContents.send('win-info', {
        // fromId:__,
        info: info,
      })
    },
  )

  return __settingWinRef
}

// 获取窗口信息 (位置&宽高)
function getWinInfo(winRef) {
  if (!hasWinInstance(winRef)) return null

  const size = winRef.getSize()
  const pos = winRef.getPosition()

  // console.log('应用窗口 大小:', size[0], size[1])
  // console.log('应用窗口 位置:', pos[0], pos[1])

  const winInfo = {
    size: { w: size[0], h: size[1] },
    pos: { x: pos[0], y: pos[1] },
  }

  return {
    ...winInfo,
  }
}

// ------------------------------------------------------------

// 应对存储应用状态的数据结构变更
function patchModeDStruct() {
  try {
    // 探测当前保存的数据结构是否为v3.2.0之前的结构,如果是就会出错
    JSON.parse(ztools.dbStorage.getItem('mode'))
  } catch (error) {
    // 更新至最新的应用状态数据结构
    const oldStructMode = ztools.dbStorage.getItem('mode')
    ztools.dbStorage.setItem('mode', JSON.stringify({ type: oldStructMode }))
  }
}

// 设置摸鱼模式存储的默认值
if (!window.ztools.db.get('default')) {
  saveOrUpdateDb('default', [
    { mode: 'mild', opacity: 0.5, IgnoreMouseEvents: false, AlwaysOnTop: false, Fullscreen: false },
    { mode: 'middle', opacity: 0.3, IgnoreMouseEvents: true, AlwaysOnTop: false, Fullscreen: true },
    { mode: 'serious', opacity: 0.2, IgnoreMouseEvents: true, AlwaysOnTop: true, Fullscreen: true },
  ])
}

window.exports = {
  typing: {
    mode: 'none',
    args: {
      enter: (action) => {
        console.log('enter', action)
        const enterMode = APP_MODE.NORMAL

        patchModeDStruct()

        // const currentMode = JSON.parse(ztools.dbStorage.getItem('mode'))?.type

        // if (!hasWinInstance(__appWinRef)) {
        //   createWindow()
        // }

        // const shouldChangeMode = currentMode !== enterMode
        // if (shouldChangeMode) {
        // __appWinRef.close()
        createWindow()
        // } else {
        // __appWinRef.show()
        // }

        //正常模式
        ztools.dbStorage.setItem(
          'mode',
          JSON.stringify({
            type: enterMode,
            payload: {},
          }),
        )
        ztools.hideMainWindow()
        ztools.outPlugin()
      },
    },
  },
  conceal: {
    mode: 'list',
    args: {
      placeholder: '选择摸鱼模式的透明度,默认保存上一次设置',
      enter: (action, callbackSetList) => {
        let list = [
          {
            title: '🐡 轻度摸鱼',
            description: '窗口可缩放可移动不置顶,默认透明度为0.5,窗口自由移动缩放',
            mode: 'mild',
          },
          {
            title: '🐟 中度摸鱼',
            description: '窗口默认全屏,默认透明度0.3,鼠标可穿透窗口,可快速切换后置窗口',
            mode: 'middle',
          },
          {
            title: '🐠 重度摸鱼',
            description: '窗口默认全屏并始终置顶,默认透明度0.2,鼠标可穿透窗口,需掌握电脑快捷键进行切换退出',
            mode: 'serious',
          },
        ]
        for (let index = 2; index < 10; index++) {
          list.push({
            title: '设置窗口透明度：' + `${index / 10}`,
            opacity: index / 10,
          })
        }
        callbackSetList(list)
      },
      select: (action, itemData, callbackSetList) => {
        let mode = 'mild' //模式控制
        let opacity_value = null
        if (itemData.mode) {
          //如果选择的是模式状态
          mode = itemData.mode
          if (window.ztools.db.get('opacity')) {
            opacity_value = window.ztools.db.get('opacity')['data'] //获取上一次设置的透明度
          } else {
            opacity_value = filterData(mode, 'opacity')
          }
          // ztools.showNotification(opacity_value)
          saveOrUpdateDb('conceal_mode', mode) //存储上次的模式，修改透明度则用的是该模式
        } else if (itemData.opacity) {
          //如果选择自定义透明度状态
          opacity_value = itemData.opacity
          saveOrUpdateDb('opacity', itemData.opacity) //更新透明度，下次进入将使用该设置
          mode = window.ztools.db.get('conceal_mode').data //更新使用的模式
        }
        let Fullscreen_State = filterData(mode, 'Fullscreen')
        let AlwaysOnTop_State = filterData(mode, 'AlwaysOnTop')
        let IgnoreMouseEvents = filterData(mode, 'IgnoreMouseEvents')

        // ------------------------------------
        patchModeDStruct()

        const enterMode = APP_MODE.CONCEAL

        const concealState = {
          opacity_value,
          IgnoreMouseEvents,
          AlwaysOnTop_State,
          Fullscreen_State,
        }
        if (!hasWinInstance(__appWinRef)) {
          createConcealWindow(concealState)
        } else {
          __appWinRef.close()
          createConcealWindow(concealState)
        }

        // ztools.dbStorage.setItem('mode', enterMode)
        // 摸鱼模式
        ztools.dbStorage.setItem(
          'mode',
          JSON.stringify({
            type: enterMode,
            payload: {
              mode, //轻度、中度、重度
              concealState,
            },
          }),
        )
        ztools.outPlugin()
      },
    },
  },
  setWinInfo: {
    mode: 'none',
    args: {
      enter: (action) => {
        // 无应用窗口
        if (!hasWinInstance(__appWinRef)) {
          window.alert(
            '英语单词肌肉记忆打字练习：\n检测不到任何模式窗口, 请打开一个应用窗口再尝试(注意：该功能仅支持正常窗口和轻度摸鱼窗口)',
          )
          ztools.outPlugin()
        }

        __appWinRef.show()

        // 判断应用窗口所处模式
        const currentMode = JSON.parse(ztools.dbStorage.getItem('mode'))

        // 获取当前应用窗口 宽高&位置 并保存
        const { size, pos } = getWinInfo(__appWinRef)

        if (currentMode?.type === APP_MODE.NORMAL) {
          ztools.dbStorage.setItem('appWinInfo4Normal', JSON.stringify({ size, pos }))
          window.alert(`英语单词肌肉记忆打字练习：\n (正常模式)设定成功!\n关闭窗口重新打开查看效果。`)
        } else if (currentMode?.type === APP_MODE.CONCEAL) {
          const { mode } = currentMode?.payload
          if (mode === 'mild') {
            ztools.dbStorage.setItem('appWinInfo4Concel', JSON.stringify({ size, pos }))
            window.alert(`英语单词肌肉记忆打字练习：\n (摸鱼模式-轻度)设定成功!\n关闭窗口重新打开查看效果。`)
          } else {
            window.alert('英语单词肌肉记忆打字练习提醒：\n设定无效，该功能仅支持正常窗口和轻度摸鱼窗口')
          }
        }
        ztools.outPlugin()
      },
    },
  },
}
