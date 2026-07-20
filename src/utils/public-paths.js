const normalizePublicFilePath = (filePath = '') => {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
};

const buildFilePageUrl = (filePath = '') => {
  return `/${normalizePublicFilePath(filePath)}`;
};

const buildFileDownloadUrl = (filePath = '') => {
  return `/d/${normalizePublicFilePath(filePath)}`;
};

module.exports = {
  normalizePublicFilePath,
  buildFilePageUrl,
  buildFileDownloadUrl,
};
