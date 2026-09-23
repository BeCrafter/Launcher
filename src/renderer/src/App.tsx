// 应用组合根:引导(设置生效 + splash 摘除)→ 外壳 + 浮层
import { bootstrap } from './state/bootstrap'
import { useBootSplash } from './boot/splash'
import { AppShell } from './layout/AppShell'
import { AgentDrawer } from './modules/drawer/AgentDrawer'
import { AgentCardMenu } from './components/overlays/AgentCardMenu'
import { SvcConfigMenu } from './components/overlays/SvcConfigMenu'
import { ChoiceModal } from './components/overlays/ChoiceModal'
import { ElevationModal, DangerModal } from './components/overlays/ElevationModal'
import { ImportModal } from './components/overlays/ImportModal'

/**
 * 引导必须发生在**模块顶层**(同步),因为 `initSettingsFromMain()` 要在首次 commit 之前把主题等
 * 设置应用上 —— 挪进 effect 会让浅色用户先闪一帧深色。
 *
 * 但错误不能抛出去:模块求值失败 ⇒ `main.tsx` 的 `createRoot().render()` 永不执行,
 * 而过渡页那时已经不在了 ⇒ 永久空白页(连诊断页都看不到,这正是此前 preload 缺失时的表现)。
 * 所以这里把异常**返回**给组件树,由 App 决定渲染哪张诊断页。
 */
function safeBootstrap(): Error | null {
  try {
    bootstrap()
    return null
  } catch (err) {
    return err instanceof Error ? err : new Error(String(err))
  }
}

const bootError = safeBootstrap()

/** preload 缺失 / 引导失败时的诊断页(开发者向,仅故障时可见;样式内联,不依赖应用 CSS) */
function BootFailure({ title, detail }: { title: string; detail: string }): React.JSX.Element {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>{title}</h1>
      <p style={{ color: '#c00' }}>{detail}</p>
    </div>
  )
}

export default function App(): React.JSX.Element {
  // 摘除过渡页要在**所有**分支上发生,故放在最前、无条件调用(与本次 commit 同帧)
  useBootSplash()
  // preload 未成功注入时给出可诊断的错误页而非白屏
  if (!window.launcher) {
    return (
      <BootFailure
        title="preload 未加载"
        detail="window.launcher 不存在——请检查主进程 preload 路径与构建输出是否一致。"
      />
    )
  }
  if (bootError) {
    return <BootFailure title="引导失败" detail={`应用引导阶段抛错：${bootError.message}`} />
  }
  return (
    <>
      <AppShell />
      <AgentDrawer />
      <AgentCardMenu />
      <SvcConfigMenu />
      <ChoiceModal />
      <ImportModal />
      <ElevationModal />
      <DangerModal />
    </>
  )
}
