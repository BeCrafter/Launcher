import { describe, expect, it } from 'vitest'
import { resolveDockerPath } from './docker-path'

describe('resolveDockerPath', () => {
  it('按候选顺序返回首个存在的绝对路径', () => {
    const existing = new Set(['/opt/homebrew/bin/docker'])
    expect(resolveDockerPath((p) => existing.has(p), '/Users/x')).toBe('/opt/homebrew/bin/docker')
  })

  it('优先 Docker Desktop 的应用内路径(本机实测唯一命中点)', () => {
    const existing = new Set([
      '/Applications/Docker.app/Contents/Resources/bin/docker',
      '/opt/homebrew/bin/docker'
    ])
    expect(resolveDockerPath((p) => existing.has(p), '/Users/x')).toBe(
      '/Applications/Docker.app/Contents/Resources/bin/docker'
    )
  })

  it('家目录候选排在绝对路径候选之后', () => {
    const existing = new Set(['/Users/x/.docker/bin/docker'])
    expect(resolveDockerPath((p) => existing.has(p), '/Users/x')).toBe('/Users/x/.docker/bin/docker')
    expect(resolveDockerPath((p) => existing.has(p), '/Users/other')).toBe('docker')
  })

  it('均不存在时兜底走 PATH(保持旧行为)', () => {
    expect(resolveDockerPath(() => false, '/Users/x')).toBe('docker')
  })
})
