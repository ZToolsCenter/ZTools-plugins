import { describe, expect, it } from 'vitest'
import { flattenFavoriteJobs } from '../src/utils/jobs'
import type { JobInfo } from '../src/types'

describe('flattenFavoriteJobs', () => {
  it('returns matching jobs as a flat list without their folders', () => {
    const jobs: JobInfo[] = [
      {
        name: 'team',
        fullName: 'team',
        url: 'http://jenkins.example/job/team/',
        color: 'notbuilt',
        _class: 'com.cloudbees.hudson.plugins.folder.Folder',
        jobs: [
          {
            name: 'services',
            fullName: 'team/services',
            url: 'http://jenkins.example/job/team/job/services/',
            color: 'notbuilt',
            _class: 'com.cloudbees.hudson.plugins.folder.Folder',
            jobs: [
              {
                name: 'deploy',
                fullName: 'team/services/deploy',
                url: 'http://jenkins.example/job/team/job/services/job/deploy/',
                color: 'blue'
              }
            ]
          }
        ]
      },
      {
        name: 'root-job',
        fullName: 'root-job',
        url: 'http://jenkins.example/job/root-job/',
        color: 'red'
      }
    ]

    const result = flattenFavoriteJobs(
      jobs,
      new Set(['team/services/deploy', 'root-job'])
    )

    expect(result.map(job => job.fullName)).toEqual([
      'team/services/deploy',
      'root-job'
    ])
    expect(result.every(job => !job.jobs)).toBe(true)
  })
})
