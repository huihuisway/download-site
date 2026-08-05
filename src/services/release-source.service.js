const { db } = require('../db');

const SOURCE_FIELDS = [
  'name',
  'type',
  'owner',
  'repo',
  'branch',
  'enabled',
  'schedule',
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
    if (!value.name || typeof value.name !== 'string') throw new Error('请提供来源名称');
    if (!value.type || typeof value.type !== 'string') value.type = 'github';
    if (!value.owner || !value.repo) throw new Error('请提供 owner 和 repo');
  }
  if (value.enabled !== undefined) value.enabled = Boolean(value.enabled);
  if (value.config !== undefined && (typeof value.config !== 'object' || Array.isArray(value.config))) {
    throw new Error('config 必须是对象');
  }
  return value;
};

const list = () => {
  ensureStore();
  return db.data.release_sources.map((source) => ({ ...source }));
};

const get = (id) => {
  ensureStore();
  return db.data.release_sources.find((source) => String(source.id) === String(id)) || null;
};

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
  const source = get(id);
  if (!source) return null;
  const value = normalize(input, true);
  Object.assign(source, value, { updated_at: now() });
  db._save();
  return source;
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
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
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
  const source = get(id);
  if (!source) return null;
  const service = optionalService();
  if (service && typeof service.sync === 'function') return service.sync(source, payload);
  return fallbackSync(source, payload);
};

const call = async (method, source, payload) => {
  const service = optionalService();
  if (service && typeof service[method] === 'function') return service[method](source, payload);
  if (method === 'preview') return preview(source, payload?.releases);
  if (method === 'status') return { source_id: source.id, status: source.status, last_sync_at: source.last_sync_at, last_success_at: source.last_success_at, last_error: source.last_error };
  if (method === 'assets') return { source_id: source.id, assets: source.assets || [] };
  if (method === 'retry') return sync(source.id, { ...payload, retry: true });
  return {};
};

module.exports = { list, get, create, update, remove, setEnabled, jobs, health, sync, call, createJob, normalize };
