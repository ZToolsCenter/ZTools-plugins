import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const nodeRequire = createRequire(import.meta.url)

type RequestOptions = { path: string }

function loadJenkinsService() {
  const requestedPaths: string[] = []

  const httpMock = {
    request(options: RequestOptions, callback: (response: EventEmitter & { statusCode: number }) => void) {
      requestedPaths.push(options.path)
      const request = new EventEmitter() as EventEmitter & { end: () => void }
      request.end = () => {
        queueMicrotask(() => {
          const response = new EventEmitter() as EventEmitter & { statusCode: number }
          response.statusCode = 200
          callback(response)

          let body: object
          if (options.path.startsWith('/job/team/api/json')) {
            body = {
              jobs: [{
                name: 'deploy',
                url: 'http://jenkins.example/job/team/job/deploy/',
                color: 'blue',
                _class: 'hudson.model.FreeStyleProject'
              }]
            }
          } else {
            const folder: Record<string, unknown> = {
              name: 'team',
              url: 'http://jenkins.example/job/team/',
              color: 'notbuilt'
            }
            if (options.path.includes('_class')) {
              folder._class = 'com.cloudbees.hudson.plugins.folder.Folder'
            }
            body = { jobs: [folder] }
          }

          response.emit('data', JSON.stringify(body))
          response.emit('end')
        })
      }
      return request
    }
  }

  const sandbox = {
    Buffer,
    URL,
    queueMicrotask,
    window: { ztools: { getPath: () => '' } } as any,
    require(id: string) {
      if (id === 'http' || id === 'https') return httpMock
      return nodeRequire(id)
    }
  }

  const source = readFileSync(resolve('preload.js'), 'utf8')
  runInNewContext(source, sandbox, { filename: 'preload.js' })

  return {
    service: sandbox.window.services.jenkins,
    requestedPaths
  }
}

describe('Jenkins folder traversal', () => {
  it('loads jobs inside a folder and assigns their full Jenkins name', async () => {
    const { service, requestedPaths } = loadJenkinsService()

    const result = await service.getJobs('http://jenkins.example', 'user', 'token')

    expect(result.error).toBeNull()
    expect(result.data[0].jobs).toEqual([
      expect.objectContaining({ name: 'deploy', fullName: 'team/deploy' })
    ])
    expect(requestedPaths).toContainEqual(expect.stringMatching(/^\/job\/team\/api\/json/))
  })

  it('addresses nested jobs with one Jenkins job segment per folder level', async () => {
    const { service, requestedPaths } = loadJenkinsService()

    await service.getBuilds('http://jenkins.example', 'user', 'token', 'team/deploy')
    await service.triggerBuild('http://jenkins.example', 'user', 'token', 'team/deploy')

    expect(requestedPaths).toContainEqual(expect.stringMatching(/^\/job\/team\/job\/deploy\/api\/json/))
    expect(requestedPaths).toContain('/job/team/job/deploy/build')
  })

  it('fetches console text for a nested build with the same per-segment job path', async () => {
    const { service, requestedPaths } = loadJenkinsService()

    const result = await service.getBuildConsole('http://jenkins.example', 'user', 'token', 'team/deploy', 42)

    expect(result.error).toBeNull()
    expect(typeof result.data).toBe('string')
    expect(requestedPaths).toContain('/job/team/job/deploy/42/consoleText')
  })
})
