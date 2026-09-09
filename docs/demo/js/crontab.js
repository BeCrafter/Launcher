// ════════ Crontab 视图 ════════
let activeCronFilter = 'all';

function parseCronExpr(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return t('cron.parse.invalid');
  const [min, hour, dom, mon, dow] = parts;
  const isEn = currentLang === 'en-US';
  const isInt = v => /^\d+$/.test(v);
  const pad = v => String(v).padStart(2, '0');
  // 时间片段：hour 为数字 -> H:MM；hour 为 * 时 zh 沿旧文案“每小时”，en 用整点
  const T = isInt(hour)
    ? hour + ':' + (isInt(min) ? pad(min) : min)
    : t('cron.parse.hour');
  const W = (() => {
    if (dow === '1-5') return t('cron.wd.1-5');
    if (isInt(dow)) return t('cron.wd.' + (parseInt(dow, 10) % 7));
    return dow;
  })();
  const isWeekdayGroup = dow === '1-5';
  if (min === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return t('cron.parse.everyMinute');
  if (dom === '*' && mon === '*' && dow === '*') {
    if (hour === '*' && min === '*') return t('cron.parse.everyHour');
    // hour 通配且分钟为步进（*/30）：en 直接给 "every N minutes"；zh 保持原样
    if (hour === '*') {
      const mm = /^\*\/(\d+)$/.exec(min);
      if (isEn && mm) return t('cron.parse.intervalMin').replace('{N}', mm[1]);
    }
    // zh 沿用原样“每天 9:00 执行 / 每天 每小时 执行”
    return fmt(t('cron.parse.daily'), { T });
  }
  if (dom === '*' && mon === '*') {
    if (isEn) return isWeekdayGroup
      ? fmt(t('cron.parse.weekdays'), { W, T })
      : fmt(t('cron.parse.weekly'), { W, T });
    return '每' + W + ' ' + T + ' 执行';
  }
  // monthly：zh 输出 "{mon}月 {dom}日 H:MM 执行"；en 用月份名
  const M = isInt(mon) ? (isEn ? t('cron.mo.' + parseInt(mon, 10)) : mon + '月') : mon;
  if (isEn) {
    return mon === '*'
      ? fmt(t('cron.parse.monthDay'), { D: dom, T })
      : fmt(t('cron.parse.monthly'), { M, D: dom, T });
  }
  return M + ' ' + dom + '日 ' + T + ' 执行';
}

function filterCrons(scope, btn) {
  activeCronFilter = scope;
  document.querySelectorAll('#cronFilterBar .chip').forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const searchInput = document.getElementById('globalSearch');
  const q = searchInput ? searchInput.value : '';
  renderCron(scope, q);
}

function updateCronStats() {
  const activeCountEl = document.getElementById('cronActiveCount');
  const totalCountEl = document.getElementById('cronTotalCount');
  if (activeCountEl) activeCountEl.textContent = cronData.filter(j => j.enabled).length;
  if (totalCountEl) totalCountEl.textContent = cronData.length;
  updateModuleStatusBar('crontab');
}

function renderCron(filter = activeCronFilter, query = '') {
  const c = document.getElementById('cronList');
  if (!c) return;
  updateCronStats();
  let list = cronData.filter(j => {
    if (filter === 'user') return !j.system;
    if (filter === 'system') return !!j.system;
    return true;
  });
  if (query) {
    const q = query.toLowerCase();
    list = list.filter(j =>
      j.cmd.toLowerCase().includes(q) ||
      j.desc.toLowerCase().includes(q) ||
      j.expr.toLowerCase().includes(q)
    );
  }
  if (!list.length) {
    c.innerHTML = emptyState('fa-regular fa-clock', t('cron.empty'));
    return;
  }
  let html = '';
  list.forEach(j => {
    const cronDesc = parseCronExpr(j.expr);
    const main = `<div class="cron-col-card">
        <div class="cron-r1">
          ${statusDot(j.enabled ? 'running' : 'stopped')}
          <span class="cron-cmd" title="${j.cmd}">${j.cmd}</span>
          <label class="toggle" title="${j.enabled?t('cron.disable'):t('cron.enable')}">
            <input type="checkbox" ${j.enabled?'checked':''} onchange="toggleCronJob('${j.id}',this)" />
            <div class="toggle-track"></div><div class="toggle-thumb"></div>
          </label>
        </div>
        <div class="cron-desc">${j.desc}</div>
        <div class="cron-repeat">
          <span class="cron-repeat-text">${cronDesc}</span>
          <span class="cron-repeat-tags">
            ${tagChip(j.user, 'blue')}
            ${tagChip(j.system ? t('cron.tag.systemEtc') : t('cron.tag.user'), j.system ? 'red' : 'blue')}
          </span>
        </div>
        <div class="cron-r4">
          <span class="cron-expr" title="${j.expr}">${j.expr}</span>
          <div class="row-actions" onclick="event.stopPropagation()">
            ${actBtn('fa-solid fa-pen', { cls: 'accent', title: t('cron.edit'), onclick: `toggleCronEdit('${j.id}',event)`, iconId: 'cronEditIcon_' + j.id })}
            ${actBtn('fa-solid fa-trash-can', { cls: 'red', title: t('cron.delete'), onclick: `deleteCronJob('${j.id}')` })}
          </div>
        </div>
      </div>`;
    const extra = `<div class="row-expand" id="exp_cron_${j.id}">
        <div class="cron-log-block">
          <div class="expand-field" style="margin-bottom:8px;">
            <div class="expand-key" data-i18n="cron.log.path">日志路径</div>
            <div class="expand-val" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${j.log ? cronLogPath(j.id) : t('cron.log.no')}</div>
          </div>
          <div class="cron-log-row" style="display:${j.log ? 'flex' : 'none'};justify-content:space-between;align-items:center;">
            <span style="font-size:10px;color:var(--dim);" data-i18n="cron.log.retainHint">日志保留 3 天，超出自动清理</span>
            <div style="display:flex;gap:6px;">
              <button class="d-btn blue" style="padding:4px 10px;font-size:10.5px;" onclick="copyCronLogPath('${j.id}')" ${j.log ? '' : 'disabled'}><i class="fa-solid fa-copy"></i> <span data-i18n="cron.log.copyPath">复制路径</span></button>
              <button class="d-btn accent" style="padding:4px 10px;font-size:10.5px;" onclick="showCronLog('${j.id}')" ${j.log ? '' : 'disabled'}><i class="fa-solid fa-scroll"></i> <span data-i18n="cron.log.view">查看日志</span></button>
            </div>
          </div>
        </div>
      </div>
      <div class="cron-edit-expand" id="cronEdit_${j.id}">
        <div style="font-size:11px;font-weight:600;color:var(--text);margin-bottom:10px;"><i class="fa-regular fa-clock" style="color:var(--accent2);margin-right:5px;"></i>${t('cron.editTitle')}</div>
        <div style="font-size:10.5px;color:var(--muted);margin-bottom:6px;font-weight:600;">${t('cron.quickPreset')}</div>
        <div class="cron-preset-row" id="cronPresets_${j.id}">
          ${CRON_PRESETS.map(p=>`<button class="cron-preset-chip ${j.expr===p.expr?'active':''}" onclick="applyCronPreset('${j.id}','${p.expr}','${t(p.descKey)}',this)">${t(p.labelKey)}</button>`).join('')}
        </div>
        <div class="cron-expr-preview" id="cronExprPreview_${j.id}">
          <i class="fa-regular fa-clock" style="color:var(--cyan);font-size:13px;flex-shrink:0;"></i>
          <code id="cronExprCode_${j.id}">${j.expr}</code>
          <span class="cron-expr-desc" id="cronExprDescText_${j.id}">${cronDesc}</span>
        </div>
        <div class="cron-edit-grid">
          <div class="f-row center"><span class="f-lbl" style="width:60px;">${t('cron.field.minute')}</span><input class="f-input mono" type="text" id="cronMin_${j.id}"  value="${j.expr.split(' ')[0]}" oninput="updateCronExpr('${j.id}')" /></div>
          <div class="f-row center"><span class="f-lbl" style="width:60px;">${t('cron.field.hour')}</span><input class="f-input mono" type="text" id="cronHour_${j.id}" value="${j.expr.split(' ')[1]}" oninput="updateCronExpr('${j.id}')" /></div>
          <div class="f-row center"><span class="f-lbl" style="width:60px;">${t('cron.field.day')}</span><input class="f-input mono" type="text" id="cronDom_${j.id}"  value="${j.expr.split(' ')[2]}" oninput="updateCronExpr('${j.id}')" /></div>
          <div class="f-row center"><span class="f-lbl" style="width:60px;">${t('cron.field.month')}</span><input class="f-input mono" type="text" id="cronMon_${j.id}"  value="${j.expr.split(' ')[3]}" oninput="updateCronExpr('${j.id}')" /></div>
          <div class="f-row center"><span class="f-lbl" style="width:60px;">${t('cron.field.dow')}</span><input class="f-input mono" type="text" id="cronDow_${j.id}"  value="${j.expr.split(' ')[4]}" oninput="updateCronExpr('${j.id}')" /></div>
        </div>
        <div class="f-row center" style="margin-bottom:8px;"><span class="f-lbl" style="width:60px;">${t('cron.field.cmd')}</span><input class="f-input mono" type="text" id="cronCmd_${j.id}"  value="${j.cmd}" /></div>
        <div class="f-row center" style="margin-bottom:8px;"><span class="f-lbl" style="width:60px;">${t('cron.field.desc')}</span><input class="f-input" type="text" id="cronDesc_${j.id}" value="${j.desc}" /></div>
        <div class="f-row center">
          <span class="f-lbl" style="width:60px;" data-i18n="cron.log.label">记录日志</span>
          <label class="toggle"><input type="checkbox" ${j.log?'checked':''} onchange="toggleCronLog('${j.id}',this)" />
            <div class="toggle-track"></div><div class="toggle-thumb"></div>
          </label>
          <span style="font-size:10px;color:var(--dim);flex:1;min-width:0;">${t('cron.log.hint')}</span>
        </div>
        <div style="display:flex;justify-content:flex-end;gap:7px;margin-top:12px;">
          <button class="d-btn" onclick="cancelCronEdit('${j.id}')"><i class="fa-solid fa-xmark"></i> ${t('common.cancel')}</button>
          <button class="d-btn accent" onclick="saveCronEdit('${j.id}')"><i class="fa-solid fa-check"></i> ${t('common.save')}</button>
        </div>
      </div>`;
    html += `<div class="cron-cell">${main}${extra}</div>`;
  });
  c.innerHTML = `<div class="group-card-grid" id="cronGrid">${html}</div>`;
}

// ════════ Cron 内联编辑 ════════
let activeCronEdit = null;

// 收起 cronGrid 内所有已打开的面板（详情/编辑），exceptId 为保留不关闭的面板元素 id
function closeCronPanels(exceptId) {
  activeCronEdit = null;
  document.querySelectorAll('#cronGrid .row-expand.open').forEach(p => {
    if (p.id === exceptId) return;
    p.classList.remove('open');
    const chev = document.getElementById('chev_' + p.id.replace('exp_', ''));
    if (chev) chev.classList.remove('open');
  });
  document.querySelectorAll('#cronGrid .cron-edit-expand.open').forEach(p => {
    if (p.id === exceptId) return;
    p.classList.remove('open');
    const icon = document.getElementById('cronEditIcon_' + p.id.replace('cronEdit_', ''));
    if (icon) icon.className = 'fa-solid fa-pen';
  });
}

// 点击卡片/展开面板以外的区域时，收起所有浮层面板（面板内交互不受影响）
document.addEventListener('click', (e) => {
  const inPanelOrCard = e.target.closest('#cronGrid .row-expand.open, #cronGrid .cron-edit-expand.open, #cronGrid .cron-col-card');
  if (inPanelOrCard) return;
  if (document.querySelector('#cronGrid .row-expand.open, #cronGrid .cron-edit-expand.open')) {
    closeCronPanels();
  }
});

function toggleCronEdit(id, e) {
  e && e.stopPropagation();
  const editEl = document.getElementById('cronEdit_' + id);
  const iconEl = document.getElementById('cronEditIcon_' + id);
  if (!editEl) return;
  const isOpen = editEl.classList.contains('open');
  closeCronPanels('cronEdit_' + id);
  if (isOpen) {
    editEl.classList.remove('open');
    if (iconEl) iconEl.className = 'fa-solid fa-pen';
  } else {
    editEl.classList.add('open');
    if (iconEl) iconEl.className = 'fa-solid fa-xmark';
    activeCronEdit = id;
    // 让展开面板整体进入可视区：滚动到面板顶部对齐容器顶部，确保标题与字段都不被遮挡
    setTimeout(() => {
      const scrollBox = editEl.closest('.list-container') || editEl.parentElement;
      const listTop = scrollBox.getBoundingClientRect().top;
      const card = editEl.closest('.row-card, .cron-col-card');
      if (card) {
        const cardTop = card.getBoundingClientRect().top;
        scrollBox.scrollTop += (cardTop - listTop - 12);
      } else {
        editEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);
  }
}

function applyCronPreset(id, expr, desc, btn) {
  const parts = expr.split(' ');
  ['Min', 'Hour', 'Dom', 'Mon', 'Dow'].forEach((f, i) => {
    const el = document.getElementById('cron' + f + '_' + id);
    if (el) el.value = parts[i];
  });
  const codeEl = document.getElementById('cronExprCode_' + id);
  if (codeEl) codeEl.textContent = expr;
  const descEl = document.getElementById('cronExprDescText_' + id);
  if (descEl) descEl.textContent = desc;
  const row = document.getElementById('cronPresets_' + id);
  if (row) row.querySelectorAll('.cron-preset-chip').forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function updateCronExpr(id) {
  const getF = fid => (document.getElementById(fid) || {}).value || '*';
  const expr = [getF('cronMin_' + id), getF('cronHour_' + id), getF('cronDom_' + id), getF('cronMon_' + id), getF('cronDow_' + id)].join(' ');
  const codeEl = document.getElementById('cronExprCode_' + id);
  if (codeEl) codeEl.textContent = expr;
  const descEl = document.getElementById('cronExprDescText_' + id);
  if (descEl) descEl.textContent = parseCronExpr(expr);
}

function cancelCronEdit(id) {
  const editEl = document.getElementById('cronEdit_' + id);
  const iconEl = document.getElementById('cronEditIcon_' + id);
  if (editEl) editEl.classList.remove('open');
  if (iconEl) iconEl.className = 'fa-solid fa-pen';
  activeCronEdit = null;
  showToast(t('toast.editCanceled'), '#888', 'fa-xmark');
}

function saveCronEdit(id) {
  const j = cronData.find(x => x.id === id);
  if (!j) return;
  const getF = fid => (document.getElementById(fid) || {}).value || '';
  j.expr = [getF('cronMin_' + id), getF('cronHour_' + id), getF('cronDom_' + id), getF('cronMon_' + id), getF('cronDow_' + id)].join(' ');
  j.cmd = getF('cronCmd_' + id);
  j.desc = getF('cronDesc_' + id);
  activeCronEdit = null;
  renderCron();
  showToast(t('toast.cronSaved'), '#4ade80', 'fa-check');
}

function deleteCronJob(id) {
  const idx = cronData.findIndex(x => x.id === id);
  if (idx > -1) cronData.splice(idx, 1);
  renderCron();
  showToast(t('toast.cronDeleted'), '#f87171', 'fa-trash-can');
}

function toggleCronJob(id, chk) {
  const j = cronData.find(x => x.id === id);
  if (j) {
    j.enabled = chk.checked;
    renderCron(); // 状态点是卡片内唯一状态指示，需随开关即时刷新
    updateCronStats();
    showToast(chk.checked ? t('toast.cronEnabled') : t('toast.cronDisabled'), chk.checked ? '#4ade80' : '#8888aa', chk.checked ? 'fa-check' : 'fa-ban');
  }
}

// ════════ Cron 日志记录 ════════
// 机制：任务开启「记录日志」后，stdout/stderr 收敛到固定日志文件；保留 3 天（可配），超出自动清理。
function cronLogPath(id) {
  return `~/Library/Logs/BeCrafter-Launcher/cron/${id}.log`;
}

// 日志开关（即时生效；仅局部同步详情面板，不整表重渲染——避免关闭当前编辑面板）
function toggleCronLog(id, chk) {
  const j = cronData.find(x => x.id === id);
  if (!j) return;
  j.log = !!chk.checked;
  const exp = document.getElementById('exp_cron_' + id);
  if (exp) {
    const logBlock = exp.querySelector('.cron-log-block');
    const val = logBlock && logBlock.querySelector('.expand-val');
    if (val) val.textContent = j.log ? cronLogPath(id) : t('cron.log.no');
    const logRow = logBlock && logBlock.querySelector('.cron-log-row');
    if (logRow) logRow.style.display = j.log ? 'flex' : 'none'; // 与开关强联动：停用时不展示提示与操作
    exp.querySelectorAll('.cron-log-row button').forEach(b => { b.disabled = !j.log; });
  }
  showToast(j.log ? t('toast.cronLogOn') : t('toast.cronLogOff'), j.log ? '#4ade80' : '#8888aa', 'fa-scroll');
}

// 模拟日志内容（最近 3 天窗口，含正确/正确重试/错误/告警，类型着色）
function cronLogLines(j) {
  const day = 86400000;
  const now = Date.now();
  const ts = (offset) => new Date(now - offset).toISOString().slice(0, 19).replace('T', ' ');
  const cmdBase = j.cmd.split('/').pop();
  return [
    [ts(2 * day + 3600000), 'info', `[INFO] cron registered: ${j.expr} → ${j.cmd}`],
    [ts(2 * day + 1790000), 'ok', `[OK] run started (pid ${1000 + (j.id.charCodeAt(1) || 65) * 7})`],
    [ts(2 * day + 1780000), 'ok', `[OK] run finished in 8.3s, exit 0`],
    [ts(day + 3600000), 'info', `[INFO] scheduled trigger matched (${j.expr})`],
    [ts(day + 3000000), 'warn', `[WARN] retry #1 — transient failure, re-running`],
    [ts(day + 2990000), 'ok', `[OK] retry succeeded: ${cmdBase}`],
    [ts(day / 2), 'info', `[INFO] heartbeat: cron dispatch alive`],
    [ts(3600000), 'ok', `[OK] last run completed successfully (exit 0)`],
    [ts(600000), 'err', `[ERR] stderr: permission denied on /var/tmp/${cmdBase}.tmp`],
    [ts(300000), 'warn', `[WARN] stdout: 3 lines truncated (retention window)`],
    [ts(0), 'info', `[INFO] log tail — retained; older than ${t('settings.launchd.cronLogRetain.3d')} auto-cleaned`]
  ];
}

// 查看日志（console 弹窗）
function showCronLog(id) {
  const j = cronData.find(x => x.id === id);
  if (!j) return;
  document.getElementById('cronLogPath').textContent = cronLogPath(id);
  const body = document.getElementById('cronLogBody');
  body.innerHTML = cronLogLines(j).map(([ts, type, text]) =>
    `<div class="log-line"><span class="log-ts">${ts}</span><span class="log-txt ${type}">${text}</span></div>`
  ).join('');
  openModal('cronLogModal');
}
