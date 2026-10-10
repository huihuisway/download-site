const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const { config } = require('../config');
const releaseSourceService = require('./release-source.service');
const syncProjectService = require('./sync-project.service');

/**
 * 服务状态
 * 所有检查都是本地/内存判断，不做外网请求 —— 状态页因此不会被上游拖慢。
 * 上游（GitHub API）用「最近一次同步记录」间接判断，出错信息只在后台展示。
 */

const SERVICE_STATUSES = ['operational', 'degraded', 'maintenance', 'outage', 'syncing', 'unknown'];

const STATUS_LABELS = {
  operational: '正常',
  degraded: '部分异常',
  maintenance: '维护中',
  outage: '不可用',
  syncing: '同步中',
  unknown: '状态未知',
};

const OVERALL_LABELS = {
  operational: '所有核心服务运行正常',
  degraded: '部分服务异常',
  maintenance: '服务维护中',
  outage: '核心服务不可用',
  syncing: '服务正常，部分内容同步中',
  unknown: '状态未知',
};

const STALE_SYNC_MS = 6 * 60 * 60 * 1000;

// 状态页与顶部状态入口会在短时间内被反复请求，做一次短缓存避免重复扫盘
const CACHE_TTL_MS = 20 * 1000;
let statusCache = { expiresAt: 0, value: null };

const now = () => new Date().toISOString();

const storagePath = () => (typeof db.dbPath === 'string' ? db.dbPath : config.dbPath);

const checkStorage = () => {
  const target = storagePath();
  try {
    fs.accessSync(path.dirname(target), fs.constants.W_OK);
    const size = fs.existsSync(target) ? fs.statSync(target).size : 0;
    return { status: 'operational', detail: `本地数据 ${(size / 1024).toFixed(0)} KB`, metrics: { size } };
  } catch {
    return { status: 'outage', detail: '数据目录不可写' };
  }
};

const checkDownload = () => {
  const downloadDir = config.downloadDir;
  try {
    if (!fs.existsSync(downloadDir)) return { status: 'degraded', detail: '下载目录不存在' };
    const total = Array.isArray(db.data.download_logs) ? db.data.download_logs.length : 0;
    return { status: 'operational', detail: `已索引 ${total} 个文件`, metrics: { files: total } };
  } catch {
    return { status: 'degraded', detail: '下载目录不可读' };
  }
};

const checkManifest = () => {
  try {
    const { buildManifest } = require('./mindustry-index.service');
    const manifest = buildManifest();
    const games = Array.isArray(manifest.games) ? manifest.games : [];
    const releases = games.reduce((sum, game) => sum + (game.releases?.length || 0), 0);
    if (!games.length) return { status: 'degraded', detail: '暂无可用的版本清单' };
    return { status: 'operational', detail: `${games.length} 个游戏 · ${releases} 个版本`, metrics: { games: games.length, releases } };
  } catch {
    return { status: 'outage', detail: '版本清单不可用' };
  }
};

const checkReleaseSync = () => {
  const sources = releaseSourceService.list();
  const records = Array.isArray(db.data.release_sync) ? db.data.release_sync : [];
  const enabled = sources.filter((source) => source.enabled !== false);
  if (!enabled.length) return { status: 'unknown', detail: '未配置发布来源' };
  const running = enabled.filter((source) => source.status === 'running');
  const failed = enabled.filter((source) => source.status === 'error');
  const latestSuccess = records
    .filter((record) => record.status === 'published' && record.synced_at)
    .map((record) => Date.parse(record.synced_at))
    .sort((a, b) => b - a)[0] || 0;
  const stale = latestSuccess ? Date.now() - latestSuccess > STALE_SYNC_MS : true;
  const metrics = { sources: sources.length, enabled: enabled.length, failed: failed.length, running: running.length, latest_success_at: latestSuccess ? new Date(latestSuccess).toISOString() : null };
  if (!config.releaseSync.enabled && !sources.length) return { status: 'unknown', detail: '自动同步未启用' };
  if (failed.length && !running.length) return { status: 'degraded', detail: `${failed.length} 个来源同步失败`, metrics };
  if (running.length) return { status: 'syncing', detail: `${running.length} 个来源正在同步`, metrics };
  if (stale && !latestSuccess) return { status: 'degraded', detail: '尚无成功的同步记录', metrics };
  return { status: 'operational', detail: latestSuccess ? `最近成功同步 ${new Date(latestSuccess).toLocaleString('zh-CN', { hour12: false })}` : '来源配置正常', metrics };
};

const checkGithubApi = () => {
  const tokenConfigured = Boolean(config.releaseSync.token);
  const records = Array.isArray(db.data.release_sync) ? db.data.release_sync : [];
  const errors = records.filter((record) => record.status === 'failed');
  const lastError = errors.sort((a, b) => String(b.synced_at || '').localeCompare(String(a.synced_at || '')))[0];
  if (lastError && Date.now() - Date.parse(lastError.synced_at || 0) < STALE_SYNC_MS) {
    return { status: 'degraded', detail: '最近一次上游请求失败', metrics: { authenticated: tokenConfigured } };
  }
  return { status: 'operational', detail: tokenConfigured ? '已配置访问凭证' : '匿名访问', metrics: { authenticated: tokenConfigured } };
};

const checkDownloadNodes = () => {
  const baseUrl = config.downloadBaseUrl;
  if (!baseUrl) return { status: 'operational', detail: '源站直连', metrics: { nodes: 1 } };
  try {
    const host = new URL(baseUrl).host;
    return { status: 'operational', detail: `下载域名 ${host}`, metrics: { nodes: 1, host } };
  } catch {
    return { status: 'degraded', detail: '下载域名配置无效' };
  }
};

const CORE_CHECKS = [
  { key: 'download', name: '文件下载', check: checkDownload },
  { key: 'manifest', name: 'Manifest', check: checkManifest },
  { key: 'database', name: '数据库', check: checkStorage },
  { key: 'release_sync', name: 'Release 同步', check: checkReleaseSync },
  { key: 'github_api', name: 'GitHub API', check: checkGithubApi },
  { key: 'cdn', name: 'CDN / 下载节点', check: checkDownloadNodes },
];

const worstStatus = (statuses) => {
  if (statuses.some((status) => status === 'outage')) return 'outage';
  if (statuses.some((status) => status === 'degraded')) return 'degraded';
  if (statuses.some((status) => status === 'maintenance')) return 'maintenance';
  if (statuses.some((status) => status === 'syncing')) return 'syncing';
  if (statuses.every((status) => status === 'unknown')) return 'unknown';
  return 'operational';
};

const buildServices = () => CORE_CHECKS.map(({ key, name, check }) => {
  let result;
  try {
    result = check();
  } catch {
    result = { status: 'unknown', detail: '' };
  }
  const status = SERVICE_STATUSES.includes(result.status) ? result.status : 'unknown';
  return {
    key,
    name,
    status,
    status_label: STATUS_LABELS[status],
    detail: result.detail || '',
    metrics: result.metrics || null,
  };
});

/** 只把「影响总体状态」的项目算进总状态，避免一个失败子项目把整站标成宕机 */
const projectSummary = () => {
  const projects = syncProjectService.list();
  const visible = projects.filter((project) => project.public_visible !== false);
  const affecting = visible.filter((project) => project.affects_global_status !== false);
  const counts = {};
  for (const project of visible) counts[project.status] = (counts[project.status] || 0) + 1;
  const degraded = affecting.filter((p) => p.status === 'failed');
  const partial = affecting.filter((p) => p.status === 'partial' || p.status === 'delayed');
  const syncing = affecting.filter((p) => p.status === 'syncing');
  const status = degraded.length ? 'degraded' : partial.length ? 'degraded' : syncing.length ? 'syncing' : 'operational';
  return { status, counts, projects: visible, degraded: degraded.length, partial: partial.length, syncing: syncing.length };
};

/**
 * 总体状态：核心服务与项目状态合成，维护公告可强制把整站标成维护中。
 */
const buildStatus = ({ requestId, fresh = false } = {}) => {
  if (!fresh && statusCache.value && Date.now() < statusCache.expiresAt) {
    return requestId ? { ...statusCache.value, freshness: { ...statusCache.value.freshness, request_id: requestId } } : statusCache.value;
  }
  const services = buildServices();
  const projects = projectSummary();
  const maintenanceNotice = (db.data.notices || []).find((notice) => notice.enabled !== false
    && notice.type === 'maintenance'
    && notice.scope === 'global'
    && (!notice.end_at || Date.parse(notice.end_at) > Date.now()));

  let status = worstStatus([...services.map((service) => service.status), projects.status]);
  if (maintenanceNotice) status = 'maintenance';
  if (status === 'unknown' && services.some((service) => service.status === 'operational')) status = 'degraded';

  const result = {
    status,
    status_label: OVERALL_LABELS[status] || OVERALL_LABELS.unknown,
    status_short: status === 'maintenance' ? '维护中' : ['outage', 'degraded'].includes(status) ? '部分服务异常' : '服务正常',
    maintenance: maintenanceNotice ? { id: maintenanceNotice.id, title: maintenanceNotice.title } : null,
    updated_at: now(),
    services,
    projects: {
      status: projects.status,
      counts: projects.counts,
      total: projects.projects.length,
      degraded: projects.degraded,
      partial: projects.partial,
      syncing: projects.syncing,
      items: projects.projects.map((project) => ({
        id: project.id,
        name: project.name,
        slug: project.slug,
        status: project.status,
        status_label: project.status_label,
        status_reason: project.status_reason,
        remote_version: project.remote_version,
        local_version: project.local_version,
        last_success_at: project.last_success_at,
        last_check_at: project.last_check_at,
        files: { expected: project.expected_files, synced: project.synced_files, failed: project.failed_files },
      })),
    },
    freshness: { ttl_seconds: Math.round(CACHE_TTL_MS / 1000), request_id: requestId || null },
  };
  statusCache = { value: result, expiresAt: Date.now() + CACHE_TTL_MS };
  return result;
};

const invalidateStatusCache = () => {
  statusCache = { expiresAt: 0, value: null };
};

module.exports = {
  SERVICE_STATUSES,
  STATUS_LABELS,
  OVERALL_LABELS,
  buildStatus,
  buildServices,
  invalidateStatusCache,
};
