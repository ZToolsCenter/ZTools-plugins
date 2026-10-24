// 命令执行公共流程：预览确认 → 加载遮罩 → 提权执行 → 结果反馈
import { h } from 'vue'
import { ElLoading, ElMessage, ElMessageBox } from 'element-plus'
import type { CmdResult } from './api'

// 执行结果三态：canceled=用户取消（调用方不应刷新/关窗）
export type RunOutcome = 'canceled' | 'success' | 'failed'

function failDetail(res: CmdResult): string {
  const lines = ['执行失败：' + (res.message || 'exitCode=' + res.exitCode)]
  for (const o of res.output || []) {
    if (o.code !== 0) lines.push('\n> ' + o.op + '\n' + (o.output || '（无输出）'))
  }
  return lines.join('\n')
}

export async function confirmAndRun(title: string, ops: string[]): Promise<RunOutcome> {
  if (!ops.length) {
    ElMessage.warning('没有要执行的命令')
    return 'canceled'
  }
  try {
    await ElMessageBox.confirm(
      h('div', null, [
        h('p', { style: 'margin:0 0 6px' }, '将执行以下命令：'),
        h('pre', { class: 'cmd-preview' }, ops.join('\n'))
      ]),
      title,
      { confirmButtonText: '执行', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (e) {
    return 'canceled'
  }
  // 加载遮罩：提权 + 轮询可能持续数秒到数十秒，必须有执行中反馈
  const loading = ElLoading.service({
    lock: true,
    text: '正在执行（如弹出 UAC 请点「是」），完成后自动刷新…',
    background: 'rgba(0, 0, 0, 0.35)'
  })
  let res: CmdResult
  try {
    res = await window.services.runCommands(ops)
  } finally {
    loading.close()
  }
  if (res.exitCode === 0) {
    ElMessage.success('执行成功')
    return 'success'
  }
  ElMessageBox.alert(h('pre', { class: 'cmd-preview' }, failDetail(res)), title, {
    confirmButtonText: '知道了'
  })
  return 'failed'
}
