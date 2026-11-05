export function createAvatarStore(requestAvatar: (url: string) => Promise<string>, onLoaded?: () => void) {
  const values = new Map<string, string>()
  const pending = new Map<string, Promise<void>>()

  async function load(url: string) {
    if (!url || values.has(url) || pending.has(url)) return pending.get(url)
    const request = requestAvatar(url)
      .then((dataUrl) => {
        values.set(url, dataUrl)
        onLoaded?.()
      })
      .catch(() => undefined)
      .finally(() => pending.delete(url))
    pending.set(url, request)
    return request
  }

  return { get: (url: string) => values.get(url), load }
}
