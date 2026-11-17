// 自动检查更新:启动后先查一次,之后每 10 分钟一次;发现新版本只在应用内提示,
// 点「下载」才走已有下载机制(与设置 › 关于的「开始下载」同一个 IPC)。
//
// e2e 的更新检查指向本地桩(lib/update-stub.mjs),绝不请求真实 CDN:
// 默认「最新版」= 当前构建版本,所以只有本用例里 setVersion() 抬高的版本才会弹横幅。
// 自动检查间隔在 run.mjs 里缩到 1.5s,用例才能在几秒内看到结果。

import { eq, ok } from '../lib/assert.mjs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const BANNER = `.update-ready-banner`
const AVAILABLE = `.update-ready-banner[data-phase="available"]`

async function waitForStubRequest(stub, needle, timeout = 8000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (stub.requests.some((path) => path.includes(needle))) return
    await sleep(50)
  }
  throw new Error(`等待桩收到 ${needle} 请求超时,实际收到:\n${stub.requests.join('\n')}`)
}

export default [
  {
    id: 'update/auto-check',
    area: 'update',
    title:
      '自动检查:启动后与每 10 分钟检查一次,发现新版本弹右下角横幅(版本号、下载、稍后);稍后只静音该版本,设置里的开关关掉后不再检查,点下载走已有下载机制',
    tags: ['update', 'banner', 'settings'],
    async run(ctx) {
      const stub = ctx.updateStub
      ok(stub !== null, 'e2e 应注入更新检查桩(run.mjs 传 LAUNCHER_R2_BASE)')

      const phase = () => ctx.cdp.eval(`window.launcher.updates.getState().then((s) => s.phase)`)
      const checkedAt = () =>
        ctx.cdp.eval(`window.launcher.updates.getState().then((s) => s.checkedAt)`)
      const bannerText = () =>
        ctx.cdp.eval(`document.querySelector(${JSON.stringify(AVAILABLE)})?.textContent ?? null`)

      const waitPhase = (expected, message, timeout = 10_000) =>
        ctx.cdp.waitFor(
          `window.launcher.updates.getState().then((s) => s.phase === ${JSON.stringify(expected)})`,
          { timeout, message }
        )

      const manualCheck = async () => {
        await ctx.cdp.eval(`window.launcher.updates.check()`)
      }

      const resetToUpToDate = async () => {
        stub.setVersion(stub.baseVersion)
        await manualCheck()
        await waitPhase('upToDate', '手动检查回到「已是最新」')
        ok(
          (await ctx.cdp.eval(`document.querySelector(${JSON.stringify(BANNER)}) === null`)),
          '已是最新时不应有更新横幅'
        )
      }

      const openSettingsAbout = async () => {
        await ctx.cdp.eval(`document.querySelectorAll('.sidebar-footer-btn')[1].click()`)
        await ctx.cdp.waitFor(`document.querySelector('.settings-tab-nav') !== null`, {
          message: '设置页打开'
        })
        await ctx.cdp.eval(
          `[...document.querySelectorAll('.set-nav-btn')].find((b) => b.querySelector('.fa-circle-info'))?.click()`
        )
        await ctx.cdp.waitFor(`document.querySelector('#sp-about') !== null`, {
          message: '关于页出现'
        })
      }

      const backToNotes = async () => {
        await ctx.cdp.eval(
          `[...document.querySelectorAll('.nav-item')].find((el) => el.querySelector('.fa-pen-to-square'))?.click()`
        )
        await ctx.cdp.waitFor(`document.querySelector('.notes-rail') !== null`, {
          message: '回到笔记'
        })
      }

      const toggleAutoCheck = async (on) => {
        const selector = `#sp-about [data-setting="autoUpdateCheck"] input`
        const current = await ctx.cdp.eval(
          `document.querySelector(${JSON.stringify(selector)})?.checked ?? null`
        )
        ok(current !== null, '关于页应出现「自动检查更新」开关')
        if (current === on) return
        await ctx.cdp.eval(`document.querySelector(${JSON.stringify(selector)}).click()`)
        await ctx.cdp.waitFor(
          `document.querySelector(${JSON.stringify(selector)}).checked === ${on}`,
          { message: `自动检查开关切到 ${on}` }
        )
      }

      try {
        // 1. 启动后的首轮自动检查:桩 = 当前版本 → 已是最新,没有横幅
        await waitPhase('upToDate', '启动后自动检查得到「已是最新」')
        ok(
          (await ctx.cdp.eval(`document.querySelector(${JSON.stringify(BANNER)}) === null`)),
          '没有新版本时不弹横幅'
        )

        // 2. 抬高新版本,等下一轮自动检查弹横幅
        stub.setVersion('99.0.0')
        await ctx.cdp.waitFor(`document.querySelector(${JSON.stringify(AVAILABLE)}) !== null`, {
          timeout: 10_000,
          message: '自动检查发现 99.0.0 后出现更新横幅'
        })
        ok((await bannerText())?.includes('99.0.0') === true, '横幅里写着新版本号 99.0.0')
        const buttons = await ctx.cdp.eval(`(() => {
          const el = document.querySelector(${JSON.stringify(AVAILABLE)})
          return {
            download: el?.querySelector('[data-action="download"]') !== null,
            later: el?.querySelector('[data-action="later"]') !== null
          }
        })()`)
        eq(buttons, { download: true, later: true }, '横幅有「下载」与「稍后」两个动作')

        // 3. 稍后:横幅消失;同一个版本的下一次自动检查不再弹(相位停在 available,不重查)
        await ctx.cdp.eval(
          `document.querySelector(${JSON.stringify(
            `${AVAILABLE} [data-action="later"]`
          )}).click()`
        )
        await ctx.cdp.waitFor(`document.querySelector(${JSON.stringify(BANNER)}) === null`, {
          message: '点稍后横幅收起'
        })
        await sleep(3500)
        ok(
          (await ctx.cdp.eval(`document.querySelector(${JSON.stringify(BANNER)}) === null`)),
          '稍后之后同一个版本不再弹'
        )
        eq(await phase(), 'available', '稍后只收起横幅,状态仍停在「发现新版本」')

        // 4. 回到已是最新,再抬一个版本 → 新一轮自动检查重新弹
        await resetToUpToDate()
        stub.setVersion('99.0.1')
        await ctx.cdp.waitFor(`document.querySelector(${JSON.stringify(AVAILABLE)}) !== null`, {
          timeout: 10_000,
          message: '自动检查发现 99.0.1 后再次出现横幅'
        })
        ok((await bannerText())?.includes('99.0.1') === true, '横幅里写着 99.0.1')

        // 5. 设置 › 关于 读的是同一份状态:显示发现新版本,并新增「自动检查更新」开关
        await openSettingsAbout()
        const aboutText = await ctx.cdp.eval(`document.querySelector('#sp-about')?.textContent ?? ''`)
        ok(aboutText.includes('99.0.1'), '关于页显示自动检查发现的新版本号')
        ok(
          (await ctx.cdp.eval(
            `document.querySelector('#sp-about [data-setting="autoUpdateCheck"]') !== null`
          )),
          '关于页有「自动检查更新」开关'
        )
        await backToNotes()

        // 6. 点「下载」:走已有下载机制(先取清单),横幅离开 available
        stub.clearRequests()
        await ctx.cdp.eval(
          `document.querySelector(${JSON.stringify(
            `${AVAILABLE} [data-action="download"]`
          )}).click()`
        )
        await waitForStubRequest(stub, '/Launcher-99.0.1.json')
        ok(
          (await ctx.cdp.eval(`document.querySelector(${JSON.stringify(AVAILABLE)}) === null`)),
          '开始下载后「发现新版本」横幅收起'
        )
        // 桩不给安装包 → 下载最终失败;这里只确认确实进了下载流程
        await waitPhase('error', '桩缺安装包时下载落到错误相位', 15_000)

        // 7. 关掉自动检查:不再发起检查(checkedAt 不变),也不会弹横幅
        await resetToUpToDate()
        await openSettingsAbout()
        await toggleAutoCheck(false)
        const before = await checkedAt()
        stub.setVersion('99.0.2')
        await sleep(4000)
        eq(await checkedAt(), before, '关掉自动检查后不再发起检查')
        eq(await phase(), 'upToDate', '关掉自动检查后相位不变')
        ok(
          (await ctx.cdp.eval(`document.querySelector(${JSON.stringify(BANNER)}) === null`)),
          '关掉自动检查后不弹横幅'
        )

        // 8. 再打开:下一轮检查发现更新,横幅回来
        await toggleAutoCheck(true)
        await ctx.cdp.waitFor(`document.querySelector(${JSON.stringify(AVAILABLE)}) !== null`, {
          timeout: 10_000,
          message: '重新打开自动检查后横幅再次出现'
        })
        ok((await bannerText())?.includes('99.0.2') === true, '重新打开后横幅里写着 99.0.2')
      } finally {
        // 恢复默认:开关打开、桩回到当前版本、状态回到已是最新 —— 不污染后续用例
        stub.setVersion(stub.baseVersion)
        try {
          if (
            (await ctx.cdp.eval(
              `document.querySelector('#sp-about [data-setting="autoUpdateCheck"] input')?.checked ?? null`
            )) === false
          ) {
            await toggleAutoCheck(true)
          }
        } catch {
          /* 页面可能已经离开设置 */
        }
        try {
          await manualCheck()
          await waitPhase('upToDate', '清理:手动检查回到已是最新', 15_000)
        } catch {
          /* 清理失败不掩盖真正的失败原因 */
        }
        try {
          await backToNotes()
        } catch {
          /* 同上 */
        }
      }
    }
  }
]
