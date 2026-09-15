import { describe, it, expect } from 'vitest'
import {
  buildRunCommand,
  shQuote,
  cleanShellWarning,
  parseImageList,
  parseVolumeList,
  parseNetworkList,
  extractHostPorts
} from '../public/preload/docker.js'

describe('buildRunCommand', () => {
  it('还原常用启动参数', () => {
    const data = {
      Name: '/web',
      Image: 'nginx:latest',
      Config: {
        Hostname: 'web',
        Env: ['TZ=Asia/Shanghai', 'FOO=bar baz'],
        Labels: { 'com.example.owner': 'team' },
        Tty: true,
        OpenStdin: true,
        WorkingDir: '/app',
        User: 'www-data',
        Entrypoint: ['/bin/sh', '-c'],
        Cmd: ['nginx -g daemon off;']
      },
      HostConfig: {
        RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 0 },
        NetworkMode: 'bridge',
        Privileged: true,
        CapAdd: ['NET_ADMIN'],
        Memory: 268435456,
        NanoCpus: 500000000,
        ExtraHosts: ['db:10.0.0.1'],
        Dns: ['8.8.8.8'],
        IpcMode: 'host',
        PidMode: 'host',
        SecurityOpt: ['seccomp=unconfined']
      },
      NetworkSettings: {
        Ports: {
          '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }],
          '443/tcp': [{ HostIp: '127.0.0.1', HostPort: '8443' }]
        }
      },
      Mounts: [{ Type: 'bind', Source: '/data', Destination: '/var/www', Mode: 'rw' }]
    }
    const cmd = buildRunCommand(data)
    expect(cmd).toContain('docker run')
    expect(cmd).toContain('--name web')
    expect(cmd).toContain('-it')
    expect(cmd).toContain('--restart unless-stopped')
    expect(cmd).toContain('-p 8080:80/tcp')
    expect(cmd).toContain('-p 127.0.0.1:8443:443/tcp')
    expect(cmd).toContain('-v /data:/var/www:rw')
    expect(cmd).toContain('-e TZ=Asia/Shanghai')
    expect(cmd).toContain("-e 'FOO=bar baz'")
    expect(cmd).toContain('-l com.example.owner=team')
    expect(cmd).toContain('--network bridge')
    expect(cmd).toContain('--privileged')
    expect(cmd).toContain('--cap-add NET_ADMIN')
    expect(cmd).toContain('-m 268435456')
    expect(cmd).toContain('--cpus 0.5')
    expect(cmd).toContain('--add-host db:10.0.0.1')
    expect(cmd).toContain('--dns 8.8.8.8')
    expect(cmd).toContain('--ipc host')
    expect(cmd).toContain('--pid host')
    expect(cmd).toContain('-u www-data')
    expect(cmd).toContain('-w /app')
    expect(cmd).toContain('nginx:latest')
    expect(cmd).toContain("/bin/sh -c 'nginx -g daemon off;'")
  })

  it('无交互无映射时默认 -d', () => {
    const data = { Name: '/x', Image: 'redis:7', Config: {}, HostConfig: {}, NetworkSettings: {}, Mounts: [] }
    expect(buildRunCommand(data)).toBe('docker run --name x -d redis:7')
  })

  it('不重复 0.0.0.0 宿主机 IP', () => {
    const data = {
      Name: '/db',
      Image: 'postgres:15',
      Config: { Env: ['POSTGRES_PASSWORD=secret'] },
      HostConfig: { RestartPolicy: { Name: 'no' } },
      NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '5432' }] } },
      Mounts: []
    }
    const cmd = buildRunCommand(data)
    expect(cmd).toContain('-p 5432:5432/tcp')
    expect(cmd).not.toContain('0.0.0.0')
  })
})

describe('shQuote', () => {
  it('简单值不加引号', () => {
    expect(shQuote('nginx:latest')).toBe('nginx:latest')
    expect(shQuote('8080:80')).toBe('8080:80')
  })
  it('含空格/特殊字符加单引号', () => {
    expect(shQuote('bar baz')).toBe("'bar baz'")
    expect(shQuote("it's")).toBe("'it'\\''s'")
  })
})

describe('cleanShellWarning', () => {
  it('过滤非 TTY job-control warning，保留提示符', () => {
    const text = "sh: 0: can't access tty; job control turned off\n# "
    expect(cleanShellWarning(text)).toBe('# ')
  })
  it('过滤 bash warning', () => {
    const text = "bash: cannot set terminal process group (-1)\nbash: no job control in this shell\nroot@host:/# "
    expect(cleanShellWarning(text)).toBe('root@host:/# ')
  })
  it('普通输出原样保留', () => {
    expect(cleanShellWarning('ls\ntotal 0\n')).toBe('ls\ntotal 0\n')
  })
})

describe('资源列表解析', () => {
  it('解析镜像列表', () => {
    const stdout = JSON.stringify({
      ID: 'sha256:abc',
      Repository: 'nginx',
      Tag: 'latest',
      Size: '123MB',
      CreatedSince: '3 days ago'
    })
    expect(parseImageList(stdout)).toEqual([
      { id: 'sha256:abc', repository: 'nginx', tag: 'latest', size: '123MB', created: '3 days ago' }
    ])
  })
  it('解析卷列表', () => {
    const stdout = JSON.stringify({ Name: 'vol1', Driver: 'local', Mountpoint: '/var/lib/docker/volumes/vol1/_data' })
    expect(parseVolumeList(stdout)).toEqual([
      { name: 'vol1', driver: 'local', mountpoint: '/var/lib/docker/volumes/vol1/_data' }
    ])
  })
  it('解析网络列表', () => {
    const stdout = JSON.stringify({ ID: 'n1', Name: 'bridge', Driver: 'bridge', Scope: 'local' })
    expect(parseNetworkList(stdout)).toEqual([{ id: 'n1', name: 'bridge', driver: 'bridge', scope: 'local' }])
  })
})

describe('extractHostPorts', () => {
  it('从 Ports 字符串提取宿主机端口', () => {
    expect(extractHostPorts('0.0.0.0:8080->80/tcp, 127.0.0.1:3306->3306/tcp')).toEqual(['8080', '3306'])
    expect(extractHostPorts('')).toEqual([])
    expect(extractHostPorts('8080->80/tcp')).toEqual(['8080'])
  })
})
