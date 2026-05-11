const { webFrame } = require('electron')

const DictsListKey = 'CustomDictsListKey'
const LocalStorageKeys = 'MigrateLocalStorageKeys'
const UserDataKey = 'x-user-data'

const db = ztools.db
const dbStorage = ztools.dbStorage

window.ztools.fetchUserPayments = () => {
  return [{ attach: 'c' }]
  // return []
}
window.ztools.getFeatures = () => {
  return []
}
window.ztools.setFeature = (feature) => {
  console.log('setFeature', feature)
}
window.ztools.removeFeature = (code) => {
  console.log('removeFeature', code)
}

window.migrateUtoolsToLocalStorage = () => {
  // console.log('migrate U -> B')
  const storageKeys = db.allDocs([LocalStorageKeys])[0]?.value
  if (!storageKeys) return false

  const allDocs = db.allDocs(storageKeys)
  for (const item of allDocs) {
    const { _id: key, value } = item
    localStorage.setItem(key, value)
  }
  return true
}
window.migrateLocalStorageToUtools = () => {
  // console.log('migrate B -> U')
  const storageKeys = new Array()
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (/^x-/.test(key)) continue
    storageKeys.push(key)
    const value = localStorage.getItem(key)
    dbStorage.setItem(key, value)
  }
  dbStorage.setItem(LocalStorageKeys, storageKeys)
  return true
}

// ---------------------------------------------------------------

// window.

// ---------------------------------------------------------------

window.readLocalDictConfig = () => {
  const _config = dbStorage.getItem(DictsListKey)
  console.log('读取到配置', JSON.stringify(_config))
  return Array.isArray(_config) ? _config : []
}
window.writeLocalDictConfig = (config) => {
  const _config = Array.isArray(config) ? config : []
  dbStorage.setItem(DictsListKey, _config)
  console.log('写入配置', JSON.stringify(_config))
}

//自定义词典属性
const customDictDefaultMeta = {
  category: 'defaultCustom',
  languageCategory: 'custom',
  tags: ['自己动手丰衣足食'],
}
//错题集词典属性
const mistakeDictDefaultMeta = {
  category: 'mistakeDefault',
  languageCategory: 'mistake',
  tags: ['拾遗补缺'],
}
const addDictMeta = (dictMeta, meta) => {
  const _meta = {
    ...dictMeta,
    ...meta,
  }
  const config = readLocalDictConfig()
  config.push(_meta)
  writeLocalDictConfig(config)
  return true
}
const delDictMeta = (dictId) => {
  const config = readLocalDictConfig()

  const index = config.findIndex((item) => item.id === dictId)
  if (index !== -1) {
    config.splice(index, 1)
  }
  return writeLocalDictConfig(config)
}

window.newLocalDict = (filePath, dictMeta) => {
  const txtBuffer = require('fs').readFileSync(filePath)
  const result = db.postAttachment(dictMeta.id, txtBuffer, 'application/json')

  return result.ok && addDictMeta(dictMeta)
}

window.newLocalDictFromJson = (jsonData, dictMeta) => {
  const jsonString = JSON.stringify(jsonData)
  const txtBuffer = Buffer.from(jsonString)
  const result = db.postAttachment(dictMeta.id, txtBuffer, 'application/json')

  return result.ok && addDictMeta(dictMeta, customDictDefaultMeta)
}
window.newLocalMistakeDictFromJson = (jsonData, dictMeta) => {
  const jsonString = JSON.stringify(jsonData)
  const txtBuffer = Buffer.from(jsonString)

  window.delLocalDict(dictMeta.id)
  const result = db.postAttachment(dictMeta.id, txtBuffer, 'application/json')

  return result.ok && addDictMeta(dictMeta, mistakeDictDefaultMeta)
}

window.readLocalDict = async (dictId) => {
  const uint8Array = await ztools.db.promises.getAttachment(dictId)
  const decoder = new TextDecoder('utf-8')
  const decodedString = decoder.decode(uint8Array)
  return JSON.parse(decodedString)
}

window.delLocalDict = (dictId) => {
  db.remove(dictId)
  delDictMeta(dictId)
  return true
}

window.delAllMistakDict = () => {
  const dicts = window.readLocalDictConfig()
  for (const d of dicts) {
    if (/^x-mdict/.test(d.id)) {
      window.delLocalDict(d.id)
    }
  }
}

// ---------------------------------------------------------------
window.postUToolsUserData = async (fileBuffer) => {
  db.remove(UserDataKey)
  const result = await db.promises.postAttachment(UserDataKey, fileBuffer, 'application/gzip')
  return result.ok
}
window.getUToolsUserData = async () => {
  let uint8Array
  try {
    uint8Array = await db.promises.getAttachment(UserDataKey)
  } catch (error) {
    // console.log('getUtoolsUserData', error)
    uint8Array = new uint8Array()
  }
  return uint8Array
}
window.postDB = async (key, fileBuffer) => {
  db.remove(key)
  const result = await db.promises.postAttachment(key, fileBuffer, 'application/gzip')
  return result.ok
}
window.getDB = async (key) => {
  const uint8Array = await db.promises.getAttachment(key)
  return uint8Array
}
// ---------------------------------------------------------------

window.getMode = () => {
  return ztools.dbStorage.getItem('mode')
}

// ---------------------------------------------------------------
/**
 * 窗口缩放
 */
const defaultZoomRate = 1.0
const zoomRateRange = Object.freeze({ MIN: 0.5, MAX: 3.0 })

let zoom_rate = 1.0
zoom_rate = initZoomRate()

function initZoomRate() {
  let rate = ztools.dbStorage.getItem('zoom_rate')
  if (typeof rate !== 'number' || rate < zoomRateRange.MIN || rate > zoomRateRange.MAX) {
    rate = defaultZoomRate
  }
  setAppWinZoom(rate)
  return rate
}
function setAppWinZoom(rate = 1.0) {
  if (typeof zoom_rate !== 'number' || zoom_rate < zoomRateRange.MIN || zoom_rate > zoomRateRange.MAX) {
    zoom_rate = defaultZoomRate
  } else {
    zoom_rate = rate
  }
  zoom_rate = parseFloat(zoom_rate.toFixed(2))
  webFrame.setZoomFactor(zoom_rate)
  ztools.dbStorage.setItem('zoom_rate', zoom_rate)
}
function setAppWinZoomIn() {
  zoom_rate -= 0.05
  if (zoom_rate < zoomRateRange.MIN) zoom_rate = zoomRateRange.MIN
  setAppWinZoom(zoom_rate)
}
function setAppWinZoomOut() {
  zoom_rate += 0.05
  if (zoom_rate > zoomRateRange.MAX) zoom_rate = zoomRateRange.MAX
  setAppWinZoom(zoom_rate)
}
function setAppWinDefaultZoom() {
  zoom_rate = 1.0
  setAppWinZoom(zoom_rate)
}
window.setAppWinZoom = setAppWinZoom
window.setAppWinZoomIn = setAppWinZoomIn
window.setAppWinZoomOut = setAppWinZoomOut
window.setAppWinDefaultZoom = setAppWinDefaultZoom
// ---------------------------------------------------------------
