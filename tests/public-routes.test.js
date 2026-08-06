const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const http = require('http');

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
const { setupTmpEnv } = require('./helpers/tmp-env');
const tmpEnv = setupTmpEnv('public-routes');
process.env.ADMIN_USERNAME = 'testadmin';
process.env.ADMIN_PASSWORD = 'testpass123';
process.env.ADMIN_ALLOWED_EMAILS = 'allowed@example.com';

const request = (server, targetPath, options = {}) => new Promise((resolve, reject) => {
  const address = server.address();
  const req = http.request({
    hostname: '127.0.0.1',
    port: address.port,
    path: targetPath,
    method: options.method || 'GET',
    headers: options.headers || {},
  }, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
    });
  });

  req.on('error', reject);
  if (options.body) req.write(options.body);
  req.end();
});

describe('public routes', () => {
  let server;
  let sessionDir;
  before(async () => {
    const dataDir = path.join(__dirname, '..', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(process.env.DOWNLOAD_DIR, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(process.env.DOWNLOAD_DIR, 'docs', 'a.txt'), 'hello public route');
    // Nested folder structure for folder browsing tests
    fs.mkdirSync(path.join(process.env.DOWNLOAD_DIR, 'docs', 'guides', 'v1'), { recursive: true });
    fs.writeFileSync(path.join(process.env.DOWNLOAD_DIR, 'docs', 'guides', 'v1', 'banner.png'), 'fake image');
    fs.mkdirSync(path.join(process.env.DOWNLOAD_DIR, 'docs', 'empty'), { recursive: true });
    sessionDir = path.join(__dirname, '..', 'data', 'sessions');

    const { db } = require('../src/db');
    db.data.download_logs = [];
    db.data._nextId = 1;
    db._save();

    db.prepare(
      'INSERT INTO download_logs (file_name, file_path, category, file_size, download_count, description, mime_type) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('a.txt', 'docs/a.txt', 'docs', 18, 0, 'route test file', 'text/plain');

    db.prepare(
      'INSERT INTO download_logs (file_name, file_path, category, file_size, download_count, description, mime_type) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('banner.png', 'docs/guides/v1/banner.png', 'docs', 10, 0, 'nested file', 'image/png');

    // 含空格与括号的文件名，用于 URL 编码回归
    fs.writeFileSync(path.join(process.env.DOWNLOAD_DIR, 'docs', 'my file (1).txt'), 'spaced name');
    db.prepare(
      'INSERT INTO download_logs (file_name, file_path, category, file_size, download_count, description, mime_type) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('my file (1).txt', 'docs/my file (1).txt', 'docs', 11, 0, 'spaced', 'text/plain');

    const app = require('../src/app');
    server = await new Promise((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });
  });

  after(async () => {
    tmpEnv.cleanup();
    if (server) {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }  });

  it('GET /docs/a.txt 应返回文件页面 HTML', async () => {
    const response = await request(server, '/docs/a.txt');
    assert.strictEqual(response.statusCode, 200);
    assert.match(response.headers['content-type'], /text\/html/);
    assert.match(response.body, /a\.txt/);
    assert.match(response.body, /\/d\/docs\/a\.txt/);
  });

  it('GET /d/docs/a.txt 应返回附件下载', async () => {
    const response = await request(server, '/d/docs/a.txt');
    assert.strictEqual(response.statusCode, 200);
    assert.match(response.headers['content-disposition'], /attachment/);
    assert.strictEqual(response.body, 'hello public route');
  });

  it('下载计数只应在 /d 路径递增', async () => {
    const { db } = require('../src/db');

    let record = db.prepare('SELECT * FROM download_logs WHERE file_path = ?').get('docs/a.txt');
    assert.strictEqual(record.download_count, 1);

    await request(server, '/docs/a.txt');
    record = db.prepare('SELECT * FROM download_logs WHERE file_path = ?').get('docs/a.txt');
    assert.strictEqual(record.download_count, 1);

    await request(server, '/d/docs/a.txt');
    record = db.prepare('SELECT * FROM download_logs WHERE file_path = ?').get('docs/a.txt');
    assert.strictEqual(record.download_count, 2);
  });

  it('应支持 Range 断点续传且中段分片不计数', async () => {
    const { db } = require('../src/db');
    const before = db.prepare('SELECT * FROM download_logs WHERE file_path = ?').get('docs/a.txt').download_count;

    // 'hello public route' 的第 6-11 字节是 'public'
    const partial = await request(server, '/d/docs/a.txt', { headers: { Range: 'bytes=6-11' } });
    assert.strictEqual(partial.statusCode, 206);
    assert.strictEqual(partial.body, 'public');
    assert.ok(partial.headers['content-range'], '应返回 Content-Range');
    assert.match(partial.headers['accept-ranges'], /bytes/);

    const after = db.prepare('SELECT * FROM download_logs WHERE file_path = ?').get('docs/a.txt').download_count;
    assert.strictEqual(after, before, '中段分片不应计数');
  });

  it('从字节 0 开始的分片应计数一次', async () => {
    const { db } = require('../src/db');
    const before = db.prepare('SELECT * FROM download_logs WHERE file_path = ?').get('docs/a.txt').download_count;

    const chunk = await request(server, '/d/docs/a.txt', { headers: { Range: 'bytes=0-4' } });
    assert.strictEqual(chunk.statusCode, 206);
    assert.strictEqual(chunk.body, 'hello');

    const after = db.prepare('SELECT * FROM download_logs WHERE file_path = ?').get('docs/a.txt').download_count;
    assert.strictEqual(after, before + 1);
  });

  it('ETag 协商缓存应返回 304 且不计数', async () => {
    const { db } = require('../src/db');
    const first = await request(server, '/d/docs/a.txt');
    assert.strictEqual(first.statusCode, 200);
    const etag = first.headers.etag;
    assert.ok(etag, '应返回 ETag');
    assert.ok(first.headers['last-modified'], '应返回 Last-Modified');

    const before = db.prepare('SELECT * FROM download_logs WHERE file_path = ?').get('docs/a.txt').download_count;
    const cached = await request(server, '/d/docs/a.txt', { headers: { 'If-None-Match': etag } });
    assert.strictEqual(cached.statusCode, 304);

    const after = db.prepare('SELECT * FROM download_logs WHERE file_path = ?').get('docs/a.txt').download_count;
    assert.strictEqual(after, before, '304 不应计数');
  });

  it('中文文件名应输出 RFC 5987 的 filename* 形式', async () => {
    const { db } = require('../src/db');
    fs.writeFileSync(path.join(process.env.DOWNLOAD_DIR, 'docs', '报告.txt'), 'cn name');
    db.prepare(
      'INSERT INTO download_logs (file_name, file_path, category, file_size, download_count, description, mime_type) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('报告.txt', 'docs/报告.txt', 'docs', 7, 0, 'cn', 'text/plain');

    const res = await request(server, `/d/docs/${encodeURIComponent('报告.txt')}`);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body, 'cn name');
    assert.match(res.headers['content-disposition'], /filename\*=UTF-8''/);
  });

  it('HTML 应被压缩,但下载响应必须保留 Content-Length 且不压缩', async () => {
    const home = await request(server, '/', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.strictEqual(home.headers['content-encoding'], 'gzip');

    // 压缩会去掉 Content-Length 并破坏 Range,下载必须排除在外
    const download = await request(server, '/d/docs/a.txt', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.strictEqual(download.headers['content-encoding'], undefined);
    assert.ok(download.headers['content-length'], '下载响应应保留 Content-Length');
  });

  it('静态资源应带缓存头', async () => {
    const css = await request(server, '/css/clean-blue-base.css');
    assert.match(css.headers['cache-control'], /max-age=3600/);
    assert.ok(css.headers.etag);
  });

  it('首页与分类页不应再输出 /download/:id 链接', async () => {
    const home = await request(server, '/');
    const category = await request(server, '/category/docs');

    assert.doesNotMatch(home.body, /\/download\/1/);
    assert.match(home.body, /docs/);

    assert.doesNotMatch(category.body, /\/download\/1/);
    assert.match(category.body, /\/docs\/a\.txt/);
  });

  it('后台静态资源应返回正确 MIME，缺失资源不得回退到 HTML', async () => {
    const asset = await request(server, '/admin/assets/index-DkunsnY5.js');
    assert.strictEqual(asset.statusCode, 200);
    assert.match(asset.headers['content-type'], /javascript/);
    assert.match(asset.body, /import|export/);

    const missing = await request(server, '/admin/assets/missing.js?v=stale');
    assert.strictEqual(missing.statusCode, 404);
    assert.doesNotMatch(missing.headers['content-type'] || '', /html/);
    assert.doesNotMatch(missing.body, /admin fixture/);
  });

  it('后台导航路径仍回退到 SPA index', async () => {
    for (const route of ['/admin', '/admin/', '/admin/files']) {
      const response = await request(server, route);
      assert.strictEqual(response.statusCode, 200);
      assert.match(response.headers['content-type'], /text\/html/);
      assert.match(response.body, /id="root"/);
    }
  });
  it('保留前缀不应被文件页 catch-all 截获', async () => {
    const admin = await request(server, '/admin');
    const auth = await request(server, '/auth/login');
    const api = await request(server, '/api/v1/files');
    const css = await request(server, '/css/clean-blue-base.css');
    const favicon = await request(server, '/favicon.svg');

    assert.doesNotMatch(admin.body, /route test file/);
    assert.doesNotMatch(auth.body, /route test file/);
    assert.doesNotMatch(api.body, /route test file/);

    assert.match(css.headers['content-type'], /text\/css/);
    assert.match(favicon.headers['content-type'], /image\/svg\+xml/);
  });

  it('含空格的文件名应生成编码链接且可访问', async () => {
    const { buildFileDownloadUrl, buildFilePageUrl } = require('../src/utils/public-paths');
    assert.strictEqual(buildFileDownloadUrl('docs/my file.txt'), '/d/docs/my%20file.txt');
    assert.strictEqual(buildFilePageUrl('docs/my file.txt'), '/docs/my%20file.txt');

    const page = await request(server, '/docs/my%20file%20(1).txt');
    assert.strictEqual(page.statusCode, 200);
    assert.match(page.body, /my%20file%20\(1\)\.txt/);

    const download = await request(server, '/d/docs/my%20file%20(1).txt');
    assert.strictEqual(download.statusCode, 200);
    assert.strictEqual(download.body, 'spaced name');
  });

  it('匿名访问不应下发 session cookie', async () => {
    // saveUninitialized:false 下匿名请求不应创建会话
    // 注:不断言 data/sessions 文件数——该目录被并行测试进程共享
    const home = await request(server, '/');
    assert.strictEqual(home.statusCode, 200);
    assert.strictEqual(home.headers['set-cookie'], undefined);

    const filePage = await request(server, '/docs/a.txt');
    assert.strictEqual(filePage.headers['set-cookie'], undefined);
  });

  it('已登录但邮箱不在白名单时访问 /admin 应返回 403', async () => {
    const body = JSON.stringify({ username: 'testadmin', password: 'testpass123' });
    const loginRes = await request(server, '/auth/local-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Forwarded-Proto': 'https',
      },
      body,
    });
    assert.strictEqual(loginRes.statusCode, 200);

    const rawCookie = loginRes.headers['set-cookie'][0].split(';')[0];
    const signedSessionId = decodeURIComponent(rawCookie.split('=')[1]);
    const sessionId = signedSessionId.replace(/^s:/, '').split('.')[0];
    const sessionPath = path.join(sessionDir, `${sessionId}.json`);
    const sessionData = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    sessionData.user = {
      id: 2,
      username: 'oauth-user',
      email: 'other@example.com',
      authProvider: 'oauth',
    };
    fs.writeFileSync(sessionPath, JSON.stringify(sessionData), 'utf8');

    const response = await request(server, '/admin', {
      headers: { Cookie: rawCookie },
    });

    assert.strictEqual(response.statusCode, 403);
    assert.match(response.body, /无后台权限/);
  });

  it('GET /category/docs/guides 应只显示直接子目录', async () => {
    const response = await request(server, '/category/docs/guides');
    assert.strictEqual(response.statusCode, 200);
    assert.match(response.body, /docs\/guides\/v1/);
    assert.doesNotMatch(response.body, /banner\.png/);
  });

  it('GET /category/docs/guides 应显示面包屑导航和返回上一级', async () => {
    const response = await request(server, '/category/docs/guides');
    assert.strictEqual(response.statusCode, 200);
    assert.match(response.body, /docs/);
    assert.match(response.body, /guides/);
    assert.match(response.body, /返回上一级/);
  });

  it('GET /category/docs/guides/v1 应显示深层路径文件夹页', async () => {
    const response = await request(server, '/category/docs/guides/v1');
    assert.strictEqual(response.statusCode, 200);
    assert.match(response.body, /banner\.png/);
    assert.match(response.body, /返回上一级/);
  });

  it('GET /category/docs/empty 应显示空目录页', async () => {
    const response = await request(server, '/category/docs/empty');
    assert.strictEqual(response.statusCode, 200);
    assert.match(response.body, /此目录为空/);
    assert.match(response.body, /返回上一级/);
  });
});
