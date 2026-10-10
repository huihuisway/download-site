const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

process.env.NODE_ENV = 'test';
const { setupTmpEnv } = require('./helpers/tmp-env');
const tmpEnv = setupTmpEnv('status');

describe('status service', () => {
  let statusService;
  let db;

  before(() => {
    fs.mkdirSync(process.env.DOWNLOAD_DIR, { recursive: true });
    ({ db } = require('../src/db'));
    statusService = require('../src/services/status.service');
  });

  after(() => tmpEnv.cleanup());

  beforeEach(() => {
    db.data.notices = [];
    db.data.sync_projects = [];
    db.data.release_sources = [];
    db.data._nextSyncProjectId = 1;
    statusService.invalidateStatusCache();
  });

  it('核心服务都带状态与中文文案', () => {
    const status = statusService.buildStatus({ fresh: true });
    const keys = status.services.map((service) => service.key);
    assert.deepStrictEqual(keys, ['download', 'manifest', 'database', 'release_sync', 'github_api', 'cdn']);
    status.services.forEach((service) => {
      assert.ok(statusService.SERVICE_STATUSES.includes(service.status));
      assert.ok(service.status_label);
    });
  });

  it('公开数据不包含路径、Token 等敏感字段', () => {
    const serialized = JSON.stringify(statusService.buildStatus({ fresh: true }));
    assert.doesNotMatch(serialized, /downloadDir|dbPath|process\.env|GITHUB_TOKEN|token/i);
  });

  it('全局维护公告会把总体状态置为维护中', () => {
    require('../src/services/notice.service').create({
      title: '下载节点维护通知',
      type: 'maintenance',
      scope: 'global',
      end_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    statusService.invalidateStatusCache();
    const status = statusService.buildStatus({ fresh: true });
    assert.strictEqual(status.status, 'maintenance');
    assert.strictEqual(status.status_short, '维护中');
    assert.strictEqual(status.maintenance.title, '下载节点维护通知');
  });

  it('未结束的维护公告才生效', () => {
    require('../src/services/notice.service').create({
      title: '已结束的维护',
      type: 'maintenance',
      scope: 'global',
      end_at: new Date(Date.now() - 1000).toISOString(),
    });
    statusService.invalidateStatusCache();
    assert.notStrictEqual(statusService.buildStatus({ fresh: true }).status, 'maintenance');
  });

  it('项目同步延迟不算故障，只表示内容还在同步', () => {
    const projects = require('../src/services/sync-project.service');
    db.data.release_sources = [{ id: 1, name: 'x', owner: 'a', repo: 'b', enabled: true, status: 'idle' }];
    const project = projects.create({ name: 'Mindustry Android', source_id: 1, local_path: 'Mindustry/Main' });
    db.data.sync_projects.find((item) => item.id === project.id).last_success_at = new Date(Date.now() - 3600_000).toISOString();
    db.data.sync_projects.find((item) => item.id === project.id).remote_version = 'v152';
    db.data.sync_projects.find((item) => item.id === project.id).local_version = 'v151';
    db.data.sync_projects.find((item) => item.id === project.id).last_sync_started_at = new Date(Date.now() - 3600_000).toISOString();
    statusService.invalidateStatusCache();
    const status = statusService.buildStatus({ fresh: true });
    assert.strictEqual(status.projects.items[0].status, 'delayed');
    assert.strictEqual(status.status, 'syncing');
    assert.strictEqual(status.status_short, '服务正常');
  });

  it('项目失败会反映为部分服务异常，且不影响核心服务条目', () => {
    const projects = require('../src/services/sync-project.service');
    db.data.release_sources = [{ id: 2, name: 'x', owner: 'a', repo: 'b', enabled: true, status: 'error', last_error: 'boom' }];
    projects.create({ name: '故障项目', source_id: 2 });
    statusService.invalidateStatusCache();
    const status = statusService.buildStatus({ fresh: true });
    assert.strictEqual(status.projects.items[0].status, 'failed');
    assert.strictEqual(status.status, 'degraded');
    assert.strictEqual(status.status_short, '部分服务异常');
    // 数据库 / CDN 这些本地检查不受项目失败影响
    const db_ = status.services.find((service) => service.key === 'database');
    assert.strictEqual(db_.status, 'operational');
  });

  it('不公开或已停用的项目不计入总体状态', () => {
    const projects = require('../src/services/sync-project.service');
    db.data.release_sources = [{ id: 3, name: 'x', owner: 'a', repo: 'b', enabled: true, status: 'error', last_error: 'boom' }];
    projects.create({ name: '隐藏项目', source_id: 3, public_visible: false });
    statusService.invalidateStatusCache();
    const status = statusService.buildStatus({ fresh: true });
    assert.strictEqual(status.projects.total, 0);
    // 隐藏项目不应把总体状态拉下去（来源自身失败属于服务级问题，这里只断言项目贡献）
    assert.strictEqual(status.projects.degraded, 0);
  });

  it('不设「影响总体状态」的项目不拉低总体', () => {
    const projects = require('../src/services/sync-project.service');
    db.data.release_sources = [{ id: 4, name: 'x', owner: 'a', repo: 'b', enabled: true, status: 'error', last_error: 'boom' }];
    projects.create({ name: '独立项目', source_id: 4, affects_global_status: false });
    statusService.invalidateStatusCache();
    const status = statusService.buildStatus({ fresh: true });
    assert.strictEqual(status.projects.items.length, 1);
    assert.strictEqual(status.projects.degraded, 0);
    assert.notStrictEqual(status.projects.status, 'degraded');
  });

  it('短缓存内复用结果，fresh 强制重算', () => {
    const first = statusService.buildStatus();
    const cached = statusService.buildStatus();
    assert.strictEqual(first.updated_at, cached.updated_at);
    const fresh = statusService.buildStatus({ fresh: true });
    assert.notStrictEqual(fresh.updated_at, undefined);
  });
});
