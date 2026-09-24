import { ref, watch, type Ref } from 'vue'

/**
 * 「保持输入到下次」：勾选后把表单字段存入 localStorage，下次进入时恢复。
 * 对齐原插件各页面的 keep_* 选项。
 */
export function useKeepInput(key: string, fields: Record<string, Ref<any>>): Ref<boolean> {
  const keep = ref(localStorage.getItem(`keep:${key}`) === '1')

  if (keep.value) {
    try {
      const saved = JSON.parse(localStorage.getItem(`keep-data:${key}`) || '{}')
      for (const name in fields) {
        if (saved[name] !== undefined) fields[name].value = saved[name]
      }
    } catch {
      /* 存量数据损坏时忽略 */
    }
  }

  watch(
    [keep, ...Object.values(fields)],
    () => {
      localStorage.setItem(`keep:${key}`, keep.value ? '1' : '0')
      if (keep.value) {
        const data = Object.fromEntries(
          Object.entries(fields).map(([name, r]) => [name, r.value])
        )
        localStorage.setItem(`keep-data:${key}`, JSON.stringify(data))
      } else {
        localStorage.removeItem(`keep-data:${key}`)
      }
    },
    { deep: false }
  )

  return keep
}
