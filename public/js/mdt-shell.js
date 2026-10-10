/**
 * MDT File 外壳行为：Toast、全局公告关闭、复制反馈、抽屉。
 * 全部走事件委托，静态产物（后台）与 SSR 页面可共用。
 */
(() => {
  const stack = document.getElementById('mdt-toast-stack');

  const dismiss = (toast) => {
    if (!toast) return;
    toast.hidden = true;
    toast.remove();
  };

  window.mdtToast = (message, type = 'info', timeout = 3200) => {
    if (!stack || !message) return null;
    const toast = document.createElement('div');
    toast.className = 'mdt-toast';
    toast.dataset.type = type;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const text = document.createElement('span');
    // 用 textContent 而非 innerHTML：提示文案里可能含用户输入
    text.textContent = String(message);
    toast.appendChild(text);
    stack.appendChild(toast);
    window.setTimeout(() => dismiss(toast), timeout);
    return toast;
  };

  // 公告关闭：只记 localStorage，不写服务端（同一浏览器不再打扰）
  const DISMISS_KEY = 'mdt-dismissed-notices';
  const readDismissed = () => {
    try {
      const value = JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]');
      return Array.isArray(value) ? value.map(String) : [];
    } catch {
      return [];
    }
  };
  const writeDismissed = (list) => {
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(list.slice(-80)));
    } catch { /* 隐私模式下可能不可写 */ }
  };

  const hideDismissed = () => {
    const dismissed = readDismissed();
    if (!dismissed.length) return;
    document.querySelectorAll('[data-notice-id]').forEach((banner) => {
      if (dismissed.includes(String(banner.dataset.noticeId))) banner.remove();
    });
  };

  hideDismissed();

  document.addEventListener('click', (event) => {
    const closeButton = event.target.closest('[data-dismiss-notice]');
    if (closeButton) {
      const id = String(closeButton.dataset.dismissNotice);
      const banner = closeButton.closest('[data-notice-id]');
      if (banner) banner.remove();
      writeDismissed([...readDismissed(), id]);
      return;
    }

    const copyButton = event.target.closest('[data-copy-text]');
    if (copyButton) {
      const value = copyButton.dataset.copyText || '';
      const done = () => window.mdtToast(copyButton.dataset.copyToast || '已复制', 'success', 2000);
      const copy = async () => {
        if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
        const input = document.createElement('textarea');
        input.value = value;
        input.setAttribute('readonly', '');
        input.className = 'clipboard-fallback';
        document.body.appendChild(input);
        input.select();
        const ok = document.execCommand('copy');
        input.remove();
        if (!ok) throw new Error('copy unavailable');
        return undefined;
      };
      copy().then(done).catch(() => window.mdtToast('复制失败', 'error', 2600));
      return;
    }

    // 移动端抽屉：点击导航项后自动收起
    const navLink = event.target.closest('.mdt-sidebar a');
    const drawer = document.getElementById('mdt-drawer');
    if (navLink && drawer) drawer.checked = false;
  });

  /**
   * 顶部服务状态：60 秒一次、且只在页面可见时刷新。
   * 状态页（/status）自己带 30 秒轮询，这里跳过以免同一页面两次请求。
   */
  const pill = document.getElementById('mdt-status-pill');
  if (pill && !document.getElementById('mdt-service-grid')) {
    const sync = async () => {
      try {
        const response = await fetch('/api/v1/status', { headers: { Accept: 'application/json' } });
        if (!response.ok) return;
        const payload = await response.json();
        const data = payload.data || payload;
        if (!data.status) return;
        pill.dataset.status = data.status;
        const label = pill.querySelector('[data-status-label]');
        if (label) label.textContent = data.status_short || '服务状态';
      } catch { /* 网络抖动时保留上一次结果 */ }
    };
    window.setInterval(() => {
      if (document.visibilityState === 'visible') sync();
    }, 60000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') sync();
    });
  }
})();
