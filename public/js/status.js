/**
 * 服务状态页：30 秒轮询 /api/v1/status（仅页面可见时），原地更新状态文本。
 * 不做每秒轮询，也不重建整页 DOM。
 */
(() => {
  const REFRESH_MS = 30000;
  const overall = document.getElementById('mdt-overall');
  const overallLabel = document.getElementById('mdt-overall-label');
  const overallTime = document.getElementById('mdt-overall-time');
  if (!overall || !overallLabel) return;

  const updatePill = (status, label) => {
    const pill = document.getElementById('mdt-status-pill');
    if (!pill) return;
    pill.dataset.status = status;
    const target = pill.querySelector('[data-status-label]');
    if (target) target.textContent = label;
  };

  const apply = (data) => {
    if (!data || !data.status) return;
    overall.dataset.status = data.status;
    overallLabel.textContent = data.status_label || '状态未知';
    if (overallTime && data.updated_at) {
      overallTime.textContent = data.updated_at.slice(11, 19);
      overallTime.setAttribute('datetime', data.updated_at);
    }
    updatePill(data.status, data.status_short || '服务状态');

    (data.services || []).forEach((service) => {
      const card = document.querySelector(`[data-service="${service.key}"]`);
      if (!card) return;
      const badge = card.querySelector('[data-service-status]');
      const detail = card.querySelector('[data-service-detail]');
      if (badge) {
        badge.className = `mdt-status mdt-status-${service.status}`;
        badge.textContent = service.status_label;
      }
      if (detail) detail.textContent = service.detail || '';
    });
  };

  let timer = null;
  const load = async () => {
    try {
      const response = await fetch('/api/v1/status', { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const payload = await response.json();
      apply(payload.data || payload);
    } catch { /* 网络抖动时保留上一次结果 */ }
  };

  const start = () => {
    if (timer) return;
    load();
    timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, REFRESH_MS);
  };

  start();

  // 页面重新可见时立刻补一次，避免切回标签页看到过期状态
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') load();
  });

  document.getElementById('mdt-overall-refresh')?.addEventListener('click', () => load());
})();
