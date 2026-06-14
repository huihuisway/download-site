const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B';
  if (!bytes || bytes < 0) return '-';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = (bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1);

  return `${size} ${units[i]}`;
};

const formatDate = (dateStr) => {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}`;
};

const formatNumber = (num) => {
  if (num === null || num === undefined) return '0';
  return num.toLocaleString('zh-CN');
};

module.exports = {
  formatFileSize,
  formatDate,
  formatNumber,
};
