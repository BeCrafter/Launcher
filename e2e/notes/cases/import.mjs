import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, ok } from '../lib/assert.mjs'
import { sleep } from '../lib/cdp.mjs'
import { BASIC } from '../lib/fixtures.mjs'

/**
 * 从系统拖入本地文件 / 文件夹。
 *
 * 拖拽用 CDP 把真实文件塞进隐藏 input（File 因此带本地路径），再把同一份
 * DataTransfer 派发到 rail 上；文件行的行为见 files 分组：单击在应用内打开，
 * 只有悬停动作里的「用默认应用打开」才走 IPC。E2E 下
 * LAUNCHER_E2E_STUB_OPEN=1 只把解析后的绝对路径写进应用日志，不真拉外部应用。
 */

function sourceDir(prefix) {
  return mkdtempSync(join(tmpdir(), `launcher-e2e-${prefix}-`))
}

function notesDir(ctx) {
  return join(ctx.profileDir, 'notes')
}

/** 通过 rail 底部的「新建目录」建一个根层目录，等它出现在列表里。 */
async function createFolder(ctx, name) {
  await ctx.cdp.eval(`document.querySelectorAll('.notes-new-folder')[1]?.click()`)
  await ctx.cdp.waitFor(`document.querySelector('.notes-folder-input') !== null`, {
    message: '目录名输入框出现'
  })
  await ctx.cdp.type(name)
  await ctx.press('Enter')
  await ctx.cdp.waitFor(
    `[...document.querySelectorAll('.notes-folder-row')].some((el) => el.dataset.folderPath === ${JSON.stringify(
      name
    )})`,
    { message: `目录「${name}」出现在列表里` }
  )
}

/** 展开目录（已展开则不动），随后由调用方等待子行出现。 */
async function expandFolder(ctx, path) {
  const state = await ctx.cdp.eval(`(() => {
    const row = [...document.querySelectorAll('.notes-folder-row')]
      .find((el) => el.dataset.folderPath === ${JSON.stringify(path)})
    if (row === undefined) return 'missing'
    const open = row.querySelector('.notes-folder-name')?.getAttribute('aria-expanded') === 'true'
    if (!open) row.querySelector('.notes-folder-name')?.click()
    return open ? 'open' : 'opened'
  })()`)
  if (state === 'missing') throw new Error(`列表里找不到目录:${path}`)
  await sleep(80)
}

export default [
  {
    id: 'import/drop-folder-recursive',
    area: 'import',
    title: '拖入文件夹:递归保留结构，Markdown 成笔记、其它文件成文件行，toast 计数',
    tags: ['import', 'rail', 'drag'],
    fixture: BASIC,
    async run(ctx) {
      const base = sourceDir('recursive')
      const source = join(base, 'drop-src')
      mkdirSync(join(source, 'sub'), { recursive: true })
      writeFileSync(join(source, 'a.md'), '# 导入的笔记\n\n来自本地。\n')
      writeFileSync(join(source, 'sub', 'b.txt'), '嵌套文本\n')
      writeFileSync(join(source, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

      await createFolder(ctx, '导入落点甲')

      // 先停在 dragover 上：目标目录高亮、顶部提示都指向它，再松手。
      await ctx.dropFiles('[data-folder-path="导入落点甲"]', [source], { hold: true })
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-folder-row[data-folder-path="导入落点甲"]')?.classList.contains('file-drop-target') === true`,
        { message: '拖入时目标目录高亮' }
      )
      await ctx.cdp.waitFor(
        `document.querySelector('.notes-import-hint')?.textContent?.includes('导入落点甲') === true`,
        { message: '拖入提示指向目标目录' }
      )
      await ctx.finishFileDrop('[data-folder-path="导入落点甲"]')

      await ctx.cdp.waitFor(
        `document.querySelector('#toast.show #toastIcon')?.classList.contains('fa-file-import') === true`,
        { message: '导入成功 toast 出现' }
      )

      const dst = join(notesDir(ctx), '导入落点甲', 'drop-src')
      await ctx.waitForNode(
        () => existsSync(join(dst, 'sub', 'b.txt')) && existsSync(join(dst, 'pic.png')),
        '文件按目录结构复制到笔记目录'
      )
      eq(
        readFileSync(join(dst, 'a.md'), 'utf8'),
        '# 导入的笔记\n\n来自本地。\n',
        'Markdown 按字节原样复制（不写 frontmatter、不转格式）'
      )
      eq(readFileSync(join(dst, 'sub', 'b.txt'), 'utf8'), '嵌套文本\n', '子目录内容原样复制')
      ok(existsSync(join(source, 'sub', 'b.txt')), '源文件夹仍在（是复制不是移动）')

      await ctx.cdp.waitFor(`document.querySelector('.notes-import-hint') === null`, {
        message: '松手后提示消失'
      })

      await expandFolder(ctx, '导入落点甲/drop-src')
      await ctx.cdp.waitFor(
        `document.querySelector('[data-note-id="导入落点甲/drop-src/a"]') !== null`,
        { message: '导入的 Markdown 成为笔记行' }
      )
      await ctx.cdp.waitFor(
        `document.querySelector('[data-folder-path="导入落点甲/drop-src/sub"]') !== null`,
        { message: '子目录出现在列表里' }
      )
      await ctx.cdp.waitFor(
        `document.querySelector('[data-file-path="导入落点甲/drop-src/pic.png"]') !== null`,
        { message: '图片成为文件行' }
      )
      await expandFolder(ctx, '导入落点甲/drop-src/sub')
      await ctx.cdp.waitFor(
        `document.querySelector('[data-file-path="导入落点甲/drop-src/sub/b.txt"]') !== null`,
        { message: '子目录里的文件成为文件行' }
      )
    }
  },

  {
    id: 'import/drop-on-note-and-root',
    area: 'import',
    title: '拖到笔记行落到它的父目录，拖到 rail 空白落到最外层',
    tags: ['import', 'rail', 'drag'],
    fixture: BASIC,
    async run(ctx) {
      const base = sourceDir('targets')
      const seed = join(base, 'seed.md')
      const intoNote = join(base, 'into-note.txt')
      const intoRoot = join(base, 'into-root.txt')
      writeFileSync(seed, '# 落点乙里的笔记\n')
      writeFileSync(intoNote, '放到笔记所在目录\n')
      writeFileSync(intoRoot, '放到最外层\n')

      await createFolder(ctx, '落点乙')
      await ctx.dropFiles('[data-folder-path="落点乙"]', [seed])
      await ctx.cdp.waitFor(`document.querySelector('[data-note-id="落点乙/seed"]') !== null`, {
        message: '目录里出现导入的笔记行'
      })

      // 落在笔记行上：目标是 parentOf(note id) = 落点乙，而不是根层。
      await ctx.dropFiles('[data-note-id="落点乙/seed"]', [intoNote])
      await ctx.cdp.waitFor(
        `document.querySelector('[data-file-path="落点乙/into-note.txt"]') !== null`,
        { message: '文件落在笔记所在目录' }
      )
      const inFolder = join(notesDir(ctx), '落点乙', 'into-note.txt')
      await ctx.waitForNode(() => existsSync(inFolder), '文件写进笔记所在目录')

      // 落在 rail 空白处（根节点本身）：目标是根层。
      await ctx.dropFiles('.notes-rail', [intoRoot])
      await ctx.cdp.waitFor(`document.querySelector('[data-file-path="into-root.txt"]') !== null`, {
        message: '文件落在最外层'
      })
      const atRoot = join(notesDir(ctx), 'into-root.txt')
      await ctx.waitForNode(() => existsSync(atRoot), '文件写进笔记根目录')
      ok(!existsSync(join(notesDir(ctx), '落点乙', 'into-root.txt')), '没有被误放进子目录')
    }
  },

  {
    id: 'import/collision-suffix',
    area: 'import',
    title: '重复导入同名目录:自动加 -2 序号，原文件夹内容不被覆盖',
    tags: ['import', 'collision'],
    fixture: BASIC,
    async run(ctx) {
      const base = sourceDir('collision')
      const source = join(base, 'collision-src')
      mkdirSync(source)
      writeFileSync(join(source, 'dup.txt'), '第一次\n')

      await ctx.dropFiles('.notes-rail', [source])
      const first = join(notesDir(ctx), 'collision-src', 'dup.txt')
      await ctx.waitForNode(() => existsSync(first), '第一次导入完成')

      // 改动源内容后再拖一次：新副本进 -2，旧副本必须保持第一次的内容。
      writeFileSync(join(source, 'dup.txt'), '第二次\n')
      await ctx.dropFiles('.notes-rail', [source])
      const second = join(notesDir(ctx), 'collision-src-2', 'dup.txt')
      await ctx.waitForNode(() => existsSync(second), '第二次导入自动改用 -2 序号')

      eq(readFileSync(first, 'utf8'), '第一次\n', '原文件夹内容没有被覆盖')
      eq(readFileSync(second, 'utf8'), '第二次\n', '新副本拿到的是这次拖入的内容')
      await ctx.cdp.waitFor(
        `document.querySelector('[data-folder-path="collision-src"]') !== null &&
         document.querySelector('[data-folder-path="collision-src-2"]') !== null`,
        { message: '两个目录行都在列表里' }
      )
    }
  },

  {
    id: 'import/file-row-open-delete',
    area: 'import',
    title:
      '文件行:单击在应用内打开、悬停按钮才交给默认应用,删除确认后文件与行一起消失',
    tags: ['import', 'file-row'],
    fixture: BASIC,
    async run(ctx) {
      const base = sourceDir('file-row')
      const file = join(base, 'open-me.txt')
      writeFileSync(file, '打开我\n')

      await ctx.dropFiles('.notes-rail', [file])
      await ctx.cdp.waitFor(`document.querySelector('[data-file-path="open-me.txt"]') !== null`, {
        message: '导入的文件出现在列表里'
      })

      // 行为按新需求变更:单击文件行在应用内打开,不再直接拉外部应用。
      await ctx.cdp.eval(`document.querySelector('[data-file-path="open-me.txt"]')?.click()`)
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-name')?.textContent === 'open-me.txt'`,
        { message: '单击文件行在应用内打开文件视图' }
      )
      await ctx.cdp.waitFor(
        `document.querySelector('.file-main .file-editor .cm-content')?.textContent?.includes('打开我') === true`,
        { message: '文本文件在文件编辑器里显示正文' }
      )
      await ctx.cdp.waitFor(
        `document.querySelector('[data-file-path="open-me.txt"]')?.classList.contains('active') === true`,
        { message: '当前文件行是活动态' }
      )

      // 「用默认应用打开」改为文件行上的显式按钮(悬停动作第一项)。
      await ctx.cdp.eval(
        `document.querySelector('[data-file-path="open-me.txt"] [data-file-action="open-external"]')?.click()`
      )
      await ctx.waitForLog(
        `[note-open] ${join(notesDir(ctx), 'open-me.txt')}`,
        '悬停按钮解析出绝对路径并交给系统默认应用'
      )

      await ctx.cdp.eval(
        `document.querySelector('[data-file-path="open-me.txt"] .notes-row-acts .danger')?.click()`
      )
      await ctx.cdp.waitFor(`document.querySelector('#dangerModal.open') !== null`, {
        message: '删除前弹出二次确认'
      })
      await ctx.cdp.eval(`document.querySelector('#dangerModal .d-btn.red')?.click()`)
      await ctx.cdp.waitFor(`document.querySelector('[data-file-path="open-me.txt"]') === null`, {
        message: '确认后文件行消失'
      })
      await ctx.waitForNode(
        () => !existsSync(join(notesDir(ctx), 'open-me.txt')),
        '文件移出笔记目录'
      )
      await ctx.cdp.waitFor(`document.querySelector('#toast.show') !== null`, {
        message: '删除成功 toast 出现'
      })
    }
  }
]
