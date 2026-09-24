/**
 * 生成 Basic Auth 头
 */
export function generateBasicAuth(username: string, apiToken: string): string {
  const credentials = btoa(`${username}:${apiToken}`)
  return credentials
}

/**
 * 验证 URL 格式
 */
export function isValidJenkinsUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol)
  } catch {
    return false
  }
}

/**
 * 格式化 Jenkins URL（确保尾部有斜杠）
 */
export function normalizeJenkinsUrl(url: string): string {
  return url.endsWith('/') ? url : `${url}/`
}
