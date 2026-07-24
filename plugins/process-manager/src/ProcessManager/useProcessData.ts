import { useState, useEffect, useCallback, useRef } from 'react'

export const CACHE_TTL = 5000

function mergeData(rawList: ProcessRaw[], rawPorts: PortEntry[]): ProcessInfo[] {
  const portMap: Record<number, number[]> = {}
  for (const entry of rawPorts) {
    if (!portMap[entry.pid]) portMap[entry.pid] = []
    if (!portMap[entry.pid].includes(entry.port)) {
      portMap[entry.pid].push(entry.port)
    }
  }

  return rawList.map(p => ({
    pid: p.pid,
    name: p.name,
    path: p.path,
    ports: portMap[p.pid] || []
  }))
}

export function useProcessData() {
  const [processes, setProcesses] = useState<ProcessInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState('')
  const lastFetchRef = useRef(0)

  const refresh = useCallback(async (force?: boolean) => {
    const now = Date.now()
    if (!force && now - lastFetchRef.current < CACHE_TTL) return

    if (!window.services?.listProcesses) {
      console.warn('services not available')
      return
    }

    setLoading(true)
    try {
      const [list, ports] = await Promise.all([
        window.services.listProcesses(),
        window.services.scanPorts()
      ])
      setProcesses(mergeData(list || [], ports || []))
      setLastUpdated(new Date().toLocaleTimeString())
      lastFetchRef.current = now
    } catch (e) {
      console.error('useProcessData error:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, CACHE_TTL)
    return () => clearInterval(timer)
  }, [refresh])

  return { processes, loading, refresh, lastUpdated }
}
