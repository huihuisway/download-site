(() => {
  const tracking = document.querySelector('[data-download-tracking]');
  const appVersion = document.querySelector('meta[name="app-version"]')?.content || 'unknown';

  document.querySelectorAll('[data-track="download"]').forEach((link) => {
    link.addEventListener('click', () => {
      const fileId = link.dataset.fileId || tracking?.dataset.fileId;
      if (!fileId) return;
      const metadata = {
        fileId,
        client_name: link.dataset.clientName || tracking?.dataset.clientName || 'Mindustry Download Site',
        client_version: link.dataset.clientVersion || tracking?.dataset.clientVersion || appVersion,
        platform: link.dataset.platform || tracking?.dataset.platform || 'web',
      };
      try {
        fetch('/count-download', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(metadata),
          keepalive: true,
        }).catch(() => {});
      } catch { /* 统计失败不影响下载 */ }
      try {
        const url = new URL(link.href, window.location.href);
        url.searchParams.set('tracked', '1');
        link.href = url.toString();
      } catch { /* 下载仍可使用原链接 */ }
      if (typeof window.mdtToast === 'function') window.mdtToast('下载已开始', 'success', 2000);
    });
  });

  const fallbackCopy = (value) => {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.className = 'clipboard-fallback';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('copy failed');
  };

  // 复制反馈统一由 mdt-shell.js 的事件委托处理（含 Toast 与复制失败兜底）；
  // 这里只补旧主题的行内状态位（.sha-copy-status），避免同一按钮被两处处理、
  // 点一次弹两个 Toast。
  document.querySelectorAll('.sha-row [data-copy-text], .term-sha-row [data-copy-text]').forEach((button) => {
    if (button.dataset.copyHandled === '1') return;
    button.dataset.copyHandled = '1';
    button.addEventListener('click', async () => {
      const value = button.dataset.copyText || '';
      const row = button.closest('.sha-row, .term-sha-row');
      const status = row?.querySelector('.sha-copy-status');
      if (!status) return;
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
        else fallbackCopy(value);
        status.textContent = '已复制';
      } catch {
        try {
          fallbackCopy(value);
          status.textContent = '已复制';
        } catch {
          status.textContent = '复制失败';
        }
      }
      window.setTimeout(() => { status.textContent = ''; }, 1800);
    });
  });
})();
