import type { JobInfo } from '../types'

const isFolder = (job: JobInfo): boolean => {
  return Array.isArray(job.jobs) || /(?:Folder|MultiBranchProject)$/.test(job._class || '')
}

/**
 * Collect favorited leaf jobs without retaining their parent folder hierarchy.
 */
export function flattenFavoriteJobs(jobList: JobInfo[], names: Set<string>): JobInfo[] {
  return jobList.flatMap(job => {
    if (isFolder(job)) {
      return flattenFavoriteJobs(job.jobs || [], names)
    }

    const fullName = job.fullName || job.name
    return names.has(fullName) ? [job] : []
  })
}
