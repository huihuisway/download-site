const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { config } = require('../config');
const { db } = require('../db');
const { getLatestRelease } = require('./github-release.service');
const { syncDirectory, guessMimeType } = require('./sync.service');
const { sanitizeFilename, isAllowedExtension, ensureInSandbox } = require('../utils/filename');
const folderTreeService = require('./folder-tree.service');

let running = false;

const isSourceArchive = (name) => /^source code\s*\((zip|tar\.gz)\)$/i.test(name) || /^(source|src)\.(zip|tar\.gz|tgz)$/i.test(name);
const validAsset = (asset) => {
  if (!asset || typeof asset.name !== 'string' || !Number.isFinite(Number(asset.size)) || Number(asset.size) < 0) return false;
  return !asset.name.includes('/') && !asset.name.includes('\\')
    && !isSourceArchive(asset.name)
    && isAllowedExtension(asset.name)
    && Number(asset.size) <= config.maxFileSize;
};

const requestAsset = (url, headers, redirects = 0) => new Promise((resolve, reject) => {
  let parsed;
  try { parsed = new URL(url); } catch { return reject(new Error('资产 URL 无效')); }
  const allowedHost = ['api.github.com', 'github.com', 'objects.githubusercontent.com'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' || !allowedHost || redirects > 3) return reject(new Error('资产重定向地址不被允许'));
  const request = https.get(parsed, { headers }, (response) => {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      response.resume();
      return requestAsset(new URL(response.headers.location, parsed).toString(), headers, redirects + 1).then(resolve, reject);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.resume();
      return reject(new Error(`Release asset returned ${response.statusCode}`));
    }
    resolve(response);
  });
  request.setTimeout(config.releaseSync.requestTimeout, () => request.destroy(new Error('Release asset request timed out')));
  request.on('error', reject);
});

const download = async (asset, destination) => {
  const tmp = `${destination}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  ensureInSandbox(tmp);
  let response;
  let written = 0;
  const hash = crypto.createHash('sha256');
  try {
    response = await requestAsset(asset.url || asset.api_url || asset.browser_download_url, {
      Accept: 'application/octet-stream',
      'User-Agent': 'download-site-release-sync',
      ...(config.releaseSync.token ? { Authorization: `Bearer ${config.releaseSync.token}` } : {}),
    });
    await new Promise((resolve, reject) => {
      const stream = fs.createWriteStream(tmp, { flags: 'wx' });
      const fail = (error) => { response.destroy(); stream.destroy(); reject(error); };
      response.on('data', (chunk) => {
        written += chunk.length;
        if (written > config.maxFileSize || written > Number(asset.size)) return fail(new Error('资产实际大小超过限制'));
        hash.update(chunk);
      });
      response.on('error', fail);
      stream.on('error', fail);
      stream.on('finish', resolve);
      response.pipe(stream);
    });
    if (written !== Number(asset.size)) throw new Error('资产实际大小与声明不一致');
    const digest = hash.digest('hex');
    if (asset.digest && asset.digest.startsWith('sha256:') && digest !== asset.digest.slice(7)) throw new Error('资产摘要校验失败');
    ensureInSandbox(destination);
    await fsp.rename(tmp, destination);
    return { bytes: written, sha256: digest };
  } catch (error) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
};

const syncRelease = async (source) => {
  if (running) return { skipped: true, reason: 'already-running' };
  running = true;
  let release;
  try {
    const repository = source ? `${source.owner}/${source.repo}` : config.releaseSync.repository;
    release = await getLatestRelease(repository);
    if (!release) return { skipped: true, reason: 'no-release' };
    const existing = db.data.release_sync.find((item) => item.repository === repository && item.release_id === release.id);
    if (existing && existing.status === 'published') return { skipped: true, release: release.tag_name };
    const safeTag = sanitizeFilename(String(release.tag_name || release.id));
    const base = source?.target_category || `github/${repository}`;
    const versionDir = path.join(config.downloadDir, base, safeTag);
    ensureInSandbox(versionDir);
    await fsp.mkdir(versionDir, { recursive: true });
    const assets = (Array.isArray(release.assets) ? release.assets : []).filter(validAsset);
    if (assets.length === 0) throw new Error('Release 没有符合条件的资产');
    const downloaded = [];
    for (const asset of assets) {
      const safeName = sanitizeFilename(asset.name);
      const destination = path.join(versionDir, safeName);
      if (fs.existsSync(destination)) { downloaded.push({ name: safeName, skipped: true }); continue; }
      const result = await download({ ...asset, url: asset.url || asset.api_url || asset.browser_download_url }, destination);
      downloaded.push({ name: safeName, ...result });
    }
    const result = await syncDirectory();
    db.prepare('INSERT OR REPLACE INTO release_sync (repository, release_id, tag_name, status, prerelease, published_at, synced_at, error) VALUES (@repository, @release_id, @tag_name, @status, @prerelease, @published_at, @synced_at, @error)').run({
      repository, release_id: release.id, tag_name: release.tag_name, status: 'published', prerelease: Boolean(release.prerelease), published_at: release.published_at || release.created_at, synced_at: new Date().toISOString(), error: null,
    });
    return { synced: true, release: release.tag_name, assets: downloaded, directory: versionDir, directorySync: result };
  } catch (error) {
    const repository = source ? `${source.owner}/${source.repo}` : config.releaseSync.repository;
    db.prepare('INSERT OR REPLACE INTO release_sync (repository, release_id, tag_name, status, prerelease, published_at, synced_at, error) VALUES (@repository, @release_id, @tag_name, @status, @published_at, @synced_at, @error)').run({ repository, release_id: release?.id || 0, tag_name: release?.tag_name || '', status: 'failed', prerelease: Boolean(release?.prerelease), published_at: release?.published_at || null, synced_at: new Date().toISOString(), error: error.message });
    throw error;
  } finally { running = false; }
};

const sync = (source) => syncRelease(source);
const status = (source) => ({ source_id: source.id, status: source.status, last_sync_at: source.last_sync_at, last_success_at: source.last_success_at, last_error: source.last_error });
const assets = (source) => ({ source_id: source.id, assets: db.data.release_sync.filter((item) => item.repository === `${source.owner}/${source.repo}`) });
const retry = (source) => syncRelease(source);
const preview = async (source) => {
  const release = await getLatestRelease(`${source.owner}/${source.repo}`);
  return { source_id: source.id, release, assets: release?.assets || [] };
};

module.exports = { syncRelease, sync, validAsset, status, assets, retry, preview, download };
