export type QueryValue = string | number | boolean | null | undefined

export function buildQueryString(params: Record<string, QueryValue>): string {
  const searchParams = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (typeof value === 'number') {
      searchParams.set(key, String(value))
      return
    }

    if (typeof value === 'boolean') {
      searchParams.set(key, String(value))
      return
    }

    if (typeof value === 'string' && value) {
      searchParams.set(key, value)
    }
  })

  const queryString = searchParams.toString()
  return queryString ? `?${queryString}` : ''
}

export function appendQuery(path: string, params: Record<string, QueryValue>): string {
  return `${path}${buildQueryString(params)}`
}
