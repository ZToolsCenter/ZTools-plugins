function generateRandomUuid(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Date.now().toString(36) + Math.random().toString(36).substring(2)
}

export function resolveVariables(
  text: string,
  variables: Record<string, string>,
  collectionVariables: Record<string, string> = {}
): string {
  if (!text) {
    return text
  }

  const allVars = { ...collectionVariables, ...variables }

  const builtInVars: Record<string, string> = {
    $timestamp: Date.now().toString(),
    $randomUUID: generateRandomUuid(),
    $isoTimestamp: new Date().toISOString()
  }

  return text.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmedKey = key.trim()
    if (builtInVars[trimmedKey] !== undefined) {
      return builtInVars[trimmedKey]
    }
    if (allVars[trimmedKey] !== undefined) {
      return allVars[trimmedKey]
    }

    return match
  })
}

export function resolveAllVariables(
  obj: unknown,
  variables: Record<string, string>,
  collectionVariables: Record<string, string> = {}
): unknown {
  if (typeof obj === 'string') {
    return resolveVariables(obj, variables, collectionVariables)
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => resolveAllVariables(item, variables, collectionVariables))
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = resolveAllVariables(value, variables, collectionVariables)
    }
    return result
  }
  return obj
}
