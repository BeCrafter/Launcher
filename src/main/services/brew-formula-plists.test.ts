import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { brewOptRoots, listBrewFormulaServicePlists, pickBrewServicePlist } from './brew-formula-plists'

describe('brewOptRoots', () => {
  it('自定义前缀和 brew 可执行文件的位置都算进去,并且不重复', () => {
    expect(
      brewOptRoots({ prefix: '/custom/homebrew', brewBin: '/opt/homebrew/bin/brew' })
    ).toEqual(['/custom/homebrew/opt', '/opt/homebrew/opt', '/usr/local/opt'])
  })

  it('没找到 brew 时仍扫两个默认位置', () => {
    expect(brewOptRoots({ prefix: null, brewBin: 'brew' })).toEqual(['/opt/homebrew/opt', '/usr/local/opt'])
  })
})

describe('pickBrewServicePlist', () => {
  it('新旧两份都在时只留 sh.brew', () => {
    expect(
      pickBrewServicePlist('colima', ['homebrew.mxcl.colima.plist', 'sh.brew.colima.plist', 'other.plist'])
    ).toBe('sh.brew.colima.plist')
  })

  it('没有新名就用 homebrew.mxcl', () => {
    expect(pickBrewServicePlist('redis', ['homebrew.mxcl.redis.plist'])).toBe('homebrew.mxcl.redis.plist')
  })

  it('不是服务 plist 就不选', () => {
    expect(pickBrewServicePlist('wget', ['README.plist'])).toBeNull()
  })
})

describe('listBrewFormulaServicePlists', () => {
  it('只收公式目录里的服务 plist,并且同一公式不重复', async () => {
    const root = await mkdtemp(join(tmpdir(), 'brew-plists-'))
    await mkdir(join(root, 'postgresql@18'), { recursive: true })
    await mkdir(join(root, 'colima'), { recursive: true })
    await mkdir(join(root, 'wget'), { recursive: true })
    await writeFile(join(root, 'postgresql@18', 'sh.brew.postgresql@18.plist'), '<plist/>')
    await writeFile(join(root, 'colima', 'sh.brew.colima.plist'), '<plist/>')
    await writeFile(join(root, 'colima', 'homebrew.mxcl.colima.plist'), '<plist/>')
    await writeFile(join(root, 'wget', 'something.plist'), '<plist/>')
    const missing = join(root, 'nope')
    await expect(listBrewFormulaServicePlists([root, missing])).resolves.toEqual([
      join(root, 'colima', 'sh.brew.colima.plist'),
      join(root, 'postgresql@18', 'sh.brew.postgresql@18.plist')
    ])
  })
})
