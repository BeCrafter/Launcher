// ════════ Launch Agents 视图 ════════
let selectedAgent = agentData[0];
let activeFilter = 'all';

function renderAgents(filter, query) {
  const container = document.getElementById('agentList');
  let list = agentData.filter(a => {
    if (filter === 'brew') return !!a.isBrew;
    if (filter === 'user') return a.scope === 'user' && !a.isBrew;
    if (filter === 'system') return a.scope === 'system';
    if (filter === 'daemon') return a.scope === 'daemon';
    return true;
  });
  if (query) {
    const q = query.toLowerCase();
    list = list.filter(a => a.label.toLowerCase().includes(q) || a.tags.some(t => t.includes(q)) || a.desc.toLowerCase().includes(q));
  }
  const groups = {
    user: {
      labelKey: 'agents.group.user',
      icon: 'fa-user',
      color: 'var(--blue)',
      items: []
    },
    system: {
      labelKey: 'agents.group.global',
      icon: 'fa-building',
      color: 'var(--yellow)',
      items: []
    },
    daemon: {
      labelKey: 'agents.group.daemon',
      icon: 'fa-server',
      color: 'var(--red)',
      items: []
    },
  };
  list.forEach(a => {
    if (groups[a.scope]) groups[a.scope].items.push(a);
  });
  let html = '';
  if (filter === 'all' || filter === 'user') {
    invalidPlists.forEach(inv => {
      html += `<div class="invalid-plist-row">
        <i class="fa-solid fa-circle-exclamation invalid-icon"></i>
        <div class="invalid-info"><div class="invalid-path">${inv.path}</div><div class="invalid-sub">${inv.reason}</div></div>
        ${actBtn('fa-solid fa-trash-can', { cls: 'red', title: t('common.delete'), onclick: `showToast(t('toast.plistDeleted'),'#f87171','fa-trash-can')`, iconStyle: 'font-size:10px;' })}
      </div>`;
    });
  }
  Object.values(groups).forEach(g => {
    if (!g.items.length) return;
    const gid = 'grp_' + g.labelKey;
    const cardsHtml = g.items.map(a => {
      const isSelected = (selectedAgent && selectedAgent.id === a.id);
      const tagHtml = a.tags.slice(0, 3).map(tg => tagChip(tg, tg)).join('');
      const brewBadge = a.isBrew ? tagChip('brew', 'brew') : '';
      const toggleBtn = a.isBrew ?
        `${actBtn('fa-solid fa-play', { cls: 'green', title: 'brew start', onclick: `event.stopPropagation();brewAction('start','${a.id}')` })}
           ${actBtn('fa-solid fa-stop', { cls: 'blue', title: 'brew stop', onclick: `event.stopPropagation();brewAction('stop','${a.id}')` })}` :
        actBtn(a.status === 'running' ? 'fa-solid fa-stop' : 'fa-solid fa-play', {
          cls: a.status === 'running' ? 'blue' : 'green',
          title: a.status === 'running' ? 'bootout' : 'bootstrap',
          onclick: `event.stopPropagation();toggleAgent('${a.id}')`
        });
      return agentCard({
        selected: isSelected,
        id: 'rc_' + a.id,
        onclick: `selectAgent('${a.id}')`,
        statusHtml: statusDot(a.status) + statusLabel(a.status),
        tagsHtml: brewBadge + tagHtml,
        labelTitle: a.label,
        labelHtml: a.label,
        descHtml: a.desc,
        metaLeftHtml: `<span class="acc-meta-stat"><i class="fa-solid fa-microchip" style="color:var(--accent2);"></i><span>${a.pid?'PID '+a.pid:'—'}</span></span>
            <span class="acc-meta-stat"><i class="fa-regular fa-clock" style="color:var(--muted);"></i><span>${a.uptime||'—'}</span></span>
            ${a.exitCode!==null&&a.exitCode!==undefined?`<span class="acc-meta-stat"><i class="fa-solid fa-right-from-bracket" style="color:${a.exitCode===0?'var(--green)':'var(--red)'};"></i><span style="color:${a.exitCode===0?'var(--green)':'var(--red)'};">${a.exitCode}</span></span>`:''}`,
        actionsHtml: `${toggleBtn}
            ${actBtn('fa-solid fa-pen', { cls: 'accent', title: t('agents.editConfig'), onclick: `event.stopPropagation();openEditFloat('${a.id}',event)` })}
            ${actBtn('fa-solid fa-ellipsis', { title: t('common.more'), onclick: `event.stopPropagation();showToast(t('toast.moreActions'),'#888','fa-ellipsis')` })}`
      });
    }).join('');
    html += groupBlock({ id: gid, icon: `fa-solid ${g.icon}`, color: g.color, label: t(g.labelKey), count: g.items.length }, cardsHtml);
  });
  if (!list.length) html = emptyState('fa-solid fa-magnifying-glass', t('agents.empty'));
  container.innerHTML = html;
  updateLaunchStatusBar();
}

// Agents 顶部过滤栏计数（由 MOCK_DATA 驱动）
function updateAgentFilterCounts() {
  document.getElementById('runningCount').textContent = MOCK_DATA.agents.filter(a => a.status === 'running').length;
  document.getElementById('totalCount').textContent = MOCK_DATA.agents.length;
}

// ════════ 交互 ════════
function filterAgents(f, btn) {
  activeFilter = f;
  document.querySelectorAll('#agentFilterBar .chip').forEach(c => c.className = c.className.replace(' active', ''));
  btn.classList.add('active');
  renderAgents(f, document.getElementById('globalSearch').value);
}

function handleSearch(v) {
  renderAgents(activeFilter, v);
}

function selectAgent(id) {
  selectedAgent = agentData.find(a => a.id === id);
  document.querySelectorAll('.agent-col-card').forEach(c => c.classList.remove('selected'));
  const card = document.getElementById('rc_' + id);
  if (card) card.classList.add('selected');
}

function toggleAgent(id) {
  const a = agentData.find(x => x.id === id);
  if (!a) return;
  if (a.status === 'running') {
    showToast(`bootout: ${a.label}`, '#60a5fa', 'fa-stop');
    a.status = 'stopped';
    a.pid = null;
    a.uptime = null;
  } else {
    showToast(`bootstrap: ${a.label}`, '#4ade80', 'fa-play');
    a.status = 'running';
    a.pid = Math.floor(Math.random() * 10000) + 1000;
    a.uptime = '0m';
  }
  renderAgents(activeFilter, document.getElementById('globalSearch').value);
}

function brewAction(action, id) {
  const a = agentData.find(x => x.id === id);
  showToast(`brew ${action}: ${a?a.label:id}`, '#f97316', 'fa-beer-mug-empty');
}
