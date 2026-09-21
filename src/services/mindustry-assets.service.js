const path = require('path');

const GAME_SOURCES = {
  'anuken/mindustry': { game_id: 'mindustry', game_name: 'Mindustry' },
  'anuken/mindustry-classic': { game_id: 'mindustry-classic', game_name: 'Mindustry Classic' },
};

const gameForSource = (source, repository) => source?.config?.game_id
  ? { game_id: source.config.game_id, game_name: source.config.game_name || source.name || source.config.game_id }
  : GAME_SOURCES[String(repository || '').toLowerCase()] || null;

const classifyAsset = (assetName) => {
  const name = path.basename(String(assetName || '')).toLowerCase();
  const ext = path.extname(name);
  if (/server|dedicated|headless/.test(name)) return { platform: 'server', asset_type: 'server' };
  if (ext === '.apk' || /android/.test(name)) return { platform: 'android', asset_type: 'installer' };
  if (/assets?\.jar|dependencies?\.jar|source(code)?/.test(name)) return { platform: 'advanced', asset_type: 'build-dependency' };
  if (/windows|win(32|64)?/.test(name)) return { platform: 'windows', asset_type: 'installer' };
  if (/macos|mac\b|osx|darwin/.test(name)) return { platform: 'macos', asset_type: 'installer' };
  if (/linux|\.deb$|\.appimage$/.test(name)) return { platform: 'linux', asset_type: 'installer' };
  if (ext === '.jar' || ext === '.zip') return { platform: 'desktop', asset_type: 'desktop' };
  return { platform: 'advanced', asset_type: 'build-artifact' };
};

const releaseChannel = (release) => {
  const tag = `${release?.tag_name || ''} ${release?.name || ''}`;
  return release?.prerelease || /(?:^|[-_.\s])(be|bleeding.?edge|beta|alpha|rc|pre|snapshot)(?:$|[-_.\s])/i.test(tag)
    ? 'prerelease'
    : 'stable';
};

const metadataForAsset = (source, release, asset, repository) => {
  const game = gameForSource(source, repository);
  if (!game) return null;
  const upstreamVersion = String(asset.name || '').match(/^Mindustry-MDT-Android-(v?[0-9]+(?:\.[0-9]+){0,2})\.apk$/i)?.[1];
  const releaseTag = String(release.tag_name || release.name || release.id);
  return {
    ...game,
    source_repository: repository,
    version_tag: upstreamVersion || releaseTag,
    release_tag: releaseTag,
    release_channel: releaseChannel(release),
    published_at: release.published_at || release.created_at || null,
    release_url: release.html_url || null,
    ...classifyAsset(asset.name),
  };
};

module.exports = { classifyAsset, releaseChannel, metadataForAsset, gameForSource };
