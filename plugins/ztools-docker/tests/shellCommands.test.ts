import { describe, it, expect } from 'vitest'
import { imageCommands } from '../src/Containers/shellCommands'

describe('imageCommands', () => {
  it('mysql 返回专属命令 + 通用命令', () => {
    const cmds = imageCommands('mysql:8.0.31')
    expect(cmds).toContain('mysql -u root -p')
    expect(cmds).toContain('SHOW DATABASES;')
    expect(cmds).toContain('ps aux')          // 通用
    expect(cmds).toContain('ls -la')
  })

  it('nginx 返回 nginx -t 等专属命令', () => {
    const cmds = imageCommands('docker.io/library/nginx:alpine')
    expect(cmds).toContain('nginx -t')
    expect(cmds).toContain('ls /etc/nginx/conf.d/')
  })

  it('未知镜像仅返回通用命令且无重复', () => {
    const cmds = imageCommands('myapp:latest')
    expect(cmds.length).toBe(new Set(cmds).size)
    expect(cmds).toContain('ps aux')
    expect(cmds).not.toContain('mysql -u root -p')
  })

  it('空镜像也返回通用命令', () => {
    expect(imageCommands('').length).toBeGreaterThan(0)
  })
})
