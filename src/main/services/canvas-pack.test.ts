import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packCanvasEmbeds } from './canvas-pack'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'launcher-canvas-pack-'))
  dirs.push(dir)
  return dir
}

function write(path: string, text: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, text)
}

function board(source: string, project = '', host = 'this-mac'): string {
  return JSON.stringify({
    type: 'excalidraw',
    elements: [
      {
        type: 'embeddable',
        isDeleted: false,
        link: 'launcher-note://file/占位.txt',
        customData: { embed: { source, project, host } }
      }
    ]
  })
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('packCanvasEmbeds', () => {
  it('原文件还在时拷进白板所在目录,并写回 project', () => {
    const notes = tempDir()
    const outside = tempDir()
    write(join(outside, '说明.txt'), '第一版')
    mkdirSync(join(notes, '画'), { recursive: true })
    write(join(notes, '画', '板.excal'), board(join(outside, '说明.txt')))

    const out = packCanvasEmbeds({ root: notes, maxBytes: 0 })
    expect(out.errors).toEqual([])
    expect(out.updated).toEqual(['画/板.excal'])
    expect(readFileSync(join(notes, '画', '说明.txt'), 'utf8')).toBe('第一版')
    const scene = JSON.parse(readFileSync(join(notes, '画', '板.excal'), 'utf8')) as {
      elements: { customData: { embed: { project: string; source: string } }; link: string }[]
    }
    expect(scene.elements[0]?.customData.embed.project).toBe('画/说明.txt')
    expect(scene.elements[0]?.customData.embed.source).toBe(join(outside, '说明.txt'))
    expect(scene.elements[0]?.link.includes(outside)).toBe(false)
  })

  it('再次打包覆盖同一个 project,不另出序号', () => {
    const notes = tempDir()
    const outside = tempDir()
    write(join(outside, '说明.txt'), '第一版')
    write(join(notes, '板.excal'), board(join(outside, '说明.txt')))

    packCanvasEmbeds({ root: notes, maxBytes: 0 })
    write(join(outside, '说明.txt'), '第二版')
    const again = packCanvasEmbeds({ root: notes, maxBytes: 0 })

    expect(again.updated).toEqual([])
    expect(existsSync(join(notes, '说明-2.txt'))).toBe(false)
    expect(readFileSync(join(notes, '说明.txt'), 'utf8')).toBe('第二版')
  })

  it('原文件不在时留着上一次的副本', () => {
    const notes = tempDir()
    write(join(notes, '说明.txt'), '留下')
    write(join(notes, '板.excal'), board('/definitely/not/here.txt', '说明.txt'))

    const out = packCanvasEmbeds({ root: notes, maxBytes: 0 })
    expect(out.updated).toEqual([])
    expect(readFileSync(join(notes, '说明.txt'), 'utf8')).toBe('留下')
  })

  it('路径还在就拷,不管记的是哪台电脑', () => {
    const notes = tempDir()
    const outside = tempDir()
    write(join(outside, '说明.txt'), '别人的')
    write(join(notes, '板.excal'), board(join(outside, '说明.txt'), '', 'other-mac'))

    const out = packCanvasEmbeds({ root: notes, maxBytes: 0 })
    expect(out.errors).toEqual([])
    expect(out.updated).toEqual(['板.excal'])
    expect(readFileSync(join(notes, '说明.txt'), 'utf8')).toBe('别人的')
  })

  it('gltf 的同目录相对引用一起拷进新目录,绝对路径和 .. 不带', () => {
    const notes = tempDir()
    const outside = tempDir()
    write(
      join(outside, '模型.gltf'),
      JSON.stringify({
        buffers: [{ uri: '模型.bin' }, { uri: '../逃.bin' }],
        images: [{ uri: '贴图.png' }, { uri: '/tmp/外面.png' }]
      })
    )
    write(join(outside, '模型.bin'), 'bin')
    write(join(outside, '贴图.png'), 'png')
    write(join(outside, '..', '逃.bin'), 'no')
    write(join(notes, '板.excal'), board(join(outside, '模型.gltf')))

    const out = packCanvasEmbeds({ root: notes, maxBytes: 0 })
    expect(out.errors).toEqual([])
    expect(out.updated).toEqual(['板.excal'])
    expect(readFileSync(join(notes, '模型', '模型.gltf'), 'utf8')).toContain('模型.bin')
    expect(readFileSync(join(notes, '模型', '模型.bin'), 'utf8')).toBe('bin')
    expect(readFileSync(join(notes, '模型', '贴图.png'), 'utf8')).toBe('png')
    expect(existsSync(join(notes, '模型', '逃.bin'))).toBe(false)
    const scene = JSON.parse(readFileSync(join(notes, '板.excal'), 'utf8')) as {
      elements: { customData: { embed: { project: string } } }[]
    }
    expect(scene.elements[0]?.customData.embed.project).toBe('模型/模型.gltf')
  })

  it('超过上限的不拷,并记进错误', () => {
    const notes = tempDir()
    const outside = tempDir()
    write(join(outside, '大.txt'), '12345')
    write(join(notes, '板.excal'), board(join(outside, '大.txt')))

    const out = packCanvasEmbeds({ root: notes, maxBytes: 4 })
    expect(out.updated).toEqual([])
    expect(out.errors[0]?.message).toContain('已跳过')
    expect(existsSync(join(notes, '大.txt'))).toBe(false)
  })
})
