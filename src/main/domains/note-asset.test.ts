// 附件闸门的回归:**预览协议与 AI 读图共用这一份**。
//
// 两个入口,一份闸门 —— 所以这里点名的是「必须继续拒绝」的那几类
// (越界、不在 assets/、白名单外的扩展名)。放行失败一眼可见,拒绝失败是静默的。
import { describe, expect, it } from 'vitest'
import { resolveAssetRel } from './note-asset'

const DIR = '/Users/tester/.config/launcher/notes'
const pathOf = (rel: string): string | null => resolveAssetRel(DIR, rel)?.path ?? null
const kindOf = (rel: string): string | null => resolveAssetRel(DIR, rel)?.kind ?? null

describe('resolveAssetRel', () => {
  it('assets/ 下的白名单文件放行', () => {
    expect(pathOf('assets/a.png')).toBe(`${DIR}/assets/a.png`)
    expect(pathOf('assets/截图.png')).toBe(`${DIR}/assets/截图.png`)
    expect(pathOf('assets/sub/x.jpg')).toBe(`${DIR}/assets/sub/x.jpg`)
    expect(kindOf('assets/x.mp4')).toBe('video')
    expect(kindOf('assets/x.pdf')).toBe('pdf')
  })

  it('空路径 / 只服务 assets/ 下的文件', () => {
    expect(resolveAssetRel(DIR, '')).toBeNull()
    expect(pathOf('secret.png')).toBeNull()
    expect(pathOf('notes.md')).toBeNull()
    expect(pathOf('.trash/old.png')).toBeNull()
    expect(pathOf('assets')).toBeNull()
  })

  it('路径穿越一律拒绝', () => {
    expect(pathOf('assets/../../etc/passwd.png')).toBeNull()
    expect(pathOf('assets/sub/../../../outside.png')).toBeNull()
    expect(pathOf('/etc/passwd.png')).toBeNull()
  })

  it('%2f 形态的穿越:原样传入时它不是分隔符,解析结果仍锁在 assets/ 内', () => {
    // 调用方(协议处理器 / readAssetForAi)会再试一次解码后的写法,那一次由上面那条用例挡住。
    // 这里要钉的是:原样传入**不会**跑出笔记目录。
    const out = resolveAssetRel(DIR, 'assets/..%2f..%2fetc/passwd.png')
    expect(out === null || out.path.startsWith(`${DIR}/assets/`)).toBe(true)
  })

  it('白名单外的扩展名拒绝(svg 是 XSS 向量,md/txt 是文档)', () => {
    for (const ext of ['svg', 'SVG', 'md', 'txt', 'js', 'json', 'html5', 'yml', '']) {
      expect(resolveAssetRel(DIR, `assets/x.${ext}`)).toBeNull()
    }
  })

  it('目录本身带符号链接式写法也归一化后再判', () => {
    expect(pathOf('assets/./x.png')).toBe(`${DIR}/assets/x.png`)
    expect(resolveAssetRel('/a/./b', 'assets/./x.png')?.path).toBe('/a/b/assets/x.png')
  })

  it('笔记目录是另一个目录的前缀时不会误放行', () => {
    // /notes-evil 以 /notes 开头,但不在 /notes 里面
    expect(resolveAssetRel('/notes', '../notes-evil/assets/x.png')).toBeNull()
  })
})
