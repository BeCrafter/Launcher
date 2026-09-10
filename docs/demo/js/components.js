// ════════════ UI 原语组件（重构 A 落地）════════
// 同类 UI 只在此一份，各视图渲染统一调用；对应设计视图「重构 A」的
// RowCard / StatusDot / PendingActionButton / FilterChipBar / CopyButton / HomebrewPalette 原语。
// 输出 HTML 的 class 与样式与拆分前完全一致（视觉零变化）。

// 标签色板（合并原 tagColor + aiTagColor 两张色表）
const TAG_COLORS = {
  brew: 'brew', server: 'blue', sync: 'purple', daemon: 'blue', backup: 'cyan', cron: 'cyan',
  log: 'green', cleanup: 'green', notify: 'purple', network: 'blue',
  anthropic: 'purple', openai: 'green', google: 'cyan', coding: 'blue', git: 'yellow',
  plist: 'purple', diagnose: 'red', refactor: 'purple', import: 'cyan', cli: 'blue'
};

// 标签 chip：cls 可为色表键（brew/blue/…）或直接 class（red/yellow/…），icon/style/title 可选
function tagChip(text, cls, icon, style, title) {
  const c = TAG_COLORS[cls] || cls || 'purple';
  return `<span class="tag ${c}"${style ? ` style="${style}"` : ''}${title ? ` title="${title}"` : ''}>${icon ? `<i class="${icon}" style="margin-right:2px;"></i>` : ''}${text}</span>`;
}

// 状态点：running / loaded / stopped
function statusDot(status) {
  const cls = status === 'running' ? 'running' : status === 'loaded' ? 'loaded' : 'stopped';
  return `<div class="status-dot ${cls}"></div>`;
}

// 状态文案（三态文本键可覆盖，ai 等不同文案场景复用）
function statusLabel(status, texts = {}) {
  const map = {
    running: (k) => `<span style="color:var(--green);font-size:10px;font-weight:600;">${t(k)}</span>`,
    loaded: (k) => `<span style="color:var(--yellow);font-size:10px;font-weight:600;">${t(k)}</span>`,
    stopped: (k) => `<span style="color:var(--dim);font-size:10px;">${t(k)}</span>`
  };
  const defaults = { running: 'status.running', loaded: 'status.loaded', stopped: 'status.stopped' };
  const keys = Object.assign(defaults, texts);
  const fn = map[status];
  return fn ? fn(keys[status]) : '';
}

// 操作按钮（PendingActionButton）：icon 为 fa 类名，opts: cls/title/onclick/btnStyle/iconStyle/iconId/disabled
function actBtn(icon, opts = {}) {
  const o = Object.assign({ cls: '', title: '', onclick: '', btnStyle: '', iconStyle: '', iconId: '', disabled: false }, opts);
  return `<button class="act-btn${o.cls ? ' ' + o.cls : ''}"${o.btnStyle ? ` style="${o.btnStyle}"` : ''}${o.title ? ` title="${o.title}"` : ''}${o.onclick ? ` onclick="${o.onclick}"` : ''}${o.disabled ? ' disabled' : ''}><i class="${icon}"${o.iconStyle ? ` style="${o.iconStyle}"` : ''}${o.iconId ? ` id="${o.iconId}"` : ''}></i></button>`;
}

// 分组块（FilterChipBar 同族容器）：header + 卡片网格
function groupBlock({ id, icon, color, label, count, labelTitle }, cardsHtml) {
  return `<div class="group-block">
    <div class="group-block-header" onclick="toggleGroupBlock('${id}',this)">
      <i class="${icon}" style="font-size:11px;color:${color};"></i>
      <span class="group-block-label"${labelTitle ? ` title="${labelTitle}"` : ''}>${label}</span>
      <span class="group-block-count">${count}</span>
      <i class="fa-solid fa-chevron-right group-block-chevron open"></i>
    </div>
    <div class="group-card-grid" id="${id}">${cardsHtml}</div>
  </div>`;
}

// 行卡片（RowCard）：main 为 row-main 片段，extra 为可选附加区（展开/内联编辑）
function rowCard({ id, main, extra = '' }) {
  return `<div class="row-card"${id ? ` id="${id}"` : ''}>
    ${main}${extra}
  </div>`;
}

// 行信息区（RowCard 的 label/sub/tags 三行）
function rowInfo({ labelHtml, subHtml, tagsHtml }) {
  return `<div class="row-info">
      <div class="row-label">${labelHtml}</div>
      <div class="row-sub">${subHtml}</div>
      <div class="row-tags">${tagsHtml}</div>
    </div>`;
}

// Agent 卡片（GroupCard）：agents / ai 共用骨架，槽位参数化
function agentCard(o) {
  const tagsStyle = o.tagsStyle !== undefined ? o.tagsStyle : 'style="flex:1;justify-content:flex-end;overflow:hidden;"';
  return `<div class="agent-col-card${o.selected ? ' selected' : ''}"${o.id ? ` id="${o.id}"` : ''}${o.onclick ? ` onclick="${o.onclick}"` : ''}>
    <div class="acc-top">
      <div class="acc-status-row">${o.statusHtml}</div>
      <div class="row-tags" ${tagsStyle}>${o.tagsHtml}</div>
    </div>
    <div class="acc-body">
      <div class="acc-label"${o.labelStyle ? ` style="${o.labelStyle}"` : ''}${o.labelTitle ? ` title="${o.labelTitle}"` : ''}>${o.labelHtml}</div>
      <div class="acc-desc">${o.descHtml}</div>
    </div>
    <div class="acc-meta">
      <div class="acc-meta-left"${o.metaLeftStyle ? ` style="${o.metaLeftStyle}"` : ''}>${o.metaLeftHtml}</div>
      <div class="acc-actions" onclick="event.stopPropagation()">${o.actionsHtml}</div>
    </div>
  </div>`;
}

// 端口服务卡片（与 agent-col-card / cron-col-card 同族：标题行 / 命令 / meta+操作行）
function svcCard(o) {
  return `<div class="svc-col-card"${o.id ? ` id="${o.id}"` : ''}>
    <div class="svc-r1">
      ${o.statusHtml || statusDot('running')}
      <span class="svc-name" title="${o.name}">${o.name}</span>
      <span class="svc-port">:${o.port}</span>
    </div>
    <div class="svc-cmd" title="${o.cmd}">${o.cmd}</div>
    <div class="svc-meta">
      <div class="svc-meta-left" style="flex:1;min-width:0;overflow:hidden;">${o.metaHtml}</div>
      <div class="row-actions" onclick="event.stopPropagation()">${o.actionsHtml}</div>
    </div>
  </div>`;
}

// 空状态
function emptyState(icon, text) {
  return `<div class="empty-state"><i class="${icon}"></i><p>${text}</p></div>`;
}
