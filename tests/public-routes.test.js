const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const http = require('http');

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.DB_PATH = path.join(__dirname, '..', 'data', 'test-public-routes.db');
process.env.DOWNLOAD_DIR = path.join(__dirname, '..', 'downloads-public-routes-test');

const request = (server, targetPath) => new Promise((resolve, reject) => {
  const address = server.address();
  const req = http.request({
    hostname: '127.0.0.1',
    port: address.port,
    path: targetPath,
    method: 'GET',
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
  req.end();
});

describe('public routes', () => {
  let server;

  before(async () => {
    const dataDir = path.join(__dirname, '..', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(process.env.DOWNLOAD_DIR, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(process.env.DOWNLOAD_DIR, 'docs', 'a.txt'), 'hello public route');

    const { db } = require('../src/db');
    db.data.download_logs = [];
    db.data._nextId = 1;
    db._save();

    db.prepare(
      'INSERT INTO download_logs (file_name, file_path, category, file_size, download_count, description, mime_type) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run('a.txt', 'docs/a.txt', 'docs', 18, 0, 'route test file', 'text/plain');

    const app = require('../src/app');
    server = await new Promise((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }

    try { fs.rmSync(process.env.DOWNLOAD_DIR, { recursive: true, force: true }); } catch {}
    try { fs.unlinkSync(process.env.DB_PATH); } catch {}
  });

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

  it('首页与分类页不应再输出 /download/:id 链接', async () => {
    const home = await request(server, '/');
    const category = await request(server, '/category/docs');

    assert.doesNotMatch(home.body, /\/download\/1/);
    assert.match(home.body, /\/docs\/a\.txt/);

    assert.doesNotMatch(category.body, /\/download\/1/);
    assert.match(category.body, /\/docs\/a\.txt/);
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
});
