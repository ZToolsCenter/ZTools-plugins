function compareByPortPath(a: ProcessInfo, b: ProcessInfo): number {
  const aHasPorts = a.ports.length > 0
  const bHasPorts = b.ports.length > 0
  const aHasPath = a.path.length > 0
  const bHasPath = b.path.length > 0

  if (aHasPorts && aHasPath && !(bHasPorts && bHasPath)) return -1
  if (bHasPorts && bHasPath && !(aHasPorts && aHasPath)) return 1
  if (aHasPorts && !bHasPorts) return -1
  if (bHasPorts && !aHasPorts) return 1
  if (aHasPath && !bHasPath) return -1
  if (bHasPath && !aHasPath) return 1

  return 0
}

export function searchProcesses(keyword: string, processes: ProcessInfo[]): ProcessInfo[] {
  const kw = keyword.trim()

  if (!kw) {
    return [...processes].sort(compareByPortPath)
  }

  const lower = kw.toLowerCase()

  return processes
    .map(p => {
      let score = -1
      const nameLower = p.name.toLowerCase()
      const pathLower = p.path.toLowerCase()
      const pidStr = String(p.pid)

      // PID 精确匹配
      if (pidStr === kw) return { process: p, score: 110 }

      // PID/端口包含匹配
      if (pidStr.includes(kw)) score = Math.max(score, 90)
      if (p.ports.some(port => String(port).includes(kw))) score = Math.max(score, 85)

      // 名称/路径匹配
      if (nameLower === lower) score = Math.max(score, 100)
      else if (nameLower.startsWith(lower)) score = Math.max(score, 80)
      else if (nameLower.includes(lower)) score = Math.max(score, 60)
      else if (pathLower.includes(lower)) score = Math.max(score, 50)

      return { process: p, score }
    })
    .filter(s => s.score >= 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return compareByPortPath(a.process, b.process)
    })
    .map(s => s.process)
}
