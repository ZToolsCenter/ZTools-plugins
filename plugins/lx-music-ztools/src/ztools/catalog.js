import { search as searchMusic } from '@renderer/store/search/music/action'
import { listInfos } from '@renderer/store/search/music/state'
import * as boards from '@renderer/store/leaderboard/action'
import * as songLists from '@renderer/store/songList/action'
import { listInfo } from '@renderer/store/songList/state'
import { getMusicUrl } from '@renderer/core/music/online'
const platforms = ['kw', 'kg', 'tx', 'wy', 'mg']
function source(value, allowAll = false) {
  if (!platforms.includes(value) && !(allowAll && value === 'all')) throw new TypeError('Invalid music platform')
  return value
}
function page(value) { if (!Number.isInteger(value) || value < 1) throw new TypeError('Invalid page'); return value }
const snapshot = value => JSON.parse(JSON.stringify(value))
export async function search({ text, source: platform = 'all', page: number = 1 }) {
  if (typeof text !== 'string') throw new TypeError('Invalid search text')
  await searchMusic(text.trim(), page(number), source(platform, true))
  return snapshot(listInfos[platform])
}
window.lxCatalog = {
  search,
  resolve: (musicInfo, quality = '128k') => getMusicUrl({ musicInfo, quality, isRefresh: true, allowToggleSource: false }),
  boards: platform => boards.getBoardsList(source(platform)),
  board: (platform, id, number = 1, refresh = false) => boards.getListDetail(`${source(platform)}__${id}`, page(number), refresh),
  boardAll: (platform, id, refresh = false) => boards.getListDetailAll(`${source(platform)}__${id}`, refresh),
  tags: platform => songLists.getTags(source(platform)),
  async lists(platform, tag = '', sort = '', number = 1, refresh = false) {
    await songLists.getAndSetList(source(platform), tag, sort, page(number), refresh)
    return snapshot(listInfo)
  },
  list: (platform, id, number = 1, refresh = false) => songLists.getListDetail(id, source(platform), page(number), refresh),
  listAll: (platform, id, refresh = false) => songLists.getListDetailAll(id, source(platform), refresh),
}
