// ════════ AI 引擎配置（设置页「AI 助手」pane）════════
// 单一状态源：整份配置以 JSON 存 localStorage 的 launcher_aiConfig，默认值取自 MOCK_DATA.aiConfigDefaults。
// 依赖方向是单向的：本文件只被 ai.js 读（aiCfgState / aiCfgConfigured），ai.js 的渲染函数由本文件在配置变更后回调，
// 故全局只有一条刷新链路 refreshAiSurfaces()——设置页保存后 AI 页即时同步，无需事件总线。
// 真实实现（阶段 4）：provider/model/apiKey 走 shared/settings.ts，其中 apiKey 由 main 进程 safeStorage 加密，不进 config.json。

const AI_CFG_KEY = 'launcher_aiConfig';
let aiCfgData = null;   // { ...MOCK_DATA.aiConfigDefaults, providerConfigs: {...} }

function aiCfgLoad() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(AI_CFG_KEY) || 'null');
  } catch (e) {
    saved = null; // 损坏数据回默认，与设置存储「损坏回退」的约定一致
  }
  const base = JSON.parse(JSON.stringify(AI_CONFIG_DEFAULTS));
  aiCfgData = Object.assign(base, saved || {});
  aiCfgData.providerConfigs = Object.assign(
    JSON.parse(JSON.stringify(AI_CONFIG_DEFAULTS.providerConfigs)),
    (saved && saved.providerConfigs) || {}
  );
  // 供应商被删/改名时回落到第一个，避免配置指向不存在的条目
  if (!aiCfgFindProvider(aiCfgData.providerId)) aiCfgData.providerId = aiProviderData[0].id;
  // 仅内置目录（Anthropic）需要校正模型名；OpenAI 兼容端点连到哪家未知，模型名原样保留
  const prov = aiCfgFindProvider(aiCfgData.providerId);
  if (prov.models && !prov.models.some(m => m.id === aiCfgData.modelId)) {
    aiCfgData.modelId = prov.models[0].id;
  }
}

function aiCfgState() {
  if (!aiCfgData) aiCfgLoad();
  return aiCfgData;
}

function aiCfgFindProvider(id) {
  return aiProviderData.find(p => p.id === id) || null;
}

/* 当前生效的供应商有 Key 才叫「已配置」——切到没填 Key 的供应商同样进未配置态 */
function aiCfgConfigured() {
  const st = aiCfgState();
  const p = aiCfgFindProvider(st.providerId);
  const pc = st.providerConfigs[st.providerId] || {};
  return !!(p && pc.apiKey && pc.apiKey.trim());
}

/* 取模型显示名：内置目录里有就显示友好名，没有（OpenAI 兼容端点）就直接用用户填的 ID */
function aiCfgModelLabel(id) {
  for (const p of aiProviderData) {
    if (!p.models) continue;
    const m = p.models.find(x => x.id === id);
    if (m) return m.label;
  }
  return id;
}

/* 写盘（剔除瞬态字段）+ 全量刷新。所有变更都必须走这里，否则设置页与 AI 页会分叉。 */
function aiCfgSet(patch, silent) {
  const st = aiCfgState();
  Object.assign(st, patch);
  const persisted = Object.assign({}, st);
  delete persisted.testing; // 测试中标记是瞬态，不落盘（刷新后不该停在「正在测试」）
  try {
    localStorage.setItem(AI_CFG_KEY, JSON.stringify(persisted));
  } catch (e) {
    showToast(t('settings.ai.saveFailed'), '#ef8080', 'fa-triangle-exclamation'); // 存储写满等极端情形
  }
  if (!silent) refreshAiSurfaces();
}

/* 配置变更后的统一重渲染入口：设置页 pane / AI 页引擎 chip / composer 引导态与发送开关 */
function refreshAiSurfaces() {
  renderAiSettings();
  if (typeof aiRenderEngineState === 'function') aiRenderEngineState();
  if (typeof aiRenderConnectCard === 'function') aiRenderConnectCard();
  if (typeof aiSyncComposer === 'function') aiSyncComposer(); // 未配置时要一并禁用发送钮并换 placeholder
}

// ── 设置页 pane ──
/* 切 pane 时开关联动信号：默认手动点 nav，恢复默认等程序化切换则传 btn */
function aiSyncSettingsNav() {
  document.querySelectorAll('#view-settings .set-nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#view-settings .settings-pane').forEach(p => p.classList.remove('active'));
  const nav = document.querySelector('.set-nav-btn[onclick*="\'ai\'"]');
  const pane = document.getElementById('sp-ai');
  if (nav) nav.classList.add('active');
  if (pane) pane.classList.add('active');
}

function aiProviderCardsHtml(st) {
  return aiProviderData.map(p => {
    const pc = st.providerConfigs[p.id] || {};
    const on = p.id === st.providerId;
    return `<div class="ai-prov-card${on ? ' selected' : ''}" onclick="aiCfgPickProvider('${p.id}')">
      <div class="ai-prov-card-hd">
        <i class="${p.icon} ai-prov-card-icon"></i>
        <span class="ai-prov-card-name">${t('settings.ai.prov.' + p.id + '.name')}</span>
        <i class="fa-solid fa-circle-check ai-prov-check"></i>
      </div>
      <div class="ai-prov-card-sub">${t('settings.ai.prov.' + p.id + '.desc')}</div>
      <div class="ai-prov-card-foot">${pc.apiKey && pc.apiKey.trim()
        ? `<span class="ai-prov-key ok"><i class="fa-solid fa-key"></i>${t('settings.ai.provKeySet')}</span>`
        : `<span class="ai-prov-key"><i class="fa-solid fa-key"></i>${t('settings.ai.provKeyEmpty')}</span>`}</div>
    </div>`;
  }).join('');
}

/* 快捷填入：内置目录给「该协议已知模型」，无目录的协议（OpenAI 兼容）给「上次用过的模型」——
   后者零虚构、对任意网关都成立（模型名只有端点自己说了算，写死清单迟早漂移） */
function aiModelQuickPicks(st, p, pc) {
  if (p && p.models) return p.models.map(m => ({ id: m.id, label: m.label }));
  if (pc.lastModel && pc.lastModel !== st.modelId) {
    return [{ id: pc.lastModel, label: t('settings.ai.model.lastUsed') }];
  }
  return [];
}

function aiProviderDetailHtml(st) {
  const p = aiCfgFindProvider(st.providerId);
  if (!p) return '';
  const pc = st.providerConfigs[p.id] || {};
  const status = aiCfgStatusHtml(pc);
  const picks = aiModelQuickPicks(st, p, pc);
  return `
    <div class="settings-row">
      <div>
        <div class="settings-row-title">${t('settings.ai.baseUrl.rowTitle')}</div>
        <div class="settings-row-desc">${t('settings.ai.baseUrl.rowDesc')}</div>
      </div>
      <input class="f-input mono ai-cfg-input" type="text" value="${aiEsc(pc.baseUrl || p.defaultBase)}"
             placeholder="${p.defaultBase}" onchange="aiCfgSetEndpoint('${p.id}', 'baseUrl', this.value)" />
    </div>
    <div class="settings-row">
      <div>
        <div class="settings-row-title">${t('settings.ai.apiKey.rowTitle')}</div>
        <div class="settings-row-desc">${t('settings.ai.apiKey.rowDesc')}</div>
      </div>
      <div class="ai-cfg-key-wrap">
        <input class="f-input mono ai-cfg-input" type="password" autocomplete="off" value="${aiEsc(pc.apiKey || '')}"
               placeholder="${t('settings.ai.apiKey.ph')}" onchange="aiCfgSetEndpoint('${p.id}', 'apiKey', this.value)" />
        <button class="d-btn" type="button" onclick="aiCfgTest('${p.id}')">
          <i class="fa-solid fa-plug-circle-check"></i><span>${t('settings.ai.test.btn')}</span>
        </button>
      </div>
    </div>
    ${status ? `<div class="settings-row"><div class="ai-cfg-test-st-wrap">${status}</div>
      <button class="d-btn" type="button" onclick="aiCfgTest('${p.id}')"><i class="fa-solid fa-arrows-rotate"></i><span>${t('settings.ai.test.retry')}</span></button>
    </div>` : ''}
    <div class="settings-row ai-model-row">
      <div>
        <div class="settings-row-title">${t('settings.ai.model.rowTitle')}</div>
        <div class="settings-row-desc">${t(p.models ? 'settings.ai.model.rowDesc' : 'settings.ai.model.rowDescCustom')}</div>
      </div>
      <div class="ai-model-pick">
        <input class="f-input mono ai-cfg-input" type="text" value="${aiEsc(st.modelId)}"
               placeholder="${t('settings.ai.model.ph')}" onchange="aiCfgSetModel(this.value)" />
        ${picks.length ? `<div class="ai-model-picks">
          ${picks.map(m => `<button type="button" class="ai-model-chip${m.id === st.modelId ? ' active' : ''}"
              title="${aiEsc(m.id)}" mousedown="event.preventDefault()" onclick="aiCfgSetModel('${m.id}')">${aiEsc(m.label)}</button>`).join('')}
        </div>` : ''}
      </div>
    </div>`;
}

function aiCfgStatusHtml(pc) {
  const r = pc.testResult;
  if (pc.testing) {
    return `<span class="ai-cfg-test-st run"><i class="fa-solid fa-circle-notch ai-spin"></i>${t('settings.ai.test.testing')}</span>`;
  }
  if (r === 'ok') {
    return `<span class="ai-cfg-test-st ok"><i class="fa-solid fa-circle-check"></i>${t('settings.ai.test.ok')}</span>`;
  }
  if (r === 'fail') {
    return `<span class="ai-cfg-test-st fail"><i class="fa-solid fa-circle-xmark"></i>${t('settings.ai.test.fail')}</span>`;
  }
  return '';
}

/* 整块重渲染 sp-ai。设置页打开与配置变更时调用；语言切换经 loadSettings→applyLanguage 后由 ai.js 重入。 */
function renderAiSettings() {
  const pane = document.getElementById('sp-ai');
  if (!pane) return;
  const st = aiCfgState();
  pane.innerHTML = `
    <div class="settings-hero">
      <div class="settings-title">${t('settings.ai.title')}</div>
      <div class="settings-subtitle">${t('settings.ai.subtitle')}</div>
    </div>

    <section class="settings-section">
      <div class="settings-section-header">
        <div class="settings-section-icon"><i class="fa-solid fa-microchip"></i></div>
        <div>
          <div class="settings-section-title">${t('settings.ai.provSectionTitle')}</div>
          <div class="settings-section-desc">${t('settings.ai.provSectionDesc')}</div>
        </div>
      </div>
      <div class="settings-body">
        <div class="ai-prov-grid">${aiProviderCardsHtml(st)}</div>
        ${aiProviderDetailHtml(st)}
      </div>
    </section>

    <section class="settings-section">
      <div class="settings-section-header">
        <div class="settings-section-icon"><i class="fa-solid fa-sliders"></i></div>
        <div>
          <div class="settings-section-title">${t('settings.ai.behaviorSectionTitle')}</div>
          <div class="settings-section-desc">${t('settings.ai.behaviorSectionDesc')}</div>
        </div>
      </div>
      <div class="settings-body">
        <div class="settings-row">
          <div>
            <div class="settings-row-title">${t('settings.ai.toolRounds.rowTitle')}</div>
            <div class="settings-row-desc">${t('settings.ai.toolRounds.rowDesc')}</div>
          </div>
          <select class="settings-select" onchange="aiCfgSet({ toolCallLimit: Number(this.value) })">
            ${[4, 8, 16].map(n => `<option value="${n}"${n === st.toolCallLimit ? ' selected' : ''}>${fmt(t('settings.ai.toolRounds.unit'), { N: n })}</option>`).join('')}
          </select>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-title">${t('settings.ai.stream.rowTitle')}</div>
            <div class="settings-row-desc">${t('settings.ai.stream.rowDesc')}</div>
          </div>
          <label class="toggle"><input type="checkbox"${st.stream ? ' checked' : ''} onchange="aiCfgSet({ stream: this.checked })" />
            <div class="toggle-track"></div>
            <div class="toggle-thumb"></div>
          </label>
        </div>
        <div class="settings-row">
          <div>
            <div class="settings-row-title">${t('settings.ai.timeout.rowTitle')}</div>
            <div class="settings-row-desc">${t('settings.ai.timeout.rowDesc')}</div>
          </div>
          <select class="settings-select" onchange="aiCfgSet({ requestTimeout: Number(this.value) })">
            ${[30, 60, 120].map(n => `<option value="${n}"${n === st.requestTimeout ? ' selected' : ''}>${fmt(t('settings.ai.timeout.unit'), { N: n })}</option>`).join('')}
          </select>
        </div>
        <div class="settings-footer ai-cfg-footer">
          <span class="ai-cfg-footer-hint"><i class="fa-solid fa-key"></i>${t('settings.ai.footerHint')}</span>
          <button class="d-btn" type="button" onclick="aiCfgResetAll()"><i class="fa-solid fa-rotate-left"></i><span>${t('settings.ai.resetBtn')}</span></button>
        </div>
      </div>
    </section>`;
}

// ── 交互 ──
function aiCfgPickProvider(id) {
  const p = aiCfgFindProvider(id);
  if (!p) return;
  const st = aiCfgState();
  if (st.providerId === id) return;
  // 内置目录的协议（Anthropic）有已知模型可选；OpenAI 兼容端点连到哪家未知，保留用户已填的模型名
  const modelId = (p.models && !p.models.some(m => m.id === st.modelId)) ? p.models[0].id : st.modelId;
  aiCfgSet({ providerId: id, modelId });
  showToast(fmt(t('toast.aiProviderSwitched'), { N: t('settings.ai.prov.' + id + '.name') }), '#a78bfa', 'fa-microchip');
}

/* 记下「上次用过的模型」，供无内置目录的协议做快捷填入（见 aiModelQuickPicks） */
function aiCfgSetModel(id) {
  const v = String(id || '').trim();
  if (!v) return;
  const st = aiCfgState();
  const pc = Object.assign({}, st.providerConfigs[st.providerId], { lastModel: v });
  aiCfgSet({ modelId: v, providerConfigs: Object.assign({}, st.providerConfigs, { [st.providerId]: pc }) });
}

function aiCfgSetEndpoint(providerId, field, value) {
  const st = aiCfgState();
  const pc = Object.assign({}, st.providerConfigs[providerId]);
  pc[field] = field === 'apiKey' ? String(value).trim() : String(value).trim();
  delete pc.testResult;
  const providerConfigs = Object.assign({}, st.providerConfigs, { [providerId]: pc });
  aiCfgSet({ providerConfigs });
}

function aiCfgTest(providerId) {
  const st = aiCfgState();
  const start = Object.assign({}, st.providerConfigs[providerId]);
  if (!start.apiKey || !start.apiKey.trim()) {
    showToast(t('settings.ai.test.noKey'), '#ef8080', 'fa-triangle-exclamation');
    return;
  }
  if (start.testing) return;
  start.testing = true;
  aiCfgSet({ providerConfigs: Object.assign({}, st.providerConfigs, { [providerId]: start }) });
  showToast(t('settings.ai.test.testing'), '#60a5fa', 'fa-plug-circle-check');
  setTimeout(() => {
    // 回调里重新取最新配置：测试期间用户可能改了 Key 或切了供应商
    const now = aiCfgState();
    const pc = Object.assign({}, now.providerConfigs[providerId]);
    pc.testing = false;
    // demo 无真实网络：按 Key 形态给出可预期的结果（含 example/invalid 的演示 Key 恒失败，用于展示失败态）
    pc.testResult = /(example|invalid)/i.test(pc.apiKey || '') ? 'fail' : 'ok';
    aiCfgSet({ providerConfigs: Object.assign({}, now.providerConfigs, { [providerId]: pc }) });
    showToast(t(pc.testResult === 'ok' ? 'settings.ai.test.ok' : 'settings.ai.test.fail'),
      pc.testResult === 'ok' ? '#4ade80' : '#ef8080',
      pc.testResult === 'ok' ? 'fa-circle-check' : 'fa-circle-xmark');
  }, 1200);
}

/* silent：全局「恢复默认」会连带重置 AI 配置，此时不重复弹 toast */
function aiCfgResetAll(silent) {
  aiCfgData = null;
  localStorage.removeItem(AI_CFG_KEY);
  aiCfgLoad();
  refreshAiSurfaces();
  if (!silent) showToast(t('settings.ai.resetDone'), '#4ade80', 'fa-rotate-left');
}

// 首屏初始化：设置页 pane / AI 页 chip 与引导卡都依赖配置状态，脚本加载完先对齐一次
refreshAiSurfaces();
