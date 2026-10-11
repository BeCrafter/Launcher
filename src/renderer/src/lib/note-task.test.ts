import { describe, expect, it } from 'vitest'
import { toggleTaskLine } from './note-task'

describe('toggleTaskLine', () => {
  it('勾上 / 取消', () => {
    expect(toggleTaskLine('- [ ] 甲', 0, true)).toBe('- [x] 甲')
    expect(toggleTaskLine('- [x] 甲', 0, false)).toBe('- [ ] 甲')
  })

  it('保留缩进与列表标记(嵌套任务项)', () => {
    expect(toggleTaskLine('    - [ ] 深层', 0, true)).toBe('    - [x] 深层')
    expect(toggleTaskLine('\t* [ ] 星号', 0, true)).toBe('\t* [x] 星号')
    expect(toggleTaskLine('  + [ ] 加号', 0, true)).toBe('  + [x] 加号')
  })

  it('大写 X 也认', () => {
    expect(toggleTaskLine('- [X] 甲', 0, false)).toBe('- [ ] 甲')
  })

  it('行尾没有内容也能改', () => {
    expect(toggleTaskLine('- [ ]', 0, true)).toBe('- [x]')
    expect(toggleTaskLine('- [x]', 0, false)).toBe('- [ ]')
  })

  it('只改目标行,其余行逐字节不动', () => {
    const body = '# 标题\n\n- [ ] 甲\n- [ ] 乙\n\n结尾'
    expect(toggleTaskLine(body, 2, true)).toBe('# 标题\n\n- [x] 甲\n- [ ] 乙\n\n结尾')
    expect(toggleTaskLine(body, 3, true)).toBe('# 标题\n\n- [ ] 甲\n- [x] 乙\n\n结尾')
  })

  it('该行不是任务项 → null(用户改过了,不猜)', () => {
    expect(toggleTaskLine('- 普通项', 0, true)).toBeNull()
    expect(toggleTaskLine('# 标题', 0, true)).toBeNull()
    expect(toggleTaskLine('正文', 0, true)).toBeNull()
    expect(toggleTaskLine('', 0, true)).toBeNull()
  })

  it('已经是目标状态 → null(省掉一次无意义的写盘与 updated 前移)', () => {
    expect(toggleTaskLine('- [x] 甲', 0, true)).toBeNull()
    expect(toggleTaskLine('- [ ] 甲', 0, false)).toBeNull()
  })

  it('越界行号 → null', () => {
    expect(toggleTaskLine('- [ ] 甲', -1, true)).toBeNull()
    expect(toggleTaskLine('- [ ] 甲', 5, true)).toBeNull()
    expect(toggleTaskLine('- [ ] 甲', 1.5, true)).toBeNull()
  })

  it('保留行内其余标记(粗体/链接)', () => {
    expect(toggleTaskLine('- [ ] **重要** [链接](https://x)', 0, true)).toBe(
      '- [x] **重要** [链接](https://x)'
    )
  })

  it('`[]` 中间有空格以外的字符就不算任务项', () => {
    expect(toggleTaskLine('- [y] 甲', 0, true)).toBeNull()
    expect(toggleTaskLine('- [] 甲', 0, true)).toBeNull()
  })
})

describe('引用 / 提示块里的任务(行首带 `> `)', () => {
  // 场景矩阵里发现的:引用、嵌套引用、提示块三格的任务勾不动,正文和折叠块却是好的。
  // 根因是正则要求行首就是列表标记,而引用行前面还有 `> `。
  it('引用里的任务能勾,前缀留着', () => {
    expect(toggleTaskLine('> - [ ] 待办', 0, true)).toBe('> - [x] 待办')
    expect(toggleTaskLine('> - [x] 待办', 0, false)).toBe('> - [ ] 待办')
  })

  it('嵌套引用(`> > `)同理', () => {
    expect(toggleTaskLine('> > - [ ] 待办', 0, true)).toBe('> > - [x] 待办')
  })

  it('提示块里的任务(前面还有别的行)', () => {
    const body = ['> [!NOTE]', '> 正文', '>', '> - [ ] 卡片里的待办'].join('\n')
    expect(toggleTaskLine(body, 3, true)!.split('\n')[3]).toBe('> - [x] 卡片里的待办')
  })

  it('引用里带缩进的任务', () => {
    expect(toggleTaskLine('>   - [ ] 缩进', 0, true)).toBe('>   - [x] 缩进')
  })

  it('那一行不是任务项时照样放弃(不猜)', () => {
    expect(toggleTaskLine('> 只是引用', 0, true)).toBeNull()
    expect(toggleTaskLine('> ```', 0, true)).toBeNull()
  })
})
