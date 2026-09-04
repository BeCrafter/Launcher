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
    const main = `<div class="row-main">
        ${statusDot(j.enabled ? 'running' : 'stopped')}
        ${rowInfo({
          labelHtml: `<span style="font-family:monospace;font-size:11.5px;">${j.cmd}</span>`,
          subHtml: j.desc,
          tagsHtml: `${tagChip(j.system ? t('cron.tag.systemEtc') : t('cron.tag.user'), j.system ? 'red' : 'blue')}
            ${tagChip(j.expr, 'cyan', '', 'font-family:monospace;')}
            ${tagChip(cronDesc, 'green')}`
        })}
        <div class="row-actions" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;margin-right:2px;">
            <label class="toggle" title="${j.enabled?t('cron.disable'):t('cron.enable')}">
              <input type="checkbox" ${j.enabled?'checked':''} onchange="toggleCronJob('${j.id}',this)" />
              <div class="toggle-track"></div><div class="toggle-thumb"></div>
            </label>
          </div>
          ${actBtn('fa-solid fa-pen', { cls: 'accent', title: t('cron.edit'), onclick: `toggleCronEdit('${j.id}',event)`, iconId: 'cronEditIcon_' + j.id })}
          ${actBtn('fa-solid fa-trash-can', { cls: 'red', title: t('cron.delete'), onclick: `deleteCronJob('${j.id}')` })}
          ${actBtn('fa-solid fa-chevron-down row-chevron', { title: t('cron.expand'), onclick: `toggleRowExpand('cron_${j.id}',event)`, iconId: 'chev_cron_' + j.id })}
        </div>
      </div>`;
    const extra = `<div class="row-expand" id="exp_cron_${j.id}">
        <div class="expand-grid">
          <div class="expand-field"><div class="expand-key">${t('cron.exprLabel')}</div><div class="expand-val">${j.expr}</div></div>
          <div class="expand-field"><div class="expand-key">${t('cron.field.desc')}</div><div class="expand-val ok">${cronDesc}</div></div>
          <div class="expand-field"><div class="expand-key">${t('cron.field.user')}</div><div class="expand-val">${j.user}</div></div>
          <div class="expand-field"><div class="expand-key">${t('cron.field.source')}</div><div class="expand-val">${j.system?'/etc/crontab':'crontab -l'}</div></div>
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
        <div class="f-row center"><span class="f-lbl" style="width:60px;">${t('cron.field.desc')}</span><input class="f-input" type="text" id="cronDesc_${j.id}" value="${j.desc}" /></div>
        <div style="display:flex;justify-content:flex-end;gap:7px;margin-top:12px;">
          <button class="d-btn" onclick="cancelCronEdit('${j.id}')"><i class="fa-solid fa-xmark"></i> ${t('common.cancel')}</button>
          <button class="d-btn accent" onclick="saveCronEdit('${j.id}')"><i class="fa-solid fa-check"></i> ${t('common.save')}</button>
        </div>
      </div>`;
    html += rowCard({ id: 'croncard_' + j.id, main, extra });
  });
  c.innerHTML = html;
}

// ════════ Cron 内联编辑 ════════
let activeCronEdit = null;

function toggleCronEdit(id, e) {
  e && e.stopPropagation();
  const editEl = document.getElementById('cronEdit_' + id);
  const iconEl = document.getElementById('cronEditIcon_' + id);
  if (!editEl) return;
  const isOpen = editEl.classList.contains('open');
  if (activeCronEdit && activeCronEdit !== id) {
    const prev = document.getElementById('cronEdit_' + activeCronEdit);
    const prevIcon = document.getElementById('cronEditIcon_' + activeCronEdit);
    if (prev) prev.classList.remove('open');
    if (prevIcon) prevIcon.className = 'fa-solid fa-pen';
  }
  if (isOpen) {
    editEl.classList.remove('open');
    if (iconEl) iconEl.className = 'fa-solid fa-pen';
    activeCronEdit = null;
  } else {
    editEl.classList.add('open');
    if (iconEl) iconEl.className = 'fa-solid fa-xmark';
    activeCronEdit = id;
    // 让展开面板整体进入可视区：滚动到面板顶部对齐容器顶部，确保标题与字段都不被遮挡
    setTimeout(() => {
      const scrollBox = editEl.closest('.list-container') || editEl.parentElement;
      const listTop = scrollBox.getBoundingClientRect().top;
      const card = editEl.closest('.row-card');
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
    updateCronStats();
    showToast(chk.checked ? t('toast.cronEnabled') : t('toast.cronDisabled'), chk.checked ? '#4ade80' : '#8888aa', chk.checked ? 'fa-check' : 'fa-ban');
  }
}
