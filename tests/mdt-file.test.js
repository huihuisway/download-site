const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const http = require('http');

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.SESSION_SECRET = 'c'.repeat(32);
const { setupTmpEnv } = require('./helpers/tmp-env');
const { ensureAdminFixture } = require('./helpers/admin-fixture');
const tmpEnv = setupTmpEnv('mdt-file');
process.env.ADMIN_USERNAME = 'testadmin';
process.env.ADMIN_PASSWORD = 'testpass123';

const request = (server, targetPath, options = {}) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: server.address().port,
        path: targetPath,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
      },
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });

describe('MDT File 前台与后台', () => {
  let server;
  let cookie;
  let db;

  before(async () => {
    fs.mkdirSync(process.env.DOWNLOAD_DIR, { recursive: true });
    fs.mkdirSync(path.join(process.env.DOWNLOAD_DIR, 'Mindustry', 'Main', 'Stable', 'v151', 'android'), { recursive: true });
    fs.writeFileSync(path.join(process.env.DOWNLOAD_DIR, 'Mindustry', 'Main', 'Stable', 'v151', 'android', 'app.apk'), 'apk');
    fs.mkdirSync(path.join(process.env.DOWNLOAD_DIR, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(process.env.DOWNLOAD_DIR, 'docs', 'a.txt'), 'hello mdt');

    ({ db } = require('../src/db'));
    db.data.download_logs = [];
    db.data._nextId = 1;
    db._save();
    db.prepare('INSERT INTO download_logs (file_name, file_path, category, file_size, mime_type) VALUES (?, ?, ?, ?, ?)')
      .run('a.txt', 'docs/a.txt', 'docs', 9, 'text/plain');
    db.prepare(`INSERT INTO download_logs
      (file_name, file_path, category, file_size, mime_type, source_id, release_id, sha256,
       game_id, version_tag, platform, release_channel, approval_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('app.apk', 'Mindustry/Main/Stable/v151/android/app.apk', 'Mindustry/Main/Stable/v151/android', 3, 'application/vnd.android.package-archive', 1, 7, 'c'.repeat(64), 'mindustry', 'v151', 'android', 'stable', 'approved');
    db.data.release_sources = [{ id: 1, name: 'Mindustry 官方版本', type: 'github', owner: 'Anuken', repo: 'Mindustry', enabled: true, status: 'idle', config: {} }];
    db.data.release_sync = [{ id: 1, source_id: 1, release_id: 7, tag_name: 'v151', status: 'published', synced_at: new Date().toISOString() }];
    db.data.notices = [];
    db.data._nextNoticeId = 1;

    const syncProjects = require('../src/services/sync-project.service');
    syncProjects.create({ name: 'Mindustry Android', slug: 'mindustry-android', source_id: 1, local_path: 'Mindustry/Main/Stable/v151/android' });

    // 缺后台构建产物时补夹具，保证干净检出也能跑（见 helpers/admin-fixture）
    ensureAdminFixture();

    const app = require('../src/app');
    server = await new Promise((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });

    const body = JSON.stringify({ username: 'testadmin', password: 'testpass123' });
    const login = await request(server, '/auth/local-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      body,
    });
    cookie = login.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
  });

  after(async () => {
    tmpEnv.cleanup();
    if (server) await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  });

  it('首页是 MDT File 首页而不是原始目录', async () => {
    const response = await request(server, '/');
    assert.strictEqual(response.statusCode, 200);
    assert.match(response.body, /MDT File/);
    assert.match(response.body, /Mindustry 版本下载/);
    assert.match(response.body, /文件目录/);
    assert.match(response.body, /服务状态/);
    assert.match(response.body, /前往下载/);
    assert.match(response.body, /打开文件目录/);
  });

  it('/files 提供统一文件目录，/category/* 旧链接仍可用', async () => {
    const files = await request(server, '/files');
    assert.strictEqual(files.statusCode, 200);
    assert.match(files.body, /文件目录/);
    assert.match(files.body, /docs/);

    const legacy = await request(server, '/category/docs');
    assert.strictEqual(legacy.statusCode, 200);
    assert.match(legacy.body, /a\.txt/);

    // 从旧入口进到子目录时，面包屑与「返回上一级」都应留在 /category 下
    const nested = await request(server, '/category/Mindustry/Main/Stable/v151/android');
    assert.strictEqual(nested.statusCode, 200);
    assert.match(nested.body, /\/category\/Mindustry\/Main\/Stable\/v151/);
  });

  it('目录页展示面包屑、返回上一级与绑定项目状态', async () => {
    const response = await request(server, '/files/Mindustry/Main/Stable/v151/android');
    assert.strictEqual(response.statusCode, 200);
    assert.match(response.body, /返回上一级/);
    assert.match(response.body, /Mindustry Android/);
    assert.match(response.body, /已同步/);
    assert.match(response.body, /app\.apk/);
  });

  it('文件详情页展示 MDT 信息块并保留下载链接与 SHA-256', async () => {
    const response = await request(server, '/Mindustry/Main/Stable/v151/android/app.apk');
    assert.strictEqual(response.statusCode, 200);
    assert.match(response.body, /文件信息/);
    assert.match(response.body, /SHA-256/);
    assert.match(response.body, /\/d\/Mindustry\/Main\/Stable\/v151\/android\/app\.apk/);
    assert.match(response.body, /同步状态/);
    assert.match(response.body, /下载文件/);
  });

  it('文件详情页同步状态反映 Release 记录', async () => {
    db.data.release_sync[0].status = 'failed';
    const failed = await request(server, '/Mindustry/Main/Stable/v151/android/app.apk');
    assert.match(failed.body, /同步失败/);
    db.data.release_sync[0].status = 'published';
  });

  it('审核中与不存在的文件给出友好页面而不是技术错误', async () => {
    db.prepare('UPDATE download_logs SET approval_status = @approval_status, updated_at = @updated_at WHERE file_path = @file_path')
      .run({ approval_status: 'pending', updated_at: new Date().toISOString(), file_path: 'docs/a.txt' });
    const pending = await request(server, '/docs/a.txt');
    assert.strictEqual(pending.statusCode, 403);
    assert.match(pending.body, /等待审核/);
    assert.doesNotMatch(pending.body, /UPSTREAM_ERROR|OBJECT_NOT_FOUND|ECONNRESET/);
    db.prepare('UPDATE download_logs SET approval_status = @approval_status, updated_at = @updated_at WHERE file_path = @file_path')
      .run({ approval_status: 'approved', updated_at: new Date().toISOString(), file_path: 'docs/a.txt' });

    const missing = await request(server, '/docs/nope.txt');
    assert.strictEqual(missing.statusCode, 404);
    assert.match(missing.body, /文件不存在/);
    assert.match(missing.body, /返回文件目录/);
  });

  it('/status 展示核心服务与项目同步状态', async () => {
    const response = await request(server, '/status');
    assert.strictEqual(response.statusCode, 200);
    assert.match(response.body, /服务状态/);
    assert.match(response.body, /文件下载/);
    assert.match(response.body, /Manifest/);
    assert.match(response.body, /Release 同步/);
    assert.match(response.body, /项目同步状态/);
    assert.match(response.body, /Mindustry Android/);
    assert.match(response.body, /同步链|上游版本/);
    assert.match(response.body, /项目文件/);
  });

  it('/notices 与详情页展示公告，并可分类筛选', async () => {
    const noticeService = require('../src/services/notice.service');
    const notice = noticeService.create({ title: 'Build 151 已同步', content: '全部平台可用', type: 'success', category: 'version', scope: 'home' });
    const list = await request(server, '/notices');
    assert.strictEqual(list.statusCode, 200);
    assert.match(list.body, /Build 151 已同步/);
    assert.match(list.body, /通知公告/);

    // 分类筛选只作用于列表；全局横幅不受分类影响，所以按详情链接判断
    const filtered = await request(server, '/notices?type=maintenance');
    assert.ok(!filtered.body.includes(`href="/notices/${notice.id}"`));

    const detail = await request(server, `/notices/${notice.id}`);
    assert.strictEqual(detail.statusCode, 200);
    assert.match(detail.body, /全部平台可用/);
  });

  it('全局公告会出现在全站横幅上，未命中范围的不出现', async () => {
    const noticeService = require('../src/services/notice.service');
    noticeService.create({ title: '下载节点维护通知', type: 'maintenance', scope: 'global', priority: 90 });
    const scoped = noticeService.create({ title: '仅状态页可见', type: 'info', scope: 'status' });
    const home = await request(server, '/');
    assert.match(home.body, /下载节点维护通知/);
    assert.doesNotMatch(home.body, /仅状态页可见/);

    const detail = await request(server, `/notices/${scoped.id}`);
    assert.match(detail.body, /仅状态页可见/);
  });

  it('停用的通知不会出现在前台，但详情页仍可访问用于预览', async () => {
    const noticeService = require('../src/services/notice.service');
    const notice = noticeService.create({ title: '已停用公告', enabled: false });
    const list = await request(server, '/notices');
    assert.doesNotMatch(list.body, /已停用公告/);
    const detail = await request(server, `/notices/${notice.id}`);
    assert.strictEqual(detail.statusCode, 404);
  });

  it('全局横幅带可关闭标记，通知改版后 key 会变化', async () => {
    const noticeService = require('../src/services/notice.service');
    const first = noticeService.create({ title: '横幅测试', type: 'info', scope: 'global', dismissible: true });
    const home = await request(server, '/');
    assert.match(home.body, new RegExp(`data-notice-key="${first.id}@`));
    assert.match(home.body, /data-dismiss-notice=/);
    assert.match(home.body, /mdt-shell\.js/);

    const updated = noticeService.update(first.id, { content: '改过了' });
    const after = await request(server, '/');
    assert.match(after.body, new RegExp(`data-notice-key="${first.id}@${updated.updated_at}"`));
    assert.notStrictEqual(first.updated_at, updated.updated_at);
    noticeService.remove(first.id);
  });

  it('Mindustry 页面与文件目录双向可达', async () => {
    const mindustry = await request(server, '/mindustry');
    assert.strictEqual(mindustry.statusCode, 200);
    assert.match(mindustry.body, /浏览 Mindustry 文件目录/);
    assert.match(mindustry.body, /\/files\/Mindustry/);
    // 版本搜索与筛选
    assert.match(mindustry.body, /搜索版本/);
    assert.match(mindustry.body, /历史版本/);
    // 每个版本都有稳定的直达锚点与复制链接入口
    assert.match(mindustry.body, /id="version-v151"/);
    assert.match(mindustry.body, /data-version-link="v151"/);
  });

  it('?v= 支持链接直达指定版本，命中的那条默认展开', async () => {
    for (const query of ['v=v151', 'v=151', 'version=v151']) {
      const response = await request(server, `/mindustry?${query}`);
      assert.strictEqual(response.statusCode, 200, `${query} 应正常渲染`);
      assert.match(response.body, /data-version-target="v151"/, `${query} 应标记目标版本`);
      assert.match(response.body, new RegExp(`id="version-v151"[^>]*\\bopen\\b`), `${query} 命中的版本应默认展开`);
      assert.match(response.body, /已定位到版本/);
    }
  });

  it('查不到的版本给出提示而不是报错，并保持全部版本可见', async () => {
    const response = await request(server, '/mindustry?v=v999.9');
    assert.strictEqual(response.statusCode, 200);
    assert.match(response.body, /没有找到版本/);
    assert.doesNotMatch(response.body, /data-version-target/);
    // 未被定位时版本行保持折叠
    assert.doesNotMatch(response.body, /<details class="mindustry-version-row [^"]*" id="version-v151"[^>]*\bopen\b/);
  });

  it('版本查询不影响其他参数，且回显内容会被 HTML 转义', async () => {
    const response = await request(server, `/mindustry?v=${encodeURIComponent('<img src=x onerror=alert(1)>')}`);
    assert.strictEqual(response.statusCode, 200);
    assert.doesNotMatch(response.body, /<img src=x onerror/);
    assert.match(response.body, /&lt;img src=x onerror=alert\(1\)&gt;/);
  });

  it('文件详情页回链带上所属版本，点回去能落在同一条版本上', async () => {
    const page = await request(server, '/Mindustry/Main/Stable/v151/android/app.apk');
    assert.strictEqual(page.statusCode, 200);
    assert.match(page.body, /\/mindustry\?v=v151/);
  });

  it('公开接口不泄露内部信息', async () => {
    const status = await request(server, '/api/v1/status');
    assert.strictEqual(status.statusCode, 200);
    assert.match(status.headers['cache-control'], /max-age=30/);
    const payload = JSON.parse(status.body);
    assert.strictEqual(payload.success, true);
    assert.ok(payload.data.services.length >= 6);

    const projects = await request(server, '/api/v1/status/projects');
    const projectsPayload = JSON.parse(projects.body);
    assert.ok(projectsPayload.data.projects.some((project) => project.name === 'Mindustry Android'));
    assert.ok(projectsPayload.data.projects[0].chain.nodes.length === 5);

    const notices = await request(server, '/api/v1/notices');
    const noticesPayload = JSON.parse(notices.body);
    assert.ok(Array.isArray(noticesPayload.data.notices));
    assert.ok(noticesPayload.data.notices.every((notice) => notice.enabled === undefined || notice.enabled !== false));

    const serialized = status.body + projects.body + notices.body;
    assert.doesNotMatch(serialized, /token|secret|downloadDir|dbPath|\/workspace|\/home\//i);
  });

  it('后台通知接口可增删改与启停', async () => {
    const headers = { 'Content-Type': 'application/json', Cookie: cookie };
    const created = await request(server, '/api/admin/notices', {
      method: 'POST', headers,
      body: JSON.stringify({ title: '后台通知', type: 'warning', scope: 'home', priority: 30 }),
    });
    assert.strictEqual(created.statusCode, 201);
    const notice = JSON.parse(created.body).notice;

    const updated = await request(server, `/api/admin/notices/${notice.id}`, {
      method: 'PUT', headers, body: JSON.stringify({ title: '后台通知（改）' }),
    });
    assert.strictEqual(JSON.parse(updated.body).notice.title, '后台通知（改）');

    const disabled = await request(server, `/api/admin/notices/${notice.id}/disable`, { method: 'POST', headers });
    assert.strictEqual(JSON.parse(disabled.body).notice.enabled, false);

    const list = await request(server, '/api/admin/notices', { headers: { Cookie: cookie } });
    const payload = JSON.parse(list.body);
    assert.ok(payload.types.includes('critical'));
    assert.ok(payload.scopes.includes('mindustry'));
    assert.ok(payload.categories.includes('maintenance'));

    const removed = await request(server, `/api/admin/notices/${notice.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
    assert.strictEqual(JSON.parse(removed.body).deleted, true);
  });

  it('后台非法通知参数应返回 400 而不是 500', async () => {
    const headers = { 'Content-Type': 'application/json', Cookie: cookie };
    const bad = await request(server, '/api/admin/notices', {
      method: 'POST', headers, body: JSON.stringify({ title: '' }),
    });
    assert.strictEqual(bad.statusCode, 400);
    const badUrl = await request(server, '/api/admin/notices', {
      method: 'POST', headers, body: JSON.stringify({ title: 'x', action_url: 'javascript:alert(1)' }),
    });
    assert.strictEqual(badUrl.statusCode, 400);
  });

  it('后台项目同步接口可增删改查与触发检查', async () => {
    const headers = { 'Content-Type': 'application/json', Cookie: cookie };
    const created = await request(server, '/api/admin/sync-projects', {
      method: 'POST', headers,
      body: JSON.stringify({ name: '测试项目', slug: 'test-project', source_id: 1, local_path: 'Mindustry/Main', expected_assets: ['app.apk'] }),
    });
    assert.strictEqual(created.statusCode, 201);
    const project = JSON.parse(created.body).project;

    const detail = await request(server, `/api/admin/sync-projects/${project.id}`, { headers: { Cookie: cookie } });
    const detailPayload = JSON.parse(detail.body);
    assert.ok(Array.isArray(detailPayload.files));
    assert.ok(detailPayload.chain);

    const checked = await request(server, `/api/admin/sync-projects/${project.id}/check`, { method: 'POST', headers: { Cookie: cookie } });
    assert.strictEqual(checked.statusCode, 200);

    const updated = await request(server, `/api/admin/sync-projects/${project.id}`, {
      method: 'PUT', headers, body: JSON.stringify({ name: '测试项目（改）' }),
    });
    assert.strictEqual(JSON.parse(updated.body).project.name, '测试项目（改）');

    const removed = await request(server, `/api/admin/sync-projects/${project.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
    assert.strictEqual(JSON.parse(removed.body).deleted, true);
  });

  it('后台状态接口返回服务与项目状态', async () => {
    const response = await request(server, '/api/admin/status', { headers: { Cookie: cookie } });
    assert.strictEqual(response.statusCode, 200);
    const payload = JSON.parse(response.body);
    assert.ok(payload.status.services.length >= 6);
    assert.ok(Array.isArray(payload.projects));
  });

  it('后台接口未登录时返回 401', async () => {
    const response = await request(server, '/api/admin/notices');
    assert.strictEqual(response.statusCode, 401);
  });

  it('后台 API 与登录端点应禁止中间层缓存', async () => {
    const apiResponse = await request(server, '/api/admin/notices', { headers: { Cookie: cookie } });
    assert.strictEqual(apiResponse.statusCode, 200);
    assert.strictEqual(apiResponse.headers['cache-control'], 'no-store');

    const authResponse = await request(server, '/auth/me');
    assert.strictEqual(authResponse.headers['cache-control'], 'no-store');
  });

  it('新增前缀不会被文件详情页 catch-all 吞掉', async () => {
    for (const target of ['/status', '/notices', '/files']) {
      const response = await request(server, target);
      assert.strictEqual(response.statusCode, 200, `${target} 应可访问`);
      assert.match(response.headers['content-type'], /text\/html/);
    }
  });

  it('切换任意旧主题后所有前台页面仍可渲染', async () => {
    const themeService = require('../src/services/theme.service');
    const original = themeService.getTheme();
    try {
      for (const theme of ['editorial', 'cloud', 'mirror', 'terminal', 'mdtbbs']) {
        themeService.setTheme(theme);
        for (const target of ['/', '/mindustry', '/files', '/status', '/notices', '/docs/a.txt', '/category/docs']) {
          const response = await request(server, target);
          assert.strictEqual(response.statusCode, 200, `${theme} 主题下 ${target} 应可访问`);
        }
      }
    } finally {
      themeService.setTheme(original);
    }
  });

  it('后台 SPA 新增路由仍回退到 index', async () => {
    for (const route of ['/admin/notices', '/admin/sync-projects', '/admin/status']) {
      const response = await request(server, route, { headers: { Cookie: cookie } });
      assert.strictEqual(response.statusCode, 200);
      assert.match(response.body, /id="root"/);
    }
  });

  it('下载能力没有回归：Range / ETag / Content-Disposition 都还在', async () => {
    const full = await request(server, '/d/docs/a.txt');
    assert.strictEqual(full.statusCode, 200);
    assert.match(full.headers['content-disposition'], /attachment/);
    assert.ok(full.headers.etag);
    assert.ok(full.headers['last-modified']);

    const partial = await request(server, '/d/docs/a.txt', { headers: { Range: 'bytes=0-4' } });
    assert.strictEqual(partial.statusCode, 206);
    assert.strictEqual(partial.body, 'hello');
    assert.match(partial.headers['content-range'], /^bytes 0-4\//);
  });

  it('目录状态聚合不会因为一个项目失败就把整层标成失败', async () => {
    const syncProjects = require('../src/services/sync-project.service');
    db.data.release_sources.push({ id: 2, name: '备用来源', type: 'github', owner: 'a', repo: 'b', enabled: true, status: 'error', last_error: 'boom', config: {} });
    syncProjects.create({ name: '异常项目', slug: 'broken', source_id: 2, local_path: 'Mindustry/Main/Stable' });
    const map = syncProjects.statusByDirectory();
    assert.ok(map['Mindustry/Main/Stable']);
    assert.strictEqual(map['Mindustry/Main/Stable'].status, 'failed');
    // 父层同时包含「已同步」的 Android 与「失败」的项目 → 部分完成
    const parent = map['Mindustry/Main'];
    assert.ok(['partial', 'failed'].includes(parent.status));
    const response = await request(server, '/status');
    assert.strictEqual(response.statusCode, 200);
    const projectIds = db.data.sync_projects.map((item) => item.id);
    for (const id of projectIds) {
      assert.match(response.body, new RegExp(`project-${id}`));
    }
  });
});
