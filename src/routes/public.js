const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { db } = require('../db');
const { config } = require('../config');
const statsService = require('../services/stats.service');
const themeService = require('../services/theme.service');
const { formatFileSize, formatDate } = require('../utils/format');
const { createFileStream } = require('../utils/stream');
const { ensureInSandbox } = require('../utils/filename');
const {
  normalizePublicFilePath,
  buildFilePageUrl,
  buildFileDownloadUrl,
} = require('../utils/public-paths');

const RESERVED_ROOTS = new Set(['admin', 'auth', 'api', 'd', 'category', 'css']);
const RESERVED_EXACT_PATHS = new Set(['favicon.svg']);

// Cloud theme helpers
const getFileExt = (filename) => {
  const ext = filename.split('.').pop()?.toUpperCase() || '';
  return ext.length > 4 ? ext.substring(0, 4) : ext;
};

const getFileIconClass = (filename) => {
  const ext = filename.split('.').pop()?.toLowerCase();
  const map = {
    pdf: 'doc', txt: 'doc', md: 'doc', doc: 'doc', docx: 'doc',
    zip: 'zip', gz: 'zip', tar: 'zip', '7z': 'zip', rar: 'zip',
    png: 'img', jpg: 'img', jpeg: 'img', gif: 'img', svg: 'img', webp: 'img',
    iso: 'iso', img: 'iso',
  };
  return map[ext] || 'default';
};

const renderTheme = (res, view, data, status = 200) => {
  const theme = themeService.getTheme();
  return res.status(status).render(`themes/${theme}/${view}`, data);
};

const renderFileError = (res, status, data) => {
  return renderTheme(res, 'error', data, status);
};

const getTrackedCategories = () => {
  const rawCategories = db.prepare('SELECT category FROM download_logs').all().map((r) => r.category);
  return [...new Set(rawCategories)].sort();
};

const getCategoriesWithDirectories = () => {
  const categories = getTrackedCategories();

  if (fs.existsSync(config.downloadDir)) {
    const dirs = fs.readdirSync(config.downloadDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const dir of dirs) {
      if (!categories.includes(dir)) {
        categories.push(dir);
      }
    }
  }

  return categories.sort();
};

const isReservedPublicPath = (publicFilePath) => {
  if (!publicFilePath) {
    return false;
  }

  if (RESERVED_EXACT_PATHS.has(publicFilePath)) {
    return true;
  }

  const [root] = publicFilePath.split('/');
  return RESERVED_ROOTS.has(root);
};

const resolvePublicFileOrRenderError = (reqPath, res) => {
  const publicFilePath = normalizePublicFilePath(reqPath);
  const file = statsService.getFileByPath(publicFilePath);

  if (!file) {
    renderFileError(res, 404, {
      title: '文件不存在',
      message: '请求的文件不存在或已被删除。',
      errorType: 'not_found',
      fileName: null,
    });
    return null;
  }

  if (file.approval_status === 'pending') {
    renderFileError(res, 403, {
      title: '文件暂不可访问',
      message: '此文件正在等待论坛审核，审核通过后将开放访问。请耐心等待，如有疑问请联系论坛管理组。',
      errorType: 'pending',
      fileName: file.file_name,
    });
    return null;
  }

  if (file.approval_status === 'rejected') {
    renderFileError(res, 403, {
      title: '文件已被拒绝',
      message: file.reject_reason
        ? `此文件未通过论坛审核。拒绝原因：${file.reject_reason}`
        : '此文件未通过论坛审核，无法访问。如有疑问请联系论坛管理组。',
      errorType: 'rejected',
      fileName: file.file_name,
    });
    return null;
  }

  const fullPath = path.join(config.downloadDir, file.file_path);

  try {
    ensureInSandbox(fullPath);
  } catch (err) {
    renderFileError(res, 403, {
      title: '访问拒绝',
      message: err.message,
    });
    return null;
  }

  if (!fs.existsSync(fullPath)) {
    renderFileError(res, 404, {
      title: '文件不存在',
      message: '文件记录存在但物理文件已丢失，请联系管理员同步。',
      errorType: 'not_found',
      fileName: file.file_name,
    });
    return null;
  }

  return {
    file,
    fullPath,
    publicFilePath,
  };
};

// EJS 辅助函数注入
router.use((req, res, next) => {
  res.locals.formatFileSize = formatFileSize;
  res.locals.formatDate = formatDate;
  res.locals.formatNumber = (num) => num?.toLocaleString('zh-CN') || '0';
  res.locals.getFileExt = getFileExt;
  res.locals.getFileIconClass = getFileIconClass;
  res.locals.buildFilePageUrl = buildFilePageUrl;
  res.locals.buildFileDownloadUrl = buildFileDownloadUrl;
  res.locals.currentTheme = themeService.getTheme();
  res.locals.siteInfo = themeService.getSiteInfo();
  next();
});

// 首页 - 所有分类的文件列表
router.get('/', (req, res) => {
  const siteInfo = themeService.getSiteInfo();
  const categories = getCategoriesWithDirectories();

  const filesByCategory = {};
  for (const cat of categories) {
    filesByCategory[cat] = db.prepare(`
      SELECT * FROM download_logs
      WHERE category = ?
      ORDER BY file_name ASC
    `).all(cat);
  }

  const totalFiles = db.prepare('SELECT COUNT(*) as count FROM download_logs').get().count;
  const totalDownloads = db.prepare('SELECT COALESCE(SUM(download_count), 0) as total FROM download_logs').get().total;

  renderTheme(res, 'index', {
    title: siteInfo.site_name,
    categories,
    filesByCategory,
    totalFiles,
    totalDownloads,
  });
});

// 分类页
router.get('/category/:category', (req, res) => {
  const siteInfo = themeService.getSiteInfo();
  const { category } = req.params;
  const allCategories = getTrackedCategories();

  const categoryCounts = {};
  for (const cat of allCategories) {
    categoryCounts[cat] = db.prepare('SELECT COUNT(*) as count FROM download_logs WHERE category = ?').get(cat).count;
  }

  const files = db.prepare(`
    SELECT * FROM download_logs
    WHERE category = ?
    ORDER BY file_name ASC
  `).all(category);

  const categoryStats = {
    file_count: files.length,
    total_downloads: files.reduce((sum, f) => sum + (Number(f.download_count) || 0), 0),
    total_size: files.reduce((sum, f) => sum + (Number(f.file_size) || 0), 0),
  };

  renderTheme(res, 'category', {
    title: `${category} - ${siteInfo.site_name}`,
    category,
    files,
    stats: categoryStats,
    allCategories,
    categoryCounts,
  });
});

// 真实下载
router.get('/d/*', (req, res, next) => {
  const resolved = resolvePublicFileOrRenderError(req.params[0], res);
  if (!resolved) {
    return;
  }

  statsService.recordDownload(resolved.file.id);

  return createFileStream(resolved.fullPath, res, resolved.file.mime_type).catch((err) => {
    console.error('[download] 文件传输错误:', err);
    if (!res.headersSent) {
      next(err);
    }
  });
});

// 文件页面
router.get('*', (req, res, next) => {
  const publicFilePath = normalizePublicFilePath(req.path);
  if (isReservedPublicPath(publicFilePath)) {
    return next();
  }

  const resolved = resolvePublicFileOrRenderError(publicFilePath, res);
  if (!resolved) {
    return;
  }

  const siteInfo = themeService.getSiteInfo();
  return renderTheme(res, 'file', {
    title: `${resolved.file.file_name} - ${siteInfo.site_name}`,
    file: resolved.file,
    publicFilePath: resolved.publicFilePath,
    downloadUrl: buildFileDownloadUrl(resolved.file.file_path),
  });
});

module.exports = router;
