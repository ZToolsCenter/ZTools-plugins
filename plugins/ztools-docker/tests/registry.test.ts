import { describe, it, expect } from 'vitest'
import { generateDaemonJson, daemonConfigPath, decodeChunked, normalize } from '../public/preload/registry.js'

describe('generateDaemonJson', () => {
  it('生成 daemon.json 内容', () => {
    const json = generateDaemonJson(['https://docker.m.daocloud.io', 'https://hub.rat.dev'])
    expect(json).toContain('"registry-mirrors"')
    expect(json).toContain('https://docker.m.daocloud.io')
    expect(json).toContain('https://hub.rat.dev')
  })
})

describe('daemonConfigPath', () => {
  it('返回平台路径与说明', () => {
    const c = daemonConfigPath()
    expect(c.path.length).toBeGreaterThan(0)
    expect(c.note.length).toBeGreaterThan(0)
  })
})

describe('decodeChunked', () => {
  it('解码 chunked 响应体', () => {
    const chunked = Buffer.from('8b2\r\n' + 'a'.repeat(0x8b2) + '\r\n0\r\n\r\n')
    expect(decodeChunked(chunked).toString()).toBe('a'.repeat(0x8b2))
  })
  it('多 chunk 解码', () => {
    const chunked = Buffer.from('5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n')
    expect(decodeChunked(chunked).toString()).toBe('hello world')
  })
})

describe('normalize - Docker Hub 官方字段', () => {
  it('官方镜像 repo_name 解析并补 library 前缀', () => {
    const item = {
      repo_name: 'nginx',
      short_description: 'Official build of Nginx.',
      star_count: 21357,
      pull_count: 13253167718,
      repo_owner: '',
      is_official: true
    }
    expect(normalize(item, 'dockerhub')).toEqual({
      source: 'dockerhub',
      name: 'library/nginx',
      description: 'Official build of Nginx.',
      stars: 21357,
      pulls: '13253167718',
      official: true,
      logo: ''
    })
  })
  it('非官方命名空间镜像保持原名', () => {
    const item = { repo_name: 'nginx/nginx-ingress', is_official: false, star_count: 122 }
    const n = normalize(item, 'dockerhub')
    expect(n.name).toBe('nginx/nginx-ingress')
    expect(n.official).toBe(false)
  })
})
