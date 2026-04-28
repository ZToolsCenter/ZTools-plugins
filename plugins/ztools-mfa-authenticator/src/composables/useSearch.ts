import { ref } from 'vue'
import type { ShuangpinScheme } from '@/utils/shuangpin'

const STORAGE_KEY = 'shuangpin_scheme'
const searchQuery = ref('')
const shuangpinScheme = ref<ShuangpinScheme>('off')

export function useSearch() {
  function init() {
    try {
      const stored = window.ztools.dbStorage.getItem(STORAGE_KEY)
      if (stored && ['off', 'ziranma', 'xiaohe', 'pinyinjiajia', 'microsoft', 'sogou'].includes(stored)) {
        shuangpinScheme.value = stored as ShuangpinScheme
      }
    } catch {
      // ignore
    }

    window.ztools.setSubInput(
      (data: { text: string }) => {
        searchQuery.value = data.text
      },
      '搜索账户...',
    )
  }

  function setShuangpin(scheme: ShuangpinScheme) {
    shuangpinScheme.value = scheme
    try {
      window.ztools.dbStorage.setItem(STORAGE_KEY, scheme)
    } catch {
      // ignore
    }
  }

  return {
    searchQuery,
    shuangpinScheme,
    init,
    setShuangpin,
  }
}
