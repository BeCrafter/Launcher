// 笔记主区的通用底栏:纯预览、空态、文件页共用。
//
// 编辑 / 分栏页有自己的 NoteToolbar(排版按钮 + 字数),那条保持原样;这里只补
// 那些原本没有底栏的场景,让右侧主区在任何状态下都落一条 38px 的同款横条。
// 左侧有意留空:这些页面没有「这一条要显示什么状态」的明确内容,右侧只放项目仓库入口。

import { GITHUB_REPO_URL } from '@shared/constants'
import { useT } from '../../hooks/useT'
import { openExternal } from '../../lib/utils'

/** 从 URL 推导展示名,避免文案和链接两处漂移:https://github.com/BeCrafter/Launcher → BeCrafter/Launcher */
const REPO_LABEL = GITHUB_REPO_URL.replace(/^https?:\/\//, '').replace(/^github\.com\//, '')

export function NotesFooter(): React.JSX.Element {
  const t = useT()

  return (
    <footer className="notes-footer" data-notes-footer>
      <span className="notes-footer-spacer" />
      <a
        className="notes-footer-link"
        data-notes-footer-link
        href={GITHUB_REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        title={t('settings.about.openRepo')}
        onClick={(e) => {
          // 应用内没有浏览器标签页:交给主进程 shell.openExternal。
          e.preventDefault()
          openExternal(GITHUB_REPO_URL)
        }}
      >
        <i className="fa-brands fa-github" aria-hidden="true" />
        <span className="notes-footer-label">{REPO_LABEL}</span>
      </a>
    </footer>
  )
}
