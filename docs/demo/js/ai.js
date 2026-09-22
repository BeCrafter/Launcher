// ════════ AI 助手（对话式 Agent · 原型/模拟，2026-09-13 重设计）════════
// 交互形态对齐 docs/design/ai-capability.md（pi-ai 流式 + pi-agent-core tool calling）：
// 消息流内可折叠工具步骤块 / 写操作内联授权卡（复用 ELEVATION.request）/ 技能卡 / @ 引用 / MCP 接入。
// 数据源：MOCK_DATA.aiChats（预置会话静态直出）+ MOCK_DATA.aiScenes（时间线脚本化播放）。

const AI_MCP_CMD = 'claude mcp add launcher -- /Applications/Launcher.app/Contents/MacOS/launcher-mcp';

let chatState = {
  currentId: null,
  sessions: [],
  messages: [],
  mentions: [],
  running: false,
  timers: [],
  typer: null,
  botMi: null,
  toolCalls: 0,
  sceneQueue: null,
  afterApprove: null,
  pendingApprove: null,
  runElapsed: 0,
  runTickStart: 0,
  stick: true,
  liveSeq: 0
};

// ── 通用小工具 ──
function aiEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function aiResolve(s) {
  const running = agentData.filter(a => a.status === 'running').length;
  const stopped = agentData.filter(a => a.status === 'stopped').length;
  const cronOn = cronData.filter(c => c.enabled).length;
  return String(s)
    .replace(/\{N_AGENTS\}/g, agentData.length)
    .replace(/\{N_AG_RUN\}/g, running)
    .replace(/\{N_AG_BAD\}/g, stopped)
    .replace(/\{N_CRONS\}/g, cronData.length)
    .replace(/\{N_CRON_ON\}/g, cronOn)
    .replace(/\{N_SVCS\}/g, svcData.length);
}

function aiFmtMs(ms) {
  return ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's';
}

function aiNowLabel() {
  const d = new Date();
  return '今天 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function aiCountTools(messages) {
  return messages.reduce((n, m) => n + ((m.steps && m.steps.items) ? m.steps.items.length : 0), 0);
}

// ── 入口（modules.js switchModule 'ai' 分支与语言切换重入点）──
function renderAiChat() {
  aiAbortRun();
  if (!chatState.sessions.length) aiInitSessions();
  const rail = document.getElementById('aiRail');
  if (rail && window.innerWidth > 900) rail.classList.toggle('collapsed', localStorage.getItem('launcherAiRailCollapsed') === 'true');
  aiSyncComposer();
  aiRenderRail();
  aiRenderMessages(true);
  aiUpdateStatusBar();
}

function aiInitSessions() {
  chatState.sessions = aiChatData.map(c => ({ id: c.id, title: c.title, ts: c.ts, source: 'preset', messages: c.messages }));
  chatState.currentId = null; // 首次进入为欢迎态
  chatState.messages = [];
}

// ── 会话栏 ──
/* 会话搜索命中摘要：返回带 <mark> 高亮的片段；仅标题命中返回空串；未命中返回 null */
function aiRailHit(s, q) {
  if (s.title.toLowerCase().includes(q)) return '';
  for (const m of s.messages) {
    const text = aiResolve(m.text || '');
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) continue;
    const from = Math.max(0, i - 12);
    const to = Math.min(text.length, i + q.length + 28);
    return (from > 0 ? '…' : '')
      + aiEsc(text.slice(from, i))
      + `<mark class="ai-rail-hit-mark">${aiEsc(text.slice(i, i + q.length))}</mark>`
      + aiEsc(text.slice(i + q.length, to))
      + (to < text.length ? '…' : '');
  }
  return null;
}

function aiRenderRail() {
  const list = document.getElementById('aiRailList');
  if (!list) return;
  const cnt = document.getElementById('aiRailCount');
  if (cnt) cnt.textContent = chatState.sessions.length;
  const search = document.getElementById('aiRailSearch');
  const q = search ? search.value.trim().toLowerCase() : '';
  const wrap = document.getElementById('aiRailSearchWrap');
  if (wrap) wrap.classList.toggle('has-text', !!q);

  if (!chatState.sessions.length) {
    list.innerHTML = `<div class="ai-rail-empty">${t('ai.rail.empty')}</div>`;
    return;
  }
  const rows = chatState.sessions
    .map(s => ({ s, hit: q ? aiRailHit(s, q) : null }))
    .filter(r => !q || r.hit !== null);
  if (!rows.length) {
    list.innerHTML = `<div class="ai-rail-empty">${t('ai.rail.searchEmpty')}</div>`;
    return;
  }
  list.innerHTML = rows.map(({ s, hit }) => `
    <div class="ai-rail-item${s.id === chatState.currentId ? ' active' : ''}" onclick="aiSelectChat('${s.id}')">
      <div class="ai-rail-item-title" title="${aiEsc(s.title)}">${aiEsc(s.title)}</div>
      ${hit ? `<div class="ai-rail-hit">${hit}</div>` : `<div class="ai-rail-item-ts">${aiEsc(s.ts)}</div>`}
    </div>`).join('');
}

function aiRailSearchClear() {
  const search = document.getElementById('aiRailSearch');
  if (!search) return;
  search.value = '';
  aiRenderRail();
  search.focus();
}

function aiSelectChat(id) {
  const s = chatState.sessions.find(x => x.id === id);
  if (!s) return;
  aiAbortRun();
  chatState.currentId = id;
  chatState.messages = s.messages;
  chatState.toolCalls = aiCountTools(s.messages);
  aiSyncComposer();
  aiRenderRail();
  aiRenderMessages(true);
  aiUpdateStatusBar();
}

function aiNewChat() {
  aiAbortRun();
  chatState.currentId = null;
  chatState.messages = [];
  chatState.toolCalls = 0;
  chatState.mentions = [];
  const ta = document.getElementById('aiInput');
  if (ta) { ta.value = ''; aiAutoGrow(ta); }
  const search = document.getElementById('aiRailSearch');
  if (search) search.value = '';
  aiSyncComposer();
  aiRenderRail();
  aiRenderMessages(true);
  aiUpdateStatusBar();
  if (ta) ta.focus();
}

function aiToggleRail() {
  const rail = document.getElementById('aiRail');
  if (!rail) return;
  if (window.innerWidth <= 900) {
    rail.classList.toggle('mobile-open');
    return;
  }
  const collapsed = rail.classList.toggle('collapsed');
  localStorage.setItem('launcherAiRailCollapsed', collapsed ? 'true' : 'false');
}

// ── 消息渲染 ──
function aiRenderMessages(jump) {
  const col = document.getElementById('aiCol');
  if (!col) return;
  col.innerHTML = chatState.messages.length
    ? chatState.messages.map((m, mi) => aiMsgHtml(m, mi)).join('')
    : aiWelcomeHtml();
  if (jump) aiScrollBottom(true); else aiScrollBottom();
}

function aiWelcomeHtml() {
  const skills = aiSkillData.map(s => `
    <div class="ai-skill-card" onclick="aiRunScene('${s.id}')">
      <div class="ai-skill-card-hd">
        <i class="fa-solid ${s.icon} ai-skill-card-icon"></i>
        <span class="ai-skill-card-name">${t(s.nameKey)}</span>
        ${tagChip(s.tag, s.tag)}
      </div>
      <div class="ai-skill-card-desc">${t(s.descKey)}</div>
    </div>`).join('');
  return `
  <div class="ai-welcome">
    <div class="ai-welcome-greet"><i class="fa-solid fa-wand-magic-sparkles"></i>${t('ai.welcome.greet')}</div>
    <div class="ai-welcome-sub">${t('ai.welcome.sub')}</div>
    <div class="ai-health-card" onclick="aiRunScene('health')">
      <span class="ai-health-icon"><i class="fa-solid fa-stethoscope"></i></span>
      <div class="ai-health-body">
        <div class="ai-health-title">${t('ai.welcome.healthTitle')}</div>
        <div class="ai-health-desc">${t('ai.welcome.healthDesc')}</div>
      </div>
      <i class="fa-solid fa-arrow-right ai-health-arrow"></i>
    </div>
    <div class="ai-skill-lbl">${t('ai.welcome.skills')}</div>
    <div class="ai-skill-grid">${skills}</div>
  </div>`;
}

function aiChipsHtml(chips) {
  if (!chips || !chips.length) return '';
  return chips.map(c => `<span class="ai-chip-ref"><i class="fa-solid fa-at"></i>${aiEsc(c.label)}</span>`).join('');
}

function aiMsgHtml(m, mi) {
  if (m.role === 'user') {
    return `<div class="ai-msg user"><div class="ai-bubble">${aiChipsHtml(m.chips)}${aiEsc(m.text)}</div></div>`;
  }
  return `<div class="ai-msg bot" id="aiMsg${mi}">${aiBotInnerHtml(m, mi)}</div>`;
}

function aiBotInnerHtml(m, mi) {
  let h = `<div class="ai-bot-name"><span class="ai-bot-avatar"><i class="fa-solid fa-wand-magic-sparkles"></i></span>Launcher Agent</div>`;
  if (m.thinking) {
    h += `<div class="ai-thinking"><span class="ai-dots"><i></i><i></i><i></i></span><span>${t('ai.thinking')}</span></div>`;
  }
  if (m.steps && m.steps.items.length) h += aiStepsHtml(m, mi);
  if (m.streaming) {
    h += `<div class="ai-txt" id="aiStreamTxt"><span class="ai-txt-inner">${aiEsc(m.text || '')}</span><span class="ai-caret"></span></div>`;
  } else if (m.text) {
    h += `<div class="ai-txt">${aiEsc(aiResolve(m.text))}</div>`;
  }
  if (m.cards && m.cards.length) h += m.cards.map((c, ci) => aiCardHtml(c, mi, ci)).join('');
  if (m.suggest && m.suggest.length) h += aiSuggestHtml(m.suggest);
  return h;
}

function aiPatchBotMsg(mi) {
  const el = document.getElementById('aiMsg' + mi);
  const m = chatState.messages[mi];
  if (!el || !m) return;
  el.innerHTML = aiBotInnerHtml(m, mi);
}

// ── 工具步骤块 ──
function aiStepsHtml(m, mi) {
  const st = m.steps;
  const open = !st.collapsed;
  const done = st.items.filter(i => i.status !== 'run').length;
  const sum = st.running
    ? fmt(t('ai.steps.running'), { N: done })
    : fmt(t('ai.steps.done'), { N: st.items.length, T: aiFmtMs(st.elapsedMs || 0) });
  return `<div class="ai-steps${open ? ' open' : ''}">
    <div class="ai-steps-hd" onclick="aiToggleSteps(${mi})">
      <i class="fa-solid fa-bolt"></i><span>${sum}</span>
      <i class="fa-solid fa-chevron-right ai-chev${open ? ' open' : ''}"></i>
    </div>
    <div class="ai-steps-body">${st.items.map((it, si) => aiStepHtml(it, mi, si)).join('')}</div>
  </div>`;
}

function aiStepHtml(it, mi, si) {
  const hasOut = !!(it.out && it.out.length);
  const stIcon = it.status === 'run'
    ? `<i class="fa-solid fa-circle-notch ai-spin"></i>`
    : `<span class="ai-step-dot ${it.status}"></span>`;
  const outs = hasOut
    ? `<div class="ai-step-out${it.open ? ' open' : ''}">` +
      it.out.map(([lv, tx]) => `<div class="log-line"><span class="log-ts">${getTs()}</span><span class="log-txt ${lv}">${aiEsc(aiResolve(tx))}</span></div>`).join('') +
      `</div>`
    : '';
  return `<div class="ai-step${hasOut ? '' : ' no-out'}">
    <div class="ai-step-hd"${hasOut ? ` onclick="aiToggleStepOut(${mi}, ${si})"` : ''}>
      ${stIcon}<span class="ai-tool">${aiEsc(it.tool)}</span>
      ${it.args ? `<span class="ai-step-args">${aiEsc(it.args)}</span>` : ''}
      <span class="ai-step-ms">${it.status === 'run' ? '' : aiFmtMs(it.ms)}</span>
      ${hasOut ? `<i class="fa-solid fa-chevron-right ai-step-chev${it.open ? ' open' : ''}"></i>` : ''}
    </div>${outs}
  </div>`;
}

function aiToggleSteps(mi) {
  const m = chatState.messages[mi];
  if (!m || !m.steps) return;
  m.steps.collapsed = !m.steps.collapsed;
  aiPatchBotMsg(mi);
}

function aiToggleStepOut(mi, si) {
  const m = chatState.messages[mi];
  const it = m && m.steps && m.steps.items[si];
  if (!it || !(it.out && it.out.length)) return;
  it.open = !it.open;
  aiPatchBotMsg(mi);
}

// ── 内联卡片 ──
function aiCardHtml(c, mi, ci) {
  if (c.kind === 'report') return aiReportCardHtml(c);
  if (c.kind === 'cron') return aiCronCardHtml(c);
  if (c.kind === 'plist') return aiPlistCardHtml(c);
  if (c.kind === 'approve') return aiApproveCardHtml(c, mi, ci);
  return '';
}

function aiReportCardHtml(c) {
  const icons = { ok: 'fa-circle-check', warn: 'fa-triangle-exclamation', err: 'fa-circle-xmark' };
  const items = c.items.map(it => `<div class="ai-report-item ${it.level}">
      <i class="fa-solid ${icons[it.level] || 'fa-circle-info'}"></i>
      <span>${aiEsc(aiResolve(it.text))}</span>
      ${it.goto ? `<button class="d-btn accent ai-report-go" onclick="aiGotoModule('${it.goto}')"><span>${t('ai.report.goto')}</span><i class="fa-solid fa-arrow-right"></i></button>` : ''}
    </div>`).join('');
  return `<div class="ai-card">
    <div class="ai-card-hd"><i class="fa-solid fa-clipboard-check" style="color:var(--accent2);"></i>${t('ai.report.title')}</div>
    ${items}
  </div>`;
}

function aiCronCardHtml(c) {
  return `<div class="ai-card">
    <div class="ai-card-hd"><i class="fa-solid fa-clock" style="color:var(--accent2);"></i>${t('ai.cron.title')}</div>
    <div class="ai-code">${aiEsc(c.cmd)}</div>
    <div class="ai-cron-row"><i class="fa-solid fa-calendar-day"></i><span>${t('ai.cron.schedule')}</span><span class="ai-cron-expr">${aiEsc(c.expr)}</span><span style="color:var(--dim);">·</span><span>${aiEsc(parseCronExpr(c.expr))}</span></div>
  </div>`;
}

function aiPlistCardHtml(c) {
  return `<div class="ai-card">
    <div class="ai-card-hd"><i class="fa-solid fa-file-code" style="color:var(--accent2);"></i>${t('ai.plist.title')}${c.path ? `<span class="ai-card-sub">${aiEsc(c.path)}</span>` : ''}</div>
    <div class="ai-code">${aiEsc(c.xml)}</div>
    <div class="ai-card-actions">
      <button class="d-btn" data-copy="${aiEsc(c.xml)}" onclick="aiCopyText(this)"><i class="fa-solid fa-copy"></i><span>${t('xml.copy')}</span></button>
      <button class="d-btn accent" onclick="aiPlistOpenEditor()"><i class="fa-solid fa-arrow-up-right-from-square"></i><span>${t('ai.plist.open')}</span></button>
    </div>
  </div>`;
}

function aiApproveCardHtml(c, mi, ci) {
  const icon = c.dangerous ? 'fa-triangle-exclamation' : 'fa-shield-halved';
  let foot;
  if (c.state === 'pending') {
    foot = `<div class="ai-card-actions">
      <button class="d-btn accent" onclick="aiApprove(${mi}, ${ci})"><i class="fa-solid fa-check"></i><span>${t('ai.appr.approve')}</span></button>
      <button class="d-btn" onclick="aiCancelApprove(${mi}, ${ci})"><span>${t('ai.appr.cancel')}</span></button>
    </div>`;
  } else if (c.state === 'approved') {
    foot = `<div class="ai-appr-st done"><i class="fa-solid fa-circle-check"></i><span>${t('ai.appr.done')} · ${aiEsc(c.tool)}</span></div>`;
  } else {
    foot = `<div class="ai-appr-st cancelled"><i class="fa-solid fa-ban"></i><span>${t('ai.appr.cancelled')}</span></div>`;
  }
  return `<div class="ai-card ai-appr">
    <div class="ai-card-hd"><i class="fa-solid ${icon}" style="color:var(--accent2);"></i>${t('ai.appr.title')}</div>
    <div style="font-size:11.5px;color:var(--muted);line-height:1.6;">${aiEsc(c.detail)}</div>
    <div class="ai-appr-cmd">${aiEsc(c.command)}</div>
    ${foot}
  </div>`;
}

function aiSuggestHtml(items) {
  return `<div class="ai-suggest">
    <span class="ai-suggest-lbl">${t('ai.suggest.title')}</span>
    ${items.map(s => `<button class="chip" data-suggest="${aiEsc(s)}" onclick="aiSendSuggest(this)">${aiEsc(s)}</button>`).join('')}
  </div>`;
}

// ── 授权卡交互（复用提权链路：危险确认 → 系统授权 → 续播）──
async function aiApprove(mi, ci) {
  const m = chatState.messages[mi];
  const card = m && m.cards && m.cards[ci];
  if (!card || card.state !== 'pending') return;
  if (card.dangerous) {
    const ok = await confirmDangerousAction({ detail: card.detail });
    if (!ok) return;
  }
  const granted = await ELEVATION.request({ detail: card.detail, command: card.command });
  if (!granted) {
    aiCancelApprove(mi, ci);
    return;
  }
  card.state = 'approved';
  chatState.toolCalls += 1;
  aiPatchBotMsg(mi);
  aiUpdateStatusBar();
  if (chatState.running) {
    chatState.pendingApprove = null;
    chatState.runTickStart = Date.now(); // 恢复计时（授权等待不计入耗时）
    const after = chatState.afterApprove || [];
    chatState.afterApprove = null;
    if (after.length) {
      chatState.sceneQueue = after.slice();
      aiNextStep();
    } else {
      aiFinishRun();
    }
  }
}

function aiCancelApprove(mi, ci) {
  const m = chatState.messages[mi];
  const card = m && m.cards && m.cards[ci];
  if (!card || card.state !== 'pending') return;
  card.state = 'cancelled';
  chatState.pendingApprove = null;
  aiPatchBotMsg(mi);
  chatState.messages.push({ role: 'bot', text: t('ai.appr.cancelNote') });
  const col = document.getElementById('aiCol');
  if (col) {
    col.insertAdjacentHTML('beforeend', `<div class="ai-msg bot" id="aiMsg${chatState.messages.length - 1}"></div>`);
    aiPatchBotMsg(chatState.messages.length - 1);
  }
  aiStopRun(true);
}

// ── 脚本化运行器 ──
function aiAfter(ms, fn) {
  const id = setTimeout(fn, ms);
  chatState.timers.push(id);
}

function aiClearTimers() {
  chatState.timers.forEach(id => clearTimeout(id));
  chatState.timers = [];
  if (chatState.typer) {
    clearInterval(chatState.typer);
    chatState.typer = null;
  }
}

function aiFindSceneId(text) {
  const low = String(text).toLowerCase();
  const hit = aiSceneData.find(s => s.id !== 'fallback' && s.match.some(k => low.includes(k)));
  return hit ? hit.id : 'fallback';
}

function aiRunScene(sceneId) {
  const scene = aiSceneData.find(s => s.id === sceneId);
  if (!scene || chatState.running) return;
  const opener = (scene.steps[0] && scene.steps[0].t === 'user') ? scene.steps[0].text : scene.title;
  aiStartLive(opener, sceneId, null);
}

function aiSend() {
  if (chatState.running) { aiStopRun(false); return; }
  const input = document.getElementById('aiInput');
  if (!input) return;
  const v = input.value.trim();
  if (!v) return;
  const chips = chatState.mentions.slice();
  input.value = '';
  chatState.mentions = [];
  aiAutoGrow(input);
  aiRenderComposerChips();
  aiStartLive(v, aiFindSceneId(v), chips.length ? chips : null);
}

function aiSendSuggest(btn) {
  const v = btn && btn.dataset ? btn.dataset.suggest : '';
  if (!v || chatState.running) return;
  if (chatState.mentions.length) { chatState.mentions = []; aiRenderComposerChips(); }
  aiStartLive(v, aiFindSceneId(v), null);
}

function aiStartLive(userText, sceneId, chips) {
  aiClearTimers();
  const scene = aiSceneData.find(s => s.id === sceneId) || aiSceneData.find(s => s.id === 'fallback');
  const session = {
    id: 'live-' + (++chatState.liveSeq),
    title: truncate(userText, 18),
    ts: aiNowLabel(),
    source: 'live',
    messages: []
  };
  chatState.sessions.unshift(session);
  chatState.currentId = session.id;
  chatState.messages = session.messages;
  chatState.toolCalls = 0;
  chatState.botMi = null;
  chatState.pendingApprove = null;
  chatState.afterApprove = scene.afterApprove || null;
  chatState.stick = true;
  chatState.runElapsed = 0;
  chatState.runTickStart = Date.now();
  aiRenderRail();
  aiRenderMessages(true);
  aiAppendUserMsg(userText, chips);
  const steps = scene.steps.slice();
  if (steps[0] && steps[0].t === 'user') steps.shift();
  chatState.sceneQueue = steps;
  aiSetRunning(true);
  aiUpdateStatusBar();
  aiNextStep();
}

function aiAppendUserMsg(text, chips) {
  chatState.messages.push({ role: 'user', text, chips: chips && chips.length ? chips.slice() : undefined });
  const col = document.getElementById('aiCol');
  if (!col) return;
  if (chatState.messages.length === 1) col.innerHTML = '';
  col.insertAdjacentHTML('beforeend', `<div class="ai-msg user"><div class="ai-bubble">${aiChipsHtml(chips)}${aiEsc(text)}</div></div>`);
  aiScrollBottom(true);
}

function aiEnsureBotMsg() {
  if (chatState.botMi != null && chatState.messages[chatState.botMi]) return chatState.botMi;
  chatState.messages.push({ role: 'bot' });
  const mi = chatState.messages.length - 1;
  chatState.botMi = mi;
  const col = document.getElementById('aiCol');
  if (col) {
    if (chatState.messages.length === 1) col.innerHTML = ''; // 理论上不会发生（首条必为用户消息）
    col.insertAdjacentHTML('beforeend', `<div class="ai-msg bot" id="aiMsg${mi}"></div>`);
    aiPatchBotMsg(mi);
  }
  return mi;
}

function aiNextStep() {
  if (!chatState.sceneQueue || !chatState.sceneQueue.length) { aiFinishRun(); return; }
  const st = chatState.sceneQueue.shift();
  const delay = st.delay != null ? st.delay : 340;
  aiAfter(delay, () => {
    if (!chatState.running) return;
    aiExecStep(st);
  });
}

function aiExecStep(st) {
  if (st.t === 'think') {
    const mi = aiEnsureBotMsg();
    chatState.messages[mi].thinking = true;
    aiPatchBotMsg(mi);
    aiScrollBottom();
    aiNextStep();
    return;
  }
  if (st.t === 'tool') {
    const mi = aiEnsureBotMsg();
    const m = chatState.messages[mi];
    m.thinking = false;
    if (!m.steps) m.steps = { collapsed: false, running: true, elapsedMs: 0, items: [] };
    m.steps.running = true;
    const item = { tool: st.tool, args: st.args, status: 'run', ms: 0, out: [] };
    m.steps.items.push(item);
    aiPatchBotMsg(mi);
    aiScrollBottom();
    chatState.toolCalls += 1;
    aiUpdateStatusBar();
    const outs = st.out || [];
    let i = 0;
    const tick = () => {
      if (!chatState.running) return;
      if (i < outs.length) {
        const [lv, tx] = outs[i++];
        item.out.push([lv, st.res ? aiResolve(tx) : tx]);
        aiPatchBotMsg(mi);
        aiScrollBottom();
        aiAfter(150, tick);
      } else {
        aiAfter(180, () => {
          if (!chatState.running) return;
          item.status = st.status;
          item.ms = st.ms;
          aiPatchBotMsg(mi);
          aiNextStep();
        });
      }
    };
    aiAfter(260, tick);
    return;
  }
  if (st.t === 'stream') {
    const mi = aiEnsureBotMsg();
    chatState.messages[mi].thinking = false;
    aiTypewriter(mi, st.res ? aiResolve(st.text) : st.text, aiNextStep);
    return;
  }
  if (st.t === 'card') {
    const mi = aiEnsureBotMsg();
    const m = chatState.messages[mi];
    m.thinking = false;
    m.cards = m.cards || [];
    const card = JSON.parse(JSON.stringify(st.card));
    m.cards.push(card);
    aiPatchBotMsg(mi);
    aiScrollBottom();
    if (card.kind === 'approve' && card.state === 'pending') {
      chatState.runElapsed += Date.now() - chatState.runTickStart; // 冻结计时，等待授权
      chatState.pendingApprove = { mi, ci: m.cards.length - 1 };
      return;
    }
    aiAfter(300, aiNextStep);
    return;
  }
  if (st.t === 'suggest') {
    const mi = aiEnsureBotMsg();
    const m = chatState.messages[mi];
    m.thinking = false;
    m.suggest = st.items.slice();
    aiPatchBotMsg(mi);
    aiScrollBottom();
    aiAfter(220, aiNextStep);
    return;
  }
  aiNextStep();
}

function aiTypewriter(mi, full, done) {
  const m = chatState.messages[mi];
  m.streaming = true;
  m.text = '';
  aiPatchBotMsg(mi);
  let i = 0;
  chatState.typer = setInterval(() => {
    i += 1;
    m.text = full.slice(0, i);
    const node = document.querySelector(`#aiMsg${mi} .ai-txt-inner`);
    if (node) node.textContent = m.text;
    aiScrollBottom();
    if (i >= full.length) {
      clearInterval(chatState.typer);
      chatState.typer = null;
      m.streaming = false;
      m.text = full;
      aiPatchBotMsg(mi);
      if (done) done();
    }
  }, 16);
}

function aiFinishRun() {
  if (!chatState.running) return;
  const mi = chatState.botMi;
  if (mi != null) {
    const m = chatState.messages[mi];
    if (m && m.steps) {
      m.steps.running = false;
      m.steps.collapsed = true;
      m.steps.elapsedMs = chatState.runElapsed + (Date.now() - chatState.runTickStart);
      aiPatchBotMsg(mi);
    }
  }
  chatState.botMi = null;
  aiSetRunning(false);
  aiScrollBottom();
}

function aiStopRun(silent) {
  if (!chatState.running) return;
  aiClearTimers();
  chatState.sceneQueue = null;
  chatState.afterApprove = null;
  if (chatState.pendingApprove) {
    const { mi, ci } = chatState.pendingApprove;
    const m = chatState.messages[mi];
    const card = m && m.cards && m.cards[ci];
    if (card && card.state === 'pending') { card.state = 'cancelled'; aiPatchBotMsg(mi); }
    chatState.pendingApprove = null;
  }
  const mi = chatState.botMi;
  if (mi != null) {
    const m = chatState.messages[mi];
    if (m && m.steps && m.steps.running) {
      m.steps.running = false;
      m.steps.collapsed = true;
      m.steps.elapsedMs = chatState.runElapsed + (Date.now() - chatState.runTickStart);
      m.steps.items.forEach(it => { if (it.status === 'run') it.status = 'warn'; });
      aiPatchBotMsg(mi);
    }
  }
  chatState.botMi = null;
  aiSetRunning(false);
  if (!silent) showToast(t('ai.stopped'), '#8888aa', 'fa-stop');
}

// 语言切换 / 切会话 / 切模块导致的运行终止（不提示 toast）
function aiAbortRun() {
  aiClearTimers();
  if (!chatState.running) return;
  if (chatState.pendingApprove) {
    const { mi, ci } = chatState.pendingApprove;
    const m = chatState.messages[mi];
    const card = m && m.cards && m.cards[ci];
    if (card && card.state === 'pending') card.state = 'cancelled';
    chatState.pendingApprove = null;
  }
  chatState.messages.forEach(m => {
    if (m.steps && m.steps.items) m.steps.items.forEach(it => { if (it.status === 'run') it.status = 'warn'; });
    if (m.steps) m.steps.running = false;
  });
  chatState.sceneQueue = null;
  chatState.afterApprove = null;
  chatState.botMi = null;
  chatState.running = false;
}

function aiSetRunning(on) {
  chatState.running = on;
  aiSyncComposer();
}

function aiSyncComposer() {
  const btn = document.getElementById('aiSendBtn');
  if (btn) {
    btn.classList.toggle('stop', chatState.running);
    btn.innerHTML = chatState.running ? '<i class="fa-solid fa-stop"></i>' : '<i class="fa-solid fa-arrow-up"></i>';
    btn.setAttribute('data-i18n-title', chatState.running ? 'ai.input.stop' : 'ai.input.send');
    btn.setAttribute('title', t(chatState.running ? 'ai.input.stop' : 'ai.input.send'));
  }
  const mb = document.getElementById('aiMentionBtn');
  if (mb) mb.classList.remove('active');
  const pop = document.getElementById('aiMentionPop');
  if (pop) pop.classList.remove('open');
  aiRenderComposerChips();
}

// ── Composer：输入 / @ 引用 ──
function aiAutoGrow(ta) {
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
}

function aiOnInput(ta) {
  aiAutoGrow(ta);
  const pop = document.getElementById('aiMentionPop');
  if (pop && pop.classList.contains('open')) {
    pop.dataset.btnMode = '';
    aiMentionBuild(false);
  }
}

function aiInputKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    aiSend();
    return;
  }
  if (e.key === 'Escape') {
    aiMentionClose();
    return;
  }
  if (e.key === '@') {
    setTimeout(() => { aiEnsureMentionPop().dataset.btnMode = ''; aiMentionOpen(false); }, 0);
  }
}

function aiEnsureMentionPop() {
  let pop = document.getElementById('aiMentionPop');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'aiMentionPop';
    pop.className = 'ai-mention-pop';
    document.body.appendChild(pop);
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#aiMentionPop') && !e.target.closest('#aiMentionBtn')) aiMentionClose();
    });
  }
  return pop;
}

function aiMentionToggle() {
  const pop = aiEnsureMentionPop();
  if (pop.classList.contains('open')) { aiMentionClose(); return; }
  pop.dataset.btnMode = '1';
  aiMentionOpen(true);
}

function aiMentionOpen(force) {
  const pop = aiEnsureMentionPop();
  aiMentionBuild(force);
  if (!pop.classList.contains('open')) return; // 构建阶段被关闭（无 @ 且非按钮模式）
  const btn = document.getElementById('aiMentionBtn');
  if (btn) {
    btn.classList.add('active');
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.max(10, r.left) + 'px';
    pop.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    pop.style.top = 'auto';
  }
}

function aiMentionBuild(force) {
  const pop = aiEnsureMentionPop();
  let q = '';
  if (!force) {
    const ta = document.getElementById('aiInput');
    const v = ta ? ta.value : '';
    const at = v.lastIndexOf('@');
    if (at === -1) { aiMentionClose(); return; }
    q = v.slice(at + 1);
    if (q.includes(' ') || q.includes('\n')) { aiMentionClose(); return; }
  }
  const low = q.trim().toLowerCase();
  const agents = agentData.filter(a => !low || a.label.toLowerCase().includes(low) || (a.desc || '').toLowerCase().includes(low));
  const crons = cronData.filter(c => !low || (c.desc || '').toLowerCase().includes(low) || c.expr.includes(low));
  let h = '';
  if (agents.length) {
    h += `<div class="ai-mention-lbl">${t('ai.mention.section.agents')}</div>` + agents.map(a => `
      <div class="ai-mention-item" data-label="${aiEsc(a.label)}" onclick="aiPickMention('agent', '${a.id}', this)">
        ${statusDot(a.status)}<span>${aiEsc(a.label)}</span>
        <span class="ai-mention-sub">${aiEsc((a.program || '').replace(/^.*\//, ''))}</span>
      </div>`).join('');
  }
  if (crons.length) {
    h += `<div class="ai-mention-lbl">${t('ai.mention.section.crons')}</div>` + crons.map(c => `
      <div class="ai-mention-item" data-label="${aiEsc(c.desc || c.expr)}" onclick="aiPickMention('cron', '${c.id}', this)">
        <i class="fa-regular fa-clock"></i><span>${aiEsc(c.desc || c.cmd)}</span>
        <span class="ai-mention-sub">${aiEsc(c.expr)}</span>
      </div>`).join('');
  }
  if (!h) h = `<div class="ai-mention-empty">${t('ai.mention.empty')}</div>`;
  pop.innerHTML = h;
  pop.classList.add('open');
}

function aiPickMention(type, id, el) {
  const label = (el && el.dataset && el.dataset.label) || id;
  const ta = document.getElementById('aiInput');
  if (ta) {
    const v = ta.value;
    const at = v.lastIndexOf('@');
    const q = at === -1 ? '' : v.slice(at + 1);
    if (at !== -1 && !q.includes(' ') && !q.includes('\n')) ta.value = v.slice(0, at);
  }
  const key = type + ':' + id;
  if (!chatState.mentions.some(m => m.key === key)) chatState.mentions.push({ key, type, id, label });
  aiRenderComposerChips();
  aiMentionClose();
  if (ta) { aiAutoGrow(ta); ta.focus(); }
}

function aiRenderComposerChips() {
  const box = document.getElementById('aiComposerChips');
  if (!box) return;
  const ms = chatState.mentions || [];
  box.classList.toggle('show', ms.length > 0);
  box.innerHTML = ms.map((m, i) => `<span class="ai-composer-chip"><i class="fa-solid fa-at"></i>${aiEsc(m.label)}<i class="fa-solid fa-xmark" onclick="aiRemoveMention(${i})"></i></span>`).join('');
}

function aiRemoveMention(i) {
  chatState.mentions.splice(i, 1);
  aiRenderComposerChips();
}

function aiMentionClose() {
  const pop = document.getElementById('aiMentionPop');
  if (pop) { pop.classList.remove('open'); pop.dataset.btnMode = ''; }
  const btn = document.getElementById('aiMentionBtn');
  if (btn) btn.classList.remove('active');
}

// ── 滚动 ──
function aiOnScroll() {
  const sc = document.getElementById('aiScroll');
  const bot = document.getElementById('aiScrollBot');
  if (!sc || !bot) return;
  const near = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80;
  chatState.stick = near;
  bot.classList.toggle('show', !near && chatState.messages.length > 0);
}

function aiScrollBottom(force) {
  if (!chatState.stick && !force) return;
  const sc = document.getElementById('aiScroll');
  if (!sc) return;
  sc.scrollTop = sc.scrollHeight;
}

// ── 卡片动作 ──
function aiCopyText(btn) {
  if (!btn || !btn.dataset) return;
  fallbackCopy(btn.dataset.copy || '', () => showToast(t('toast.xmlCopied'), '#22d3ee', 'fa-copy'));
}

function aiPlistOpenEditor() {
  aiStopRun(true);
  switchModule('agents');
}

function aiGotoModule(mod) {
  aiStopRun(true);
  switchModule(mod);
}

function aiUpdateStatusBar() {
  updateModuleStatusBar('ai', { calls: chatState.toolCalls });
}

// ── MCP 接入 ──
function aiOpenMcpModal() {
  aiRenderMcpModal();
  openModal('aiMcpModal');
}

function aiRenderMcpModal() {
  const cmd = document.getElementById('aiMcpCmd');
  if (cmd) cmd.textContent = AI_MCP_CMD;
  const tg = document.getElementById('aiMcpWriteToggle');
  if (tg) tg.checked = localStorage.getItem('launcher_mcpAllowWrite') === 'true';
  const box = document.getElementById('aiMcpAgents');
  if (box) {
    box.innerHTML = aiAgentData.map(a => {
      const st = a.status === 'installed' ? 'running' : 'stopped';
      return `<div class="ai-mcp-agent">
        <i class="${a.icon} ai-mcp-agent-icon"></i>
        <span class="ai-mcp-agent-name">${a.name}</span>
        <span class="ai-mcp-agent-cli">${a.cli}</span>
        <span class="ai-mcp-agent-st">${statusDot(st)}${statusLabel(st, { running: 'ai.status.installed', stopped: 'ai.status.notfound' })}</span>
      </div>`;
    }).join('');
  }
}

function aiCopyMcpCmd() {
  fallbackCopy(AI_MCP_CMD, () => showToast(t('toast.xmlCopied'), '#22d3ee', 'fa-copy'));
}

function aiToggleMcpPerm(cb) {
  const on = !!(cb && cb.checked);
  localStorage.setItem('launcher_mcpAllowWrite', on ? 'true' : 'false');
  showToast(t(on ? 'ai.mcp.permOn' : 'ai.mcp.permOff'), on ? '#f87171' : '#4ade80', 'fa-shield-halved');
}
