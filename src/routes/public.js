const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { db } = require('../db');
const { config } = require('../config');
const statsService = require('../services/stats.service');
const themeService = require('../services/theme.service');
const folderTreeService = require('../services/folder-tree.service');
const { formatFileSize, formatDate, formatNumber } = require('../utils/format');
const { ensureInSandbox } = require('../utils/filename');
const { downloadLimiter, countDownloadLimiter } = require('../middleware/rateLimit');
const { renderThemeError } = require('../utils/render-theme');
const { buildManifest } = require('../services/mindustry-index.service');
const mindustryPresentation = require('../services/mindustry-presentation.service');
const {
  normalizePublicFilePath,
  buildFilePageUrl,
  buildFileDownloadUrl,
} = require('../utils/public-paths');

// 新增顶层路由或静态挂载点时必须同步登记，否则会被文件详情页的 catch-all 吞掉
const RESERVED_ROOTS = new Set(['admin', 'auth', 'api', 'd', 'category', 'css', 'fonts', 'js', 'privacy', 'terms', 'mindustry']);
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

// 委托给统一实现（会显式补齐 currentTheme / siteInfo / errorType 默认值）
const renderFileError = (res, status, data) => renderThemeError(res, status, data);

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
  res.locals.formatNumber = formatNumber;
  res.locals.getFileExt = getFileExt;
  res.locals.getFileIconClass = getFileIconClass;
  res.locals.buildFilePageUrl = buildFilePageUrl;
  res.locals.buildFileDownloadUrl = buildFileDownloadUrl;
  res.locals.buildCategoryHref = folderTreeService.buildCategoryHref;
  res.locals.currentTheme = themeService.getTheme();
  res.locals.siteInfo = themeService.getSiteInfo();
  next();
});

// 首页 - 顶层目录浏览（统一为根目录视图）
router.get('/', (req, res) => {
  const siteInfo = themeService.getSiteInfo();
  const allFiles = db.prepare('SELECT * FROM download_logs ORDER BY file_path ASC').all();
  const physicalFolders = folderTreeService.listPhysicalFolders(config.downloadDir);
  const directory = folderTreeService.listFolderEntries({ currentPath: 'root', files: allFiles, physicalFolders });

  const totalFiles = db.prepare('SELECT COUNT(*) as count FROM download_logs').get().count;
  const totalDownloads = db.prepare('SELECT COALESCE(SUM(download_count), 0) as total FROM download_logs').get().total;

  renderTheme(res, 'index', {
    title: siteInfo.site_name,
    currentPath: 'root',
    isRoot: true,
    rootHref: '/',
    parentHref: null,
    ancestors: [],
    directories: directory.directories,
    files: [],
    treeRows: directory.treeRows,
    totalFiles,
    totalDownloads,
    isEmpty: directory.isEmpty,
  });
});

// 分类页 - 支持多层路径浏览
router.get(['/category', '/category/*'], (req, res) => {
  const siteInfo = themeService.getSiteInfo();
  let currentPath;
  try {
    currentPath = folderTreeService.normalizeFolderPath(req.params[0] || 'root');
  } catch {
    // 路径穿越等非法目录路径：渲染主题化 404
    return renderFileError(res, 404, {
      title: '目录不存在',
      message: '请求的目录路径无效。',
      errorType: 'not_found',
      fileName: null,
    });
  }
  const allFiles = db.prepare('SELECT * FROM download_logs ORDER BY file_path ASC').all();
  const physicalFolders = folderTreeService.listPhysicalFolders(config.downloadDir);
  const directory = folderTreeService.listFolderEntries({ currentPath, files: allFiles, physicalFolders });

  const categoryStats = {
    file_count: directory.files.length,
    total_downloads: directory.files.reduce((sum, f) => sum + (Number(f.download_count) || 0), 0),
    total_size: directory.files.reduce((sum, f) => sum + (Number(f.file_size) || 0), 0),
  };

  renderTheme(res, 'category', {
    title: `${directory.isRoot ? '目录' : directory.currentPath} - ${siteInfo.site_name}`,
    currentPath: directory.currentPath,
    isRoot: directory.isRoot,
    rootHref: directory.rootHref,
    parentHref: directory.parentHref,
    parentPath: directory.parentPath,
    ancestors: directory.ancestors,
    breadcrumbs: directory.breadcrumbs,
    directories: directory.directories,
    files: directory.files,
    treeRows: directory.treeRows,
    stats: categoryStats,
    isEmpty: directory.isEmpty,
  });
});

router.get('/mindustry', (req, res) => {
  const siteInfo = themeService.getSiteInfo();
  let manifest = null;
  try {
    manifest = buildManifest();
  } catch (err) {
    console.error('[mindustry] 版本清单生成失败:', err.message);
  }
  return res.render('mindustry', {
    title: 'Mindustry 下载 - 最新版与历史版本 | MDT File',
    description: '由 MDT File 提供的 Mindustry 游戏版本镜像，可下载当前可用平台版本，并浏览历史 Build。',
    canonicalUrl: 'https://file.mdtbbs.cn/mindustry',
    currentTheme: themeService.getTheme(),
    siteInfo,
    manifest,
    ...mindustryPresentation,
  });
});

// 前端下载计数上报（EdgeOne 等 CDN 缓存 /d/* 后，源站 res.on('finish') 不再触发，
// 由前端 JS 在用户点击下载按钮时主动上报；源站计数保留用于直链下载场景）
router.post('/count-download', countDownloadLimiter, (req, res) => {
  const { fileId } = req.body || {};
  const numericId = typeof fileId === 'number'
    ? fileId
    : (typeof fileId === 'string' && /^\d+$/.test(fileId) ? Number(fileId) : NaN);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) {
    return res.status(400).json({ error: '缺少 fileId 参数' });
  }
  try {
    statsService.recordDownload(numericId, {
      client_name: req.body?.client_name || req.body?.clientName,
      client_version: req.body?.client_version || req.body?.clientVersion,
      platform: req.body?.platform,
    });
    res.json({ success: true });
  } catch (err) {
    console.error('[count-download] 计数失败:', err.message);
    res.status(500).json({ error: '计数失败' });
  }
});

// 真实下载
// 用 res.download 以获得 Range(断点续传)、ETag/Last-Modified(协商缓存)
// 以及符合 RFC 6266/5987 的 Content-Disposition(中文文件名正确落地)
router.get('/d/*', downloadLimiter, (req, res, next) => {
  const resolved = resolvePublicFileOrRenderError(req.params[0], res);
  if (!resolved) {
    return;
  }

  // 计数策略：完整下载或下载工具的首个分片(bytes=0-)才计数；
  // 中段分片与 304 协商缓存不计数
  res.on('finish', () => {
    if (req.query.tracked === '1') return;
    const range = req.headers.range;
    const isFullDownload = res.statusCode === 200 && !range;
    const isFirstChunk = res.statusCode === 206 && /^bytes=0-/.test(range || '');
    if (isFullDownload || isFirstChunk) {
      try {
        statsService.recordDownload(resolved.file.id, { client_name: 'direct-link', client_version: 'unknown', platform: 'other' });
      } catch (err) {
        console.error('[download] 下载计数失败:', err.message);
      }
    }
  });

  const downloadHeaders = { 'Content-Type': resolved.file.mime_type || 'application/octet-stream' };
  if (resolved.file.source_id && resolved.file.release_id) {
    downloadHeaders['Cache-Control'] = 'public, max-age=31536000, immutable';
  }

  return res.download(
    resolved.fullPath,
    resolved.file.file_name,
    { headers: downloadHeaders },
    (err) => {
      if (!err) return;
      console.error('[download] 文件传输错误:', err.message);
      if (!res.headersSent) {
        next(err);
      }
    },
  );
});

// 法律协议页面必须在文件详情 catch-all 之前注册，并列入保留路径
router.get('/privacy', (req, res) => {
  const siteInfo = themeService.getSiteInfo();
  const privacyContent = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'privacy-policy.ejs'), 'utf-8');
  return res.render('legal', {
    title: '隐私政策',
    siteInfo,
    legalContent: privacyContent,
  });
});

router.get('/terms', (req, res) => {
  const siteInfo = themeService.getSiteInfo();
  const termsContent = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'terms-of-service.ejs'), 'utf-8');
  return res.render('legal', {
    title: '服务使用协议',
    siteInfo,
    legalContent: termsContent,
  });
});

// 文件详情页 catch-all
router.get('*', (req, res, next) => {
  // req.path 保留百分号编码，需解码后匹配 DB 中的原始路径；
  // 非法编码（文件名本身含 %）按原样回退匹配
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(req.path);
  } catch {
    decodedPath = req.path;
  }
  const publicFilePath = normalizePublicFilePath(decodedPath);
  if (isReservedPublicPath(publicFilePath)) {
    return next();
  }

  const resolved = resolvePublicFileOrRenderError(publicFilePath, res);
  if (!resolved) {
    return;
  }

  const siteInfo = themeService.getSiteInfo();
  const parentPath = folderTreeService.getParentFolderPath(resolved.file.file_path);
  return renderTheme(res, 'file', {
    title: `${resolved.file.file_name} - ${siteInfo.site_name}`,
    file: resolved.file,
    publicFilePath: resolved.publicFilePath,
    downloadUrl: buildFileDownloadUrl(resolved.file.file_path),
    parentHref: folderTreeService.buildCategoryHref(parentPath),
  });
});

module.exports = router;
