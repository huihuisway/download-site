const { db } = require('../db');

const getDashboardStats = () => {
  const totalFiles = db.prepare('SELECT COUNT(*) as count FROM download_logs').get().count;
  const totalDownloads = db.prepare('SELECT COALESCE(SUM(download_count), 0) as total FROM download_logs').get().total;
  const totalSize = db.prepare('SELECT COALESCE(SUM(file_size), 0) as total FROM download_logs').get().total;
  const totalCategories = db.prepare('SELECT COUNT(DISTINCT category) as count FROM download_logs').get().count;

  // 近 7 天下载趋势（在 JS 层面计算，因 JSON DB 不支持 DATE 函数）
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentDownloadsRaw = db.prepare(`
    SELECT id, last_download_at, download_count
    FROM download_logs
    WHERE last_download_at IS NOT NULL
  `).all();

  // 按日期分组
  const dailyMap = {};
  for (const record of recentDownloadsRaw) {
    if (record.last_download_at >= sevenDaysAgo) {
      const date = record.last_download_at.slice(0, 10); // 'YYYY-MM-DD'
      dailyMap[date] = (dailyMap[date] || 0) + (Number(record.download_count) || 0);
    }
  }
  const recentDownloads = Object.entries(dailyMap)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // 最近下载的文件
  const recentFiles = db.prepare(`
    SELECT id, file_name, file_path, category, download_count, last_download_at
    FROM download_logs
    WHERE last_download_at IS NOT NULL
    ORDER BY last_download_at DESC
    LIMIT 10
  `).all();

  return {
    totalFiles,
    totalDownloads,
    totalSize,
    totalCategories,
    recentDownloads,
    recentFiles,
  };
};

const getTopFiles = (limit = 10) => {
  return db.prepare(`
    SELECT id, file_name, file_path, category, download_count, file_size, last_download_at
    FROM download_logs
    ORDER BY download_count DESC
    LIMIT ?
  `).all(limit);
};

const getCategoryStats = () => {
  return db.prepare(`
    SELECT
      category,
      COUNT(*) as file_count,
      SUM(file_size) as total_size,
      SUM(download_count) as total_downloads,
      MAX(last_download_at) as last_download
    FROM download_logs
    GROUP BY category
    ORDER BY total_downloads DESC
  `).all();
};

const getFilesByCategory = (category) => {
  return db.prepare(`
    SELECT * FROM download_logs
    WHERE category = ?
    ORDER BY file_name ASC
  `).all(category);
};

const getAllFiles = (options = {}) => {
  const { page = 1, pageSize = 50, sortBy = 'file_name', sortOrder = 'ASC', category } = options;
  const offset = (page - 1) * pageSize;

  const allowedSorts = ['file_name', 'file_size', 'download_count', 'file_mtime', 'created_at'];
  const sort = allowedSorts.includes(sortBy) ? sortBy : 'file_name';
  const order = sortOrder.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

  let whereClause = '';
  const params = [];

  if (category) {
    whereClause = 'WHERE category = ?';
    params.push(category);
  }

  const total = db.prepare(`SELECT COUNT(*) as count FROM download_logs ${whereClause}`).get(...params).count;

  const files = db.prepare(`
    SELECT * FROM download_logs
    ${whereClause}
    ORDER BY ${sort} ${order}
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);

  return {
    files,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
};

const getFileById = (fileId) => {
  return db.prepare('SELECT * FROM download_logs WHERE id = ?').get(fileId);
};

const recordDownload = (fileId) => {
  // 原子递增，避免竞态条件
  db.prepare(`
    UPDATE download_logs
    SET download_count = download_count + 1,
        last_download_at = @ts,
        updated_at = @ts
    WHERE id = @id
  `).run({
    ts: new Date().toISOString(),
    id: fileId,
  });
};

module.exports = {
  getDashboardStats,
  getTopFiles,
  getCategoryStats,
  getFilesByCategory,
  getAllFiles,
  getFileById,
  recordDownload,
};
