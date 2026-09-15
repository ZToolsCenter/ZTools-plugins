const MINIMUM_VERSION = [3, 0, 2]

const compareVersionParts = (versionParts, minimumParts) => {
  for (let index = 0; index < minimumParts.length; index++) {
    if (versionParts[index] !== minimumParts[index]) {
      return versionParts[index] > minimumParts[index] ? 1 : -1
    }
  }
  return 0
}

export const supportsMultiSelectClipboard = (version) => {
  const match = String(version ?? '').trim().match(
    /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9a-z.-]+))?(?:\+[0-9a-z.-]+)?$/i
  )
  if (!match) return false

  const versionParts = match.slice(1, 4).map(Number)
  const baseComparison = compareVersionParts(versionParts, MINIMUM_VERSION)
  if (baseComparison !== 0) return baseComparison > 0

  const prerelease = match[4]
  if (!prerelease) return true

  // 3.0.2-beta.* is the first release line that exposes multi-file writes.
  return /^(beta|rc)(?:[.-]|$)/i.test(prerelease)
}
