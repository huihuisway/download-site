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
  const { page = 1, pageSize = 50, sortBy = 'file_name', sortOrder = 'ASC', category, search } = options;
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

  // 先取全量再过滤：搜索必须在分页之前生效，total 反映过滤后数量
  let rows = db.prepare(`
    SELECT * FROM download_logs
    ${whereClause}
    ORDER BY ${sort} ${order}
  `).all(...params);

  if (search && String(search).trim()) {
    const q = String(search).trim().toLowerCase();
    rows = rows.filter((f) => (f.file_name || '').toLowerCase().includes(q));
  }

  const total = rows.length;
  const files = rows.slice(offset, offset + pageSize);

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

const getFileByPath = (filePath) => {
  return db.prepare('SELECT * FROM download_logs WHERE file_path = ?').get(filePath);
};

const cleanTelemetryText = (value, fallback, maxLength = 80) => {
  if (typeof value !== 'string') return fallback;
  const normalized = [...value]
    .filter((character) => {
      const code = character.codePointAt(0);
      return code > 0x1f && code !== 0x7f;
    })
    .join('')
    .trim()
    .slice(0, maxLength);
  return normalized || fallback;
};

const recordDownloadWithMetadata = (fileId, metadata = {}) => {
  const file = getFileById(Number(fileId));
  if (!file) return false;
  // 原子递增，避免竞态条件
  db.prepare(`
    UPDATE download_logs
    SET download_count = download_count + 1,
        last_download_at = @ts,
        updated_at = @ts
    WHERE id = @id
  `).run({
    ts: new Date().toISOString(),
    id: Number(fileId),
  });
  if (!Array.isArray(db.data.download_events)) db.data.download_events = [];
  const platforms = new Set(['android', 'windows', 'linux', 'macos', 'desktop', 'server', 'advanced', 'web', 'other']);
  const platform = cleanTelemetryText(metadata.platform, 'other', 24).toLowerCase();
  const event = {
    file_id: file.id,
    file_name: file.file_name,
    client_name: cleanTelemetryText(metadata.client_name, 'direct-link'),
    client_version: cleanTelemetryText(metadata.client_version, 'unknown', 40),
    platform: platforms.has(platform) ? platform : 'other',
    created_at: new Date().toISOString(),
  };
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  db.data.download_events = db.data.download_events
    .filter((item) => Date.parse(item.created_at) >= cutoff)
    .slice(-24999);
  db.data.download_events.push(event);
  db._scheduleSave();
  return true;
};

const getDownloadClientStats = () => {
  const events = Array.isArray(db.data.download_events) ? db.data.download_events : [];
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recent = events.filter((event) => Date.parse(event.created_at) >= since);
  const byClient = new Map();
  const byPlatform = new Map();
  for (const event of recent) {
    const clientKey = `${event.client_name}@${event.client_version}`;
    byClient.set(clientKey, (byClient.get(clientKey) || 0) + 1);
    byPlatform.set(event.platform, (byPlatform.get(event.platform) || 0) + 1);
  }
  return {
    period_days: 30,
    total: recent.length,
    clients: [...byClient].map(([client, count]) => ({ client, count })).sort((a, b) => b.count - a.count).slice(0, 20),
    platforms: [...byPlatform].map(([platform, count]) => ({ platform, count })).sort((a, b) => b.count - a.count),
  };
};

const recordDownload = (fileId, metadata) => recordDownloadWithMetadata(fileId, metadata);

module.exports = {
  getDashboardStats,
  getTopFiles,
  getCategoryStats,
  getFilesByCategory,
  getAllFiles,
  getFileById,
  getFileByPath,
  recordDownload,
  getDownloadClientStats,
};
