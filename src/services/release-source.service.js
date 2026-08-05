const { db } = require('../db');

const SOURCE_FIELDS = [
  'name',
  'type',
  'owner',
  'repo',
  'branch',
  'enabled',
  'schedule',
  'target_category',
  'asset_include_pattern',
  'asset_exclude_pattern',
  'include_prerelease',
  'include_draft',
  'sync_interval_ms',
  'config',
];

const ensureStore = () => {
  if (!Array.isArray(db.data.release_sources)) db.data.release_sources = [];
  if (!Array.isArray(db.data.release_jobs)) db.data.release_jobs = [];
  if (!db.data._nextReleaseSourceId) db.data._nextReleaseSourceId = 1;
  if (!db.data._nextReleaseJobId) db.data._nextReleaseJobId = 1;
};

const now = () => new Date().toISOString();

const normalize = (input, partial = false) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('来源参数必须是对象');
  const value = {};
  for (const field of SOURCE_FIELDS) {
    if (input[field] !== undefined) value[field] = input[field];
  }
  if (!partial) {
    if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) throw new Error('请提供有效的来源名称');
    if (value.type === undefined) value.type = 'github';
    if (value.type !== 'github') throw new Error('来源类型必须是 github');
    if (typeof value.owner !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(value.owner)) throw new Error('owner 格式无效');
    if (typeof value.repo !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(value.repo)) throw new Error('repo 格式无效');
  }
  if (value.type !== undefined && value.type !== 'github') throw new Error('来源类型必须是 github');
  for (const field of ['name', 'owner', 'repo', 'branch']) {
    if (value[field] !== undefined && (typeof value[field] !== 'string' || value[field].length > 100)) throw new Error(`${field} 格式无效`);
  }
  for (const field of ['asset_include_pattern', 'asset_exclude_pattern']) {
    if (value[field] !== undefined && (typeof value[field] !== 'string' || value[field].length > 200)) throw new Error(`${field} 格式无效`);
  }
  if (value.enabled !== undefined) {
    if (typeof value.enabled !== 'boolean') throw new Error('enabled 必须是布尔值');
  }
  if (value.include_prerelease !== undefined && typeof value.include_prerelease !== 'boolean') throw new Error('include_prerelease 必须是布尔值');
  if (value.include_draft !== undefined && typeof value.include_draft !== 'boolean') throw new Error('include_draft 必须是布尔值');
  if (value.sync_interval_ms !== undefined && (!Number.isInteger(value.sync_interval_ms) || value.sync_interval_ms < 300000 || value.sync_interval_ms > 604800000)) throw new Error('sync_interval_ms 必须在 5 分钟至 7 天之间');
  if (value.config !== undefined && (!value.config || typeof value.config !== 'object' || Array.isArray(value.config))) {
    throw new Error('config 必须是对象');
  }
  return value;
};

const publicSource = (source) => {
  if (!source) return source;
  const { config: _config, ...safe } = source;
  return safe;
};

const publicJob = (job) => {
  if (!job) return job;
  const { payload: _payload, ...safe } = job;
  return safe;
};

const list = () => {
  ensureStore();
  return db.data.release_sources.map(publicSource);
};

const rawGet = (id) => {
  ensureStore();
  return db.data.release_sources.find((source) => String(source.id) === String(id)) || null;
};

const get = (id) => publicSource(rawGet(id));

const create = (input) => {
  ensureStore();
  const value = normalize(input);
  const timestamp = now();
  const source = {
    id: db.data._nextReleaseSourceId++,
    ...value,
    enabled: value.enabled !== false,
    branch: value.branch || 'main',
    config: value.config || {},
    status: 'idle',
    last_sync_at: null,
    last_success_at: null,
    last_error: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
  db.data.release_sources.push(source);
  db._save();
  return source;
};

const update = (id, input) => {
  const source = rawGet(id);
  if (!source) return null;
  const value = normalize(input, true);
  Object.assign(source, value, { updated_at: now() });
  db._save();
  return publicSource(source);
};

const remove = (id) => {
  ensureStore();
  const index = db.data.release_sources.findIndex((source) => String(source.id) === String(id));
  if (index < 0) return false;
  db.data.release_sources.splice(index, 1);
  db._save();
  return true;
};

const setEnabled = (id, enabled) => update(id, { enabled });

const createJob = (source, type, payload = {}) => {
  ensureStore();
  const job = {
    id: db.data._nextReleaseJobId++,
    source_id: source.id,
    type,
    status: 'queued',
    payload,
    error: null,
    created_at: now(),
    started_at: null,
    finished_at: null,
  };
  db.data.release_jobs.push(job);
  db._save();
  return job;
};

const jobs = (sourceId) => {
  ensureStore();
  return db.data.release_jobs
    .filter((job) => sourceId === undefined || String(job.source_id) === String(sourceId))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map(publicJob);
};

const health = () => {
  ensureStore();
  const sources = list();
  const failed = sources.filter((source) => source.status === 'error');
  return { ok: failed.length === 0, sources: sources.length, enabled: sources.filter((s) => s.enabled).length, failed: failed.length };
};

const preview = (source, releases = []) => ({
  source_id: source.id,
  owner: source.owner,
  repo: source.repo,
  branch: source.branch,
  releases: Array.isArray(releases) ? releases : [],
});

const fallbackSync = async (source, payload = {}) => {
  if (source.status === 'running') throw new Error('来源同步正在运行');
  const job = createJob(source, 'sync', payload);
  source.status = 'running';
  source.last_sync_at = now();
  source.updated_at = now();
  job.status = 'succeeded';
  job.started_at = job.created_at;
  job.finished_at = now();
  source.status = 'idle';
  source.last_success_at = job.finished_at;
  source.last_error = null;
  db._save();
  return { job, source, synced: 0, releases: [] };
};

const optionalService = () => {
  try { return require('./release-sync.service'); } catch { return null; }
};

const sync = async (id, payload = {}) => {
  const source = rawGet(id);
  if (!source) return null;
  if (source.status === 'running') throw new Error('来源同步正在运行');
  const job = createJob(source, 'sync', payload);
  const started = now();
  Object.assign(source, { status: 'running', last_sync_at: started, last_error: null, updated_at: started });
  job.status = 'running';
  job.started_at = started;
  db._save();
  try {
    const service = optionalService();
    const result = service && typeof service.sync === 'function'
      ? await service.sync(source, payload)
      : await fallbackSync(source, payload);
    const finished = now();
    Object.assign(source, { status: 'idle', last_success_at: finished, last_error: null, updated_at: finished });
    Object.assign(job, { status: 'succeeded', finished_at: finished });
    db._save();
    return { ...result, job: publicJob(job), source: publicSource(source) };
  } catch (error) {
    const finished = now();
    Object.assign(source, { status: 'error', last_error: error.message, updated_at: finished });
    Object.assign(job, { status: 'failed', error: error.message, finished_at: finished });
    db._save();
    throw error;
  }
};

const call = async (method, sourceView, payload) => {
  const source = rawGet(sourceView.id);
  const service = optionalService();
  if (service && typeof service[method] === 'function') return service[method](source, payload);
  if (method === 'preview') return preview(source, payload?.releases);
  if (method === 'status') return { source_id: source.id, status: source.status, last_sync_at: source.last_sync_at, last_success_at: source.last_success_at, last_error: source.last_error };
  if (method === 'assets') return { source_id: source.id, assets: source.assets || [] };
  if (method === 'retry') return sync(source.id, { ...payload, retry: true });
  return {};
};

module.exports = { list, get, create, update, remove, setEnabled, jobs, health, sync, call, createJob, normalize };
