(() => {
  const data = document.getElementById('mindustry-assets-data');
  const download = document.getElementById('mindustry-primary-download');
  if (!data || !download) return;

  let assets = [];
  try {
    assets = JSON.parse(data.textContent || '[]');
  } catch (error) {
    console.error('[mindustry] 无法读取页面版本数据:', error);
    return;
  }

  const buttons = [...document.querySelectorAll('.mindustry-platform-option')];
  const name = document.getElementById('mindustry-recommend-name');
  const meta = document.getElementById('mindustry-recommend-meta');
  const status = document.getElementById('mindustry-device-status');
  const stickyDownload = document.getElementById('mindustry-sticky-download');
  const stickyName = document.getElementById('mindustry-sticky-name');
  const stickyMeta = document.getElementById('mindustry-sticky-meta');
  const versionSearch = document.getElementById('mindustry-version-search');
  const versionRows = [...document.querySelectorAll('.mindustry-version-row')];
  const versionEmpty = document.getElementById('mindustry-version-empty');
  const versionTabs = [...document.querySelectorAll('.mindustry-version-tab')];
  const formatSize = (bytes) => {
    if (!bytes) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
  };

  const selectAsset = (index, message) => {
    const asset = assets[index];
    if (!asset) return;
    download.href = asset.downloadUrl;
    download.dataset.fileId = asset.fileId;
    download.dataset.platform = asset.platform;
    download.innerHTML = `下载 ${asset.displayName}<span aria-hidden="true">↓</span>`;
    name.textContent = asset.displayName;
    meta.textContent = [asset.format, formatSize(asset.fileSize), asset.architecture].filter(Boolean).join(' · ');
    // 手机底部常驻下载条跟随推荐平台切换
    if (stickyDownload) {
      stickyDownload.href = asset.downloadUrl;
      stickyDownload.dataset.fileId = asset.fileId || '';
      stickyDownload.dataset.platform = asset.platform;
      if (stickyName) stickyName.textContent = `${asset.displayName}${asset.versionName ? ` · ${asset.versionName}` : ''}`;
      if (stickyMeta) stickyMeta.textContent = [asset.format, formatSize(asset.fileSize), asset.architecture].filter(Boolean).join(' · ');
    }
    buttons.forEach((button) => {
      const selected = Number(button.dataset.assetIndex) === index;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    if (message) status.textContent = message;
  };

  buttons.forEach((button) => button.addEventListener('click', () => {
    selectAsset(Number(button.dataset.assetIndex), '已切换下载平台。');
  }));

  const ua = navigator.userAgent || '';
  const platform = `${navigator.userAgentData?.platform || ''} ${navigator.platform || ''} ${ua}`.toLowerCase();
  const isIPad = /ipad/.test(platform) || (/macintosh/.test(platform) && navigator.maxTouchPoints > 1);
  let system = null;
  if (/android/.test(platform)) system = 'android';
  else if (/iphone|ipad|ipod/.test(platform) || isIPad) system = 'ios';
  else if (/windows|win32|win64/.test(platform)) system = 'windows';
  else if (/macintosh|mac os|macintel|darwin/.test(platform)) system = 'macos';
  else if (/linux|x11/.test(platform)) system = 'linux';

  const exactIndex = assets.findIndex((asset) => asset.platform === system);
  const universalIndex = assets.findIndex((asset) => asset.platform === 'desktop');
  const defaultIndex = buttons.findIndex((button) => button.getAttribute('aria-pressed') === 'true');
  if (system === 'ios') {
    status.textContent = 'iOS 暂无对应安装包，可选择其他平台查看可用文件。';
  } else if (exactIndex >= 0) {
    selectAsset(exactIndex, `检测到 ${assets[exactIndex].displayName}，已为你推荐。`);
  } else if (system && universalIndex >= 0) {
    selectAsset(universalIndex, `当前版本没有原生 ${system} 安装包，已推荐通用 JAR。`);
  } else if (system) {
    status.textContent = `当前版本没有 ${system} 安装包，请从下方选择可用平台。`;
  } else if (defaultIndex >= 0) {
    status.textContent = '未能识别设备，已提供当前版本的可用下载；你也可以手动切换平台。';
  }

  const fallbackCopy = (value) => {
    const input = document.createElement('textarea');
    input.value = value;
    input.readOnly = true;
    input.className = 'clipboard-fallback';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw new Error('clipboard unavailable');
  };

  // Clipboard API 会被权限或「文档未聚焦」拒掉，这时退回 execCommand（与 file-actions.js 一致）
  const copyText = async (value) => {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch { /* 落到 execCommand 兜底 */ }
    }
    fallbackCopy(value);
  };

  const copyWithFeedback = async (value, feedback) => {
    try {
      await copyText(value);
      if (feedback) feedback.textContent = '已复制';
    } catch (error) {
      if (feedback) feedback.textContent = '复制失败';
      console.error('[mindustry] 复制失败:', error);
    }
  };

  document.querySelectorAll('.mindustry-copy-button').forEach((button) => button.addEventListener('click', () => {
    const row = button.closest('.mindustry-copy-value');
    copyWithFeedback(button.dataset.copy || '', row?.querySelector('.mindustry-copy-status'));
  }));

  // ===== 版本直达链接 =====
  // ?v= 的展开与提示由服务端完成（无 JS 也能用），这里只做滚动定位；
  // #version-* 形式的锚点链接则在加载时补上展开动作。
  // 直达链接同时带 ?v= 与 #version-*：前者让 SSR 直接展开（分享到不支持 JS 的客户端也有效），
  // 后者让人在已打开的页面上点链接能立刻跳到那一条。
  const versionUrlFor = (tag, anchorId) => {
    const params = new URLSearchParams(window.location.search);
    if (tag) params.set('v', tag);
    else params.delete('v');
    const query = params.toString();
    return `${window.location.pathname}${query ? `?${query}` : ''}${anchorId ? `#${anchorId}` : ''}`;
  };

  // smooth=false 用于首次加载：从别的页面跳进来时再滚一段反而像页面在抖
  const focusVersionRow = (row, smooth) => {
    if (!row || row.hidden) return false;
    row.open = true;
    row.classList.add('is-target');
    row.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    return true;
  };

  const hashRowOf = () => {
    const hash = String(window.location.hash || '');
    return hash.startsWith('#version-') ? document.getElementById(hash.slice(1)) : null;
  };

  // 展开某个版本时把地址栏换成可分享的直达链接；收起不动，免得链接指向一个看不见的版本
  // （是否高亮交给 focusVersionRow，手动展开不该伪装成「链接定位到的那条」）
  const versionHint = document.getElementById('mindustry-version-hint');
  versionRows.forEach((row) => row.addEventListener('toggle', () => {
    if (!row.open) return;
    window.history.replaceState(null, '', versionUrlFor(row.dataset.versionTag, row.id));
    // 手动展开后地址栏已经指向真实版本，「没找到」的提示不再成立
    if (versionHint?.dataset.tone === 'warning') versionHint.remove();
  }));

  document.querySelectorAll('[data-version-link]').forEach((button) => button.addEventListener('click', () => {
    const anchor = button.dataset.versionAnchor || '';
    const url = new URL(versionUrlFor(button.dataset.versionLink, anchor), window.location.origin).toString();
    copyWithFeedback(url, button.parentElement?.querySelector('.mindustry-copy-status'));
  }));

  // hash 优先：#version-* 精确到某一条；否则用服务端按 ?v= 展开的那条
  focusVersionRow(hashRowOf() || document.querySelector('[data-version-target]'), false);
  window.addEventListener('hashchange', () => focusVersionRow(hashRowOf(), true));

  // 版本筛选：搜索框 + 正式版/测试版/历史版本 三档
  let activeFilter = 'all';
  const applyVersionFilter = () => {
    const keyword = (versionSearch?.value || '').trim().toLowerCase();
    let visible = 0;
    versionRows.forEach((row) => {
      const version = String(row.dataset.version || '').toLowerCase();
      const channel = row.dataset.channel;
      const index = Number(row.dataset.index || 0);
      let matched = !keyword || version.includes(keyword) || String(index + 1) === keyword;
      if (activeFilter === 'stable' || activeFilter === 'prerelease') matched = matched && channel === activeFilter;
      if (activeFilter === 'history') matched = matched && index > 0;
      row.hidden = !matched;
      if (matched) visible += 1;
    });
    if (versionEmpty) versionEmpty.hidden = visible > 0;
  };

  versionTabs.forEach((tab) => tab.addEventListener('click', () => {
    activeFilter = tab.dataset.versionFilter || 'all';
    versionTabs.forEach((item) => {
      const selected = item === tab;
      item.classList.toggle('is-active', selected);
      item.setAttribute('aria-selected', String(selected));
    });
    applyVersionFilter();
  }));

  versionSearch?.addEventListener('input', applyVersionFilter);
})();
