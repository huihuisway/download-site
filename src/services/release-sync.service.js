const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const https = require('https');
const { config } = require('../config');
const { db } = require('../db');
const { getLatestRelease } = require('./github-release.service');
const { syncDirectory } = require('./sync.service');

let running = false;

const download = (url, destination) => new Promise((resolve, reject) => {
  const request = https.get(url, { headers: { 'User-Agent': 'download-site-release-sync' } }, (response) => {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      response.resume();
      return download(response.headers.location, destination).then(resolve, reject);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.resume();
      return reject(new Error(`Release asset returned ${response.statusCode}`));
    }
    const stream = fs.createWriteStream(destination);
    response.pipe(stream);
    stream.on('finish', () => stream.close(resolve));
    stream.on('error', reject);
  });
  request.setTimeout(config.releaseSync.requestTimeout, () => request.destroy(new Error('Release asset request timed out')));
  request.on('error', reject);
});

const validAsset = (asset) => {
  const ext = path.extname(asset.name).toLowerCase();
  return !asset.name.includes('/') && !asset.name.includes('\\')
    && !/^(source|src)\.(zip|tar\.gz|tgz)$/i.test(asset.name)
    && config.allowedExtensions.includes(ext)
    && !config.releaseSync.blockedExtensions.includes(ext)
    && Number(asset.size) <= config.maxFileSize;
};

const syncRelease = async () => {
  if (running) return { skipped: true };
  running = true;
  const startedAt = new Date().toISOString();
  try {
    const release = await getLatestRelease(config.releaseSync.repository);
    if (!release) return { skipped: true, reason: 'no-release' };
    const existing = db.prepare('SELECT * FROM release_sync WHERE repository = ? AND release_id = ?').get(config.releaseSync.repository, release.id);
    if (existing && existing.status === 'published') return { skipped: true, release: release.tag_name };
    const versionDir = path.join(config.downloadDir, 'releases', release.tag_name.replace(/[^a-zA-Z0-9._-]/g, '_'));
    await fsp.mkdir(versionDir, { recursive: true });
    const assets = release.assets.filter(validAsset);
    for (const asset of assets) await download(asset.browser_download_url, path.join(versionDir, asset.name));
    db.prepare('INSERT OR REPLACE INTO release_sync (repository, release_id, tag_name, status, prerelease, published_at, synced_at, error) VALUES (@repository, @release_id, @tag_name, @status, @prerelease, @published_at, @synced_at, @error)').run({
      repository: config.releaseSync.repository, release_id: release.id, tag_name: release.tag_name, status: 'published',
      prerelease: Boolean(release.prerelease), published_at: release.published_at, synced_at: new Date().toISOString(), error: null,
    });
    await syncDirectory();
    return { synced: true, release: release.tag_name, assets: assets.length, startedAt };
  } catch (error) {
    db.prepare('INSERT OR REPLACE INTO release_sync (repository, release_id, tag_name, status, synced_at, error) VALUES (@repository, @release_id, @tag_name, @status, @synced_at, @error)').run({ repository: config.releaseSync.repository, release_id: 0, tag_name: '', status: 'failed', synced_at: new Date().toISOString(), error: error.message });
    throw error;
  } finally { running = false; }
};

module.exports = { syncRelease, validAsset };
