const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const { config } = require('../config');
const { buildFileDownloadUrl } = require('../utils/public-paths');
const { compareVersionTags } = require('./mindustry-index.service');

const REPOSITORY = 'MDTCopper/launcher';
const isPrereleaseVersion = (version) => /-(?:alpha|beta|rc|pre|preview|snapshot)/i.test(version);

const resolveDownloadUrl = (filePath, baseUrl) => {
  const downloadPath = buildFileDownloadUrl(filePath);
  if (!baseUrl) return downloadPath;
  try {
    return new URL(downloadPath, baseUrl).toString();
  } catch {
    return downloadPath;
  }
};

const getReleaseAssets = (sourceId, releaseId, baseUrl) => {
  const root = path.resolve(config.downloadDir);
  let realRoot;
  try { realRoot = fs.realpathSync(root); } catch { return []; }
  return (Array.isArray(db.data.download_logs) ? db.data.download_logs : [])
    .filter((file) => String(file.source_id) === String(sourceId)
      && String(file.release_id) === String(releaseId)
      && file.approval_status === 'approved'
      && typeof file.file_path === 'string')
    .map((file) => {
      const fullPath = path.resolve(root, file.file_path);
      if (fullPath === root || !fullPath.startsWith(`${root}${path.sep}`)) return null;
      try {
        const realPath = fs.realpathSync(fullPath);
        if (realPath === realRoot || !realPath.startsWith(`${realRoot}${path.sep}`)) return null;
        const stat = fs.statSync(realPath);
        if (!stat.isFile()) return null;
        const extension = path.extname(file.file_name || '').toLowerCase();
        const type = extension === '.exe' ? 'installer' : extension === '.zip' ? 'portable' : 'asset';
        return {
          name: file.file_name,
          type,
          size: Number(file.file_size) || stat.size,
          sha256: file.sha256 || null,
          download_url: resolveDownloadUrl(file.file_path, baseUrl),
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.type === 'installer' ? -1 : 0) - (b.type === 'installer' ? -1 : 0)
      || a.name.localeCompare(b.name));
};

const buildUpdateInfo = ({ version, channel, baseUrl = config.downloadBaseUrl }) => {
  const currentVersion = String(version || '').trim();
  if (!/^[vV]?[0-9][A-Za-z0-9.+_-]{0,99}$/.test(currentVersion)) {
    const error = new Error('version 必须是有效的版本号');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const normalizedChannel = channel || (isPrereleaseVersion(currentVersion) ? 'preview' : 'stable');
  if (!['stable', 'preview'].includes(normalizedChannel)) {
    const error = new Error('channel 只支持 stable 或 preview');
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const sources = Array.isArray(db.data.release_sources) ? db.data.release_sources : [];
  const source = sources.find((item) => `${item.owner}/${item.repo}`.toLowerCase() === REPOSITORY.toLowerCase());
  const releases = (Array.isArray(db.data.release_sync) ? db.data.release_sync : [])
    .filter((release) => release.status === 'published'
      && String(release.repository || '').toLowerCase() === REPOSITORY.toLowerCase()
      && (normalizedChannel === 'preview' || !release.prerelease))
    .map((release) => ({
      ...release,
      assets: getReleaseAssets(release.source_id || source?.id || REPOSITORY, release.release_id, baseUrl),
    }))
    .filter((release) => release.assets.length > 0)
    .sort((a, b) => compareVersionTags(a.tag_name, b.tag_name)
      || String(b.published_at || '').localeCompare(String(a.published_at || '')));

  if (!releases.length) {
    const error = new Error(`目前没有可用的 ${normalizedChannel === 'preview' ? '预览版' : '正式版'} 启动器版本`);
    error.statusCode = 503;
    error.code = 'RELEASES_UNAVAILABLE';
    throw error;
  }

  const latest = releases[0];
  const assets = latest.assets;
  const releaseUrl = `https://github.com/${REPOSITORY}/releases/tag/${encodeURIComponent(latest.tag_name)}`;
  return {
    repository: REPOSITORY,
    channel: normalizedChannel,
    current_version: currentVersion,
    latest_version: latest.tag_name,
    update_available: compareVersionTags(currentVersion, latest.tag_name) > 0,
    published_at: latest.published_at || null,
    release_url: releaseUrl,
    assets,
    installer: assets.find((asset) => asset.type === 'installer') || null,
    portable: assets.find((asset) => asset.type === 'portable') || null,
  };
};

module.exports = { buildUpdateInfo };
