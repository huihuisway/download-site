const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const { config } = require('../config');
const releaseSourceService = require('./release-source.service');
const noticeService = require('./notice.service');

/**
 * 项目与文件同步状态
 *
 * 这一层是「项目」视角，包装在既有的 Release Source 之上：
 * 不重复实现 GitHub Release 同步，触发同步时直接调 releaseSourceService。
 * 状态由 来源状态 + 已同步记录 + 本地文件 三者推导，避免出现「管理员手填的状态」。
 */

const SOURCE_TYPES = ['github_release', 'github_actions', 'http_json', 'manifest', 'remote_file', 'local_directory', 'custom_http', 'manual'];

const PROJECT_STATUSES = ['synced', 'syncing', 'pending', 'partial', 'delayed', 'failed', 'unknown'];
const FILE_STATUSES = ['synced', 'syncing', 'pending', 'failed'];

const STATUS_LABELS = {
  synced: '已同步',
  syncing: '同步中',
  pending: '等待同步',
  partial: '部分完成',
  delayed: '同步延迟',
  failed: '同步失败',
  unknown: '状态未知',
};

const FILE_STATUS_LABELS = {
  synced: '已同步',
  syncing: '同步中',
  pending: '等待',
  failed: '失败',
};

const NOTIFY_KINDS = ['new_version', 'sync_complete', 'delayed', 'failed', 'recovered'];

// 同步开始后超过这个时间仍未成功，视为「同步延迟」
const DELAY_THRESHOLD_MS = 15 * 60 * 1000;

const ensureStore = () => {
  if (!Array.isArray(db.data.sync_projects)) db.data.sync_projects = [];
  if (!Array.isArray(db.data.sync_project_files)) db.data.sync_project_files = [];
  if (!Array.isArray(db.data.sync_events)) db.data.sync_events = [];
  if (!db.data._nextSyncProjectId) db.data._nextSyncProjectId = 1;
  if (!db.data._nextSyncEventId) db.data._nextSyncEventId = 1;
};

const now = () => new Date().toISOString();

// 注意别用 Date.parse(0)：它会把数字 0 解析成 2000 年而不是 epoch，
// 于是「从未同步」被判成「很久以前同步过」。
const parseTime = (value) => {
  if (!value || typeof value !== 'string') return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const asString = (value, max = 200) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const normalize = (input, partial = false) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('项目参数必须是对象');
  const value = {};

  if (input.name !== undefined || !partial) {
    const name = asString(input.name, 100);
    if (!name) throw new Error('请提供项目名称');
    value.name = name;
  }
  if (input.slug !== undefined) {
    const slug = asString(input.slug, 80);
    if (slug && !/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error('项目标识只能包含小写字母、数字与连字符');
    value.slug = slug;
  }
  if (input.description !== undefined) value.description = asString(input.description, 500);
  if (input.icon !== undefined) value.icon = asString(input.icon, 60);
  if (input.enabled !== undefined) value.enabled = input.enabled !== false;
  if (input.public_visible !== undefined) value.public_visible = input.public_visible !== false;
  if (input.affects_global_status !== undefined) value.affects_global_status = input.affects_global_status !== false;
  if (input.source_type !== undefined) {
    if (!SOURCE_TYPES.includes(input.source_type)) throw new Error(`来源类型必须是 ${SOURCE_TYPES.join(' / ')} 之一`);
    value.source_type = input.source_type;
  }
  if (input.source_config !== undefined) {
    if (input.source_config === null) value.source_config = {};
    else if (typeof input.source_config !== 'object' || Array.isArray(input.source_config)) throw new Error('source_config 必须是对象');
    else value.source_config = input.source_config;
  }
  if (input.source_id !== undefined) {
    if (input.source_id === null || input.source_id === '') value.source_id = null;
    else {
      const source = releaseSourceService.get(input.source_id);
      if (!source) throw new Error('绑定的发布来源不存在');
      value.source_id = source.id;
    }
  }
  if (input.local_path !== undefined) {
    const localPath = asString(input.local_path, 300).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (localPath.split('/').some((segment) => segment === '..' || segment === '.')) throw new Error('本地目录路径无效');
    value.local_path = localPath;
  }
  if (input.file_pattern !== undefined) value.file_pattern = asString(input.file_pattern, 200);
  if (input.file_exclude_pattern !== undefined) value.file_exclude_pattern = asString(input.file_exclude_pattern, 200);
  if (input.expected_assets !== undefined) {
    value.expected_assets = Array.isArray(input.expected_assets)
      ? input.expected_assets.map((item) => asString(item, 200)).filter(Boolean).slice(0, 200)
      : [];
  }
  if (input.check_interval_ms !== undefined) {
    const interval = Number(input.check_interval_ms);
    if (!Number.isFinite(interval) || interval < 300000 || interval > 604800000) throw new Error('检查周期必须在 5 分钟至 7 天之间');
    value.check_interval_ms = Math.trunc(interval);
  }
  if (input.timeout_ms !== undefined) {
    const timeout = Number(input.timeout_ms);
    if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 600000) throw new Error('超时必须介于 1 秒与 10 分钟之间');
    value.timeout_ms = Math.trunc(timeout);
  }
  if (input.depends_on !== undefined) {
    value.depends_on = Array.isArray(input.depends_on)
      ? input.depends_on.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0).slice(0, 20)
      : [];
  }
  if (input.notify !== undefined) {
    if (!input.notify || typeof input.notify !== 'object' || Array.isArray(input.notify)) throw new Error('notify 必须是对象');
    value.notify = {};
    for (const kind of NOTIFY_KINDS) {
      if (input.notify[kind] !== undefined) value.notify[kind] = input.notify[kind] === true;
    }
  }
  if (input.remote_version !== undefined) value.remote_version = asString(input.remote_version, 60);
  if (input.local_version !== undefined) value.local_version = asString(input.local_version, 60);
  return value;
};

const DEFAULT_NOTIFY = { new_version: false, sync_complete: false, delayed: true, failed: true, recovered: true };

// 项目状态变化后状态页/顶部状态必须立刻反映，避免缓存窗口里看到旧数据
const invalidatePublicStatus = () => {
  try { require('./status.service').invalidateStatusCache(); } catch { /* 循环依赖时忽略 */ }
  try { require('./shell.service').invalidateHeaderStatus(); } catch { /* 同上 */ }
};

const recordEvent = (project, type, payload = {}) => {
  ensureStore();
  const event = {
    id: db.data._nextSyncEventId++,
    project_id: project.id,
    type,
    status: project.status || null,
    payload,
    created_at: now(),
  };
  db.data.sync_events.push(event);
  // 只保留最近 500 条，JSON 库不做归档
  if (db.data.sync_events.length > 500) db.data.sync_events = db.data.sync_events.slice(-500);
  db._scheduleSave();
  return event;
};

const boundSource = (project) => (project.source_id ? releaseSourceService.get(project.source_id) : null);

const releaseRecordFor = (project) => {
  if (!project.source_id) return null;
  const records = (Array.isArray(db.data.release_sync) ? db.data.release_sync : [])
    .filter((item) => String(item.source_id) === String(project.source_id));
  if (!records.length) return null;
  return records
    .slice()
    .sort((a, b) => String(b.synced_at || '').localeCompare(String(a.synced_at || '')))[0];
};

const filesForProject = (project) => {
  const files = Array.isArray(db.data.download_logs) ? db.data.download_logs : [];
  return files.filter((file) => {
    if (project.source_id && String(file.source_id) === String(project.source_id)) return true;
    if (project.local_path && String(file.file_path || '').startsWith(`${project.local_path}/`)) return true;
    return false;
  });
};

const fileExists = (file) => {
  if (typeof file.file_path !== 'string' || path.isAbsolute(file.file_path)) return false;
  const fullPath = path.resolve(config.downloadDir, file.file_path);
  const relative = path.relative(config.downloadDir, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false;
  try {
    return fs.statSync(fullPath).isFile();
  } catch {
    return false;
  }
};

/** 单文件同步状态：物理文件存在即已同步；缺失的按项目整体状态归类 */
const fileStatus = (file, projectStatus) => {
  if (fileExists(file)) return 'synced';
  if (projectStatus === 'syncing') return 'syncing';
  if (projectStatus === 'failed' || projectStatus === 'partial') return 'failed';
  return 'pending';
};

const computeStatus = (project) => {
  if (project.enabled === false) return { status: 'unknown', reason: '项目已停用' };
  const source = boundSource(project);
  if (source && source.enabled === false) return { status: 'unknown', reason: '来源已停用' };

  if (source?.status === 'running') return { status: 'syncing', reason: '正在同步' };

  const record = releaseRecordFor(project);
  const files = filesForProject(project);
  const missing = files.filter((file) => !fileExists(file)).length;
  const lastSuccess = parseTime(project.last_success_at || source?.last_success_at || record?.synced_at);
  const lastStarted = parseTime(project.last_sync_started_at || source?.last_sync_at);
  const remote = project.remote_version || record?.tag_name || '';
  const local = project.local_version || '';

  if (source?.status === 'error' || record?.status === 'failed') {
    return { status: 'failed', reason: (source?.last_error || record?.error || '最近一次同步失败').slice(0, 200) };
  }
  if (!source && !files.length) return { status: 'pending', reason: '尚未同步' };

  // 从未成功同步过：不判「延迟」（否则新项目一上线就挂着「同步延迟」很像故障）。
  // 本地文件已经齐全且没有上游版本可对照时，按已同步处理。
  if (!lastSuccess) {
    if (files.length && missing === 0) return { status: 'synced', reason: '' };
    if (missing > 0) return { status: 'partial', reason: `${missing} 个文件尚未就绪` };
    return { status: 'pending', reason: '尚未完成首次同步' };
  }

  const elapsed = Date.now() - lastSuccess;
  // startedAgo 是「距本次同步开始已过去多久」；没有开始时间就用距上次成功的时间兜底
  const startedAgo = lastStarted ? Date.now() - lastStarted : elapsed;
  if (remote && local && remote !== local) {
    // 远端出现了新版本，本地还没跟上：短时间内算「同步中」，超过阈值算「延迟」
    const stale = startedAgo > DELAY_THRESHOLD_MS;
    return { status: stale ? 'delayed' : 'syncing', reason: `远端 ${remote}，本地 ${local}` };
  }
  if (missing > 0) return { status: 'partial', reason: `${missing} 个文件尚未就绪` };
  if (elapsed > DELAY_THRESHOLD_MS * 4) {
    return { status: 'delayed', reason: '长时间没有成功同步记录' };
  }
  return { status: 'synced', reason: '' };
};

const decorate = (project) => {
  const source = boundSource(project);
  const computed = computeStatus(project);
  const files = filesForProject(project);
  const syncedFiles = files.filter((file) => fileExists(file)).length;
  const record = releaseRecordFor(project);
  return {
    ...project,
    status: computed.status,
    status_label: STATUS_LABELS[computed.status] || STATUS_LABELS.unknown,
    status_reason: computed.reason,
    source: source || null,
    remote_version: project.remote_version || record?.tag_name || '',
    local_version: project.local_version || project.remote_version || record?.tag_name || '',
    expected_files: project.expected_assets?.length || files.length,
    synced_files: syncedFiles,
    failed_files: Math.max(0, files.length - syncedFiles),
    last_check_at: project.last_check_at || source?.last_sync_at || null,
    last_sync_started_at: project.last_sync_started_at || source?.last_sync_at || null,
    last_success_at: project.last_success_at || source?.last_success_at || record?.synced_at || null,
    error_message: project.error_message || source?.last_error || null,
  };
};

const list = () => {
  ensureStore();
  return db.data.sync_projects.map(decorate).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
};

const listPublic = () => list().filter((project) => project.enabled !== false && project.public_visible !== false);

const rawGet = (id) => {
  ensureStore();
  return db.data.sync_projects.find((project) => String(project.id) === String(id)) || null;
};

const get = (id) => {
  const project = rawGet(id);
  return project ? decorate(project) : null;
};

const getBySlug = (slug) => {
  ensureStore();
  const project = db.data.sync_projects.find((item) => item.slug && item.slug === slug);
  return project ? decorate(project) : null;
};

const create = (input) => {
  ensureStore();
  const value = normalize(input);
  const timestamp = now();
  const project = {
    id: db.data._nextSyncProjectId++,
    name: value.name,
    slug: value.slug || '',
    description: value.description || '',
    icon: value.icon || '',
    enabled: value.enabled !== false,
    public_visible: value.public_visible !== false,
    affects_global_status: value.affects_global_status !== false,
    source_type: value.source_type || 'github_release',
    source_id: value.source_id ?? null,
    source_config: value.source_config || {},
    local_path: value.local_path || '',
    file_pattern: value.file_pattern || '',
    file_exclude_pattern: value.file_exclude_pattern || '',
    expected_assets: value.expected_assets || [],
    check_interval_ms: value.check_interval_ms || 60 * 60 * 1000,
    timeout_ms: value.timeout_ms || 30000,
    depends_on: value.depends_on || [],
    notify: { ...DEFAULT_NOTIFY, ...(value.notify || {}) },
    remote_version: value.remote_version || '',
    local_version: value.local_version || '',
    last_check_at: null,
    last_sync_started_at: null,
    last_sync_at: null,
    last_success_at: null,
    error_message: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  if (project.slug && db.data.sync_projects.some((item) => item.slug === project.slug)) {
    throw new Error('项目标识已被占用');
  }
  db.data.sync_projects.push(project);
  db._save();
  recordEvent(project, 'project_created');
  invalidatePublicStatus();
  return decorate(project);
};

const update = (id, input) => {
  const project = rawGet(id);
  if (!project) return null;
  const value = normalize(input, true);
  if (value.slug && db.data.sync_projects.some((item) => item.slug === value.slug && item !== project)) {
    throw new Error('项目标识已被占用');
  }
  if (value.notify) value.notify = { ...DEFAULT_NOTIFY, ...project.notify, ...value.notify };
  Object.assign(project, value, { updated_at: now() });
  db._save();
  invalidatePublicStatus();
  return decorate(project);
};

const remove = (id) => {
  ensureStore();
  const index = db.data.sync_projects.findIndex((project) => String(project.id) === String(id));
  if (index < 0) return false;
  const [removed] = db.data.sync_projects.splice(index, 1);
  db.data.sync_events = db.data.sync_events.filter((event) => String(event.project_id) !== String(removed.id));
  db.data.sync_project_files = db.data.sync_project_files.filter((file) => String(file.project_id) !== String(removed.id));
  for (const project of db.data.sync_projects) {
    if (Array.isArray(project.depends_on)) {
      project.depends_on = project.depends_on.filter((dependencyId) => String(dependencyId) !== String(removed.id));
    }
  }
  db._save();
  invalidatePublicStatus();
  return true;
};

/**
 * 目录状态推导：
 * 目录绑定项目来自 project.local_path；一个目录下可能挂着多个项目，
 * 按「全部完成 / 存在同步中 / 部分完成 / 存在失败 / 全部未知」聚合。
 */
/**
 * 目录状态聚合：目录下多个项目状态不一致时按「最需要被看见」的那个展示，
 * 但不能因为一个失败子项目就把整层显示成异常 —— 混合情况统一落到「部分完成」。
 */
const aggregateStatus = (statuses) => {
  if (!statuses.length) return null;
  const kinds = new Set(statuses);
  if (kinds.size === 1) return statuses[0];
  if (kinds.has('syncing')) return 'syncing';
  if (kinds.has('failed')) return 'failed';
  if (kinds.has('partial')) return 'partial';
  if (kinds.has('delayed')) return 'delayed';
  return 'partial';
};

/** 返回「目录路径 → 状态」的聚合视图，未绑定项目的目录不出现在结果里 */
const statusByDirectory = () => {
  const projects = list().filter((project) => project.local_path);
  const result = {};
  const paths = new Set();
  for (const project of projects) {
    const segments = project.local_path.split('/');
    for (let i = 1; i <= segments.length; i += 1) paths.add(segments.slice(0, i).join('/'));
  }
  for (const dirPath of paths) {
    const matched = projects.filter((project) => project.local_path === dirPath || project.local_path.startsWith(`${dirPath}/`));
    if (!matched.length) continue;
    const status = aggregateStatus(matched.map((project) => project.status));
    if (!status) continue;
    result[dirPath] = {
      status,
      status_label: STATUS_LABELS[status] || STATUS_LABELS.unknown,
      projects: matched.map((project) => ({ id: project.id, name: project.name, status: project.status })),
    };
  }
  return result;
};

const directoryStatusFor = (dirPath, map = statusByDirectory()) => map[dirPath] || null;

const listFiles = (id) => {
  const project = rawGet(id);
  if (!project) return null;
  const decorated = decorate(project);
  const files = filesForProject(project);
  const rows = files.map((file) => {
    const status = fileStatus(file, decorated.status);
    return {
      file_id: file.id,
      file_name: file.file_name,
      file_path: file.file_path,
      size: Number(file.file_size) || 0,
      status,
      status_label: FILE_STATUS_LABELS[status],
      version: file.version_tag || '',
      sha256: file.sha256 || null,
    };
  });
  // 管理员填写的期望文件（还没有落盘的）补进列表，避免「看不到缺什么」
  const missing = (project.expected_assets || [])
    .filter((name) => !files.some((file) => file.file_name === name))
    .map((name) => ({
      file_id: null,
      file_name: name,
      file_path: project.local_path ? `${project.local_path}/${name}` : name,
      size: 0,
      status: decorated.status === 'syncing' ? 'syncing' : 'pending',
      status_label: decorated.status === 'syncing' ? FILE_STATUS_LABELS.syncing : FILE_STATUS_LABELS.pending,
      version: decorated.remote_version || '',
      sha256: null,
    }));
  return {
    project: decorated,
    files: rows.concat(missing).sort((a, b) => a.file_name.localeCompare(b.file_name)),
  };
};

/** 同步链：上游 → 构建 → Release → MDT File → 下载节点 */
const buildChain = (project) => {
  const source = boundSource(project);
  const record = releaseRecordFor(project);
  const status = project.status || computeStatus(project).status;
  const done = status === 'synced';
  const running = status === 'syncing';
  const nodes = [
    { key: 'upstream', label: '上游版本', state: record || source ? 'done' : 'waiting', detail: project.remote_version || project.local_version || '' },
    { key: 'build', label: '构建任务', state: record ? 'done' : 'waiting', detail: '' },
    { key: 'release', label: 'MDT Release', state: record?.status === 'published' ? 'done' : record?.status === 'failed' ? 'failed' : 'waiting', detail: record?.tag_name || '' },
    { key: 'sync', label: 'MDT File Sync', state: done ? 'done' : running ? 'running' : status === 'failed' ? 'failed' : 'waiting', detail: '' },
    { key: 'cdn', label: '下载节点', state: done ? 'done' : 'waiting', detail: '' },
  ];
  return { status, nodes, summary: humanizeChain(project, status) };
};

/** 普通用户看到的简化描述（技术细节留在后台） */
const humanizeChain = (project, status) => {
  const version = project.remote_version || project.local_version || '';
  const subject = `${project.name}${version ? ` ${version}` : ''}`;
  switch (status) {
    case 'synced':
      return `${subject} 已同步完成，可以直接下载。`;
    case 'syncing':
      return `${subject} 正在同步，当前已完成构建，正在分发下载文件。`;
    case 'delayed':
      return `${subject} 的文件同步有延迟，新版本可能暂时无法下载，已有版本不受影响。`;
    case 'failed':
      return `${subject} 最近一次同步失败，我们正在处理，已有版本不受影响。`;
    case 'partial':
      return `${subject} 部分文件还未同步完成。`;
    case 'pending':
      return `${subject} 正在等待首次同步。`;
    default:
      return `${subject} 的同步状态暂时未知。`;
  }
};

/** 依赖关系：仅保留数据结构与展示，不做 DAG 调度 */
const dependencyStatus = (project) => {
  const dependencies = (project.depends_on || [])
    .map((id) => get(id))
    .filter(Boolean)
    .map((dependency) => ({ id: dependency.id, name: dependency.name, status: dependency.status }));
  const blocked = dependencies.some((dependency) => dependency.status !== 'synced');
  return {
    dependencies,
    blocked,
    stage: project.status === 'syncing' ? '同步中' : project.status === 'synced' ? '已同步' : blocked ? '等待依赖' : '等待同步',
  };
};

/**
 * 自动通知：延迟 / 失败 / 恢复 三类，用 dedupe_key 保证同一项目同一状态只留一条。
 * 管理员可在项目里逐项关闭（notify.delayed / notify.failed / notify.recovered）。
 */
const syncAutoNotice = (project) => {
  const flags = { ...DEFAULT_NOTIFY, ...(project.notify || {}) };
  const version = project.remote_version || project.local_version || '';
  const reason = project.status_reason ? `（${project.status_reason}）` : '';

  if (project.status === 'delayed') {
    if (flags.delayed) {
      noticeService.upsertSystemNotice(`sync:${project.id}:delayed`, {
        title: `${project.name} 同步延迟`,
        content: `新版本${version ? ` ${version}` : ''} 暂时可能无法下载，已有版本不受影响。${reason}`,
        type: 'warning',
        scope: 'status',
        category: 'incident',
        priority: 60,
      });
    }
    noticeService.resolveSystemNotice(`sync:${project.id}:failed`);
    return;
  }

  if (project.status === 'failed') {
    if (flags.failed) {
      noticeService.upsertSystemNotice(`sync:${project.id}:failed`, {
        title: `${project.name} 同步失败`,
        content: `我们正在处理，已有版本不受影响。${reason}`,
        type: 'critical',
        scope: 'status',
        category: 'incident',
        priority: 70,
      });
    }
    noticeService.resolveSystemNotice(`sync:${project.id}:delayed`);
    return;
  }

  if (project.status === 'synced') {
    const hadProblem = noticeService.resolveSystemNotice(`sync:${project.id}:delayed`)
      | noticeService.resolveSystemNotice(`sync:${project.id}:failed`);
    if (hadProblem && flags.recovered) {
      noticeService.upsertSystemNotice(`sync:${project.id}:recovered`, {
        title: `${project.name} 文件同步已恢复`,
        content: `${project.name}${version ? ` ${version}` : ''} 已完成同步，可以正常下载。`,
        type: 'success',
        scope: 'status',
        category: 'announcement',
        priority: 40,
      });
    }
    return;
  }

  noticeService.resolveSystemNotice(`sync:${project.id}:delayed`);
  noticeService.resolveSystemNotice(`sync:${project.id}:failed`);
};

const refresh = (project, { notify = true } = {}) => {
  const before = project.status || null;
  const decorated = decorate(project);
  if (decorated.status !== before) {
    project.status = decorated.status;
    recordEvent(project, 'status_changed', { from: before, to: decorated.status, reason: decorated.status_reason });
  } else {
    project.status = decorated.status;
  }
  project.last_check_at = now();
  db._save();
  if (notify) syncAutoNotice(project);
  invalidatePublicStatus();
  return decorate(project);
};

const checkProject = (id) => {
  const project = rawGet(id);
  if (!project) return null;
  return refresh(project);
};

/** 绑定 Release Source 的项目可直接触发既有同步；其他来源类型先只做状态检查 */
const syncProject = async (id) => {
  const project = rawGet(id);
  if (!project) return null;
  project.last_sync_started_at = now();
  project.status = 'syncing';
  recordEvent(project, 'sync_requested', { source_id: project.source_id });
  db._save();

  if (!project.source_id) {
    project.error_message = '该项目尚未绑定发布来源，无法自动同步';
    project.status = 'pending';
    db._save();
    return { project: decorate(project), skipped: true, reason: project.error_message };
  }

  try {
    const result = await releaseSourceService.sync(project.source_id, { trigger: 'project' });
    const record = releaseRecordFor(project);
    if (result?.synced || result?.skipped) {
      project.error_message = null;
      project.last_success_at = now();
      project.remote_version = record?.tag_name || project.remote_version;
      project.local_version = record?.tag_name || project.local_version;
    }
    recordEvent(project, 'sync_finished', { synced: Boolean(result?.synced), skipped: Boolean(result?.skipped) });
    db._save();
    const decorated = refresh(project);
    const flags = { ...DEFAULT_NOTIFY, ...(project.notify || {}) };
    if (result?.synced && flags.sync_complete) {
      noticeService.upsertSystemNotice(`sync:${project.id}:completed`, {
        title: `${project.name} 同步完成`,
        content: `${project.name}${decorated.remote_version ? ` ${decorated.remote_version}` : ''} 已完成同步。`,
        type: 'success',
        scope: 'status',
        priority: 30,
      });
    }
    return { project: decorated, result };
  } catch (error) {
    project.error_message = String(error.message || '同步失败').slice(0, 300);
    project.status = 'failed';
    recordEvent(project, 'sync_failed', { error: project.error_message });
    db._save();
    const decorated = refresh(project);
    return { project: decorated, error: project.error_message };
  }
};

const events = (id, limit = 50) => {
  ensureStore();
  return db.data.sync_events
    .filter((event) => String(event.project_id) === String(id))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);
};

/** 全局刷新：调度器与状态页调用，顺带触发自动通知 */
const refreshAll = ({ notify = true } = {}) => {
  ensureStore();
  const result = db.data.sync_projects.map((project) => refresh(project, { notify }));
  invalidatePublicStatus();
  return result;
};

/** 首次启动时按既有 Release Source 生成项目骨架，老数据也能直接起来 */
const ensureDefaultProjects = () => {
  ensureStore();
  const created = [];
  const seeds = [
    { sourceKey: 'Anuken/Mindustry', name: 'Mindustry 主线', slug: 'mindustry', local_path: 'Mindustry/Main', description: 'Mindustry 官方稳定版与预发布版本', icon: 'mindustry' },
    { sourceKey: 'Anuken/Mindustry-Classic', name: 'Mindustry Classic', slug: 'mindustry-classic', local_path: 'Mindustry/Classic', description: 'Mindustry Classic 官方版本', icon: 'mindustry' },
  ];
  const sources = releaseSourceService.list();
  const androidRepository = String(config.releaseSync.mindustryAndroidRepository || '').trim().toLowerCase();
  if (androidRepository) seeds.push({ sourceKey: androidRepository, name: 'Mindustry Android', slug: 'mindustry-android', local_path: 'Mindustry/Main', description: 'MDT Android 社区构建', icon: 'android' });
  if (config.releaseSync.repository) seeds.push({ sourceKey: config.releaseSync.repository, name: 'MDT 启动器', slug: 'mdt-launcher', local_path: '', description: 'MDT 客户端发布版本', icon: 'launcher' });

  for (const seed of seeds) {
    const source = sources.find((item) => `${item.owner}/${item.repo}`.toLowerCase() === seed.sourceKey.toLowerCase());
    if (!source) continue;
    const existing = db.data.sync_projects.find((project) => String(project.source_id) === String(source.id));
    if (existing) {
      if (!existing.slug) {
        existing.slug = seed.slug;
        existing.updated_at = now();
      }
      continue;
    }
    created.push(create({
      name: seed.name,
      slug: seed.slug,
      description: seed.description,
      icon: seed.icon,
      source_type: 'github_release',
      source_id: source.id,
      local_path: seed.local_path,
      notify: DEFAULT_NOTIFY,
    }));
  }
  if (created.length) {
    db._save();
    invalidatePublicStatus();
  }
  return created;
};

module.exports = {
  SOURCE_TYPES,
  PROJECT_STATUSES,
  FILE_STATUSES,
  STATUS_LABELS,
  FILE_STATUS_LABELS,
  DEFAULT_NOTIFY,
  DELAY_THRESHOLD_MS,
  list,
  listPublic,
  get,
  getBySlug,
  create,
  update,
  remove,
  refresh,
  refreshAll,
  checkProject,
  syncProject,
  events,
  listFiles,
  buildChain,
  dependencyStatus,
  statusByDirectory,
  directoryStatusFor,
  ensureDefaultProjects,
  computeStatus,
};
