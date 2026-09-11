import { describe, it, expect } from 'vitest'
import { buildInstallCommand } from '../../src/lib/command-builder'

describe('buildInstallCommand', () => {
  it('npm / pnpm / yarn 基础指令', () => {
    const c = { name: 'lodash', version: '4.17.21' }
    expect(buildInstallCommand(c, 'npm')).toBe('npm install lodash@4.17.21')
    expect(buildInstallCommand(c, 'pnpm')).toBe('pnpm add lodash@4.17.21')
    expect(buildInstallCommand(c, 'yarn')).toBe('yarn add lodash@4.17.21')
  })
  it('默认包管理器为 npm', () => {
    expect(buildInstallCommand({ name: 'vue', version: '3.5.41' })).toBe('npm install vue@3.5.41')
  })
  it('无版本时省略 @version', () => {
    expect(buildInstallCommand({ name: 'vue' }, 'npm')).toBe('npm install vue')
  })
  it('npm 开发依赖 -D', () => {
    expect(buildInstallCommand({ name: 'vite', version: '6.0.11' }, 'npm', { dev: true })).toBe('npm install -D vite@6.0.11')
  })
  it('pnpm/yarn 开发依赖 -D', () => {
    expect(buildInstallCommand({ name: 'vite', version: '6.0.11' }, 'pnpm', { dev: true })).toBe('pnpm add -D vite@6.0.11')
    expect(buildInstallCommand({ name: 'vite', version: '6.0.11' }, 'yarn', { dev: true })).toBe('yarn add -D vite@6.0.11')
  })
  it('全局安装', () => {
    expect(buildInstallCommand({ name: 'vue-cli' }, 'npm', { global: true })).toBe('npm install -g vue-cli')
    expect(buildInstallCommand({ name: 'vue-cli' }, 'pnpm', { global: true })).toBe('pnpm add -g vue-cli')
    expect(buildInstallCommand({ name: 'vue-cli' }, 'yarn', { global: true })).toBe('yarn global add vue-cli')
  })
  it('全局安装保留版本', () => {
    expect(buildInstallCommand({ name: 'vue-cli', version: '5.0.8' }, 'npm', { global: true })).toBe('npm install -g vue-cli@5.0.8')
    expect(buildInstallCommand({ name: 'vue-cli', version: '5.0.8' }, 'pnpm', { global: true })).toBe('pnpm add -g vue-cli@5.0.8')
    expect(buildInstallCommand({ name: 'vue-cli', version: '5.0.8' }, 'yarn', { global: true })).toBe('yarn global add vue-cli@5.0.8')
  })
  it('global 优先于 dev', () => {
    expect(buildInstallCommand({ name: 'foo', version: '1.0.0' }, 'npm', { global: true, dev: true })).toBe('npm install -g foo@1.0.0')
  })
  it('scoped 包名', () => {
    expect(buildInstallCommand({ name: '@vue/cli', version: '5.0.8' }, 'npm')).toBe('npm install @vue/cli@5.0.8')
    expect(buildInstallCommand({ name: '@scope/pkg' }, 'pnpm')).toBe('pnpm add @scope/pkg')
  })
})
