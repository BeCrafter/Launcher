// ════════ 提权交互（ElevationService）════════
// 非用户所属权限内容的操作（系统级 plist / /etc/crontab / launchctl 特权域）统一流程：
// 权限判定 → [危险二次确认 confirmDangerous] → 凭证缓存窗口(authCacheMin)内静默 /
// 提权模态（osascript 模拟）→ 执行反馈（取消 -128 不残留、密码错误可重试）。
// demo 为模拟实现：密码非空即授权；缓存窗口免弹窗；与设计阶段 1 的提权路径验收对齐。
const ELEVATION = {
  pending: false,
  cachedUntil: 0,

  // 请求提权：返回 Promise<boolean>（true=已授权可执行）
  async request({ title = t('elev.title'), detail, command }) {
    if (this.pending) return false;
    const cacheMin = parseInt(localStorage.getItem('launcher_authCacheMin') || '5', 10);
    if (cacheMin > 0 && Date.now() < this.cachedUntil) {
      showToast(t('toast.elevationCached'), '#4ade80', 'fa-shield-halved');
      return true;
    }
    this.pending = true;
    return new Promise(resolve => {
      document.getElementById('elevDetail').textContent = detail;
      document.getElementById('elevCmd').textContent = command;
      const err = document.getElementById('elevError');
      err.style.display = 'none';
      const pwd = document.getElementById('elevPwd');
      pwd.value = '';
      openModal('elevationModal');
      const cancel = () => {
        closeModal('elevationModal');
        this.pending = false;
        showToast(t('toast.elevationCancelled'), '#8888aa', 'fa-xmark');
        resolve(false);
      };
      document.getElementById('elevCancel').onclick = cancel;
      document.getElementById('elevGrant').onclick = () => {
        if (!pwd.value.trim()) {
          err.style.display = 'block';
          pwd.focus();
          return;
        }
        closeModal('elevationModal');
        // 模拟提权执行（异步防重复；成功回写缓存窗口）
        setTimeout(() => {
          this.cachedUntil = cacheMin > 0 ? Date.now() + cacheMin * 60000 : 0;
          this.pending = false;
          showToast(t('toast.elevationGranted'), '#4ade80', 'fa-shield-halved');
          resolve(true);
        }, 400);
      };
      pwd.onkeydown = (e) => { if (e.key === 'Enter') document.getElementById('elevGrant').click(); };
      setTimeout(() => pwd.focus(), 80);
    });
  }
};

// 危险操作二次确认（confirmDangerous 设置关闭时直接通过）
function confirmDangerousAction({ title = t('dgr.title'), detail }) {
  if (localStorage.getItem('launcher_confirmDangerous') === 'false') return Promise.resolve(true);
  return new Promise(resolve => {
    document.getElementById('dgrTitle').textContent = title;
    document.getElementById('dgrDetail').textContent = detail;
    openModal('dangerModal');
    document.getElementById('dgrOk').onclick = () => { closeModal('dangerModal'); resolve(true); };
    document.getElementById('dgrCancel').onclick = () => { closeModal('dangerModal'); resolve(false); };
  });
}
