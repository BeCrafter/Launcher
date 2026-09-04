// ════════ TCP Services 视图 ════════

// ════════ TCP Services ════════
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
    html += rowCard({
      main: `<div class="row-main">
        ${statusDot('running')}
        ${rowInfo({
          labelHtml: `${s.name} <span style="color:var(--cyan);font-family:monospace;font-size:11px;">:${s.port}</span>`,
          subHtml: truncate(s.cmd, 60),
          tagsHtml: `${tagChip(s.type, s.isBrew ? 'brew' : 'purple', icon)}
            ${tagChip('PID ' + s.pid, 'blue')}`
        })}
        <div class="row-actions" onclick="event.stopPropagation()">
          ${actBtn('fa-solid fa-arrow-up-right-from-square', { title: 'Open', onclick: `showToast(fmt(t('toast.openingPort'), { P: ${s.port} }),'#60a5fa','fa-arrow-up-right-from-square')` })}
          ${actBtn('fa-solid fa-copy', { title: t('common.copy'), onclick: `copyPort(${s.port})` })}
          ${actBtn('fa-solid fa-stop', { cls: 'red', title: t('common.kill'), onclick: `killSvc('${s.id}','${s.name}')` })}
          ${actBtn('fa-solid fa-rocket', { cls: 'accent', title: t('agents.createLaunchAgent'), onclick: `showToast(t('toast.launchAgentDraft'),'#a78bfa','fa-rocket')` })}
        </div>
      </div>`
    });
  });
  c.innerHTML = html;
  const svcBadge = document.getElementById('svcBadge');
  if (svcBadge) svcBadge.textContent = svcData.length;
  updateModuleStatusBar('services');
}

function killSvc(id, name) {
  showToast(fmt(t('toast.killedSvc'), { N: name }), '#f87171', 'fa-stop');
}

function copyPort(port) {
  showToast(fmt(t('toast.copiedPort'), { P: port }), '#22d3ee', 'fa-copy');
}
