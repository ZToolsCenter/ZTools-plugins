import { describe, it, expect } from 'vitest'
import { imageBadge, isK8sContainer, imageLogoDataUrl } from '../src/Containers/imageBadge'

describe('imageBadge', () => {
  it('已知镜像返回品牌色缩写', () => {
    expect(imageBadge('mysql:8.0.31')).toEqual({ letter: 'M', bg: '#00758f' })
    expect(imageBadge('redis:7')).toEqual({ letter: 'R', bg: '#d82c20' })
    expect(imageBadge('postgres:15')).toEqual({ letter: 'P', bg: '#336791' })
  })
  it('含仓库前缀的镜像正确取 basename', () => {
    expect(imageBadge('registry.k8s.io/coredns/coredns:v1.11')).toEqual({ letter: 'C', bg: '#1e6feb' })
    expect(imageBadge('docker.io/library/nginx:alpine')).toEqual({ letter: 'N', bg: '#009639' })
  })
  it('中间件/数据库镜像品牌徽章', () => {
    expect(imageBadge('rabbitmq:3-management')).toEqual({ letter: 'R', bg: '#ff6600' })
    expect(imageBadge('zookeeper:3.8')).toEqual({ letter: 'Z', bg: '#b8860b' })
    expect(imageBadge('clickhouse/clickhouse-server:23')).toEqual({ letter: 'C', bg: '#9a6700' })
    expect(imageBadge('opensearchproject/opensearch:2.11')).toEqual({ letter: 'O', bg: '#005eb8' })
    expect(imageBadge('mongo:7')).toEqual({ letter: 'M', bg: '#47a248' })
  })
  it('未知镜像回退为首字母+灰', () => {
    expect(imageBadge('myapp:latest')).toEqual({ letter: 'M', bg: '#8e8e93' })
    expect(imageBadge('')).toEqual({ letter: '?', bg: '#8e8e93' })
  })
})

describe('imageLogoDataUrl', () => {
  it('有品牌 LOGO 的镜像返回 svg data URL', () => {
    expect(imageLogoDataUrl('mysql:8.0.31')).toMatch(/^data:image\/svg\+xml,/)
    expect(imageLogoDataUrl('redis:7')).toMatch(/^data:image\/svg\+xml,/)
    expect(imageLogoDataUrl('docker.io/library/nginx:alpine')).toMatch(/^data:image\/svg\+xml,/)
  })
  it('无品牌 LOGO 的镜像返回空串（回退字母徽章）', () => {
    expect(imageLogoDataUrl('coredns')).toBe('')
    expect(imageLogoDataUrl('myapp:latest')).toBe('')
    expect(imageLogoDataUrl('')).toBe('')
  })
})

describe('isK8sContainer', () => {
  it('k8s_ 名称前缀识别', () => {
    expect(isK8sContainer({ name: 'k8s_coredns_pod_ns_uid_1', image: 'x' } as any)).toBe(true)
  })
  it('k8s 系统组件镜像识别（coredns/local-path/pause 等）', () => {
    expect(
      isK8sContainer({ name: 'coredns-64d64f99dd-kg6bm', image: 'registry.k8s.io/coredns/coredns:v1.11' } as any)
    ).toBe(true)
    expect(
      isK8sContainer({ name: 'local-path-provisioner', image: 'rancher/mirrored-local-path-provisioner:v0.0.24' } as any)
    ).toBe(true)
    expect(isK8sContainer({ name: 'coredns-pod', image: 'mirrored-pause:3.6' } as any)).toBe(true)
  })
  it('普通应用镜像不误判', () => {
    expect(isK8sContainer({ name: 'mysql8', image: 'mysql:8.0.31' } as any)).toBe(false)
    expect(isK8sContainer({ name: 'mta-service-parent-redis-1', image: 'redis:7' } as any)).toBe(false)
    expect(isK8sContainer({ name: 'chroma', image: 'chroma:1.1.0' } as any)).toBe(false)
  })
})
