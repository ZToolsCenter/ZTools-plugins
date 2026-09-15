import { ElMessage, ElMessageBox } from 'element-plus';

/**
 * 持久展示 Git 错误（不自动关闭）。
 * 多行/长错误：先 toast 摘要，并弹出可滚动详情框。
 */
export function showPersistentGitError(message: string) {
  const text = String(message || '').trim() || 'Unknown error';
  const isLong = text.length > 120 || text.includes('\n');

  if (!isLong) {
    ElMessage({
      type: 'error',
      message: text,
      duration: 0,
      showClose: true,
    });
    return;
  }

  const summary = text.split('\n').map(l => l.trim()).find(Boolean) || text.slice(0, 120);

  ElMessage({
    type: 'error',
    duration: 8000,
    showClose: true,
    message: summary.length < text.length ? `${summary}…` : summary,
  });

  // 同步弹出详情，便于复制完整 stderr
  void ElMessageBox.alert(
    `<pre style="white-space:pre-wrap;word-break:break-word;max-height:50vh;overflow:auto;margin:0;font-size:var(--app-font-code);line-height:var(--app-line-height-code);">${escapeHtml(text)}</pre>`,
    'Git 错误详情',
    {
      dangerouslyUseHTMLString: true,
      confirmButtonText: '关闭',
      customClass: 'git-error-detail-box',
    },
  ).catch(() => {
    /* 用户关闭详情框即可 */
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
