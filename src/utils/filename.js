const sanitize = require('sanitize-filename');
const path = require('path');
const { config } = require('../config');
const { BLOCKED_EXTENSIONS } = require('../config/constants');

const sanitizeFilename = (rawName) => {
  const cleaned = sanitize(rawName, { replacement: '_' });
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new Error('无效的文件名');
  }
  return cleaned;
};

const getExtension = (filename) => {
  return path.extname(filename).toLowerCase();
};

const isAllowedExtension = (filename) => {
  const ext = getExtension(filename);
  if (!ext) return false;
  if (BLOCKED_EXTENSIONS.includes(ext)) return false;
  return config.allowedExtensions.includes(ext);
};

const ensureInSandbox = (targetPath) => {
  const resolved = path.resolve(targetPath);
  const sandbox = path.resolve(config.downloadDir);
  if (!resolved.startsWith(sandbox + path.sep) && resolved !== sandbox) {
    throw new Error('路径越界: 文件操作被限制在下载目录内');
  }
  return resolved;
};

const getCategoryFromPath = (relativePath) => {
  const parts = relativePath.split(/[\\/]/);
  if (parts.length < 2) return 'root';
  return parts[0];
};

module.exports = {
  sanitizeFilename,
  getExtension,
  isAllowedExtension,
  ensureInSandbox,
  getCategoryFromPath,
};
