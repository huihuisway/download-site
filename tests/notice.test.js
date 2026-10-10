const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

process.env.NODE_ENV = 'test';
const { setupTmpEnv } = require('./helpers/tmp-env');
const tmpEnv = setupTmpEnv('notice');

describe('notice service', () => {
  let noticeService;
  let db;

  before(() => {
    fs.mkdirSync(process.env.DOWNLOAD_DIR, { recursive: true });
    ({ db } = require('../src/db'));
    noticeService = require('../src/services/notice.service');
  });

  after(() => tmpEnv.cleanup());

  beforeEach(() => {
    db.data.notices = [];
    db.data._nextNoticeId = 1;
  });

  it('创建通知时补齐默认值', () => {
    const notice = noticeService.create({ title: 'Build 151 已同步完成' });
    assert.strictEqual(notice.type, 'info');
    assert.strictEqual(notice.scope, 'global');
    assert.strictEqual(notice.platform, 'all');
    assert.strictEqual(notice.enabled, true);
    assert.strictEqual(notice.dismissible, true);
    assert.strictEqual(notice.priority, 50);
    assert.strictEqual(notice.type_label, '提示');
    assert.ok(notice.created_at);
  });

  it('缺少标题或类型非法时应报错', () => {
    assert.throws(() => noticeService.create({ title: '   ' }), /标题/);
    assert.throws(() => noticeService.create({ title: 'x', type: 'nope' }), /通知类型/);
  });

  it('按钮链接必须是站内路径或 http(s)', () => {
    assert.throws(() => noticeService.create({ title: 'x', action_url: 'javascript:alert(1)' }), /按钮链接/);
    const ok = noticeService.create({ title: 'x', action_url: '/mindustry', action_label: '查看' });
    assert.strictEqual(ok.action_url, '/mindustry');
  });

  it('按优先级与创建时间排序', () => {
    noticeService.create({ title: '低', priority: 10 });
    noticeService.create({ title: '高', priority: 90 });
    const list = noticeService.list();
    assert.strictEqual(list[0].title, '高');
  });

  it('listPublic 过滤停用、未生效与已过期通知', () => {
    noticeService.create({ title: '正常' });
    noticeService.create({ title: '停用', enabled: false });
    noticeService.create({ title: '未生效', start_at: new Date(Date.now() + 3600_000).toISOString() });
    noticeService.create({ title: '已过期', end_at: new Date(Date.now() - 3600_000).toISOString() });
    const titles = noticeService.listPublic().map((notice) => notice.title);
    assert.deepStrictEqual(titles, ['正常']);
  });

  it('listPublic 按作用域与平台筛选，global 始终可见', () => {
    noticeService.create({ title: '全站', scope: 'global' });
    noticeService.create({ title: 'Mindustry 页', scope: 'mindustry' });
    noticeService.create({ title: '状态页', scope: 'status' });
    const mindustry = noticeService.listPublic({ scope: 'mindustry' }).map((n) => n.title);
    assert.deepStrictEqual(mindustry.sort(), ['Mindustry 页', '全站']);
    noticeService.create({ title: 'Android 专属', scope: 'mindustry', platform: 'android' });
    const windows = noticeService.listPublic({ scope: 'mindustry', platform: 'windows' }).map((n) => n.title);
    assert.ok(!windows.includes('Android 专属'));
  });

  it('更新与删除', () => {
    const notice = noticeService.create({ title: '旧标题' });
    const updated = noticeService.update(notice.id, { title: '新标题', priority: 70 });
    assert.strictEqual(updated.title, '新标题');
    assert.strictEqual(updated.priority, 70);
    assert.strictEqual(noticeService.remove(notice.id), true);
    assert.strictEqual(noticeService.get(notice.id), null);
  });

  it('系统通知按 dedupe_key 去重，内容不变不刷新 updated_at', () => {
    const first = noticeService.upsertSystemNotice('sync:1:delayed', { title: '同步延迟' });
    const second = noticeService.upsertSystemNotice('sync:1:delayed', { title: '同步延迟' });
    assert.strictEqual(first.id, second.id);
    assert.strictEqual(noticeService.list().length, 1);
    assert.strictEqual(first.updated_at, second.updated_at);

    const changed = noticeService.upsertSystemNotice('sync:1:delayed', { title: '同步延迟', content: '补充说明' });
    assert.strictEqual(changed.id, first.id);
    assert.strictEqual(changed.content, '补充说明');
    assert.strictEqual(noticeService.list().length, 1);
  });

  it('resolveSystemNotice 只撤下同 key 的系统通知', () => {
    const manual = noticeService.create({ title: '人工通知' });
    noticeService.upsertSystemNotice('sync:2:failed', { title: '同步失败', type: 'critical' });
    assert.strictEqual(noticeService.resolveSystemNotice('sync:2:failed'), true);
    assert.strictEqual(noticeService.resolveSystemNotice('sync:2:failed'), false);
    assert.strictEqual(noticeService.get(manual.id).title, '人工通知');
  });
});
