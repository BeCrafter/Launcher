// ════════ TCP Services 视图 ════════
// 布局：响应式网格卡片（svc-col-card，与 agents/cron 卡片同族）；
// 操作：Open / Copy / Kill（Kill 走危险二次确认，与系统级提权体系一致）
function renderServices() {
  const c = document.getElementById('svcList');
  let html = '';
  svcData.forEach(s => {
    const typeIcons = {
      node: 'fa-brands fa-node-js',
      brew: 'fa-solid fa-beer-mug-empty',
      process: 'fa-solid fa-terminal'
    };
    const icon = typeIcons[s.type] || 'fa-solid fa-circle-nodes';
    // 地址以 mono 高亮（端口家族 cyan），uptime 中性 dim —— 信息密度补齐但不过度彩色
    const metaHtml = [
      tagChip(t('svc.type.' + s.type) || s.type, s.isBrew ? 'brew' : 'purple', icon),
      `<span class="tag blue" style="font-family:'SF Mono',Menlo,monospace;">PID ${s.pid}</span>`,
      `<span class="tag cyan" style="font-family:'SF Mono',Menlo,monospace;">${s.addr}:${s.port} ${s.proto || ''}</span>`,
      `<span class="tag dim"><i class="fa-regular fa-clock" style="margin-right:2px;"></i>${s.uptime}</span>`
    ].join('');
    const actionsHtml = [
      actBtn('fa-solid fa-arrow-up-right-from-square', { title: t('svc.open'), onclick: `showToast(fmt(t('toast.openingPort'), { P: ${s.port} }),'#60a5fa','fa-arrow-up-right-from-square')` }),
      actBtn('fa-solid fa-copy', { title: t('common.copy'), onclick: `copyPort(${s.port})` }),
      actBtn('fa-solid fa-stop', { cls: 'red', title: t('common.kill'), onclick: `killSvc('${s.id}','${s.name}')` })
    ].join('');
    html += svcCard({ id: 'svc_' + s.id, name: s.name, port: s.port, cmd: s.cmd, metaHtml, actionsHtml });
  });
  c.innerHTML = html;
  const svcBadge = document.getElementById('svcBadge');
  if (svcBadge) svcBadge.textContent = svcData.length;
  updateModuleStatusBar('services');
}

function killSvc(id, name) {
  const svc = svcData.find(x => x.id === id);
  if (!svc) return;
  confirmDangerousAction({ detail: fmt(t('svc.killConfirm'), { N: name, P: svc.pid }) }).then(ok => {
    if (!ok) return;
    showToast(fmt(t('toast.killedSvc'), { N: name }), '#f87171', 'fa-stop');
  });
}

function copyPort(port) {
  showToast(fmt(t('toast.copiedPort'), { P: port }), '#22d3ee', 'fa-copy');
}
