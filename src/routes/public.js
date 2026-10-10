const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { db } = require('../db');
const { config } = require('../config');
const statsService = require('../services/stats.service');
const themeService = require('../services/theme.service');
const folderTreeService = require('../services/folder-tree.service');
const noticeService = require('../services/notice.service');
const statusService = require('../services/status.service');
const syncProjectService = require('../services/sync-project.service');
const shellService = require('../services/shell.service');
const { formatFileSize, formatDate, formatNumber } = require('../utils/format');
const { ensureInSandbox } = require('../utils/filename');
const { downloadLimiter, countDownloadLimiter } = require('../middleware/rateLimit');
const { renderThemeError } = require('../utils/render-theme');
const { buildManifest } = require('../services/mindustry-index.service');
const mindustryPresentation = require('../services/mindustry-presentation.service');
const {
  normalizePublicFilePath,
  encodePublicFilePath,
  buildFilePageUrl,
  buildFileDownloadUrl,
} = require('../utils/public-paths');

/**
 * 目录链接前缀跟随当前入口：从 /files 进就在 /files 下继续走，
 * 从旧的 /category 进来就留在 /category，避免浏览中途换 URL 结构。
 */
const directoryHrefBuilder = (reqPath) => {
  const useFilesPrefix = reqPath === '/files' || String(reqPath).startsWith('/files/');
  const base = useFilesPrefix ? '/files' : '/category';
  return (folderPath) => (folderPath === 'root' ? '/' : `${base}/${encodePublicFilePath(folderPath)}`);
};

// 新增顶层路由或静态挂载点时必须同步登记，否则会被文件详情页的 catch-all 吞掉
const RESERVED_ROOTS = new Set([
  'admin', 'auth', 'api', 'd', 'category', 'css', 'fonts', 'js', 'privacy', 'terms',
  'mindustry', 'files', 'status', 'notices',
]);
const RESERVED_EXACT_PATHS = new Set(['favicon.svg']);

const getFileExt = (filename) => {
  const ext = filename.split('.').pop()?.toUpperCase() || '';
  return ext.length > 4 ? ext.substring(0, 4) : ext;
};

const renderTheme = (res, view, data, status = 200) => {
  const theme = themeService.getTheme();
  return res.status(status).render(`themes/${theme}/${view}`, data);
};

// 委托给统一实现（会显式补齐 currentTheme / siteInfo / errorType 默认值）
const renderFileError = (res, status, data) => renderThemeError(res, status, data);

const isReservedPublicPath = (publicFilePath) => {
  if (!publicFilePath) return false;
  if (RESERVED_EXACT_PATHS.has(publicFilePath)) return true;
  const [root] = publicFilePath.split('/');
  return RESERVED_ROOTS.has(root);
};

const resolvePublicFileOrRenderError = (reqPath, res) => {
  const publicFilePath = normalizePublicFilePath(reqPath);
  const file = statsService.getFileByPath(publicFilePath);

  if (!file) {
    renderFileError(res, 404, {
      title: '文件不存在',
      message: '这个文件可能已经被移动或删除。',
      errorType: 'not_found',
      fileName: null,
    });
    return null;
  }

  if (file.approval_status === 'pending') {
    renderFileError(res, 403, {
      title: '文件暂不可访问',
      message: '该文件正在等待论坛审核，审核通过后将开放访问。如有疑问请联系论坛管理组。',
      errorType: 'pending',
      fileName: file.file_name,
    });
    return null;
  }

  if (file.approval_status === 'rejected') {
    renderFileError(res, 403, {
      title: '文件未通过审核',
      message: file.reject_reason
        ? `该文件未通过论坛审核。拒绝原因：${file.reject_reason}`
        : '该文件未通过论坛审核，无法访问。如有疑问请联系论坛管理组。',
      errorType: 'rejected',
      fileName: file.file_name,
    });
    return null;
  }

  const fullPath = path.join(config.downloadDir, file.file_path);

  try {
    ensureInSandbox(fullPath);
  } catch (err) {
    renderFileError(res, 403, { title: '访问拒绝', message: err.message });
    return null;
  }

  if (!fs.existsSync(fullPath)) {
    renderFileError(res, 404, {
      title: '文件不存在',
      message: '该文件的记录还在，但物理文件已丢失，请联系管理员重新同步。',
      errorType: 'not_found',
      fileName: file.file_name,
    });
    return null;
  }

  return { file, fullPath, publicFilePath };
};

/**
 * 文件同步状态：有 Release 记录的文件按记录状态判定，
 * 手动上传的文件只要记录还在且文件存在就是已同步。
 */
const buildSyncContext = () => {
  const releases = Array.isArray(db.data.release_sync) ? db.data.release_sync : [];
  const releaseMap = new Map();
  for (const record of releases) {
    releaseMap.set(`${record.source_id}:${record.release_id}`, record);
  }
  const projects = syncProjectService.list();
  const projectBySource = new Map();
  for (const project of projects) {
    if (project.source_id !== null && project.source_id !== undefined) projectBySource.set(String(project.source_id), project);
  }

  const statusOf = (file) => {
    if (file.approval_status === 'pending') return 'pending';
    const record = file.source_id && file.release_id !== undefined
      ? releaseMap.get(`${file.source_id}:${file.release_id}`)
      : null;
    if (record?.status === 'failed') return 'failed';
    if (record?.status === 'published') return 'synced';
    if (record && record.status !== 'published') return 'syncing';
    return 'synced';
  };

  return {
    fileStatus: (file) => statusOf(file),
    fileStatusLabel: (file) => syncProjectService.FILE_STATUS_LABELS[statusOf(file)] || '状态未知',
    projectForFile: (file) => (file.source_id !== undefined && file.source_id !== null
      ? projectBySource.get(String(file.source_id)) || null
      : null),
  };
};

const releasePageHref = (file) => {
  if (!file || !file.game_id) return null;
  return '/mindustry';
};

// EJS 辅助函数注入
router.use((req, res, next) => {
  const syncContext = buildSyncContext();
  res.locals.formatFileSize = formatFileSize;
  res.locals.formatDate = formatDate;
  res.locals.formatNumber = formatNumber;
  res.locals.getFileExt = getFileExt;
  res.locals.buildFilePageUrl = buildFilePageUrl;
  res.locals.buildFileDownloadUrl = buildFileDownloadUrl;
  res.locals.buildCategoryHref = req.path === '/files' || String(req.path).startsWith('/files/')
    ? directoryHrefBuilder(req.path)
    : folderTreeService.buildCategoryHref;
  res.locals.buildDirHref = directoryHrefBuilder(req.path);
  res.locals.buildFilesHref = directoryHrefBuilder('/files/x');
  res.locals.currentTheme = themeService.getTheme();
  res.locals.siteInfo = themeService.getSiteInfo();
  res.locals.fileSyncStatus = syncContext.fileStatus;
  res.locals.fileSyncLabel = syncContext.fileStatusLabel;
  res.locals.currentUser = res.locals.currentUser || null;
  res.locals.shellSection = shellService.sectionFor(req.path);
  res.locals.headerStatus = shellService.headerStatus();
  res.locals.globalNotices = shellService.globalNotices();
  res.locals.pageScripts = [];
  res.locals.syncProjects = syncProjectService.listPublic();
  req.npcSyncContext = syncContext;
  next();
});

const listDownloadFiles = () => db.prepare('SELECT * FROM download_logs ORDER BY file_path ASC').all();

const folderUpdatedAt = (files, folderPath) => {
  let latest = null;
  for (const file of files) {
    if (file.file_path !== folderPath && !String(file.file_path).startsWith(`${folderPath}/`)) continue;
    const stamp = file.file_mtime || file.updated_at;
    if (stamp && (!latest || stamp > latest)) latest = stamp;
  }
  return latest;
};

const renderDirectory = (res, { currentPath, directoryName }) => {
  const siteInfo = themeService.getSiteInfo();
  const allFiles = listDownloadFiles();
  const physicalFolders = folderTreeService.listPhysicalFolders(config.downloadDir);
  const directory = folderTreeService.listFolderEntries({ currentPath, files: allFiles, physicalFolders });

  const directoryStatuses = syncProjectService.statusByDirectory();
  const directories = directory.directories.map((dir) => ({
    ...dir,
    updatedAt: folderUpdatedAt(allFiles, dir.path),
    status: directoryStatuses[dir.path] || null,
  }));

  const categoryStats = {
    file_count: directory.files.length,
    total_downloads: directory.files.reduce((sum, f) => sum + (Number(f.download_count) || 0), 0),
    total_size: directory.files.reduce((sum, f) => sum + (Number(f.file_size) || 0), 0),
  };

  return renderTheme(res, 'category', {
    title: `${directory.isRoot ? '文件目录' : directory.currentPath} - ${siteInfo.site_name}`,
    description: `${siteInfo.site_name} 文件目录：浏览全部目录与文件，保留原始目录结构、大小与校验信息。`,
    canonicalUrl: 'https://file.mdtbbs.cn/files',
    currentPath: directory.currentPath,
    isRoot: directory.isRoot,
    directoryName: directoryName || '文件目录',
    rootHref: directory.rootHref,
    parentHref: directory.parentHref,
    parentPath: directory.parentPath,
    ancestors: directory.ancestors,
    breadcrumbs: directory.breadcrumbs,
    directories,
    files: directory.files,
    treeRows: directory.treeRows,
    stats: categoryStats,
    isEmpty: directory.isEmpty,
    directoryStatuses,
    currentProject: (() => {
      const candidates = Object.entries(directoryStatuses)
        .filter(([dirPath]) => dirPath === directory.currentPath)
        .map(([, entry]) => entry.projects[0]?.id)
        .filter(Boolean);
      if (!candidates.length) return null;
      return syncProjectService.get(candidates[0]);
    })(),
  });
};

// 首页 - MDT File
router.get('/', (req, res) => {
  const siteInfo = themeService.getSiteInfo();
  const allFiles = listDownloadFiles();
  const physicalFolders = folderTreeService.listPhysicalFolders(config.downloadDir);
  const directory = folderTreeService.listFolderEntries({ currentPath: 'root', files: allFiles, physicalFolders });
  const directoryStatuses = syncProjectService.statusByDirectory();

  const totalFiles = allFiles.length;
  const totalDownloads = allFiles.reduce((sum, file) => sum + (Number(file.download_count) || 0), 0);

  let latestVersion = null;
  try {
    const manifest = buildManifest();
    const game = (manifest.games || []).find((item) => item.id === 'mindustry');
    const stable = (game?.releases || []).find((release) => release.channel === 'stable');
    latestVersion = (stable || game?.releases?.[0])?.build_name
      || manifest.featured_downloads?.build_name
      || null;
  } catch {
    latestVersion = null;
  }

  return renderTheme(res, 'index', {
    title: `${siteInfo.site_name} - MDTBBS 文件分发`,
    description: siteInfo.site_description,
    canonicalUrl: 'https://file.mdtbbs.cn/',
    currentPath: 'root',
    isRoot: true,
    rootHref: '/',
    parentHref: null,
    ancestors: [],
    directories: directory.directories.map((dir) => ({ ...dir, status: directoryStatuses[dir.path] || null })),
    files: [],
    treeRows: directory.treeRows,
    directoryStatus: directoryStatuses,
    totalFiles,
    totalDownloads,
    latestVersion,
    isEmpty: directory.isEmpty,
    recentNotices: noticeService.listPublic({ scope: 'home' }).slice(0, 4),
  });
});

// 统一文件目录入口 /files（/category/* 旧链接保持可用）
router.get(['/category', '/category/*'], (req, res) => {
  let currentPath;
  try {
    currentPath = folderTreeService.normalizeFolderPath(req.params[0] || 'root');
  } catch {
    return renderFileError(res, 404, {
      title: '目录不存在',
      message: '请求的目录路径无效。',
      errorType: 'not_found',
      fileName: null,
    });
  }
  return renderDirectory(res, { currentPath, directoryName: '文件目录' });
});

router.get(['/files', '/files/*'], (req, res) => {
  let currentPath;
  try {
    currentPath = folderTreeService.normalizeFolderPath(req.params[0] || 'root');
  } catch {
    return renderFileError(res, 404, {
      title: '目录不存在',
      message: '请求的目录路径无效。',
      errorType: 'not_found',
      fileName: null,
    });
  }
  const name = currentPath === 'root' ? '文件目录' : currentPath.split('/').slice(-1)[0];
  return renderDirectory(res, { currentPath, directoryName: name });
});

const renderMindustry = (req, res) => {
  const siteInfo = themeService.getSiteInfo();
  let manifest = null;
  try {
    manifest = buildManifest();
  } catch (err) {
    console.error('[mindustry] 版本清单生成失败:', err.message);
  }
  const projects = syncProjectService.listPublic().filter((project) => /mindustry/i.test(project.name) || /Mindustry/i.test(project.local_path || ''));
  return res.render('mindustry', {
    title: 'Mindustry 下载 - 最新版与历史版本 | MDT File',
    description: '由 MDT File 提供的 Mindustry 游戏版本镜像，可下载当前可用平台版本，并浏览历史 Build。',
    canonicalUrl: 'https://file.mdtbbs.cn/mindustry',
    currentTheme: themeService.getTheme(),
    siteInfo,
    manifest,
    ...mindustryPresentation,
    pageNotices: noticeService.listPublic({ scope: 'mindustry' }).filter((notice) => notice.scope !== 'global').slice(0, 2),
    syncProjects: projects,
    pageScripts: ['/js/mindustry-download.js'],
    shellSection: 'mindustry',
    headerStatus: shellService.headerStatus(),
    globalNotices: shellService.globalNotices(),
    appVersion: res.locals.appVersion,
    cspNonce: res.locals.cspNonce,
  });
};

router.get('/mindustry', renderMindustry);

router.get('/status', (req, res) => {
  const projects = syncProjectService.listPublic();
  const details = {};
  for (const project of projects) {
    const files = syncProjectService.listFiles(project.id);
    details[project.id] = {
      files: files ? files.files.slice(0, 30) : [],
      chain: syncProjectService.buildChain(project),
      dependency: syncProjectService.dependencyStatus(project),
      events: syncProjectService.events(project.id, 8),
    };
  }
  return res.render('status', {
    title: '服务状态 - MDT File',
    description: 'MDT File 实时服务状态：下载、Manifest、数据库、Release 同步、下载节点与项目同步进度。',
    canonicalUrl: 'https://file.mdtbbs.cn/status',
    currentTheme: themeService.getTheme(),
    siteInfo: themeService.getSiteInfo(),
    pageScripts: ['/js/status.js'],
    shellSection: 'status',
    headerStatus: shellService.headerStatus(),
    globalNotices: shellService.globalNotices(),
    status: statusService.buildStatus(),
    projectDetails: details,
    appVersion: res.locals.appVersion,
    cspNonce: res.locals.cspNonce,
  });
});

router.get('/notices', (req, res) => {
  const category = noticeService.NOTICE_CATEGORIES.includes(req.query.type) ? req.query.type : '';
  const all = noticeService.listPublic({ scope: 'home' });
  const notices = category ? all.filter((notice) => notice.category === category) : all;
  return res.render('notices', {
    title: '通知公告 - MDT File',
    description: 'MDT File 通知公告：版本更新、维护通知与故障通报。',
    canonicalUrl: 'https://file.mdtbbs.cn/notices',
    currentTheme: themeService.getTheme(),
    siteInfo: themeService.getSiteInfo(),
    pageScripts: ['/js/notices.js'],
    shellSection: 'notices',
    headerStatus: shellService.headerStatus(),
    globalNotices: shellService.globalNotices(),
    notices,
    activeCategory: category,
    categoryLabels: noticeService.CATEGORY_LABELS,
    appVersion: res.locals.appVersion,
    cspNonce: res.locals.cspNonce,
  });
});

router.get('/notices/:id', (req, res) => {
  const notice = noticeService.get(req.params.id);
  if (!notice || !notice.enabled) {
    return renderFileError(res, 404, {
      title: '通知不存在',
      message: '这条通知可能已经过期或被撤下。',
      errorType: 'not_found',
      fileName: null,
    });
  }
  return res.render('notice', {
    title: `${notice.title} - MDT File`,
    description: notice.content || notice.title,
    currentTheme: themeService.getTheme(),
    siteInfo: themeService.getSiteInfo(),
    pageScripts: [],
    shellSection: 'notices',
    headerStatus: shellService.headerStatus(),
    globalNotices: shellService.globalNotices(),
    notice,
    appVersion: res.locals.appVersion,
    cspNonce: res.locals.cspNonce,
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
  if (!resolved) return;

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

  return res.download(resolved.fullPath, resolved.file.file_name, { headers: downloadHeaders }, (err) => {
    if (!err) return;
    console.error('[download] 文件传输错误:', err.message);
    if (!res.headersSent) next(err);
  });
});

// 法律协议页面必须在文件详情 catch-all 之前注册，并列入保留路径
router.get('/privacy', (req, res) => {
  const privacyContent = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'privacy-policy.ejs'), 'utf-8');
  return res.render('legal', {
    title: '隐私政策',
    siteInfo: themeService.getSiteInfo(),
    currentTheme: themeService.getTheme(),
    legalContent: privacyContent,
    pageScripts: [],
    cspNonce: res.locals.cspNonce,
    appVersion: res.locals.appVersion,
  });
});

router.get('/terms', (req, res) => {
  const termsContent = fs.readFileSync(path.join(__dirname, '..', 'views', 'partials', 'terms-of-service.ejs'), 'utf-8');
  return res.render('legal', {
    title: '服务使用协议',
    siteInfo: themeService.getSiteInfo(),
    currentTheme: themeService.getTheme(),
    legalContent: termsContent,
    pageScripts: [],
    cspNonce: res.locals.cspNonce,
    appVersion: res.locals.appVersion,
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
  if (!resolved) return;

  const siteInfo = themeService.getSiteInfo();
  const fileHref = directoryHrefBuilder('/files/x');
  const parentPath = folderTreeService.getParentFolderPath(resolved.file.file_path);
  const project = req.npcSyncContext.projectForFile(resolved.file);
  return renderTheme(res, 'file', {
    title: `${resolved.file.file_name} - ${siteInfo.site_name}`,
    file: resolved.file,
    publicFilePath: resolved.publicFilePath,
    filePageHref: buildFilePageUrl(resolved.file.file_path),
    downloadUrl: buildFileDownloadUrl(resolved.file.file_path),
    parentHref: fileHref(parentPath),
    ancestors: folderTreeService.listFolderEntries({
      currentPath: parentPath,
      files: [],
      physicalFolders: [],
    }).ancestors,
    project,
    releaseHref: releasePageHref(resolved.file),
  });
});

module.exports = router;
