import { useCallback } from 'react'
import type { Bookmark } from '@/types/bookmark'
import { getTemplateLabel, resolveBookmarkLaunchUrl } from '@/lib/utils'
import { addBehaviorLog } from '@/lib/debugReport'
import { useBookmarkStore, TRASH_GROUP_ID } from '@/stores/bookmark'
import { useSettingsStore } from '@/stores/settings'
import { useUIManager } from './useUIManager'

/**
 * 书签打开 / 复制 / 删除 / 重排操作（React 版）
 * --------------------------------------------------------------------------
 * 旧版 Vue composable。React 版：
 *   - store / settingsStore 在回调内用 .getState() 取最新值；showToast 订阅自 useUIManager。
 *   - 修复旧版 openExternalUrl 自我递归的 bug：非 uTools 调试环境改用 window.open。
 */

type UToolsExtendedApi = {
  copyText?: (text: string) => void
  shellOpenExternal?: (url: string) => void
  ubrowser?: {
    goto(url: string): { run(options?: { width?: number; height?: number }): Promise<unknown[]> }
  }
  outPlugin?: (isKill?: boolean) => boolean
  hideMainWindow?: () => void
  getWindowType?: () => string
}

type OpenBookmarkOptions = {
  query?: string
  useUiQuery?: boolean
  /** 调用来源，如 'template' 表示由模板书签触发 */
  source?: string
}

const openExternalUrl = (url: string) => {
  window.open(url, '_blank')
}

export function useBookmarkOperations() {
  const showToast = useUIManager((s) => s.showToast)
  const isDevRuntime = import.meta.env.DEV

  const notifyCopySuccess = useCallback(() => {
    showToast({ title: '已复制书签地址', variant: 'success', duration: 2000 })
  }, [showToast])

  const copyText = useCallback(async (text: string, onSuccess: () => void) => {
    try {
      if (window.utools && typeof window.utools.copyText === 'function') {
        window.utools.copyText(text)
        onSuccess()
        return true
      }

      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
          await navigator.clipboard.writeText(text)
          onSuccess()
          return true
        } catch (clipboardErr) {
          console.warn('[Bookmark] Clipboard API 失败，尝试备用方案', clipboardErr)
        }
      }

      const textArea = document.createElement('textarea')
      textArea.value = text
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px'
      textArea.style.top = '0'
      textArea.style.opacity = '0'
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()

      const successful = document.execCommand('copy')
      document.body.removeChild(textArea)

      if (!successful) throw new Error('无法访问剪贴板')

      onSuccess()
      return true
    } catch {
      return false
    }
  }, [])

  const copyBookmarkUrl = useCallback(
    async (bookmark: Bookmark): Promise<boolean> => {
      if (!bookmark || !bookmark.url) return false
      const copied = await copyText(bookmark.url, notifyCopySuccess)
      if (!copied) {
        showToast({
          title: '复制失败',
          description: '由于环境限制，请手动开启书签后在地址栏复制',
          variant: 'error'
        })
      }
      return copied
    },
    [copyText, notifyCopySuccess, showToast]
  )

  const copyBookmarkDescription = useCallback(
    async (bookmark: Bookmark) => {
      const desc = bookmark?.desc?.trim()
      if (!desc) {
        showToast({ title: '暂无描述可复制', variant: 'error' })
        return
      }

      const copied = await copyText(desc, () => {
        showToast({ title: '已复制描述', variant: 'success', duration: 2000 })
      })

      if (!copied) {
        showToast({
          title: '复制失败',
          description: '由于环境限制，请手动选中描述后复制',
          variant: 'error'
        })
      }
    },
    [copyText, showToast]
  )

  const openUrl = useCallback(
    (url: string) => {
      const settingsStore = useSettingsStore.getState()

      if (window.utools) {
        const utoolsApi = window.utools as unknown as UToolsExtendedApi | undefined
        // 默认使用系统默认浏览器；仅当设置勾选「使用 uTools 内置浏览器」时才走 ubrowser
        const canUseInner = settingsStore.useUtoolsBrowser && !!utoolsApi?.ubrowser
        let opened = false
        if (canUseInner) {
          try {
            utoolsApi.ubrowser?.goto(url).run({ width: 1280, height: 800 })
            opened = true
          } catch (e) {
            console.warn('[Bookmark] 内置浏览器打开失败', e)
          }
        }
        if (!opened) utoolsApi?.shellOpenExternal?.(url)
        return
      }
      openExternalUrl(url)
    },
    []
  )

  const openBookmarkLink = useCallback(
    (bookmark: Bookmark, options: OpenBookmarkOptions = {}) => {
      const store = useBookmarkStore.getState()

      if (isDevRuntime) console.info('[Bookmark] open', bookmark)
      addBehaviorLog('open', `${bookmark.title || ''} ${bookmark.url || ''}`.trim())

      const raw = typeof bookmark.url === 'string' ? bookmark.url : ''
      const hasTemplate = /{[^}]+}/.test(raw)
      const queryFromOptions = typeof options.query === 'string' ? options.query.trim() : undefined
      const queryFromUi =
        options.useUiQuery === false ? '' : (typeof store.search === 'string' ? store.search : '').trim()
      const query = queryFromOptions ?? queryFromUi
      const url = resolveBookmarkLaunchUrl(raw, query)

      if (!url) {
        if (hasTemplate) {
          const label = getTemplateLabel(raw)
          console.info(`[Bookmark] 模板书签需要输入${label}`)
        }
        return
      }

      // 记录本地使用排序数据：lastUsed = now、visits++（驱动「最近使用」虚拟视图）
      store.recordBookmarkUse(bookmark.id)
      openUrl(url)
    },
    [isDevRuntime, openUrl]
  )

  const openUrlInUtoolsBrowser = useCallback((url: string) => {
    if (window.utools) {
      const utoolsApi = window.utools as unknown as UToolsExtendedApi | undefined
      if (utoolsApi?.ubrowser) {
        try {
          utoolsApi.ubrowser.goto(url).run({ width: 1280, height: 800 })
        } catch (e) {
          console.warn('[Bookmark] 内置浏览器打开失败', e)
          utoolsApi?.shellOpenExternal?.(url)
        }
      } else {
        utoolsApi?.shellOpenExternal?.(url)
      }
      return
    }
    openExternalUrl(url)
  }, [])

  // 强制走系统默认浏览器（右键反转入口用：默认=内置时提供「用默认浏览器打开」）
  const openUrlInDefaultBrowser = useCallback((url: string) => {
    if (window.utools) {
      const utoolsApi = window.utools as unknown as UToolsExtendedApi | undefined
      utoolsApi?.shellOpenExternal?.(url)
      return
    }
    openExternalUrl(url)
  }, [])

  const handleRemove = useCallback((bookmark: Bookmark, location?: { groupId: string; subGroupId: string }) => {
    const store = useBookmarkStore.getState()

    // 若调用方传入了明确位置，优先使用
    if (location?.groupId && location?.subGroupId && location.groupId !== TRASH_GROUP_ID) {
      store.removeBookmarkFromLocation(bookmark.id, location.groupId, location.subGroupId)
      return
    }

    // 优先用书签自身的 locations 找第一个非回收站位置
    const locations = Array.isArray(bookmark.locations) && bookmark.locations.length > 0
      ? bookmark.locations
      : store.getBookmarkLocations(bookmark.id)  // 旧数据可能无 locations 字段，回退查 store

    const validLoc = locations.find(
      (loc) => loc.groupId && loc.groupId !== TRASH_GROUP_ID
    )

    if (validLoc?.groupId != null && validLoc?.subGroupId != null) {
      store.removeBookmarkFromLocation(bookmark.id, validLoc.groupId, validLoc.subGroupId)
    } else {
      // 最终兜底：遍历 groups 找第一个包含该书签的位置
      outer: for (const g of store.groups) {
        if (g.id === TRASH_GROUP_ID) continue
        for (const s of (g.children ?? [])) {
          if ((s.bookmarkIds ?? []).includes(bookmark.id)) {
            store.removeBookmarkFromLocation(bookmark.id, g.id, s.id)
            break outer
          }
        }
      }
    }
  }, [])

  const emptyTrash = useCallback(() => {
    useBookmarkStore.getState().emptyTrash()
  }, [])

  const handleReorder = useCallback(({ fromId, toId }: { fromId: string; toId: string }) => {
    const store = useBookmarkStore.getState()
    if (store.search) return
    const groupId = store.activeGroupId
    const subId = store.activeSubGroupId
    if (!groupId || !subId || groupId === TRASH_GROUP_ID) return
    store.reorderInSub(groupId, subId, fromId, toId)
  }, [])

  return {
    openBookmarkLink,
    copyBookmarkUrl,
    copyBookmarkDescription,
    openUrl,
    openUrlInUtoolsBrowser,
    openUrlInDefaultBrowser,
    getTemplateLabel,
    handleRemove,
    emptyTrash,
    handleReorder
  }
}
