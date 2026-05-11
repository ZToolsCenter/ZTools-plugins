import { ElMessage } from 'element-plus';

export function showPersistentGitError(message: string) {
  ElMessage({
    type: 'error',
    message,
    duration: 0,
    showClose: true,
  });
}
