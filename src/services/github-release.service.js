const https = require('https');
const { config } = require('../config');

const MAX_RESPONSE_SIZE = 2 * 1024 * 1024;
const IDENTIFIER = /^[A-Za-z0-9_.-]{1,100}$/;

const validateRepository = (repository) => {
  if (typeof repository !== 'string') throw new Error('仓库必须是 owner/name 格式');
  const parts = repository.split('/');
  if (parts.length !== 2 || !IDENTIFIER.test(parts[0]) || !IDENTIFIER.test(parts[1])) {
    throw new Error('仓库必须使用安全的 owner/name 格式');
  }
  return parts;
};

const requestJson = (url, headers = {}, timeout = config.releaseSync.requestTimeout) => new Promise((resolve, reject) => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.github.com') {
    return reject(new Error('GitHub API 地址不被允许'));
  }
  const request = https.get(parsed, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'download-site-release-sync',
      ...headers,
    },
  }, (response) => {
    let body = '';
    let size = 0;
    response.setEncoding('utf8');
    response.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_RESPONSE_SIZE) {
        response.destroy(new Error('GitHub API 响应过大'));
        return;
      }
      body += chunk;
    });
    response.on('error', reject);
    response.on('end', () => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        const error = new Error(`GitHub API returned ${response.statusCode}`);
        error.statusCode = response.statusCode;
        error.body = body.slice(0, 500);
        return reject(error);
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error(`Invalid GitHub API response: ${error.message}`));
      }
    });
  });
  request.setTimeout(timeout, () => request.destroy(new Error('GitHub API request timed out')));
  request.on('error', reject);
});

const compilePattern = (pattern) => {
  if (!pattern) return null;
  try { return new RegExp(pattern); } catch { return null; }
};

const matchesAssetPatterns = (release, includePattern, excludePattern) => {
  if (!includePattern && !excludePattern) return true;
  const include = compilePattern(includePattern);
  const exclude = compilePattern(excludePattern);
  if (includePattern && !include) return false;
  return Array.isArray(release.assets) && release.assets.some((asset) => (
    asset && typeof asset.name === 'string' && (!include || include.test(asset.name)) && (!exclude || !exclude.test(asset.name))
  ));
};

const getReleases = async (repository, options = {}) => {
  const [owner, repo] = validateRepository(repository);
  const headers = config.releaseSync.token ? { Authorization: `Bearer ${config.releaseSync.token}` } : {};
  const all = [];
  const maxPages = Math.max(1, Math.min(50, Number(options.maxPages) || 50));
  for (let page = 1; page <= maxPages; page++) {
    const releases = await requestJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=100&page=${page}`, headers);
    if (!Array.isArray(releases)) throw new Error('GitHub Releases 响应格式无效');
    all.push(...releases);
    if (releases.length < 100) break;
  }
  const candidates = all.filter((item) => item
    && (options.includeDraft || !item.draft)
    && (options.includePrerelease || !item.prerelease)
    && (options.prereleaseOnly === undefined || Boolean(item.prerelease) === options.prereleaseOnly)
    && matchesAssetPatterns(item, options.asset_include_pattern, options.asset_exclude_pattern));
  candidates.sort((a, b) => String(b.published_at || b.created_at || '').localeCompare(String(a.published_at || a.created_at || '')));
  return candidates;
};

const getLatestRelease = async (repository, options = {}) => {
  const [owner, repo] = validateRepository(repository);
  const headers = config.releaseSync.token ? { Authorization: `Bearer ${config.releaseSync.token}` } : {};
  const maxPages = Math.max(1, Math.min(50, Number(options.maxPages) || 50));
  for (let page = 1; page <= maxPages; page++) {
    const releases = await requestJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases?per_page=100&page=${page}`, headers);
    if (!Array.isArray(releases)) throw new Error('GitHub Releases 响应格式无效');
    const candidates = releases.filter((item) => item
      && (options.includeDraft || !item.draft)
      && (options.includePrerelease || !item.prerelease)
      && (options.prereleaseOnly === undefined || Boolean(item.prerelease) === options.prereleaseOnly)
      && matchesAssetPatterns(item, options.asset_include_pattern, options.asset_exclude_pattern));
    candidates.sort((a, b) => String(b.published_at || b.created_at || '').localeCompare(String(a.published_at || a.created_at || '')));
    if (candidates.length) return candidates[0];
    if (releases.length < 100) break;
  }
  return null;
};

module.exports = { getLatestRelease, getReleases, requestJson, validateRepository };
