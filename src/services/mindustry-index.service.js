const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const { config } = require('../config');
const { buildFileDownloadUrl } = require('../utils/public-paths');

const GAME_DETAILS = {
  mindustry: { name: 'Mindustry', repositories: ['Anuken/Mindustry'] },
  'mindustry-classic': { name: 'Mindustry Classic', repositories: ['Anuken/Mindustry-Classic'] },
};
const PLATFORM_ORDER = ['android', 'windows', 'linux', 'macos', 'desktop', 'server', 'advanced'];

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
      .sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')) || b.tag.localeCompare(a.tag)),
  }));
  return { schema_version: 1, generated_at: new Date().toISOString(), games: result };
};

module.exports = { buildManifest };
