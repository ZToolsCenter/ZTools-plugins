const defaults = require('../upstream/common/defaultSetting.cjs').default
const migrateSetting = require('../upstream/common/utils/migrateSetting.cjs').default
const { toNewMusicInfo, fixNewMusicInfoQuality, filterMusicList } = require('../upstream/common/utils/tools.cjs')
const { exportLists } = require('./export-lists.cjs')
const { normalizeSettingPatch } = require('./settings.cjs')
const kinds = ['all', 'lists', 'settings']
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
function assert(value, message) { if (!value) throw new Error('无效的 LX 备份：' + message) }
function createBackup({ data, settings, files, onCommit }) {
  function allLists() {
    return [{ id: 'default', name: '默认列表' }, { id: 'love', name: '我的收藏' }, ...data.call('list', 'getAllUserList')]
      .map(list => ({ ...list, list: data.call('list', 'getListMusics', [list.id]) }))
  }
  function parse(document, kind) {
    assert(kinds.includes(kind), '不支持的导入类型')
    assert(object(document), '文件内容必须是对象')
    const type = document.type
    const accepted = { all: ['allData', 'allData_v2'], lists: ['playList', 'playList_v2', 'defautlList'], settings: ['setting', 'setting_v2'] }
    assert(accepted[kind].includes(type), '备份格式或版本不支持')
    const legacy = !type.endsWith('_v2')
    let patch, lists
    if (kind === 'all' || kind === 'settings') {
      const original = kind === 'all' ? document.setting : document.data
      assert(object(original), '缺少设置对象')
      const setting = legacy ? migrateSetting(JSON.parse(JSON.stringify(original))) : original
      if (setting.version != null) assert(typeof setting.version === 'string' && Number(setting.version.split('.')[0]) <= 2, '设置版本不支持')
      patch = Object.fromEntries(Object.entries(setting).filter(([key, value]) => Object.hasOwn(defaults, key) && value !== undefined))
      patch['common.isAgreePact'] = false
      // Validate the complete patch before any SQL is changed.
      try { patch = normalizeSettingPatch(patch) }
      catch (error) { assert(false, '设置类型错误：' + error.message) }
    }
    if (kind === 'all' || kind === 'lists') {
      lists = kind === 'all' ? document.defaultList ? [{ id: 'default', name: '默认列表', list: document.defaultList.list }] : document.playList
        : type === 'defautlList' ? [{ id: 'default', name: '默认列表', list: document.data?.list }] : document.data
      assert(Array.isArray(lists), '缺少歌单数组')
      const seen = new Set()
      lists = lists.map(info => {
        assert(object(info) && (typeof info.id === 'string' || typeof info.id === 'number') && String(info.id), '歌单 ID 无效')
        const id = String(info.id)
        assert(!seen.has(id) && id !== 'temp', '重复或保留的歌单 ID'); seen.add(id)
        assert(typeof info.name === 'string' && Array.isArray(info.list), '歌单结构无效')
        const converted = info.list.map(song => {
          assert(object(song) && typeof song.name === 'string' && song.name && typeof song.source === 'string', '歌曲结构无效')
          if (legacy) song = toNewMusicInfo(song)
          assert(typeof song.id === 'string' && song.id && object(song.meta), '歌曲 ID 或 meta 无效')
          if (song.source !== 'local') assert(object(song.meta._qualitys) && Array.isArray(song.meta.qualitys), '歌曲音质结构无效')
          return fixNewMusicInfoQuality(song)
        })
        return { id, name: info.name, source: info.source ?? null, sourceListId: info.sourceListId == null ? null : String(info.sourceListId), locationUpdateTime: info.locationUpdateTime ?? null, list: filterMusicList(converted) }
      })
    }
    return { patch, lists }
  }
  return {
    async export(kind, path) {
      assert(kinds.includes(kind), '不支持的导出类型')
      const document = kind === 'all' ? { type: 'allData_v2', setting: settings.get(), playList: allLists() }
        : kind === 'lists' ? { type: 'playList_v2', data: allLists() } : { type: 'setting_v2', data: settings.get() }
      await files.call('saveLxConfigFile', [path, document])
    },
    async import(path, kind) {
      const parsed = parse(await files.call('readLxConfigFile', [path]), kind)
      let listData, nextSetting
      if (parsed.lists) {
        const merged = allLists()
        for (const list of parsed.lists) {
          const existing = merged.find(value => value.id === list.id)
          if (existing) existing.list = list.list
          else merged.push(list)
        }
        listData = { defaultList: merged[0].list, loveList: merged[1].list, userList: merged.slice(2) }
      }
      data.transaction(() => {
        if (parsed.patch) nextSetting = settings.update(parsed.patch)
        if (listData) data.call('list', 'listDataOverwrite', [listData])
      })
      // The sole publication point follows successful commit of BOTH settings and lists.
      onCommit?.({ setting: nextSetting, patch: parsed.patch, listData })
    },
    allLists,
    exportListText: (path, format, merge = true) => exportLists(files, path, allLists(), format, merge),
  }
}
module.exports = { createBackup }
