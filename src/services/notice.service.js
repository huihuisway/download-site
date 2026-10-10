const { db } = require('../db');

/**
 * 通知公告（Notice）
 * 前台分三级展示：Global Banner / 页面 Notice / Toast（Toast 由前端自行产生，不落库）。
 * 所有写操作直接改 JSON DB 的 notices 数组，与 release-source.service 保持同一风格。
 */

const NOTICE_TYPES = ['info', 'success', 'warning', 'critical', 'maintenance'];
const NOTICE_SCOPES = ['global', 'home', 'mindustry', 'directory', 'download', 'status'];
const NOTICE_PLATFORMS = ['all', 'windows', 'android', 'linux', 'macos'];
const NOTICE_CATEGORIES = ['announcement', 'version', 'maintenance', 'incident'];

const TYPE_LABELS = {
  info: '提示',
  success: '成功',
  warning: '警告',
  critical: '故障',
  maintenance: '维护',
};

const CATEGORY_LABELS = {
  announcement: '公告',
  version: '版本更新',
  maintenance: '维护通知',
  incident: '故障通知',
};

// 类型 → 默认分类：管理员只选类型时也能落到合适的通知中心分组
const DEFAULT_CATEGORY_BY_TYPE = {
  maintenance: 'maintenance',
  critical: 'incident',
  success: 'version',
};

const ensureStore = () => {
  if (!Array.isArray(db.data.notices)) db.data.notices = [];
  if (!db.data._nextNoticeId) db.data._nextNoticeId = 1;
};

const now = () => new Date().toISOString();
const asString = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const asOptionalDate = (value) => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
};
const normalize = (input, partial = false) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('通知参数必须是对象');
  const value = {};

  if (input.title !== undefined || !partial) {
    const title = asString(input.title, 120);
    if (!title) throw new Error('请提供通知标题');
    value.title = title;
  }
  if (input.content !== undefined) value.content = asString(input.content, 2000);
  if (input.type !== undefined) {
    if (!NOTICE_TYPES.includes(input.type)) throw new Error(`通知类型必须是 ${NOTICE_TYPES.join(' / ')} 之一`);
    value.type = input.type;
  } else if (!partial) {
    value.type = 'info';
  }
  if (input.scope !== undefined) {
    if (!NOTICE_SCOPES.includes(input.scope)) throw new Error(`目标位置必须是 ${NOTICE_SCOPES.join(' / ')} 之一`);
    value.scope = input.scope;
  } else if (!partial) {
    value.scope = 'global';
  }
  if (input.platform !== undefined) {
    if (!NOTICE_PLATFORMS.includes(input.platform)) throw new Error(`目标平台必须是 ${NOTICE_PLATFORMS.join(' / ')} 之一`);
    value.platform = input.platform;
  }
  if (input.category !== undefined) {
    if (!NOTICE_CATEGORIES.includes(input.category)) throw new Error(`通知分类必须是 ${NOTICE_CATEGORIES.join(' / ')} 之一`);
    value.category = input.category;
  }
  if (input.version !== undefined) value.version = asString(input.version, 40);
  if (input.priority !== undefined) {
    const priority = Number(input.priority);
    if (!Number.isFinite(priority)) throw new Error('priority 必须是数字');
    value.priority = Math.max(0, Math.min(100, Math.trunc(priority)));
  }
  if (input.dismissible !== undefined) value.dismissible = input.dismissible !== false;
  if (input.start_at !== undefined) value.start_at = asOptionalDate(input.start_at);
  if (input.end_at !== undefined) value.end_at = asOptionalDate(input.end_at);
  if (input.action_label !== undefined) value.action_label = asString(input.action_label, 40);
  if (input.action_url !== undefined) {
    const url = asString(input.action_url, 300);
    // 只允许站内相对路径与绝对 http(s)，避免把 javascript: 之类的地址投放到前台
    if (url && !(url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\')) && !/^https?:\/\//i.test(url)) {
      throw new Error('按钮链接必须是站内路径或 http(s) 地址');
    }
    value.action_url = url;
  }
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') throw new Error('enabled 必须是布尔值');
    value.enabled = input.enabled;
  }
  return value;
};

const isActiveAt = (notice, reference = Date.now()) => {
  if (notice.enabled === false) return false;
  if (notice.start_at && Date.parse(notice.start_at) > reference) return false;
  if (notice.end_at && Date.parse(notice.end_at) < reference) return false;
  return true;
};

const sortByPriority = (left, right) =>
  (Number(right.priority) || 0) - (Number(left.priority) || 0)
  || String(right.created_at || '').localeCompare(String(left.created_at || ''));

const decorate = (notice) => ({
  ...notice,
  type_label: TYPE_LABELS[notice.type] || TYPE_LABELS.info,
  category_label: CATEGORY_LABELS[notice.category] || CATEGORY_LABELS.announcement,
  active: isActiveAt(notice),
});

const list = () => {
  ensureStore();
  return db.data.notices.map(decorate).sort(sortByPriority);
};

const rawGet = (id) => {
  ensureStore();
  return db.data.notices.find((notice) => String(notice.id) === String(id)) || null;
};

const get = (id) => {
  const notice = rawGet(id);
  return notice ? decorate(notice) : null;
};

const create = (input) => {
  ensureStore();
  const value = normalize(input);
  const timestamp = now();
  const notice = {
    id: db.data._nextNoticeId++,
    title: value.title,
    content: value.content || '',
    type: value.type,
    category: value.category || DEFAULT_CATEGORY_BY_TYPE[value.type] || 'announcement',
    scope: value.scope,
    platform: value.platform || 'all',
    version: value.version || '',
    priority: value.priority === undefined ? 50 : value.priority,
    dismissible: value.dismissible !== false,
    start_at: value.start_at || null,
    end_at: value.end_at || null,
    action_label: value.action_label || '',
    action_url: value.action_url || '',
    enabled: value.enabled !== false,
    source: 'admin',
    dedupe_key: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  db.data.notices.push(notice);
  db._save();
  return decorate(notice);
};

const update = (id, input) => {
  const notice = rawGet(id);
  if (!notice) return null;
  const value = normalize(input, true);
  Object.assign(notice, value, { updated_at: now() });
  db._save();
  return decorate(notice);
};

const remove = (id) => {
  ensureStore();
  const index = db.data.notices.findIndex((notice) => String(notice.id) === String(id));
  if (index < 0) return false;
  db.data.notices.splice(index, 1);
  db._save();
  return true;
};

const setEnabled = (id, enabled) => update(id, { enabled: Boolean(enabled) });

/**
 * 系统通知：同一 dedupe_key 只保留一条，状态恢复时直接撤下，避免刷屏。
 * 与管理员人工通知用 source 区分（admin / system）。
 */
const upsertSystemNotice = (dedupeKey, input) => {
  ensureStore();
  if (!dedupeKey) throw new Error('系统通知必须提供 dedupe_key');
  const existing = db.data.notices.find((notice) => notice.source === 'system' && notice.dedupe_key === dedupeKey);
  const timestamp = now();
  const value = normalize({ type: 'warning', ...input }, false);
  if (existing) {
    // 内容没变就不动 updated_at，避免后台列表看起来一直在刷
    const unchanged = existing.title === value.title
      && existing.content === (value.content || '')
      && existing.type === value.type
      && existing.enabled === true;
    if (unchanged) return decorate(existing);
    Object.assign(existing, {
      title: value.title,
      content: value.content || '',
      type: value.type,
      category: value.category || DEFAULT_CATEGORY_BY_TYPE[value.type] || 'announcement',
      scope: value.scope,
      platform: value.platform || 'all',
      version: value.version || '',
      priority: value.priority === undefined ? 50 : value.priority,
      dismissible: value.dismissible !== false,
      action_label: value.action_label || '',
      action_url: value.action_url || '',
      enabled: true,
      updated_at: timestamp,
    });
    db._save();
    return decorate(existing);
  }
  const notice = {
    id: db.data._nextNoticeId++,
    title: value.title,
    content: value.content || '',
    type: value.type,
    category: value.category || DEFAULT_CATEGORY_BY_TYPE[value.type] || 'announcement',
    scope: value.scope,
    platform: value.platform || 'all',
    version: value.version || '',
    priority: value.priority === undefined ? 50 : value.priority,
    dismissible: value.dismissible !== false,
    start_at: null,
    end_at: null,
    action_label: value.action_label || '',
    action_url: value.action_url || '',
    enabled: true,
    source: 'system',
    dedupe_key: dedupeKey,
    created_at: timestamp,
    updated_at: timestamp,
  };
  db.data.notices.push(notice);
  db._save();
  return decorate(notice);
};

const resolveSystemNotice = (dedupeKey) => {
  ensureStore();
  const before = db.data.notices.length;
  db.data.notices = db.data.notices.filter((notice) => !(notice.source === 'system' && notice.dedupe_key === dedupeKey));
  if (db.data.notices.length !== before) {
    db._save();
    return true;
  }
  return false;
};

/** 前台可见通知：按作用域 / 平台筛选，停用与过期的一律不返回 */
const listPublic = ({ scope, platform } = {}) => {
  const reference = Date.now();
  return list()
    .filter((notice) => isActiveAt(notice, reference))
    .filter((notice) => !scope || notice.scope === 'global' || notice.scope === scope)
    .filter((notice) => !platform || notice.platform === 'all' || notice.platform === platform);
};

module.exports = {
  NOTICE_TYPES,
  NOTICE_SCOPES,
  NOTICE_PLATFORMS,
  NOTICE_CATEGORIES,
  TYPE_LABELS,
  CATEGORY_LABELS,
  list,
  listPublic,
  get,
  create,
  update,
  remove,
  setEnabled,
  upsertSystemNotice,
  resolveSystemNotice,
  isActiveAt,
  normalize,
};
