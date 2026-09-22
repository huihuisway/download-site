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

  document.querySelectorAll('[data-copy-text]').forEach((button) => {
    button.addEventListener('click', async () => {
      const value = button.dataset.copyText || '';
      const row = button.closest('.sha-row, .term-sha-row, .mindustry-asset-hash');
      const status = row?.querySelector('.sha-copy-status');
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
        else fallbackCopy(value);
        if (status) status.textContent = '已复制';
      } catch {
        try {
          fallbackCopy(value);
          if (status) status.textContent = '已复制';
        } catch {
          if (status) status.textContent = '复制失败';
        }
      }
      window.setTimeout(() => { if (status) status.textContent = ''; }, 1800);
    });
  });
})();
