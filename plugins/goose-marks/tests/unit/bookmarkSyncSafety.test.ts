import { expect, test } from '@playwright/test'
import { filterRemoteChangesForShare, type RemoteSyncItem } from '../../src/lib/bookmarkSyncSafety'
import type { Group } from '../../src/types/bookmark'

const unsharedGroup: Group = {
  id: 'g-real',
  name: 'Mark',
  createdAt: 1,
  updatedAt: 2,
  children: [{
    id: 's-real',
    name: '常用',
    bookmarkIds: ['b-real'],
    createdAt: 1,
    updatedAt: 2,
  }],
}

const sharedGroup = {
  ...unsharedGroup,
  id: 'g-shared',
  shareId: 'share-current',
  children: [{ ...unsharedGroup.children[0], id: 's-shared', bookmarkIds: ['b-shared'] }],
} as Group & { shareId: string }

const tombstone = (itemId: string, itemType: RemoteSyncItem['itemType']): RemoteSyncItem => ({
  itemId,
  itemType,
  content: null,
  isDeleted: true,
  updatedAt: 100,
})

test('旧同步队列不能删除已恢复的本地非共享数据', () => {
  const accepted = filterRemoteChangesForShare(
    [unsharedGroup, sharedGroup],
    [tombstone('g-real', 'group'), tombstone('b-real', 'bookmark')],
    'share-old',
  )

  expect(accepted).toEqual([])
})

test('远端变更只能修改当前 shareId 所属数据', () => {
  const validGroupDelete = tombstone('g-shared', 'group')
  const wrongShareDelete = tombstone('b-shared', 'bookmark')
  const accepted = filterRemoteChangesForShare(
    [unsharedGroup, sharedGroup],
    [validGroupDelete, wrongShareDelete],
    'share-current',
  )

  expect(accepted).toEqual([validGroupDelete, wrongShareDelete])
  expect(filterRemoteChangesForShare(
    [unsharedGroup, sharedGroup],
    [validGroupDelete, wrongShareDelete],
    'share-other',
  )).toEqual([])
})

test('同一分享的旧 tombstone 也不能覆盖更新的本地内容', () => {
  const stale = { ...tombstone('g-shared', 'group'), updatedAt: 2 }
  const fresh = { ...tombstone('g-shared', 'group'), updatedAt: 3 }

  expect(filterRemoteChangesForShare([unsharedGroup, sharedGroup], [stale, fresh], 'share-current'))
    .toEqual([fresh])
})
