import { describe, expect, it } from 'vitest'
import { dockerUnavailableReason, isDockerUnavailable, parseDockerPs, portsRawToPort } from './docker-parse'

describe('parseDockerPs', () => {
  it('running/exited 两行解析(含端口映射原文)', () => {
    const out = [
      'a1b2c3d4e5f6\tnginx-web\tnginx:latest\tUp 3 hours\t0.0.0.0:8080->80/tcp, :::8080->80/tcp',
      'f6e5d4c3b2a1\tredis-cache\tredis:7\tExited (0) 2 days ago\t6379/tcp'
    ].join('\n')
    const cs = parseDockerPs(out)
    expect(cs).toHaveLength(2)
    expect(cs[0]).toMatchObject({ id: 'docker:a1b2c3d4e5f6', name: 'nginx-web', image: 'nginx:latest', status: 'running', statusText: 'Up 3 hours' })
    expect(cs[1]).toMatchObject({ name: 'redis-cache', status: 'exited', statusText: 'Exited (0) 2 days ago' })
  })

  it('空输出/畸形行跳过', () => {
    expect(parseDockerPs('')).toEqual([])
    expect(parseDockerPs('only-one-field')).toEqual([])
  })
})

describe('portsRawToPort / isDockerUnavailable', () => {
  it('取首个宿主机端口;无映射 → 0', () => {
    expect(portsRawToPort('0.0.0.0:8080->80/tcp, :::8080->80/tcp')).toBe(8080)
    expect(portsRawToPort('6379/tcp')).toBe(0)
    expect(portsRawToPort('')).toBe(0)
  })

  it('daemon 未运行/CLI 缺失识别', () => {
    expect(isDockerUnavailable(null, '', 'spawn docker ENOENT')).toBe(true)
    expect(isDockerUnavailable(1, 'Cannot connect to the Docker daemon at unix:///x. Is the docker daemon running?', null)).toBe(true)
    expect(isDockerUnavailable(1, 'dial unix /Users/x/.docker/run/docker.sock: connect: no such file or directory', null)).toBe(true)
    expect(isDockerUnavailable(0, '', null)).toBe(false)
    expect(isDockerUnavailable(1, 'some other error', null)).toBe(false)
  })
})

describe('dockerUnavailableReason', () => {
  it('区分 CLI 缺失 / daemon 未运行 / 超时', () => {
    expect(dockerUnavailableReason({ code: null, stderr: '', error: 'spawn docker ENOENT' })).toBe('cli-missing')
    expect(dockerUnavailableReason({ code: 1, stderr: 'zsh: command not found: docker', error: null })).toBe('cli-missing')
    expect(
      dockerUnavailableReason({
        code: 1,
        stderr: 'Cannot connect to the Docker daemon at unix:///x. Is the docker daemon running?',
        error: null
      })
    ).toBe('daemon-down')
    expect(dockerUnavailableReason({ code: null, stderr: '', error: null, timedOut: true })).toBe('timeout')
  })

  it('超时优先于 code===null 的兜底分类(超时被杀时 code 同样为 null)', () => {
    expect(dockerUnavailableReason({ code: null, stderr: '', error: null })).toBe('cli-missing')
  })

  it('可用与无法识别的非零退出都回 null', () => {
    expect(dockerUnavailableReason({ code: 0, stderr: '', error: null })).toBeNull()
    expect(dockerUnavailableReason({ code: 1, stderr: 'some other error', error: null })).toBeNull()
  })
})
