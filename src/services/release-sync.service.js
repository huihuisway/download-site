const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { config } = require('../config');
const { db } = require('../db');
const { getLatestRelease } = require('./github-release.service');
const { sanitizeFilename, isAllowedExtension, ensureInSandbox } = require('../utils/filename');

let running = false;

const ensureStores = () => {
  if (!Array.isArray(db.data.release_sync)) db.data.release_sync = [];
  if (!Array.isArray(db.data.release_history)) db.data.release_history = [];
  if (!Array.isArray(db.data.release_jobs)) db.data.release_jobs = [];
};
const now = () => new Date().toISOString();
const repositoryOf = (source) => source ? `${source.owner}/${source.repo}` : config.releaseSync.repository;
const sourceIdOf = (source) => source?.id || repositoryOf(source);
const event = (source, releaseId, type, payload = {}) => {
  ensureStores();
  db.data.release_history.push({ id: db.data.release_history.length + 1, source_id: sourceIdOf(source), release_id: releaseId, type, payload, created_at: now() });
};
const releaseRecord = (source, releaseId) => {
  ensureStores();
  return db.data.release_sync.find((item) => String(item.source_id) === String(sourceIdOf(source)) && String(item.release_id) === String(releaseId));
};
const validAsset = (asset) => {
  if (!asset || typeof asset.name !== 'string' || !Number.isFinite(Number(asset.size)) || Number(asset.size) < 0) return false;
  const sourceArchive = /^source code\s*\((zip|tar\.gz)\)$/i.test(asset.name) || /^(source|src)\.(zip|tar\.gz|tgz)$/i.test(asset.name);
  return !asset.name.includes('/') && !asset.name.includes('\\') && !sourceArchive && isAllowedExtension(asset.name) && Number(asset.size) <= config.maxFileSize;
};
const matches = (value, pattern) => {
  if (!pattern) return true;
  if (typeof pattern !== 'string' || pattern.length > 200) return false;
  try { return new RegExp(pattern).test(value); } catch { return false; }
};
const selectAssets = (release, source) => (Array.isArray(release.assets) ? release.assets : [])
  .filter(validAsset)
  .filter((asset) => matches(asset.name, source?.asset_include_pattern))
  .filter((asset) => !source?.asset_exclude_pattern || !matches(asset.name, source.asset_exclude_pattern));

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
    if (response.statusCode < 200 || response.statusCode >= 300) { response.resume(); return reject(new Error(`Release asset returned ${response.statusCode}`)); }
    resolve(response);
  });
  request.setTimeout(config.releaseSync.requestTimeout, () => request.destroy(new Error('Release asset request timed out')));
  request.on('error', reject);
});

const download = async (asset, destination) => {
  const tmp = `${destination}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  ensureInSandbox(tmp);
  let response; let written = 0;
  const hash = crypto.createHash('sha256');
  try {
    response = await requestAsset(asset.url || asset.api_url || asset.browser_download_url, { Accept: 'application/octet-stream', 'User-Agent': 'download-site-release-sync', ...(config.releaseSync.token ? { Authorization: `Bearer ${config.releaseSync.token}` } : {}) });
    await new Promise((resolve, reject) => {
      const stream = fs.createWriteStream(tmp, { flags: 'wx' });
      const fail = (error) => { response.destroy(); stream.destroy(); reject(error); };
      response.on('data', (chunk) => { written += chunk.length; if (written > config.maxFileSize || written > Number(asset.size)) return fail(new Error('资产实际大小超过限制')); hash.update(chunk); });
      response.on('error', fail); stream.on('error', fail); stream.on('finish', resolve); response.pipe(stream);
    });
    if (written !== Number(asset.size)) throw new Error('资产实际大小与声明不一致');
    const digest = hash.digest('hex');
    if (asset.digest?.startsWith('sha256:') && digest !== asset.digest.slice(7)) throw new Error('资产摘要校验失败');
    ensureInSandbox(destination); await fsp.rename(tmp, destination); return { bytes: written, sha256: digest };
  } catch (error) { await fsp.rm(tmp, { force: true }).catch(() => {}); throw error; }
};

const upsertFile = (source, release, asset, relativePath, stat, sha256) => {
  const existing = db.data.download_logs.find((item) => item.file_path === relativePath);
  const values = { file_name: asset.name, file_path: relativePath, category: path.posix.dirname(relativePath), file_size: stat.size, mime_type: require('./sync.service').guessMimeType(asset.name), sha256, file_mtime: stat.mtime.toISOString(), source_id: sourceIdOf(source), release_id: release.id, approval_status: 'approved' };
  if (existing) Object.assign(existing, values, { updated_at: now() });
  else db.data.download_logs.push({ id: db.data._nextId++, download_count: 0, created_at: now(), updated_at: now(), ...values });
};

const syncRelease = async (source, options = {}) => {
  ensureStores();
  if (running) return { skipped: true, reason: 'already-running' };
  running = true;
  const repository = repositoryOf(source); let release; let job;
  if (source) {
    job = { id: db.data._nextReleaseJobId++, source_id: source.id, type: options.retry ? 'retry' : 'sync', status: 'running', payload: options, created_at: now(), started_at: now(), finished_at: null, error: null };
    db.data.release_jobs.push(job); source.status = 'running'; source.last_sync_at = now(); event(source, null, 'sync_started', { job_id: job.id });
  }
  try {
    release = await getLatestRelease(repository, { includePrerelease: source?.include_prerelease, includeDraft: source?.include_draft });
    if (!release) return { skipped: true, reason: 'no-release' };
    const existing = releaseRecord(source, release.id);
    if (existing?.status === 'published') return { skipped: true, release: release.tag_name };
    const safeTag = sanitizeFilename(String(release.tag_name || release.id));
    const base = source?.target_category || `github/${repository}`;
    const versionDir = path.join(config.downloadDir, base, safeTag); ensureInSandbox(versionDir); await fsp.mkdir(versionDir, { recursive: true });
    const assets = selectAssets(release, source); if (!assets.length) throw new Error('Release 没有符合条件的资产');
    const downloaded = [];
    for (const asset of assets) {
      const safeName = sanitizeFilename(asset.name); const destination = path.join(versionDir, safeName); let result = { skipped: true };
      if (!fs.existsSync(destination)) result = await download({ ...asset, url: asset.url || asset.api_url || asset.browser_download_url }, destination);
      const stat = await fsp.stat(destination); const relativePath = path.relative(config.downloadDir, destination).replace(/\\/g, '/');
      upsertFile(source, release, { ...asset, name: safeName }, relativePath, stat, result.sha256 || null); downloaded.push({ name: safeName, ...result });
    }
    const record = { id: existing?.id || db.data.release_sync.length + 1, source_id: sourceIdOf(source), repository, release_id: release.id, tag_name: release.tag_name, status: 'published', prerelease: Boolean(release.prerelease), draft: Boolean(release.draft), published_at: release.published_at || release.created_at, synced_at: now(), error: null };
    if (existing) Object.assign(existing, record); else db.data.release_sync.push(record);
    event(source, release.id, 'sync_succeeded', { assets: downloaded.length, job_id: job?.id });
    if (source) { source.status = 'idle'; source.last_success_at = now(); source.last_error = null; }
    if (job) Object.assign(job, { status: 'succeeded', finished_at: now() });
    db._save(); return { synced: true, release: release.tag_name, assets: downloaded, directory: versionDir };
  } catch (error) {
    const existing = release && releaseRecord(source, release.id); const failed = { id: existing?.id || db.data.release_sync.length + 1, source_id: sourceIdOf(source), repository, release_id: release?.id || 0, tag_name: release?.tag_name || '', status: 'failed', error: error.message, synced_at: now() };
    if (existing) Object.assign(existing, failed); else db.data.release_sync.push(failed);
    event(source, release?.id || null, 'sync_failed', { error: error.message, job_id: job?.id });
    if (source) { source.status = 'error'; source.last_error = error.message; }
    if (job) Object.assign(job, { status: 'failed', finished_at: now(), error: error.message });
    db._save(); throw error;
  } finally { running = false; }
};

const sync = (source, payload) => syncRelease(source, payload);
const status = (source) => ({ source_id: source.id, status: source.status, last_sync_at: source.last_sync_at, last_success_at: source.last_success_at, last_error: source.last_error });
const assets = (source) => { ensureStores(); return { source_id: source.id, assets: db.data.release_sync.filter((item) => String(item.source_id) === String(source.id)) }; };
const retry = (source, payload = {}) => syncRelease(source, { ...payload, retry: true });
const preview = async (source) => { const release = await getLatestRelease(`${source.owner}/${source.repo}`, { includePrerelease: source.include_prerelease, includeDraft: source.include_draft }); return { source_id: source.id, release, assets: selectAssets(release || {}, source) }; };
module.exports = { syncRelease, sync, validAsset, status, assets, retry, preview, download, selectAssets };
