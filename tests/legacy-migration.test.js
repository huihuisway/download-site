const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
const { setupTmpEnv } = require('./helpers/tmp-env');
const tmpEnv = setupTmpEnv('legacy');

describe('老数据启动兼容', () => {
  before(() => {
    fs.mkdirSync(path.join(process.env.DOWNLOAD_DIR, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(process.env.DOWNLOAD_DIR, 'docs', 'a.txt'), 'legacy');
    // 旧版本的库：没有 notices / sync_projects / release_sources 等新表
    fs.writeFileSync(process.env.DB_PATH, JSON.stringify({
      download_logs: [{
        id: 1, file_name: 'a.txt', file_path: 'docs/a.txt', category: 'docs',
        file_size: 6, mime_type: 'text/plain', download_count: 3,
        created_at: '2024-01-01T00:00:00.000Z', updated_at: '2024-01-01T00:00:00.000Z',
      }],
      sessions: {},
      api_keys: [],
      release_sync: [],
      settings: [
        { key: 'theme', value: 'editorial', updated_at: '2024-01-01T00:00:00.000Z' },
        { key: 'site_name', value: '旧下载站', updated_at: '2024-01-01T00:00:00.000Z' },
      ],
      _nextId: 2,
    }), 'utf-8');
  });

  after(() => tmpEnv.cleanup());

  it('迁移补齐新表并把旧默认主题切到 mdtbbs，但不覆盖站点设置', () => {
    const { runMigrations } = require('../src/db/migrations');
    runMigrations();
    const { db } = require('../src/db');
    for (const table of ['notices', 'sync_projects', 'sync_project_files', 'sync_events']) {
      assert.ok(Array.isArray(db.data[table]), `${table} 应被补齐`);
    }
    assert.strictEqual(db.data.settings.find((item) => item.key === 'theme').value, 'mdtbbs');
    assert.strictEqual(db.data.settings.find((item) => item.key === 'site_name').value, '旧下载站');
    // 既有业务数据不得被迁移破坏
    assert.strictEqual(db.data.download_logs.length, 1);
    assert.strictEqual(db.data.download_logs[0].download_count, 3);
  });

  it('迁移可重复执行', () => {
    const { runMigrations } = require('../src/db/migrations');
    runMigrations();
    assert.strictEqual(require('../src/db').db.data.download_logs.length, 1);
  });

  it('新服务在空数据下可用且不报错', () => {
    const statusService = require('../src/services/status.service');
    const noticeService = require('../src/services/notice.service');
    const syncProjectService = require('../src/services/sync-project.service');
    assert.strictEqual(noticeService.list().length, 0);
    assert.strictEqual(syncProjectService.list().length, 0);
    assert.deepStrictEqual(syncProjectService.ensureDefaultProjects(), []);
    assert.deepStrictEqual(syncProjectService.statusByDirectory(), {});
    const status = statusService.buildStatus({ fresh: true });
    assert.ok(status.services.length >= 6);
    assert.ok(status.projects);
  });

  it('迁移重跑时不会覆盖管理员手动选过的主题', () => {
    const { db } = require('../src/db');
    const { runMigrations } = require('../src/db/migrations');
    // 抹掉迁移记录，强制 v4 重新执行一次
    db.data._migrations = (db.data._migrations || []).filter((item) => item.version !== 4);
    db._save();
    db.data.settings.find((item) => item.key === 'theme').value = 'terminal';
    db._save();

    runMigrations();

    assert.strictEqual(db.data.settings.find((item) => item.key === 'theme').value, 'terminal');
  });
});
