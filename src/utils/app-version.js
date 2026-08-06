const { execFileSync } = require('child_process');

const VERSION_PATTERN = /^v\d+$/;

function normalizeVersion(value) {
  if (typeof value !== 'string') return null;
  const version = value.trim();
  return VERSION_PATTERN.test(version) ? version : null;
}

function getAppVersion(options = {}) {
  const envVersion = normalizeVersion(options.envVersion ?? process.env.APP_VERSION);
  if (envVersion) return envVersion;

  try {
    const count = execFileSync(
      options.gitCommand || 'git',
      ['rev-list', '--count', 'HEAD'],
      {
        cwd: options.cwd || process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    if (/^\d+$/.test(count)) return `v${count}`;
  } catch {
    // 打包部署可能没有 .git，使用稳定的兜底版本。
  }

  return 'v0000';
}

module.exports = { getAppVersion, normalizeVersion };
