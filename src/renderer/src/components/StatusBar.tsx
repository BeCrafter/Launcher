// 底部状态栏(demo statusbar.js + launch-statusbar 渲染;几何由 useSidebarLayout 内联控制)
// 配置数据 = lib/modules MODULES[mod] + 各视图 statusbar 构建器(此处接收构建好的模型)
// summary/items 文案来自生成字典,含 <strong> 标签(demo 走 innerHTML),此处按 HTML 渲染保持视觉一致
import type { StatusBarModel } from '../lib/modules'

export function StatusBar({ model }: { model: StatusBarModel | null }): React.JSX.Element | null {
  if (!model) return null
  return (
    <div className="launch-statusbar" id="launchStatusBar">
      <div className="launch-status-left" id="moduleStatusLeft">
        <div className="launch-status-summary">
          <i className={`fa-solid ${model.summaryIcon}`} />
          <span dangerouslySetInnerHTML={{ __html: model.summaryHtml }} />
        </div>
        <div className="launch-status-divider" />
        {model.items.map((item, i) => (
          <div className="launch-status-item" key={i}>
            <span className={`launch-status-dot ${item.dot}`} />
            <span dangerouslySetInnerHTML={{ __html: item.textHtml }} />
          </div>
        ))}
      </div>
      <div className="launch-status-right" id="moduleStatusRight">
        <div className="launch-status-path">
          <i className={model.pathIcon} />
          {model.pathHref ? (
            <a
              className="launch-status-link"
              href={model.pathHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.preventDefault()
                window.launcher.openExternal(model.pathHref as string)
              }}
            >
              {model.path}
            </a>
          ) : (
            <span>{model.path}</span>
          )}
        </div>
        <div className="launch-status-monitor">
          <i className="fa-solid fa-circle" />
          <span>{model.monitor}</span>
        </div>
      </div>
    </div>
  )
}
