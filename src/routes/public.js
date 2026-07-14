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

// EJS 辅助函数注入
router.use((req, res, next) => {
  res.locals.formatFileSize = formatFileSize;
  res.locals.formatDate = formatDate;
  res.locals.formatNumber = (num) => num?.toLocaleString('zh-CN') || '0';
  res.locals.getFileExt = getFileExt;
  res.locals.getFileIconClass = getFileIconClass;
  res.locals.currentTheme = themeService.getTheme();
  res.locals.siteInfo = themeService.getSiteInfo();
  next();
});

// Theme-aware render helper
const renderTheme = (res, view, data) => {
  const theme = themeService.getTheme();
  res.render(`themes/${theme}/${view}`, data);
};

// 首页 - 所有分类的文件列表
router.get('/', (req, res) => {
  const siteInfo = themeService.getSiteInfo();
  // JSON DB 不支持 DISTINCT，用 Set 去重
  const rawCategories = db.prepare('SELECT category FROM download_logs').all().map((r) => r.category);
  const categories = [...new Set(rawCategories)].sort();

  // 补充物理目录
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

  // 加载所有分类供导航使用
  const rawCategories = db.prepare('SELECT category FROM download_logs').all().map((r) => r.category);
  const allCategories = [...new Set(rawCategories)].sort();

  // 各分类的文件数
  const categoryCounts = {};
  for (const cat of allCategories) {
    categoryCounts[cat] = db.prepare('SELECT COUNT(*) as count FROM download_logs WHERE category = ?').get(cat).count;
  }

  const files = db.prepare(`
    SELECT * FROM download_logs
    WHERE category = ?
    ORDER BY file_name ASC
  `).all(category);

  // JSON DB 不支持多字段聚合查询，直接用 JS 计算统计
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

// 文件下载
router.get('/download/:id', (req, res, next) => {
  const file = statsService.getFileById(req.params.id);
  if (!file) {
    return res.status(404).render(`themes/${themeService.getTheme()}/error`, {
      title: '文件不存在',
      message: '请求的文件不存在或已被删除。',
      errorType: 'not_found',
      fileName: null,
    });
  }

  // 审核状态拦截
  if (file.approval_status === 'pending') {
    return res.status(403).render(`themes/${themeService.getTheme()}/error`, {
      title: '文件暂不可下载',
      message: '此文件正在等待论坛审核，审核通过后将开放下载。请耐心等待，如有疑问请联系论坛管理组。',
      errorType: 'pending',
      fileName: file.file_name,
    });
  }
  if (file.approval_status === 'rejected') {
    return res.status(403).render(`themes/${themeService.getTheme()}/error`, {
      title: '文件已被拒绝',
      message: file.reject_reason
        ? `此文件未通过论坛审核。拒绝原因：${file.reject_reason}`
        : '此文件未通过论坛审核，无法下载。如有疑问请联系论坛管理组。',
      errorType: 'rejected',
      fileName: file.file_name,
    });
  }

  const fullPath = path.join(config.downloadDir, file.file_path);

  try {
    ensureInSandbox(fullPath);
  } catch (err) {
    return res.status(403).render(`themes/${themeService.getTheme()}/error`, {
      title: '访问拒绝',
      message: err.message,
    });
  }

  if (!fs.existsSync(fullPath)) {
    return res.status(404).render(`themes/${themeService.getTheme()}/error`, {
      title: '文件不存在',
      message: '文件记录存在但物理文件已丢失，请联系管理员同步。',
    });
  }

  // 记录下载
  statsService.recordDownload(file.id);

  // 流式传输
  return createFileStream(fullPath, res, file.mime_type).catch((err) => {
    console.error('[download] 文件传输错误:', err);
    if (!res.headersSent) {
      next(err);
    }
  });
});

module.exports = router;
