import { describe, expect, it } from 'vitest'
import { BREW_LABEL_PREFIX, brewFormulaName, formulaNameFromLabel, formulaNameFromProgram, isBrewManaged } from './brew-heuristic'

describe('formulaNameFromLabel', () => {
  it('homebrew.mxcl. 前缀 → 余部即公式名', () => {
    expect(formulaNameFromLabel('homebrew.mxcl.php@7.1')).toBe('php@7.1')
    expect(formulaNameFromLabel('homebrew.mxcl.redis')).toBe('redis')
  })
  it('非前缀 / 空余部 → null', () => {
    expect(formulaNameFromLabel('com.user.backup')).toBeNull()
    expect(formulaNameFromLabel('homebrew.mxcl.')).toBeNull()
    expect(formulaNameFromLabel('')).toBeNull()
  })
})

describe('formulaNameFromProgram', () => {
  it('Apple Silicon 路径(/opt/homebrew)', () => {
    expect(formulaNameFromProgram('/opt/homebrew/opt/redis/bin/redis-server')).toBe('redis')
    expect(formulaNameFromProgram('/opt/homebrew/Cellar/mysql@8.4/8.4.0/bin/mysqld')).toBe('mysql')
  })
  it('Intel 路径(/usr/local/opt | Cellar)', () => {
    expect(formulaNameFromProgram('/usr/local/opt/php@7.1/bin/php')).toBe('php')
    expect(formulaNameFromProgram('/usr/local/Cellar/redis/7.2.5/bin/redis-server')).toBe('redis')
  })
  it('.rb 后缀剥离(捕获段以 .rb 结尾时)', () => {
    expect(formulaNameFromProgram('/usr/local/opt/mysql.rb')).toBe('mysql')
  })
  it('@版本后缀剥离', () => {
    expect(formulaNameFromProgram('/usr/local/opt/php@8.1/sbin/php-fpm')).toBe('php')
  })
  it('非 Homebrew 路径 → null', () => {
    expect(formulaNameFromProgram('/usr/sbin/mysqld')).toBeNull()
    expect(formulaNameFromProgram('/usr/local/bin/node')).toBeNull()
    expect(formulaNameFromProgram('')).toBeNull()
  })
  it('/usr/local/opt 之外的 /usr/local 不误判', () => {
    // HOMEBREW_PATH_RE 只放行 /usr/local/opt|Cellar,/usr/local/share 等不算
    expect(formulaNameFromProgram('/usr/local/share/foo/bar')).toBeNull()
  })
})

describe('isBrewManaged / brewFormulaName 组合', () => {
  it('label 命中优先于路径', () => {
    expect(brewFormulaName('homebrew.mxcl.redis', '/usr/sbin/other')).toBe('redis')
  })
  it('label 未命中但路径命中 → 路径推断兜底', () => {
    expect(brewFormulaName('sh.brew.php', '/usr/local/opt/php@7.1/bin/php')).toBe('php')
    expect(isBrewManaged('sh.brew.php', '/usr/local/opt/php@7.1/bin/php')).toBe(true)
  })
  it('两者均未命中 → false', () => {
    expect(isBrewManaged('com.apple.launchd', '/usr/sbin/syslogd')).toBe(false)
    expect(isBrewManaged('', '')).toBe(false)
  })
  it('常量与开源 BrewManagedSupport 一致', () => {
    expect(BREW_LABEL_PREFIX).toBe('homebrew.mxcl.')
  })
})
