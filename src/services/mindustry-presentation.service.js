const path = require('path');
const { deduplicateAssets } = require('./mindustry-assets.service');

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
  if (!featuredMatches || !Array.isArray(featuredDownloads.assets)) return deduplicateAssets(assets);

  const merged = [...assets];
  for (const rawAsset of featuredDownloads.assets) {
    const asset = presentAsset(rawAsset);
    merged.push(asset);
  }
  return deduplicateAssets(merged);
};

/**
 * 版本定位（/mindustry?v=...）用的查询归一化：接受 v160.4 / 160.4 / v8 Build 160.4 /
 * #version-v160.4 这类写法，统一小写、去首尾空白、去开头的 v，并限长防止把超长串
 * 回显到页面上。
 */
const VERSION_QUERY_MAX = 64;
const normalizeVersionQuery = (raw) => {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .slice(0, VERSION_QUERY_MAX)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    // 直接粘页内锚点（#version-v157.4）或完整分享链接的尾巴时也认
    .replace(/^#/, '')
    .replace(/^version-/, '')
    .replace(/^v(?=\d)/, '');
};

// 候选值同样归一化（tag / build_name）
const normalizeVersionValue = (value) =>
  String(value || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/^v(?=\d)/, '');

// build_name 形如「v8 Build 160.4」，取尾部版本号；取不到就返回空串
const buildVersionOf = (release) => {
  const name = normalizeVersionValue(release?.build_name);
  const tail = name.match(/(\d+(?:\.\d+)*)$/);
  return tail ? tail[1] : '';
};

/**
 * 在版本列表里找一个「像这个查询」的 Release，用于链接直达。
 * 匹配优先级：tag/build_name 完全相等 → build 尾部版本号相等 → 前缀 → 包含。
 * 同一优先级命中多条时正式版优先，避免「输 157 却落到某个 Beta」。
 * 全都不中返回 null，由调用方提示「未找到」。
 */
const findReleaseForQuery = (releases, rawQuery) => {
  const query = normalizeVersionQuery(rawQuery);
  const list = (Array.isArray(releases) ? releases : []).filter((release) => release && (release.tag || release.build_name));
  if (!query || !list.length) return null;

  const matchers = [
    (release) =>
      normalizeVersionValue(release.tag) === query || normalizeVersionValue(release.build_name) === query,
    (release) => buildVersionOf(release) === query,
    (release) =>
      normalizeVersionValue(release.tag).startsWith(query) || buildVersionOf(release).startsWith(query),
    (release) =>
      normalizeVersionValue(release.tag).includes(query) ||
      normalizeVersionValue(release.build_name).includes(query),
  ];
  for (const matches of matchers) {
    const found = list.filter(matches);
    if (found.length) return found.find((release) => release.channel !== 'prerelease') || found[0];
  }
  return null;
};

/**
 * 版本行锚点 id：tag 打头做 slug，同一 tag 同时有正式版与预发布版时
 * 给后出现的一条补上渠道后缀，保证 id 唯一（否则 #version-v157 只能命中一条）。
 */
const versionAnchorFor = (release, taken) => {
  const source = String((release && (release.tag || release.build_name)) || 'release');
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'release';
  const base = `version-${slug}`;
  if (!taken || !taken.has(base)) return base;
  return `${base}-${release && release.channel === 'prerelease' ? 'beta' : 'stable'}`;
};

module.exports = { presentAsset, isPlayerDownload, mergeFeaturedAssets, PLATFORM_LABELS, normalizeVersionQuery, findReleaseForQuery, versionAnchorFor };
