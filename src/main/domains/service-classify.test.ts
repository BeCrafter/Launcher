import { describe, expect, it } from 'vitest'
import { classifyService, matchesBrewService } from './service-classify'

const brewSet = (...names: string[]): ReadonlySet<string> => new Set(names)
const cls = (command: string, cmd: string, brewServices: ReadonlySet<string> = brewSet()) =>
  classifyService({ command, cmd, port: 12345 }, brewServices)

describe('matchesBrewService(名称变形)', () => {
  it('直接同名 / -server / -d / @版本 变形', () => {
    expect(matchesBrewService('redis-server', brewSet('redis'))).toBe('redis')
    expect(matchesBrewService('nginx', brewSet('nginx'))).toBe('nginx')
    expect(matchesBrewService('mysqld', brewSet('mysql@8.4'))).toBe('mysql@8.4')
    expect(matchesBrewService('php-fpm', brewSet('php@8.1'))).toBe('php@8.1')
    expect(matchesBrewService('/usr/local/opt/postgresql@16/bin/postgres', brewSet('postgresql@16'))).toBe('postgresql@16')
  })
  it('不相关命令不命中', () => {
    expect(matchesBrewService('rapportd', brewSet('redis', 'nginx'))).toBeNull()
  })
})

describe('classifyService(分类管线)', () => {
  it('brew:redis-server / nginx / postgres / mysqld@8.4 / httpd → brew 桶', () => {
    const set = brewSet('redis', 'nginx', 'postgresql@16', 'mysql@8.4', 'httpd')
    expect(cls('redis-server', 'redis-server *:6379', set)).toMatchObject({ type: 'brew', kind: 'brew' })
    expect(cls('nginx', 'nginx: master process', set)).toMatchObject({ type: 'brew', kind: 'brew' })
    expect(cls('postgres', 'postgres -D /usr/local/var', set)).toMatchObject({ type: 'brew', kind: 'brew' })
    expect(cls('mysqld', 'mysqld', set)).toMatchObject({ type: 'brew', kind: 'brew' })
    expect(cls('httpd', 'httpd -D FOREGROUND', set)).toMatchObject({ type: 'brew', kind: 'brew' })
  })

  it('node:node / 绝对路径 / nvm 路径 → node 桶', () => {
    expect(cls('node', 'node server.js')).toMatchObject({ type: 'node', kind: 'node' })
    expect(cls('/usr/local/bin/node', '/usr/local/bin/node app.js')).toMatchObject({ type: 'node', kind: 'node' })
    expect(cls('/Users/x/.nvm/versions/node/v20.11.0/bin/node', 'node index.js')).toMatchObject({ type: 'node', kind: 'node' })
  })

  it('dev:node 运行 vite/webpack-dev-server/next dev/nodemon → node 桶 + dev kind', () => {
    expect(cls('node', '/path/node_modules/.bin/vite --port 5173')).toMatchObject({ type: 'node', kind: 'dev' })
    expect(cls('node', 'webpack-dev-server --hot')).toMatchObject({ type: 'node', kind: 'dev' })
    expect(cls('node', 'next dev -p 3000')).toMatchObject({ type: 'node', kind: 'dev' })
    expect(cls('node', 'nodemon server.js')).toMatchObject({ type: 'node', kind: 'dev' })
    expect(cls('node', 'nuxt dev')).toMatchObject({ type: 'node', kind: 'dev' })
  })

  it('python:python3.11 / python3.14 / uvicorn / gunicorn', () => {
    expect(cls('python3.11', 'python3.11 -m http.server 8000')).toMatchObject({ type: 'process', kind: 'python' })
    expect(cls('python3.14', 'python3.14 app.py')).toMatchObject({ type: 'process', kind: 'python' })
    expect(cls('uvicorn', 'uvicorn app:api --port 8000')).toMatchObject({ type: 'process', kind: 'python' })
    expect(cls('gunicorn', 'gunicorn -w 4 app:app')).toMatchObject({ type: 'process', kind: 'python' })
  })

  it('php:php-fpm / php8.1', () => {
    expect(cls('php-fpm', 'php-fpm: master process')).toMatchObject({ kind: 'php' })
    expect(cls('php8.1', 'php8.1 -S localhost:8080')).toMatchObject({ kind: 'php' })
  })

  it('jvm:java -jar / -classpath', () => {
    expect(cls('java', 'java -jar server.jar')).toMatchObject({ kind: 'jvm' })
    expect(cls('/usr/bin/java', 'java -classpath lib/a.jar Main')).toMatchObject({ kind: 'jvm' })
  })

  it('ruby:ruby3.2 / puma / rails', () => {
    expect(cls('ruby3.2', 'ruby3.2 app.rb')).toMatchObject({ kind: 'ruby' })
    expect(cls('puma', 'puma -p 9292')).toMatchObject({ kind: 'ruby' })
    expect(cls('rails', 'rails server')).toMatchObject({ kind: 'ruby' })
  })

  it('docker 代理进程:com.docker.* → docker kind', () => {
    expect(cls('com.docker.backend', 'com.docker.backend -socket')).toMatchObject({ kind: 'docker' })
    expect(cls('com.docker.vpnkit', 'com.docker.vpnkit')).toMatchObject({ kind: 'docker' })
  })

  it('process 兜底:系统与普通进程', () => {
    expect(cls('rapportd', 'rapportd')).toMatchObject({ type: 'process', kind: 'process' })
    expect(cls('ControlCenter', 'ControlCenter')).toMatchObject({ kind: 'process' })
    expect(cls('Spotify', 'Spotify')).toMatchObject({ kind: 'process' })
    expect(cls('知音楼 Helper', '知音楼 Helper')).toMatchObject({ kind: 'process' })
    expect(cls('clash-verge', 'clash-verge')).toMatchObject({ kind: 'process' })
    expect(cls('BSPrintNotify', 'BSPrintNotify')).toMatchObject({ kind: 'process' })
  })

  it('evidence 为命令 basename(tooltip {C} 槽)', () => {
    expect(cls('/usr/local/bin/node', 'node x.js').evidence).toBe('node')
    expect(cls('com.docker.backend', 'com.docker.backend').evidence).toBe('com.docker.backend')
  })

  it('优先序:brew 命中优先于命令名特征(redis-server 即使像 node 也归 brew)', () => {
    const set = brewSet('redis')
    expect(cls('redis-server', 'redis-server', set)).toMatchObject({ type: 'brew' })
  })

  it('空 brew 集合:不误判', () => {
    expect(cls('redis-server', 'redis-server', brewSet())).toMatchObject({ type: 'process', kind: 'process' })
  })
})
