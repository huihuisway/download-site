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

  document.querySelectorAll('.mindustry-copy-button').forEach((button) => button.addEventListener('click', async () => {
    const row = button.closest('.mindustry-copy-value');
    const feedback = row?.querySelector('.mindustry-copy-status');
    const value = button.dataset.copy || '';
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const input = document.createElement('textarea');
        input.value = value;
        input.className = 'clipboard-fallback';
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand('copy');
        input.remove();
        if (!copied) throw new Error('clipboard unavailable');
      }
      if (feedback) feedback.textContent = '已复制';
    } catch (error) {
      if (feedback) feedback.textContent = '复制失败';
      console.error('[mindustry] 复制失败:', error);
    }
  }));
})();
