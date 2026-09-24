import { describe, it, expect } from 'vitest'
import {
  parseContainerList,
  parseInspect,
  classifyDockerError,
  classifyState,
  stripAnsi,
  resolveDockerBin,
  extractProject,
  parseComposeProjects,
  parseContextList
} from '../public/preload/docker.js'

describe('parseContainerList', () => {
  it('解析多行 docker ps --format json 输出', () => {
    const stdout = [
      '{"ID":"a1b2c3","Names":"nginx,/nginx","Image":"nginx:latest","Command":"nginx -g","CreatedAt":"2026-08-01 10:00:00","Ports":"0.0.0.0:80->80/tcp","Status":"Up 3 hours","State":"running"}',
      '{"ID":"d4e5f6","Names":"/mysql","Image":"mysql:8","Command":"docker-entrypoint.sh","CreatedAt":"2026-07-01 09:00:00","Ports":"","Status":"Exited (0) 2 days ago","State":"exited"}'
    ].join('\n')
    const list = parseContainerList(stdout)
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({
      id: 'a1b2c3',
      names: 'nginx,/nginx',
      name: 'nginx',
      image: 'nginx:latest',
      command: 'nginx -g',
      created: '2026-08-01 10:00:00',
      status: 'Up 3 hours',
      ports: '0.0.0.0:80->80/tcp',
      state: 'running'
    })
    expect(list[1].name).toBe('mysql')
    expect(list[1].state).toBe('stopped')
  })

  it('跳过无法解析为 JSON 的行', () => {
    const stdout = [
      'this is not json',
      '{"ID":"a1b2c3","Names":"nginx,/nginx","Image":"nginx:latest","Command":"nginx -g","CreatedAt":"2026-08-01 10:00:00","Ports":"0.0.0.0:80->80/tcp","Status":"Up 3 hours","State":"running"}',
      'docker: error response from daemon'
    ].join('\n')
    const list = parseContainerList(stdout)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('a1b2c3')
  })

  it('跳过值为 null 的有效 JSON 行', () => {
    const stdout = 'null\n{"ID":"a1b2c3","Names":"/x","Image":"x","Command":"","CreatedAt":"","Ports":"","Status":"Up","State":"running"}'
    expect(parseContainerList(stdout)).toHaveLength(1)
  })

  it('空输出返回空数组', () => {
    expect(parseContainerList('')).toEqual([])
  })
})

describe('parseInspect', () => {
  const inspectJson = JSON.stringify([{
    Id: 'a1b2c3',
    Name: '/nginx',
    Config: { Image: 'nginx:latest' },
    Created: '2026-08-01T02:00:00Z',
    State: { Status: 'running' },
    HostConfig: { RestartPolicy: { Name: 'always', MaximumRetryCount: 0 } },
    NetworkSettings: { Ports: { '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '80' }] } },
    Mounts: [{ Type: 'bind', Source: '/data', Destination: '/usr/share/nginx/html', Mode: '', RW: true }]
  }])
  it('解析端口与挂载', () => {
    const c = parseInspect(inspectJson)
    expect(c.name).toBe('nginx')
    expect(c.restartPolicy).toEqual({ name: 'always', maxRetryCount: 0 })
    expect(c.ports).toEqual([{ containerPort: '80/tcp', bindings: ['80'] }])
    expect(c.mounts).toEqual([{ type: 'bind', source: '/data', destination: '/usr/share/nginx/html', mode: '', rw: true }])
  })
  it('无端口/挂载时为空数组，且缺省 image/state 为 null', () => {
    const bare = JSON.stringify([{ Name: '/x', Config: {}, State: {}, NetworkSettings: { Ports: {} }, Mounts: [] }])
    const c = parseInspect(bare)
    expect(c.ports).toEqual([])
    expect(c.mounts).toEqual([])
    expect(c.image).toBeNull()
    expect(c.state).toBeNull()
    expect(c.restartPolicy).toEqual({ name: '', maxRetryCount: 0 })
  })
  it('未绑定主机的端口映射为空数组', () => {
    const unbound = JSON.stringify([{
      Name: '/nginx',
      Config: { Image: 'nginx:latest' },
      NetworkSettings: { Ports: { '80/tcp': null, '443/tcp': null } },
      Mounts: []
    }])
    const c = parseInspect(unbound)
    expect(c.ports).toEqual([
      { containerPort: '80/tcp', bindings: [] },
      { containerPort: '443/tcp', bindings: [] }
    ])
  })
})

describe('classifyDockerError', () => {
  it('ENOENT 识别为 DOCKER_NOT_FOUND', () => {
    const err = { code: 'ENOENT', message: 'spawn docker ENOENT' }
    expect(classifyDockerError(err).code).toBe('DOCKER_NOT_FOUND')
  })
  it('超时识别为操作超时', () => {
    const err = { killed: true, message: 'Command failed: docker start' }
    expect(classifyDockerError(err).message).toBe('操作超时')
  })
  it('daemon 未运行识别为 DAEMON_DOWN', () => {
    const err = { stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?' }
    expect(classifyDockerError(err).code).toBe('DAEMON_DOWN')
  })
  it('其他错误识别为 DOCKER_ERROR', () => {
    const err = { stderr: 'Error response from daemon: No such container' }
    expect(classifyDockerError(err).code).toBe('DOCKER_ERROR')
  })
  it('null 入参返回兜底文案', () => {
    expect(classifyDockerError(null).code).toBe('DOCKER_ERROR')
    expect(classifyDockerError(null).message).toBe('docker 命令执行失败')
  })
})

describe('classifyState', () => {
  it('映射运行/暂停/停止', () => {
    expect(classifyState('running', 'Up')).toBe('running')
    expect(classifyState('paused', 'Up (Paused)')).toBe('paused')
    expect(classifyState('exited', 'Exited')).toBe('stopped')
    expect(classifyState('created', 'Created')).toBe('stopped')
  })
  it('status 中包含 (Paused) 时识别为暂停', () => {
    expect(classifyState('running', 'Up (Paused)')).toBe('paused')
  })
})

describe('stripAnsi', () => {
  it('清除 ANSI SGR 颜色码', () => {
    expect(stripAnsi('\x1b[32mhello\x1b[0m world')).toBe('hello world')
  })
})

describe('resolveDockerBin', () => {
  it('候选为空或不存在时回退为 docker', () => {
    expect(resolveDockerBin([])).toBe('docker')
    expect(resolveDockerBin(['/nonexistent/docker'])).toBe('docker')
  })
})

describe('extractProject', () => {
  it('从 Labels 逗号分隔字符串提取 compose 项目名', () => {
    const labels = 'com.docker.compose.project=mta-service-parent,com.docker.compose.project.working_dir=/data'
    expect(extractProject(labels)).toBe('mta-service-parent')
  })
  it('无 compose label 返回 undefined', () => {
    expect(extractProject('foo=bar')).toBeUndefined()
    expect(extractProject(undefined)).toBeUndefined()
  })
})

describe('parseComposeProjects', () => {
  it('解析 compose ls --format json 的 JSON 数组', () => {
    const stdout = JSON.stringify([
      { Name: 'mta-service-parent', Status: 'running(2)', ConfigFiles: '/path/docker-compose.yml' }
    ])
    expect(parseComposeProjects(stdout)).toEqual([
      { name: 'mta-service-parent', status: 'running(2)', configFiles: '/path/docker-compose.yml' }
    ])
  })
  it('空/非法输入返回空数组', () => {
    expect(parseComposeProjects('')).toEqual([])
    expect(parseComposeProjects('not json')).toEqual([])
  })
})

describe('parseContextList', () => {
  it('解析逐行 JSON 的 context 列表', () => {
    const stdout = JSON.stringify({
      Name: 'default',
      Description: 'Current DOCKER_HOST based configuration',
      DockerEndpoint: 'unix:///var/run/docker.sock',
      Current: true
    })
    expect(parseContextList(stdout)).toEqual([
      {
        name: 'default',
        description: 'Current DOCKER_HOST based configuration',
        endpoint: 'unix:///var/run/docker.sock',
        current: true
      }
    ])
  })
  it('空输出返回空数组', () => {
    expect(parseContextList('')).toEqual([])
  })
})
