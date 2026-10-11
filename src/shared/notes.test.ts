import { describe, expect, it } from 'vitest'
import {
  baseNameOf,
  isSafeNoteId,
  isSafeNoteSegment,
  joinNoteId,
  noteAssetKind,
  noteAssetKindOfUrl,
  notesAssetsDir,
  parentOf,
  resolveNotesDir,
  MAX_FOLDER_DEPTH,
  NOTE_ID_MAX,
  NOTE_SEGMENT_MAX
} from './notes'
import { LAUNCHER_CONFIG_DIR_SUFFIX } from './constants'

const HOME = '/Users/tester'

describe('resolveNotesDir', () => {
  it('设置为空 → 默认落在设置文件同层', () => {
    expect(resolveNotesDir({ notesDir: '', home: HOME })).toBe(
      `${HOME}/${LAUNCHER_CONFIG_DIR_SUFFIX}/notes`
    )
    expect(resolveNotesDir({ notesDir: '   ', home: HOME })).toBe(
      `${HOME}/${LAUNCHER_CONFIG_DIR_SUFFIX}/notes`
    )
  })

  it('显式绝对路径原样使用(可指向 Obsidian vault / iCloud)', () => {
    expect(resolveNotesDir({ notesDir: '/Volumes/sync/notes', home: HOME })).toBe('/Volumes/sync/notes')
    expect(resolveNotesDir({ notesDir: '  /Volumes/sync/notes  ', home: HOME })).toBe('/Volumes/sync/notes')
  })

  it('~/ 前缀按 home 展开', () => {
    expect(resolveNotesDir({ notesDir: '~/Documents/notes', home: HOME })).toBe(`${HOME}/Documents/notes`)
  })

  it('E2E 覆盖优先于显式设置 —— 否则自动化验证会写进用户真实笔记目录', () => {
    expect(
      resolveNotesDir({ notesDir: '/Volumes/sync/notes', home: HOME, e2eUserData: '/tmp/launcher-e2e' })
    ).toBe('/tmp/launcher-e2e/notes')
  })
})

describe('notesAssetsDir', () => {
  it('附件目录在笔记目录内', () => {
    expect(notesAssetsDir('/notes')).toBe('/notes/assets')
  })
})

describe('isSafeNoteSegment', () => {
  it('正常段放行(含中文与空格)', () => {
    expect(isSafeNoteSegment('note')).toBe(true)
    expect(isSafeNoteSegment('排查 redis')).toBe(true)
  })

  it('空 / 点 / 点点 / 点开头 拒绝', () => {
    for (const seg of ['', '.', '..', '.trash', '.hidden']) {
      expect(isSafeNoteSegment(seg)).toBe(false)
    }
  })

  it('分隔符与控制字符拒绝', () => {
    for (const seg of ['a/b', 'a\\b', 'a\u0000b']) {
      expect(isSafeNoteSegment(seg)).toBe(false)
    }
  })

  it('单段超长拒绝', () => {
    expect(isSafeNoteSegment('x'.repeat(NOTE_SEGMENT_MAX))).toBe(true)
    expect(isSafeNoteSegment('x'.repeat(NOTE_SEGMENT_MAX + 1))).toBe(false)
  })
})

describe('isSafeNoteId(路径穿越防护)', () => {
  it('正常 id 放行', () => {
    expect(isSafeNoteId('note')).toBe(true)
    expect(isSafeNoteId('排查-redis')).toBe(true)
  })

  it('目录路径放行', () => {
    expect(isSafeNoteId('工作/nginx 排障')).toBe(true)
    expect(isSafeNoteId('a/b/c')).toBe(true)
  })

  it('路径分隔符在**段内**仍被拒 —— 但作为分隔符是合法的', () => {
    // `a/b` 现在是两段,合法;`a\b` 与 `a\0b` 仍非法
    expect(isSafeNoteId('a\\b')).toBe(false)
    expect(isSafeNoteId('a\u0000b')).toBe(false)
    expect(isSafeNoteId('a//b')).toBe(false) // 空段
  })

  it('穿越与绝对路径一律拒绝', () => {
    for (const id of ['../x', 'a/../../x', '/etc/passwd', 'a/..', '..', '.', 'a/./b', '.trash/x']) {
      expect(isSafeNoteId(id)).toBe(false)
    }
  })

  it('任意一段以点开头就拒绝(隐藏文件与 .trash 落点)', () => {
    expect(isSafeNoteId('ok/.hidden')).toBe(false)
    expect(isSafeNoteId('a/b/.c')).toBe(false)
  })

  it('前后斜杠拒绝(不静默归一化 —— 归一化会让「同一篇笔记两个 id」)', () => {
    expect(isSafeNoteId('/a')).toBe(false)
    expect(isSafeNoteId('a/')).toBe(false)
  })

  it('单段上限比总长上限更严:一段写满总长也照样拒', () => {
    expect(isSafeNoteId('x'.repeat(NOTE_SEGMENT_MAX))).toBe(true)
    expect(isSafeNoteId('x'.repeat(NOTE_SEGMENT_MAX + 1))).toBe(false)
    // 400 个 x 是「一段」,先撞段上限(120)而不是总长上限(400)
    expect(isSafeNoteId('x'.repeat(NOTE_ID_MAX))).toBe(false)
  })

  it('多段累加超总长也拒', () => {
    const seg = 'x'.repeat(NOTE_SEGMENT_MAX) // 每段都合法
    const total = (n: number): string => Array.from({ length: n }, () => seg).join('/')
    // 3 段 = 362 字符 ≤ 400 → 放行
    expect(isSafeNoteId(total(3))).toBe(true)
    // 4 段 = 483 字符 > 400 → 拒
    expect(isSafeNoteId(total(4))).toBe(false)
  })

  it('目录深度上限', () => {
    // id 的段数 = 目录层数 + 文件名那一段
    expect(isSafeNoteId(Array.from({ length: MAX_FOLDER_DEPTH + 1 }, () => 'd').join('/'))).toBe(true)
    expect(isSafeNoteId(Array.from({ length: MAX_FOLDER_DEPTH + 2 }, () => 'd').join('/'))).toBe(false)
  })
})

describe('路径助手', () => {
  it('parentOf / baseNameOf', () => {
    expect(parentOf('a/b/c')).toBe('a/b')
    expect(parentOf('a')).toBe('')
    expect(baseNameOf('a/b/c')).toBe('c')
    expect(baseNameOf('a')).toBe('a')
  })

  it('joinNoteId:父为空就是子', () => {
    expect(joinNoteId('', 'x')).toBe('x')
    expect(joinNoteId('a/b', 'x')).toBe('a/b/x')
  })
})

describe('noteAssetKind(协议白名单与渲染分流的唯一事实来源)', () => {
  it.each([
    ['png', 'image'],
    ['JPG', 'image'],
    ['webp', 'image'],
    ['mp4', 'video'],
    ['webm', 'video'],
    ['mov', 'video'],
    ['mp3', 'audio'],
    ['m4a', 'audio'],
    ['flac', 'audio'],
    ['pdf', 'pdf'],
    ['html', 'page'],
    ['htm', 'page']
  ])('%s → %s', (ext, kind) => {
    expect(noteAssetKind(ext)).toBe(kind)
  })

  it.each(['svg', 'md', 'js', 'json', 'txt', 'yml', 'html5', ''])('%s 不在白名单里', (ext) => {
    expect(noteAssetKind(ext)).toBeNull()
  })

  it('svg 必须在名单外 —— 作为文档打开时是 XSS 向量', () => {
    expect(noteAssetKind('svg')).toBeNull()
    expect(noteAssetKind('SVG')).toBeNull()
  })
})

describe('noteAssetKindOfUrl', () => {
  it('从地址里取后缀', () => {
    expect(noteAssetKindOfUrl('assets/x.mp4')).toBe('video')
    expect(noteAssetKindOfUrl('assets/测试文档.pdf')).toBe('pdf')
  })

  it('忽略 query 与 hash', () => {
    expect(noteAssetKindOfUrl('assets/x.mp4?t=1')).toBe('video')
    expect(noteAssetKindOfUrl('assets/x.pdf#page=2')).toBe('pdf')
  })

  it('没有后缀返回 null', () => {
    expect(noteAssetKindOfUrl('assets/x')).toBeNull()
    expect(noteAssetKindOfUrl('')).toBeNull()
  })
})
