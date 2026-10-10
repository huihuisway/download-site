const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

process.env.NODE_ENV = 'test';
const { setupTmpEnv } = require('./helpers/tmp-env');
const tmpEnv = setupTmpEnv('sync-project');

describe('sync project service', () => {
  let service;
  let db;

  before(() => {
    fs.mkdirSync(path.join(process.env.DOWNLOAD_DIR, 'Mindustry/Main/Stable/v151/android'), { recursive: true });
    fs.writeFileSync(path.join(process.env.DOWNLOAD_DIR, 'Mindustry/Main/Stable/v151/android/app.apk'), 'apk');
    ({ db } = require('../src/db'));
    service = require('../src/services/sync-project.service');
  });

  after(() => tmpEnv.cleanup());

  beforeEach(() => {
    db.data.sync_projects = [];
    db.data.sync_events = [];
    db.data.notices = [];
    db.data._nextSyncProjectId = 1;
    db.data._nextNoticeId = 1;
    db.data.release_sources = [{ id: 1, name: 'Mindustry 官方版本', owner: 'Anuken', repo: 'Mindustry', enabled: true, status: 'idle', config: {} }];
    db.data.release_sync = [];
    db.data.download_logs = [];
  });

  it('创建项目时补齐默认值与通知开关', () => {
    const project = service.create({ name: 'Mindustry 主线' });
    assert.strictEqual(project.enabled, true);
    assert.strictEqual(project.public_visible, true);
    assert.strictEqual(project.affects_global_status, true);
    assert.strictEqual(project.source_type, 'github_release');
    assert.strictEqual(project.notify.delayed, true);
    assert.strictEqual(project.notify.failed, true);
    assert.strictEqual(project.notify.recovered, true);
    assert.strictEqual(project.notify.sync_complete, false);
  });

  it('校验项目标识与来源类型', () => {
    assert.throws(() => service.create({ name: 'x', slug: 'Bad Slug' }), /标识/);
    assert.throws(() => service.create({ name: 'x', source_type: 'nope' }), /来源类型/);
    assert.throws(() => service.create({ name: 'x', local_path: '../../etc' }), /本地目录/);
    assert.throws(() => service.create({ name: 'x', source_id: 999 }), /发布来源不存在/);
  });

  it('项目标识不允许重复', () => {
    service.create({ name: 'A', slug: 'dup' });
    assert.throws(() => service.create({ name: 'B', slug: 'dup' }), /已被占用/);
  });

  it('本地文件齐全且无上游版本时判为已同步（不会误报延迟）', () => {
    db.data.download_logs = [{
      id: 1, file_name: 'app.apk', file_path: 'Mindustry/Main/Stable/v151/android/app.apk',
      file_size: 3, source_id: 1, release_id: 11, approval_status: 'approved', download_count: 0,
    }];
    const project = service.create({ name: 'Mindustry Android', source_id: 1, local_path: 'Mindustry/Main/Stable/v151/android' });
    assert.strictEqual(project.status, 'synced');
    assert.strictEqual(project.synced_files, 1);
    assert.strictEqual(project.failed_files, 0);
  });

  it('缺失文件判为部分完成', () => {
    db.data.download_logs = [{
      id: 2, file_name: 'missing.apk', file_path: 'Mindustry/Main/Stable/v151/android/missing.apk',
      file_size: 3, source_id: 1, release_id: 11, approval_status: 'approved', download_count: 0,
    }];
    const project = service.create({ name: 'Mindustry Android', source_id: 1, local_path: 'Mindustry/Main/Stable/v151/android' });
    assert.strictEqual(project.status, 'partial');
    assert.strictEqual(project.failed_files, 1);
  });

  it('来源同步失败时项目标失败', () => {
    db.data.release_sources[0].status = 'error';
    db.data.release_sources[0].last_error = 'upstream 502';
    const project = service.create({ name: 'Mindustry 主线', source_id: 1 });
    assert.strictEqual(project.status, 'failed');
    assert.match(project.status_reason, /upstream/);
  });

  it('停用的项目与来源显示为状态未知', () => {
    const project = service.create({ name: '停用项目', source_id: 1, enabled: false });
    assert.strictEqual(project.status, 'unknown');
    db.data.release_sources[0].enabled = false;
    const second = service.create({ name: '来源停用', source_id: 1 });
    assert.strictEqual(second.status, 'unknown');
  });

  it('远端与本地版本不一致时判为同步中/延迟', () => {
    db.data.release_sources[0].last_success_at = new Date().toISOString();
    const project = service.create({ name: 'A', source_id: 1, remote_version: 'v151', local_version: 'v150' });
    // last_started 取来源 last_sync_at（不存在）→ 以 lastSuccess 为基准，刚刚同步过 → 同步中
    assert.strictEqual(project.status, 'syncing');
  });

  it('目录状态按绑定项目聚合，未绑定目录不出现', () => {
    fs.mkdirSync(path.join(process.env.DOWNLOAD_DIR, 'Other'), { recursive: true });
    db.data.download_logs = [{
      id: 3, file_name: 'app.apk', file_path: 'Mindustry/Main/Stable/v151/android/app.apk',
      file_size: 3, source_id: 1, release_id: 11, approval_status: 'approved', download_count: 0,
    }];
    service.create({ name: 'Mindustry Android', source_id: 1, local_path: 'Mindustry/Main/Stable/v151/android' });
    const map = service.statusByDirectory();
    assert.ok(map['Mindustry']);
    assert.ok(map['Mindustry/Main/Stable/v151/android']);
    assert.strictEqual(map.Other, undefined);
    assert.strictEqual(map['Mindustry'].status_label, '已同步');
  });

  it('列表拆分公开视图（隐藏停用与私有项目）', () => {
    service.create({ name: '公开项目', source_id: 1 });
    service.create({ name: '私有项目', source_id: 1, public_visible: false });
    service.create({ name: '停用项目', source_id: 1, enabled: false });
    assert.strictEqual(service.list().length, 3);
    const publicNames = service.listPublic().map((project) => project.name);
    assert.deepStrictEqual(publicNames, ['公开项目']);
  });

  it('同步链与依赖关系只做展示结构', () => {
    const main = service.create({ name: 'Mindustry 主线', slug: 'main', source_id: 1 });
    const android = service.create({ name: 'Mindustry Android', slug: 'android', source_id: 1, depends_on: [main.id] });
    const chain = service.buildChain(android);
    assert.deepStrictEqual(chain.nodes.map((node) => node.key), ['upstream', 'build', 'release', 'sync', 'cdn']);
    assert.ok(chain.summary.includes('Mindustry Android'));
    const dependency = service.dependencyStatus(service.get(android.id));
    assert.strictEqual(dependency.dependencies.length, 1);
    assert.strictEqual(dependency.dependencies[0].name, 'Mindustry 主线');
  });

  it('自动通知：延迟产生一条、恢复后撤下并留下恢复通知', () => {
    service.create({ name: 'Mindustry Android', source_id: 1, local_path: 'Mindustry/Main' });
    db.data.sync_projects[0].last_success_at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    db.data.sync_projects[0].remote_version = 'v152';
    db.data.sync_projects[0].local_version = 'v151';
    db.data.sync_projects[0].last_sync_started_at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    service.refresh(db.data.sync_projects[0]);
    const notices = require('../src/services/notice.service').list();
    assert.strictEqual(notices.length, 1);
    assert.match(notices[0].title, /同步延迟/);
    assert.strictEqual(notices[0].source, 'system');

    // 再次刷新：同状态不重复产生
    service.refresh(db.data.sync_projects[0]);
    assert.strictEqual(require('../src/services/notice.service').list().length, 1);

    // 恢复正常 → 延迟通知撤下，留下一条恢复通知
    delete db.data.sync_projects[0].remote_version;
    delete db.data.sync_projects[0].local_version;
    db.data.sync_projects[0].last_success_at = new Date().toISOString();
    service.refresh(db.data.sync_projects[0]);
    const afterRecover = require('../src/services/notice.service').list();
    assert.strictEqual(afterRecover.length, 1);
    assert.match(afterRecover[0].title, /恢复/);
  });

  it('项目可以关闭自动通知', () => {
    const created = service.create({ name: '静默项目', source_id: 1, notify: { delayed: false, failed: false, recovered: false } });
    db.data.release_sources[0].status = 'error';
    db.data.release_sources[0].last_error = 'boom';
    service.refresh(db.data.sync_projects.find((item) => item.id === created.id));
    assert.strictEqual(require('../src/services/notice.service').list().length, 0);
  });

  it('删除项目时清理事件与依赖引用', () => {
    const main = service.create({ name: '主项目', slug: 'main', source_id: 1 });
    const dependent = service.create({ name: '依赖项目', slug: 'dep', source_id: 1, depends_on: [main.id] });
    service.checkProject(dependent.id);
    assert.ok(service.events(dependent.id).length > 0);
    assert.strictEqual(service.remove(main.id), true);
    assert.strictEqual(service.get(dependent.id).depends_on.length, 0);
  });
});
