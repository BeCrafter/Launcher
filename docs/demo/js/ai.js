// ════════ AI 助手（原型/模拟）════════
let aiFilter = 'all';

function aiIconBadgeCls(f) {
  return f === 'installed' ? 'green' : f === 'skills' ? 'purple' : '';
}

function filterAi(f, btn) {
  aiFilter = f;
  document.querySelectorAll('#aiFilterBar .chip').forEach(c => c.className = c.className.replace(' active', ''));
  btn.classList.add('active');
  renderAi(f, document.getElementById('globalSearch')?.value || '');
}

function handleAiSearch(v) {
  renderAi(aiFilter || 'all', v);
}

function scanAiAgents() {
  showToast(t('ai.scan.start'), '#22d3ee', 'fa-magnifying-glass');
  setTimeout(() => {
    showToast(fmt(t('ai.scan.done'), { N: aiAgentData.filter(a => a.status === 'installed').length }), '#4ade80', 'fa-circle-check');
  }, 700);
}

function renderAi(filter = 'all', query = '') {
  const container = document.getElementById('aiList');
  if (!container) return;
  const q = (query || '').toLowerCase();
  const agents = aiAgentData.filter(a => {
    if (filter === 'installed') return a.status === 'installed';
    if (filter === 'skills') return false;
    return true;
  }).filter(a => !q || a.name.toLowerCase().includes(q) || a.cli.includes(q) || t(a.descKey).toLowerCase().includes(q));
  const skills = aiSkillData.filter(s => {
    if (filter === 'skills') return true;
    if (filter !== 'all' && filter !== 'installed') return false;
    return !q || t(s.nameKey).toLowerCase().includes(q) || t(s.descKey).toLowerCase().includes(q);
  });
  let html = '';

  // —— 已安装 Agent 分组 ——
  if (agents.length) {
    const cardsHtml = agents.map(a => {
      const installed = a.status === 'installed';
      const st = installed ? 'running' : 'stopped';
      const tagHtml = a.tags.map(tg => tagChip(tg, tg)).join('');
      return agentCard({
        statusHtml: statusDot(st) + statusLabel(st, { running: 'ai.status.installed', stopped: 'ai.status.notfound' }),
        tagsHtml: tagHtml,
        labelTitle: a.name,
        labelHtml: `${a.name} <span style="font-weight:400;color:var(--dim);font-size:10px;">· ${a.cli}</span>`,
        descHtml: t(a.descKey),
        metaLeftHtml: `<span class="acc-meta-stat"><i class="fa-solid fa-tag" style="color:var(--muted);"></i><span>v${a.version}</span></span>
            <span class="acc-meta-stat" title="${a.path || t('ai.status.notfound')}"><i class="fa-solid fa-folder" style="color:var(--dim);"></i><span>${a.path ? a.path.replace(/^.*\//, '…/') : '—'}</span></span>`,
        actionsHtml: `${actBtn('fa-solid fa-bolt', { cls: installed ? 'accent' : 'green', onclick: `runWithAgent('${a.id}')`, disabled: !installed })}
            ${actBtn('fa-solid fa-circle-info', { cls: 'blue', onclick: `showToast(fmt(t('ai.run.info'),{name:'${a.name}'}),'#60a5fa','fa-circle-info')` })}`
      });
    }).join('');
    html += groupBlock({ id: 'grp_aiAgents', icon: 'fa-solid fa-robot', color: 'var(--accent2)', label: t('ai.group.agents'), count: agents.length }, cardsHtml);
  }

  // —— 内置技能 ——
  if (skills.length) {
    const cardsHtml = skills.map(s => {
      const sname = t(s.nameKey);
      return agentCard({
        statusHtml: `<i class="fa-solid ${s.icon}" style="color:var(--accent2);font-size:12px;"></i>`,
        tagsHtml: tagChip(s.tag, s.tag),
        tagsStyle: '',
        labelStyle: 'font-family:inherit;',
        labelHtml: sname,
        descHtml: t(s.descKey),
        metaLeftStyle: 'color:var(--dim);font-size:10px;',
        metaLeftHtml: t('ai.skill.done.hint'),
        actionsHtml: actBtn('fa-solid fa-play', { cls: 'accent', onclick: `showToast(fmt(t('ai.applySkill'),{name:'${sname}'}),'#a78bfa','fa-wand-magic-sparkles')` })
      });
    }).join('');
    html += groupBlock({ id: 'grp_aiSkills', icon: 'fa-solid fa-wand-magic-sparkles', color: 'var(--accent2)', label: t('ai.group.skills'), count: skills.length }, cardsHtml);
  }

  if (!agents.length && !skills.length) html = emptyState('fa-solid fa-magnifying-glass', t('ai.empty'));
  container.innerHTML = html;
  // 计数
  const installedEl = document.getElementById('aiInstalledCount');
  const agentEl = document.getElementById('aiAgentCount');
  const skillEl = document.getElementById('aiSkillCount');
  if (installedEl) installedEl.textContent = aiAgentData.filter(a => a.status === 'installed').length;
  if (agentEl) agentEl.textContent = aiAgentData.length;
  if (skillEl) skillEl.textContent = aiSkillData.length;
  updateModuleStatusBar('ai');
}

function runWithAgent(id) {
  const a = aiAgentData.find(x => x.id === id);
  showToast(fmt(t('ai.run.working'), { name: a ? a.name : id }), '#a78bfa', 'fa-bolt');
}
