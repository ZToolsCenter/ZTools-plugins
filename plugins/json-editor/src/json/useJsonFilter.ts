import { onScopeDispose, ref, watch, type Ref } from 'vue'

const debounceMs = 50
const maxExecutionMs = 2_000

export function useJsonFilter(input: Ref<string>, expression: Ref<string>, active: Ref<boolean>) {
  const output = ref('')
  let worker: Worker | undefined
  let debounce: number | undefined
  let deadline: number | undefined
  let requestId = 0

  function stopWorker() {
    window.clearTimeout(deadline)
    deadline = undefined
    worker?.terminate()
    worker = undefined
  }

  function configureWorker(instance: Worker) {
    instance.onmessage = ({ data }: MessageEvent<{ id: number; output: string }>) => {
      if (instance !== worker || data.id !== requestId) return
      window.clearTimeout(deadline)
      deadline = undefined
      output.value = data.output
    }
    instance.onerror = () => {
      if (instance !== worker) return
      stopWorker()
      output.value = '// JavaScript 过滤失败'
    }
    return instance
  }

  watch([input, expression, active], ([text, js, enabled]) => {
    window.clearTimeout(debounce)
    const id = ++requestId
    // A superseded computation must not block the newest expression.
    if (deadline !== undefined || !enabled) stopWorker()
    if (!enabled || !js) return

    debounce = window.setTimeout(async () => {
      try {
        if (!worker) {
          const { default: FilterWorker } = await import('./filter.worker.ts?worker&inline')
          if (id !== requestId) return
          worker = configureWorker(new FilterWorker())
        }
        worker.postMessage({ id, text, expression: js })
        deadline = window.setTimeout(() => {
          stopWorker()
          output.value = '// JavaScript 执行超时'
        }, maxExecutionMs)
      } catch {
        if (id !== requestId) return
        stopWorker()
        output.value = '// JavaScript 过滤失败'
      }
    }, debounceMs)
  })

  onScopeDispose(() => {
    requestId += 1
    window.clearTimeout(debounce)
    stopWorker()
  })

  return output
}
