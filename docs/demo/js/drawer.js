// ════════ 抽屉编辑器 ════════
// ════════ 操作栏状态 ════════
const drawerAgentState = MOCK_DATA.drawer.opsState;


// ════════ 抽屉编辑器 ════════
function openEditFloat(id, e) {
  e && e.stopPropagation();
  const a = agentData.find(x => x.id === id);
  if (!a) return;
  selectAgent(id);
  const scopeMap = {
    user: '用户级 · ~/Library/LaunchAgents',
    system: '全局 · /Library/LaunchAgents',
    daemon: '系统 · /Library/LaunchDaemons'
  };
  document.getElementById('efLabel').textContent = a.label;
  document.getElementById('efScope').textContent = scopeMap[a.scope] || a.scope;
  const setVal = (fid, v) => {
    const el = document.getElementById(fid);
    if (el) el.value = v;
  };
  setVal('ef_label', a.label);
  setVal('ef_desc', a.desc);
  setVal('ef_program', a.program || '');
  switchDrawerTab('edit', document.querySelector('#editDrawer .drawer-nav-btn'));
  drawerAgentState.loaded = a.status !== 'stopped' || !!a.pid;
  drawerAgentState.enabled = !a.disabled;
  drawerAgentState.running = a.status === 'running';
  updateOpsBar();
  openModal('editAgentFloat');
}

function closeDrawerMask(e) {
  if (e && e.target.id === 'editAgentFloat') closeModal('editAgentFloat');
}
function updateOpsBar() {
  const s = drawerAgentState;
  const btnLoad = document.getElementById('opsBtnLoad');
  const btnLoadLbl = document.getElementById('opsBtnLoadLabel');
  const btnEnable = document.getElementById('opsBtnEnable');
  const btnEnableLbl = document.getElementById('opsBtnEnableLabel');
  const btnEnableIcon = document.getElementById('opsEnableIcon');
  const btnKick = document.getElementById('opsBtnKickstart');
  const chip = document.getElementById('opsStateChip');
  const dot = document.getElementById('opsStateDot');
  const lbl = document.getElementById('opsStateLabel');
  if (!btnLoad) return;
  if (s.loaded) {
    btnLoad.className = 'hdr-ops-btn active-blue';
    btnLoad.querySelector('i').className = 'fa-solid fa-plug-circle-xmark';
    btnLoadLbl.textContent = t('drawer.op.unload');
  } else {
    btnLoad.className = 'hdr-ops-btn active-green';
    btnLoad.querySelector('i').className = 'fa-solid fa-plug';
    btnLoadLbl.textContent = t('drawer.op.load');
  }
  btnEnable.disabled = !s.loaded;
  btnKick.disabled = !s.loaded;
  if (s.loaded && s.enabled) {
    btnEnable.className = 'hdr-ops-btn active-yellow';
    btnEnableIcon.className = 'fa-solid fa-circle-pause';
    btnEnableLbl.textContent = t('drawer.op.disable');
  } else {
    btnEnable.className = 'hdr-ops-btn active-accent';
    btnEnableIcon.className = 'fa-solid fa-circle-check';
    btnEnableLbl.textContent = t('drawer.op.enable');
  }
  if (!s.loaded) {
    dot.className = 'hdr-state-dot unloaded';
    lbl.textContent = t('drawer.state.unloaded');
    chip.style.color = 'var(--dim)';
  } else if (!s.enabled) {
    dot.className = 'hdr-state-dot stopped';
    lbl.textContent = t('drawer.state.stopped');
    chip.style.color = 'var(--yellow)';
  } else if (s.running) {
    dot.className = 'hdr-state-dot running';
    lbl.textContent = t('status.running');
    chip.style.color = 'var(--green)';
  } else {
    dot.className = 'hdr-state-dot loaded';
    lbl.textContent = t('drawer.state.ready');
    chip.style.color = 'var(--accent2)';
  }
}

function drawerOpsAction(action) {
  const s = drawerAgentState;
  if (action === 'load') {
    if (s.loaded) {
      s.loaded = false;
      s.running = false;
      showToast(t('toast.bootoutSuccess'), '#60a5fa', 'fa-plug-circle-xmark');
      addLogLine('info', '[INFO] bootout: task unloaded.');
    } else {
      s.loaded = true;
      s.enabled = true;
      s.running = false;
      showToast(t('toast.bootstrapSuccess'), '#4ade80', 'fa-plug');
      addLogLine('ok', '[OK] bootstrap: task loaded.');
    }
  } else if (action === 'enable') {
    if (!s.loaded) {
      showToast(t('toast.loadFirst'), '#fbbf24', 'fa-circle-exclamation');
      return;
    }
    if (s.enabled) {
      s.enabled = false;
      s.running = false;
      showToast(t('toast.taskDisabled'), '#fbbf24', 'fa-circle-pause');
      addLogLine('warn', '[WARN] disabled: Disabled=true.');
    } else {
      s.enabled = true;
      showToast(t('toast.taskEnabled'), '#4ade80', 'fa-circle-check');
      addLogLine('ok', '[OK] enabled.');
    }
  } else if (action === 'kickstart') {
    if (!s.loaded) {
      showToast(t('toast.notLoaded'), '#fbbf24', 'fa-circle-exclamation');
      return;
    }
    s.running = true;
    showToast(t('toast.kickstarting'), '#a78bfa', 'fa-bolt');
    addLogLine('info', '[INFO] kickstart: forcing immediate run…');
    setTimeout(() => addLogLine('ok', '[OK] kickstart: started. PID=' + (Math.floor(Math.random() * 8000) + 2000)), 600);
  }
  updateOpsBar();
}

function switchDrawerTab(name, btn) {
  document.querySelectorAll('.drawer-section').forEach(s => s.classList.remove('active'));
  const target = document.getElementById('dft-' + name);
  if (target) target.classList.add('active');
  document.querySelectorAll('.drawer-nav-btn').forEach(b => b.classList.remove('active'));
  if (!btn || !btn.classList) {
    document.querySelectorAll('.drawer-nav-btn').forEach(b => {
      if (b.getAttribute('data-tab') === name) b.classList.add('active');
    });
  } else {
    btn.classList.add('active');
  }
}

function efToggleTrig(cardId, chk) {
  const card = document.getElementById(cardId);
  if (card) card.classList.toggle('on', chk.checked);
}

function efToggleSection(secId, show) {
  const el = document.getElementById(secId);
  if (el) el.style.display = show ? '' : 'none';
  if (show && secId === 'ef_cronArea') {
    sciRefreshAll();
    sciRefreshPlistPreview();
  }
}

function efSetKaMode(mode) {
  const boolBtn = document.getElementById('ef_ka_bool');
  const dictBtn = document.getElementById('ef_ka_dict');
  const dictArea = document.getElementById('ef_kaDictArea');
  if (mode === 'bool') {
    boolBtn.classList.add('active');
    dictBtn.classList.remove('active');
    if (dictArea) dictArea.style.display = 'none';
  } else {
    dictBtn.classList.add('active');
    boolBtn.classList.remove('active');
    if (dictArea) dictArea.style.display = '';
  }
}

function saveFloatAgent() {
  closeModal('editAgentFloat');
  showToast(t('toast.configSavedReload'), '#4ade80', 'fa-check');
  addLogLine('ok', '[OK] Config saved. Reloading…');
}
function addArgTo(listId) {
  const list = document.getElementById(listId);
  if (!list) return;
  const btn = list.querySelector('.add-row-btn');
  const row = document.createElement('div');
  row.className = 'mv-row';
  const idx = list.querySelectorAll('.mv-row').length;
  row.innerHTML = `<span class="mv-idx">[${idx}]</span><input class="f-input mono" type="text" placeholder="--参数" /><button class="mv-del" onclick="delMvRow(this)"><i class="fa-solid fa-xmark"></i></button>`;
  list.insertBefore(row, btn);
  row.querySelector('input').focus();
}

function addEnvTo(listId) {
  const list = document.getElementById(listId);
  if (!list) return;
  const btn = list.querySelector('.add-row-btn');
  const row = document.createElement('div');
  row.className = 'kv-row';
  row.innerHTML = `<input class="f-input mono" type="text" placeholder="KEY" style="max-width:110px;font-size:10.5px;"/><span class="kv-eq">=</span><input class="f-input mono" type="text" placeholder="VALUE" style="font-size:10.5px;"/><button class="mv-del" onclick="this.closest('.kv-row').remove()"><i class="fa-solid fa-xmark"></i></button>`;
  list.insertBefore(row, btn);
  row.querySelector('input').focus();
}

function addWatchTo(listId) {
  const list = document.getElementById(listId);
  if (!list) return;
  const btn = list.querySelector('.add-row-btn');
  const row = document.createElement('div');
  row.className = 'mv-row';
  row.innerHTML = `<span class="mv-idx">•</span><input class="f-input mono" type="text" placeholder="/path/to/watch" /><button class="mv-del" onclick="delMvRow(this)"><i class="fa-solid fa-xmark"></i></button>`;
  list.insertBefore(row, btn);
  row.querySelector('input').focus();
}

function sciAddEntry(preset) {
  const c = document.getElementById('ef_sciEntries');
  if (!c) return;
  const entry = document.createElement('div');
  entry.className = 'sci-entry';
  entry.style.cssText = 'display:flex;flex-direction:column;gap:7px;padding:9px 10px;background:rgba(255,255,255,0.025);border:1px solid var(--border);border-radius:8px;';
  const p = preset || {};
  const wdList = [];
  for (let wd = 0; wd < 7; wd++) wdList.push({ v: String(wd), l: t('cron.wd.' + wd) });
  const wdOptions = wdList.map(item => {
    const sel = (p.Weekday !== undefined && String(p.Weekday) === item.v) ? 'selected' : '';
    return `<option value="${item.v}" ${sel}>${item.l}</option>`;
  }).join('');
  const moOptions = ['*'].concat(Array.from({ length: 12 }, (_, i) => t('cron.mo.' + (i + 1)))).map((l, i) => {
    const v = i === 0 ? '' : String(i);
    const sel = (p.Month !== undefined && String(p.Month) === v) ? 'selected' : '';
    return `<option value="${v}" ${sel}>${l}</option>`;
  }).join('');
  entry.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(5, 1fr) 30px;gap:8px;align-items:center;">
      <div><input type="number" class="f-input" placeholder="*" min="0" max="59" ${p.Minute!==undefined?'value="'+p.Minute+'"':''} style="width:100%;font-family:'SF Mono',Menlo,monospace;font-size:12px;font-weight:600;text-align:center;padding:7px 4px;border-radius:6px;" title="Minute (0-59)" oninput="sciUpdatePreview(this.closest('.sci-entry'))" /></div>
      <div><input type="number" class="f-input" placeholder="*" min="0" max="23" ${p.Hour!==undefined?'value="'+p.Hour+'"':''} style="width:100%;font-family:'SF Mono',Menlo,monospace;font-size:12px;font-weight:600;text-align:center;padding:7px 4px;border-radius:6px;" title="Hour (0-23)" oninput="sciUpdatePreview(this.closest('.sci-entry'))" /></div>
      <div><input type="number" class="f-input" placeholder="*" min="1" max="31" ${p.Day!==undefined?'value="'+p.Day+'"':''} style="width:100%;font-family:'SF Mono',Menlo,monospace;font-size:12px;font-weight:600;text-align:center;padding:7px 4px;border-radius:6px;" title="Day of Month (1-31)" oninput="sciUpdatePreview(this.closest('.sci-entry'))" /></div>
      <div><select class="f-input" style="width:100%;font-size:12px;font-weight:500;padding:7px 4px;text-align:center;border-radius:6px;text-align-last:center;cursor:pointer;" title="Weekday (0=Sunday)" onchange="sciUpdatePreview(this.closest('.sci-entry'))">${wdOptions}</select></div>
      <div><select class="f-input" style="width:100%;font-size:12px;font-weight:500;padding:7px 4px;text-align:center;border-radius:6px;text-align-last:center;cursor:pointer;" title="Month (1-12)" onchange="sciUpdatePreview(this.closest('.sci-entry'))">${moOptions}</select></div>
      <button class="mv-del" style="width:30px;height:30px;border-radius:6px;display:flex;align-items:center;justify-content:center;margin:0 auto;" title="${t('sci.deleteRule')}" onclick="this.closest('.sci-entry').remove();sciRefreshAll()"><i class="fa-solid fa-xmark" style="font-size:11px;"></i></button>
    </div>
    <div class="sci-preview" style="display:flex;align-items:center;gap:6px;padding:5px 9px;background:rgba(34,211,238,0.06);border:1px solid rgba(34,211,238,0.18);border-radius:6px;">
      <i class="fa-regular fa-clock" style="font-size:10px;color:var(--cyan);flex-shrink:0;"></i>
      <span style="font-size:11px;color:var(--cyan);font-weight:600;" class="sci-preview-text"></span>
      <span style="font-size:10px;color:var(--dim);margin-left:auto;font-family:'SF Mono',Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:210px;" class="sci-plist-text"></span>
    </div>`;
  c.appendChild(entry);
  sciUpdatePreview(entry);
  sciRefreshPlistPreview();
  entry.scrollIntoView({
    behavior: 'smooth',
    block: 'nearest'
  });
}

function sciInsertPreset(preset, label) {
  sciAddEntry(preset);
  showToast(t('toast.insertedPreset') + ' ' + label, '#fbbf24', 'fa-clock');
}

function sciGetEntryData(entry) {
  const inputs = entry.querySelectorAll('input[type="number"]');
  const selects = entry.querySelectorAll('select');
  const minVal = inputs[0] && inputs[0].value !== '' ? parseInt(inputs[0].value) : null;
  const hourVal = inputs[1] && inputs[1].value !== '' ? parseInt(inputs[1].value) : null;
  const dayVal = inputs[2] && inputs[2].value !== '' ? parseInt(inputs[2].value) : null;
  const wdVal = selects[0] && selects[0].value !== '' ? parseInt(selects[0].value) : null;
  const moVal = selects[1] && selects[1].value !== '' ? parseInt(selects[1].value) : null;
  return {
    Minute: minVal,
    Hour: hourVal,
    Day: dayVal,
    Weekday: wdVal,
    Month: moVal
  };
}

function sciDescribe(d) {
  const isEn = currentLang === 'en-US';
  const pad = v => String(v).padStart(2, '0');
  const wk = () => (d.Weekday !== null ? t('cron.wd.' + d.Weekday) : null);
  const mo = () => (d.Month !== null ? t('cron.mo.' + d.Month) : null);
  const dy = () => (d.Day !== null ? (isEn ? d.Day : d.Day + '日') : null);
  const hm = () => (d.Hour !== null ? pad(d.Hour) : '**') + ':' + (d.Minute !== null ? pad(d.Minute) : '**');
  // 无日期维度：纯时间 / 间隔描述
  if (d.Month === null && d.Day === null && d.Weekday === null) {
    if (d.Hour !== null && d.Minute !== null) return fmt(t('sci.describe.daily'), { T: hm() });
    if (d.Hour !== null) return fmt(t('sci.describe.hourOfDay'), { H: d.Hour });
    if (d.Minute !== null) return fmt(t('sci.describe.minEachHour'), { M: d.Minute });
    return t('sci.describe.everyMinute');
  }
  // 含日期维度：zh 语序 月份 日期 星期（与旧输出一致）；en 用 at 表达时刻
  const parts = isEn ? [wk(), mo(), dy()] : [mo(), dy(), wk()];
  const head = parts.filter(Boolean).join(' ');
  if (isEn) return head + ' ' + fmt(t('sci.describe.at'), { T: hm() });
  return head + ' ' + hm() + ' ' + t('sci.describe.trigger');
}

function sciPlistFragment(d) {
  const keys = [];
  if (d.Minute !== null) keys.push('Minute=' + d.Minute);
  if (d.Hour !== null) keys.push('Hour=' + d.Hour);
  if (d.Day !== null) keys.push('Day=' + d.Day);
  if (d.Weekday !== null) keys.push('Weekday=' + d.Weekday);
  if (d.Month !== null) keys.push('Month=' + d.Month);
  return keys.length ? '<dict> ' + keys.join(' ') + ' </dict>' : '<dict/> /* ' + t('sci.plist.wildcard') + ' */';
}

function sciUpdatePreview(entry) {
  if (!entry) return;
  const d = sciGetEntryData(entry);
  const prevText = entry.querySelector('.sci-preview-text');
  const plistText = entry.querySelector('.sci-plist-text');
  if (prevText) prevText.textContent = sciDescribe(d);
  if (plistText) plistText.textContent = sciPlistFragment(d);
  sciRefreshPlistPreview();
}

function sciRefreshAll() {
  const c = document.getElementById('ef_sciEntries');
  if (!c) return;
  c.querySelectorAll('.sci-entry').forEach(e => sciUpdatePreview(e));
}

function sciRefreshPlistPreview() {
  const c = document.getElementById('ef_sciEntries');
  const pre = document.getElementById('ef_sciPlistPreview');
  if (!c || !pre) return;
  const entries = c.querySelectorAll('.sci-entry');
  if (entries.length === 0) {
    pre.textContent = '<!-- ' + t('sci.plist.noRules') + ' -->';
    return;
  }
  const wdNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const buildDict = d => {
    let s = '    <dict>\n';
    if (d.Minute !== null) s += `      <key>Minute</key><integer>${d.Minute}</integer>\n`;
    if (d.Hour !== null) s += `      <key>Hour</key><integer>${d.Hour}</integer>\n`;
    if (d.Day !== null) s += `      <key>Day</key><integer>${d.Day}</integer>\n`;
    if (d.Weekday !== null) s += `      <key>Weekday</key><integer>${d.Weekday}</integer>\n`;
    if (d.Month !== null) s += `      <key>Month</key><integer>${d.Month}</integer>\n`;
    s += '    </dict>';
    return s;
  };
  let xml = '<key>StartCalendarInterval</key>\n';
  if (entries.length === 1) {
    const d = sciGetEntryData(entries[0]);
    xml += buildDict(d).trimStart().replace(/^    /, '');
  } else {
    xml += '<array>\n';
    entries.forEach(e => {
      xml += buildDict(sciGetEntryData(e)) + '\n';
    });
    xml += '</array>';
  }
  pre.textContent = xml;
}

function sciCopyPlist() {
  const pre = document.getElementById('ef_sciPlistPreview');
  if (!pre) return;
  navigator.clipboard && navigator.clipboard.writeText(pre.textContent).then(() => showToast(t('toast.plistFragmentCopied'), '#22d3ee', 'fa-copy'));
}

function addCronEntryTo(containerId) {
  sciAddEntry();
}

function delMvRow(btn) {
  btn.closest('.mv-row').remove();
}
function toggleCfg(hdr) {
  const body = hdr.nextElementSibling;
  const chev = hdr.querySelector('.cfg-chevron');
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'flex';
  if (chev) chev.classList.toggle('open', !isOpen);
}
// ════════ XML ════════
function validateXml() {
  showToast(t('toast.xmlValidated'), '#4ade80', 'fa-check-circle');
}

function copyXml() {
  const xml = document.getElementById('ef_xmlEditor').value;
  navigator.clipboard && navigator.clipboard.writeText(xml).then(() => showToast(t('toast.xmlCopied'), '#22d3ee', 'fa-copy'));
}
// ════════ 日志 ════════
function clearLog() {
  const body = document.getElementById('ef_logBody');
  if (body) body.innerHTML = `<div class="log-line"><span class="log-ts">${getTs()}</span><span class="log-txt" style="color:var(--dim);">日志已清空</span></div>`;
}

function addLogLine(type, text) {
  const body = document.getElementById('ef_logBody');
  if (!body) return;
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<span class="log-ts">${getTs()}</span><span class="log-txt ${type}">${text}</span>`;
  body.appendChild(line);
  body.scrollTop = body.scrollHeight;
}

function getTs() {
  return new Date().toTimeString().slice(0, 8);
}

// ════════ 抽屉初始值填充（编辑表单/状态/日志/XML 均来自 MOCK_DATA，页面不再写死样例）════════
function populateDrawerDefaults() {
  const d = MOCK_DATA.drawer;
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  const setChecked = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
  // 顶部标题
  setText('efLabel', d.title);
  setText('efScope', d.scope);
  // § 标识
  setVal('ef_label', d.form.label);
  setVal('ef_desc', d.form.desc);
  setVal('ef_processType', d.form.processType);
  // § 执行
  setVal('ef_program', d.form.program);
  const buildArgs = (listId) => {
    const list = document.getElementById(listId);
    if (!list) return;
    const btn = list.querySelector('.add-row-btn');
    d.form.args.forEach((v, i) => {
      const row = document.createElement('div');
      row.className = 'mv-row';
      row.innerHTML = `<span class="mv-idx">[${i}]</span><input class="f-input mono" type="text" value="${v}" /><button class="mv-del" onclick="delMvRow(this)"><i class="fa-solid fa-xmark"></i></button>`;
      list.insertBefore(row, btn);
    });
  };
  buildArgs('ef_argsList');
  setVal('ef_workdir', d.form.workingDir);
  setVal('ef_nice', d.form.nice);
  setVal('ef_throttle', d.form.throttleInterval);
  const envList = document.getElementById('ef_envList');
  if (envList) {
    const btn = envList.querySelector('.add-row-btn');
    Object.entries(d.form.env).forEach(([k, v]) => {
      const row = document.createElement('div');
      row.className = 'kv-row';
      row.innerHTML = `<input class="f-input mono" type="text" value="${k}" style="max-width:110px;font-size:10.5px;" /><span class="kv-eq">=</span><input class="f-input mono" type="text" value="${v}" style="font-size:10.5px;" /><button class="mv-del" onclick="this.closest('.kv-row').remove()"><i class="fa-solid fa-xmark"></i></button>`;
      envList.insertBefore(row, btn);
    });
  }
  // § 调度触发
  const trig = d.form.triggers;
  setChecked('efTrigRun', trig.runAtLoad);
  setChecked('efTrigKeep', trig.keepAlive);
  setChecked('efTrigWatch', trig.watchPaths);
  setChecked('efTrigCron', trig.startCalendarInterval);
  efToggleTrig('ef_trig_run', document.getElementById('efTrigRun'));
  efToggleTrig('ef_trig_keep', document.getElementById('efTrigKeep'));
  efToggleTrig('ef_trig_watch', document.getElementById('efTrigWatch'));
  efToggleTrig('ef_trig_cron', document.getElementById('efTrigCron'));
  efToggleSection('ef_keepAliveArea', trig.keepAlive);
  efToggleSection('ef_watchArea', trig.watchPaths);
  efToggleSection('ef_cronArea', trig.startCalendarInterval);
  setVal('ef_interval', trig.startInterval);
  efSetKaMode(d.form.keepAliveMode);
  setChecked('efKaCrashed', d.form.keepAliveDict.crashed);
  setChecked('efKaAfter', d.form.keepAliveDict.afterInitialDemand);
  setChecked('efKaSuccess', d.form.keepAliveDict.successfulExit);
  const watchList = document.getElementById('ef_watchPaths');
  if (watchList) {
    const btn = watchList.querySelector('.add-row-btn');
    d.form.watchPaths.forEach(v => {
      const row = document.createElement('div');
      row.className = 'mv-row';
      row.innerHTML = `<span class="mv-idx">•</span><input class="f-input mono" type="text" value="${v}" /><button class="mv-del" onclick="delMvRow(this)"><i class="fa-solid fa-xmark"></i></button>`;
      watchList.insertBefore(row, btn);
    });
  }
  // § I/O 路径
  setVal('ef_stdout', d.form.stdout);
  setVal('ef_stderr', d.form.stderr);
  // 状态 tab
  const dot = document.getElementById('stStateDot');
  if (dot) dot.className = 'status-dot ' + d.status.state;
  setText('stPid', d.status.pid);
  setText('stUptime', d.status.uptime);
  setText('stCpu', d.status.cpu);
  setText('stMem', d.status.mem);
  setText('stExit', d.status.exitCode);
  setText('stRestarts', d.status.restarts);
  setText('stStart', d.status.startTime);
  setText('stPlistPath', d.status.plistPath);
  setText('stWorkDir', d.status.workDir);
  setText('stScope', d.status.scope);
  const cpuFill = document.getElementById('stCpuFill');
  if (cpuFill) cpuFill.style.width = d.status.cpuWidth;
  const memFill = document.getElementById('stMemFill');
  if (memFill) memFill.style.width = d.status.memWidth;
  // 日志 tab
  const logBody = document.getElementById('ef_logBody');
  if (logBody) {
    logBody.innerHTML = '';
    d.logLines.forEach(([ts, type, text]) => {
      const line = document.createElement('div');
      line.className = 'log-line';
      line.innerHTML = `<span class="log-ts">${ts}</span><span class="log-txt ${type}">${text}</span>`;
      logBody.appendChild(line);
    });
  }
  // 定时触发规则（生成条目并同步预览；与页面静态版一致：日期/星期/月份保持通配）
  const sciC = document.getElementById('ef_sciEntries');
  if (sciC) {
    sciC.innerHTML = '';
    d.form.sciEntries.forEach(e => {
      sciAddEntry(e);
      const entry = sciC.lastElementChild;
      if (entry) {
        entry.querySelectorAll('select').forEach(sel => { sel.value = ''; });
        sciUpdatePreview(entry);
      }
    });
    sciC.querySelectorAll('.sci-entry .sci-preview-text').forEach(el => el.setAttribute('data-i18n', 'sci.preview'));
  }
  // XML tab
  setVal('ef_xmlEditor', d.xml);
}
