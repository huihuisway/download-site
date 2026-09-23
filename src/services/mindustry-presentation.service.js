const path = require('path');

const PLATFORM_LABELS = {
  android: 'Android APK',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  desktop: '通用 JAR',
  server: '服务器文件',
  advanced: '其他文件',
};

const formatFor = (filename, type) => {
  const extension = path.extname(String(filename || '')).slice(1).toUpperCase();
  if (extension) return extension;
  if (type === 'installer') return '安装包';
  return '文件';
};

const architectureFor = (filename) => {
  const name = String(filename || '').toLowerCase();
  if (/\b(?:x86[_-]?64|x64|amd64|64[_-]?bit|win64)\b/.test(name)) return '64 位';
  if (/\b(?:x86|i[3-6]86|32[_-]?bit|win32)\b/.test(name)) return '32 位';
  if (/\b(?:arm64|aarch64)\b/.test(name)) return 'ARM64';
  if (/\b(?:armv?7|armeabi)\b/.test(name)) return 'ARM';
  return null;
};

const presentAsset = (asset = {}) => {
  const originalFilename = String(asset.file_name || '未命名文件');
  const filename = originalFilename.toLowerCase();
  let platform = asset.platform;
  if (!['android', 'windows', 'macos', 'linux', 'desktop', 'server', 'advanced'].includes(platform)) {
    if (/\.apk$/.test(filename) || /android/.test(filename)) platform = 'android';
    else if (/windows|win(?:32|64)?/.test(filename)) platform = 'windows';
    else if (/macos|osx|darwin/.test(filename)) platform = 'macos';
    else if (/linux|\.deb$|\.appimage$/.test(filename)) platform = 'linux';
    else if (/server|dedicated|headless/.test(filename)) platform = 'server';
    else if (/\.jar$|\.zip$/.test(filename)) platform = 'desktop';
    else platform = 'advanced';
  }
  const format = formatFor(originalFilename, asset.type);
  const architecture = architectureFor(originalFilename);
  let displayName = PLATFORM_LABELS[platform] || '其他文件';
  if (architecture && ['windows', 'linux'].includes(platform)) displayName += ` ${architecture}`;
  if (platform === 'android' && architecture) displayName += ` ${architecture}`;

  return {
    ...asset,
    platform,
    architecture,
    format,
    displayName,
    fileSize: Number.isFinite(Number(asset.size)) && Number(asset.size) > 0 ? Number(asset.size) : null,
    downloadUrl: typeof asset.download_url === 'string' ? asset.download_url : '',
    checksum: typeof asset.sha256 === 'string' && asset.sha256 ? asset.sha256 : null,
    originalFilename,
  };
};

const isPlayerDownload = (asset) => ['android', 'windows', 'macos', 'linux', 'desktop'].includes(asset.platform)
  && Boolean(asset.downloadUrl);

const mergeFeaturedAssets = (release, featuredDownloads) => {
  const assets = Array.isArray(release?.assets) ? release.assets.map(presentAsset) : [];
  const featuredMatches = release?.channel === 'stable'
    && featuredDownloads
    && release.tag?.replace(/^v/i, '') === featuredDownloads.build
    && Boolean(featuredDownloads.game_version);
  if (!featuredMatches || !Array.isArray(featuredDownloads.assets)) return assets;

  const merged = [...assets];
  for (const rawAsset of featuredDownloads.assets) {
    const asset = presentAsset(rawAsset);
    if (!merged.some((existing) => existing.downloadUrl === asset.downloadUrl)) merged.push(asset);
  }
  return merged;
};

module.exports = { presentAsset, isPlayerDownload, mergeFeaturedAssets };
