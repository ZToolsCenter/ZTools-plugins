import type { AppSummary, Candidate, ExecutionResult } from '../types'

export function filterApps(apps: AppSummary[], query: string): AppSummary[] {
  const term = query.trim().toLocaleLowerCase()
  if (!term) return apps
  return apps.filter((app) => [app.name, app.publisher, app.version, app.install.kind]
    .some((value) => String(value || '').toLocaleLowerCase().includes(term)))
}

export function defaultSelectedIds(candidates: Candidate[]): string[] {
  return candidates.filter((item) => item.deletable && item.selectedByDefault && item.confidence === 'exact').map((item) => item.id)
}

export function summarizeResult(result: ExecutionResult) {
  const counts = { trashed: 0, launched: 0, skipped: 0, failed: 0 }
  for (const item of result.results) {
    if (item.status === 'trashed') counts.trashed += 1
    else if (item.status === 'launched-uninstaller') counts.launched += 1
    else if (item.status === 'skipped') counts.skipped += 1
    else counts.failed += 1
  }
  return counts
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return '目录'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}
