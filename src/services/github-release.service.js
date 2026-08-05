const https = require('https');
const { config } = require('../config');

const requestJson = (url, headers = {}, timeout = config.releaseSync.requestTimeout) => new Promise((resolve, reject) => {
  const request = https.get(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'download-site-release-sync',
      ...headers,
    },
  }, (response) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { body += chunk; });
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

const getLatestRelease = async (repository) => {
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository)) {
    throw new Error('GITHUB_REPOSITORY must use owner/name format');
  }
  const headers = config.releaseSync.token ? { Authorization: `Bearer ${config.releaseSync.token}` } : {};
  const release = await requestJson(`https://api.github.com/repos/${repository}/releases?per_page=30`, headers);
  const candidates = release.filter((item) => !item.draft);
  if (!candidates.length) return null;
  return candidates[0];
};

module.exports = { getLatestRelease, requestJson };
