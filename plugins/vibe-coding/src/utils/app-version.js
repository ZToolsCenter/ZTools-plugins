const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9a-z.-]+))?(?:\+[0-9a-z.-]+)?$/i

function parseVersion(version) {
  const match = String(version ?? "").trim().match(VERSION_PATTERN)
  if (!match) return null

  return {
    parts: match.slice(1, 4).map(Number),
    prerelease: match[4] ? match[4].split(".") : [],
  }
}

function comparePrerelease(left, right) {
  if (!left.length && !right.length) return 0
  if (!left.length) return 1
  if (!right.length) return -1

  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    if (index >= left.length) return -1
    if (index >= right.length) return 1

    const leftIdentifier = left[index]
    const rightIdentifier = right[index]
    if (leftIdentifier === rightIdentifier) continue

    const leftNumeric = /^\d+$/.test(leftIdentifier)
    const rightNumeric = /^\d+$/.test(rightIdentifier)
    if (leftNumeric && rightNumeric) {
      return Number(leftIdentifier) > Number(rightIdentifier) ? 1 : -1
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftIdentifier > rightIdentifier ? 1 : -1
  }
  return 0
}

export function compareAppVersions(leftVersion, rightVersion) {
  const left = parseVersion(leftVersion)
  const right = parseVersion(rightVersion)
  if (!left || !right) return null

  for (let index = 0; index < left.parts.length; index += 1) {
    if (left.parts[index] !== right.parts[index]) {
      return left.parts[index] > right.parts[index] ? 1 : -1
    }
  }
  return comparePrerelease(left.prerelease, right.prerelease)
}

export function isSupportedZToolsVersion(version, minimumVersion = "3.2.0") {
  const comparison = compareAppVersions(version, minimumVersion)
  return comparison !== null && comparison >= 0
}
