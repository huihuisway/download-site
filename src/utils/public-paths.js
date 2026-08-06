const normalizePublicFilePath = (filePath = '') => {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
};

// 按段 URL 编码（保留 /），使含空格、#、? 、% 等字符的文件名生成合法链接
const encodePublicFilePath = (filePath = '') => {
  return normalizePublicFilePath(filePath)
    .split('/')
    .map(encodeURIComponent)
    .join('/');
};

const buildFilePageUrl = (filePath = '') => {
  return `/${encodePublicFilePath(filePath)}`;
};

const buildFileDownloadUrl = (filePath = '', baseUrl = '') => {
  const downloadPath = `/d/${encodePublicFilePath(filePath)}`;
  return baseUrl ? `${baseUrl.replace(/\/+$/, '')}${downloadPath}` : downloadPath;
};

module.exports = {
  normalizePublicFilePath,
  encodePublicFilePath,
  buildFilePageUrl,
  buildFileDownloadUrl,
};
