const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const { config } = require('../config');
const { buildFileDownloadUrl } = require('../utils/public-paths');
const { classifyAsset } = require('./mindustry-assets.service');

const GAME_DETAILS = {
  mindustry: { name: 'Mindustry', repositories: ['Anuken/Mindustry'] },
  'mindustry-classic': { name: 'Mindustry Classic', repositories: ['Anuken/Mindustry-Classic'] },
};
const PLATFORM_ORDER = ['android', 'windows', 'linux', 'macos', 'desktop', 'server', 'advanced'];

const compareVersionTags = (left, right) => {
  const leftParts = String(left || '').match(/\d+|[a-z]+/gi) || [];
  const rightParts = String(right || '').match(/\d+|[a-z]+/gi) || [];
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const a = leftParts[index];
    const b = rightParts[index];
    if (a === undefined) return /^\d+$/.test(b) ? 1 : -1;
    if (b === undefined) return /^\d+$/.test(a) ? -1 : 1;
    const aNumber = /^\d+$/.test(a);
    const bNumber = /^\d+$/.test(b);
    if (aNumber && bNumber && Number(a) !== Number(b)) return Number(b) - Number(a);
    if (aNumber !== bNumber) return aNumber ? -1 : 1;
    const difference = a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    if (difference) return -difference;
  }
  return 0;
};

const buildManifest = () => {
  const games = new Map();
  const records = Array.isArray(db.data.download_logs) ? db.data.download_logs : [];
  for (const file of records) {
    if (!file.game_id || !file.version_tag || ['pending', 'rejected'].includes(file.approval_status)) continue;
    const root = path.resolve(config.downloadDir);
    const fullPath = path.resolve(root, file.file_path || '');
    if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) continue;
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;

    const details = GAME_DETAILS[file.game_id] || { name: file.game_name || file.game_id, repositories: [] };
    if (!games.has(file.game_id)) games.set(file.game_id, { id: file.game_id, name: file.game_name || details.name, repositories: new Set(details.repositories), releases: new Map() });
    const game = games.get(file.game_id);
    if (file.source_repository) game.repositories.add(file.source_repository);
    const channel = file.release_channel === 'prerelease' ? 'prerelease' : 'stable';
    const releaseKey = `${file.version_tag}:${channel}`;
    if (!game.releases.has(releaseKey)) {
      game.releases.set(releaseKey, {
        tag: file.version_tag,
        build_name: file.build_name || null,
        channel,
        published_at: file.published_at || null,
        source_repository: file.source_repository || null,
        source_repositories: [],
        release_url: file.release_url || null,
        assets: [],
      });
    }
    const release = game.releases.get(releaseKey);
    if (file.source_repository && !release.source_repositories.includes(file.source_repository)) {
      release.source_repositories.push(file.source_repository);
    }
    if (file.source_repository === GAME_DETAILS[file.game_id]?.repositories[0]) {
      release.source_repository = file.source_repository;
      release.release_url = file.release_url || release.release_url;
      release.published_at = file.published_at || release.published_at;
      release.build_name = file.build_name || release.build_name;
    }
    release.assets.push({
      file_id: file.id,
      file_name: file.file_name,
      source_repository: file.source_repository || null,
      size: Number(file.file_size) || 0,
      sha256: file.sha256 || null,
      platform: file.platform || 'advanced',
      type: file.asset_type || 'build-artifact',
      download_url: buildFileDownloadUrl(file.file_path),
    });
  }

  const result = [...games.values()].map((game) => ({
    id: game.id,
    name: game.name,
    repositories: [...game.repositories],
    releases: [...game.releases.values()]
      .map((release) => ({
        ...release,
        source_repositories: [...new Set(release.source_repositories)],
        assets: release.assets.sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform) || a.file_name.localeCompare(b.file_name)),
      }))
      .sort((a, b) => compareVersionTags(a.tag, b.tag) || String(b.published_at || '').localeCompare(String(a.published_at || ''))),
  }));

  // 普通玩家用的 Android APK 和桌面 ZIP 存在历史资源目录中，不一定属于 GitHub Release 同步记录。
  const packages = new Map();
  for (const file of records) {
    const match = String(file.file_path || '').match(/^Mindustry\/(v\d+)\/build-(\d+(?:\.\d+)*?)-stable\/([^/]+)$/i);
    if (!match || ['pending', 'rejected'].includes(file.approval_status)) continue;
    const root = path.resolve(config.downloadDir);
    const fullPath = path.resolve(root, file.file_path);
    if ((fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) || !fs.existsSync(fullPath)) continue;
    let stat;
    try { stat = fs.statSync(fullPath); } catch { continue; }
    if (!stat.isFile()) continue;
    const platform = classifyAsset(file.file_name).platform;
    if (!['android', 'windows', 'linux', 'macos'].includes(platform)) continue;
    const key = `${match[1].toLowerCase()}:${match[2]}`;
    if (!packages.has(key)) packages.set(key, { game_version: match[1].toLowerCase(), build: match[2], assets: [] });
    packages.get(key).assets.push({
      file_id: file.id,
      file_name: file.file_name,
      size: Number(file.file_size) || stat.size,
      platform,
      download_url: buildFileDownloadUrl(file.file_path),
    });
  }

  const compareBuilds = (a, b) => {
    const majorDiff = Number(b.game_version.slice(1)) - Number(a.game_version.slice(1));
    if (majorDiff) return majorDiff;
    const left = a.build.split('.').map(Number);
    const right = b.build.split('.').map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
      const diff = (right[i] || 0) - (left[i] || 0);
      if (diff) return diff;
    }
    return 0;
  };
  const featuredDownloads = [...packages.values()].sort(compareBuilds)[0] || null;
  if (featuredDownloads) {
    featuredDownloads.assets.sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform) || a.file_name.localeCompare(b.file_name));
    featuredDownloads.build_name = `${featuredDownloads.game_version} Build ${featuredDownloads.build}`;
  }

  return { schema_version: 1, generated_at: new Date().toISOString(), games: result, featured_downloads: featuredDownloads };
};

module.exports = { buildManifest, compareVersionTags };
