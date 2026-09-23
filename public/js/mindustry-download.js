(() => {
  const status = document.getElementById('mindustry-device-status');
  if (!status) return;

  const ua = navigator.userAgent || '';
  const platform = `${navigator.userAgentData?.platform || ''} ${navigator.platform || ''} ${ua}`.toLowerCase();
  const isIPad = /ipad/.test(platform) || (/macintosh/.test(platform) && navigator.maxTouchPoints > 1);
  let system = null;
  if (/android/.test(platform)) system = 'android';
  else if (/iphone|ipad|ipod/.test(platform) || isIPad) system = 'ios';
  else if (/windows|win32|win64/.test(platform)) system = 'windows';
  else if (/macintosh|mac os|macintel|darwin/.test(platform)) system = 'macos';
  else if (/linux|x11/.test(platform)) system = 'linux';

  const labels = { android: 'Android', windows: 'Windows', macos: 'macOS', linux: 'Linux' };
  if (!system) {
    status.textContent = '无法识别你的设备，请手动选择 Android APK 或对应电脑系统的 ZIP。';
    return;
  }
  if (system === 'ios') {
    status.textContent = '检测到 iPhone 或 iPad。本站没有 iOS 安装包，请按需手动选择其他平台。';
    return;
  }

  const download = document.querySelector(`[data-platform="${system}"]`);
  if (!download) {
    status.textContent = `检测到${labels[system]}设备，但本站暂时没有对应安装包，请展开高级文件或手动选择其他版本。`;
    return;
  }

  download.classList.add('is-recommended');
  const badge = document.createElement('em');
  badge.className = 'mindustry-recommended-tag';
  badge.textContent = '适合你的设备';
  download.appendChild(badge);
  status.textContent = `已识别你的设备：${labels[system]}。已标出推荐下载版本。`;
})();
