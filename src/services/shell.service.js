const statusService = require('./status.service');
const noticeService = require('./notice.service');

/**
 * 前台统一外壳的数据源：当前导航高亮、顶部服务状态、全局横幅公告。
 * 这些数据每个页面都要，集中在这里算，避免各路由重复取。
 */

const HEADER_STATUS_TTL_MS = 20 * 1000;
let headerCache = { expiresAt: 0, value: null };

const headerStatus = () => {
  const now = Date.now();
  if (headerCache.value && now < headerCache.expiresAt) return headerCache.value;
  let value = { status: 'unknown', status_short: '服务状态' };
  try {
    const overall = statusService.buildStatus();
    value = { status: overall.status, status_short: overall.status_short, updated_at: overall.updated_at };
  } catch {
    // 状态不可用不应影响页面本身
  }
  headerCache = { value, expiresAt: now + HEADER_STATUS_TTL_MS };
  return value;
};

const invalidateHeaderStatus = () => {
  headerCache = { expiresAt: 0, value: null };
};

const globalNotices = () => {
  try {
    return noticeService.listPublic({ scope: 'home' })
      .filter((notice) => notice.scope === 'global')
      .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));
  } catch {
    return [];
  }
};

const SECTIONS = [
  { section: 'mindustry', match: (p) => p === '/mindustry' || p.startsWith('/mindustry/') },
  { section: 'files', match: (p) => p === '/files' || p.startsWith('/files/') || p === '/category' || p.startsWith('/category/') },
  { section: 'status', match: (p) => p === '/status' || p.startsWith('/status/') },
  { section: 'notices', match: (p) => p === '/notices' || p.startsWith('/notices/') },
];

const sectionFor = (pathname = '') => {
  const path = String(pathname).split('?')[0];
  if (path === '/' || path === '') return 'home';
  const matched = SECTIONS.find((item) => item.match(path));
  return matched ? matched.section : '';
};

module.exports = { headerStatus, invalidateHeaderStatus, globalNotices, sectionFor };
