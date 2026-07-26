const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const http = require('http');

process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.DB_PATH = path.join(__dirname, '..', 'data', 'test-admin-routes.db');
process.env.DOWNLOAD_DIR = path.join(__dirname, '..', 'downloads-admin-routes-test');
process.env.SESSION_SECRET = 'b'.repeat(32);
process.env.ADMIN_USERNAME = 'testadmin';
process.env.ADMIN_PASSWORD = 'testpass123';

const request = (server, targetPath, options = {}) =>
  new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path: targetPath,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });

describe('admin routes - 嵌套分类删除', () => {
  let server;
  let cookie;

  before(async () => {
    fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
    fs.mkdirSync(process.env.DOWNLOAD_DIR, { recursive: true });

    const { db } = require('../src/db');
    db.data.download_logs = [];
    db.data._nextId = 1;
    db._save();

    const app = require('../src/app');
    server = await new Promise((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });

    const body = JSON.stringify({ username: 'testadmin', password: 'testpass123' });
    const loginRes = await request(server, '/auth/local-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      body,
    });
    assert.strictEqual(loginRes.statusCode, 200);
    cookie = loginRes.headers['set-cookie'].map((c) => c.split(';')[0]).join('; ');
  });

  after(async () => {
    if (server) server.close();
    try { fs.unlinkSync(process.env.DB_PATH); } catch {}
    try { fs.rmSync(process.env.DOWNLOAD_DIR, { recursive: true, force: true }); } catch {}
  });

  it('编码后的嵌套分类名应能删除(%2F 往返)', async () => {
    const createBody = JSON.stringify({ path: 'docs/tmpcat' });
    const created = await request(server, '/api/admin/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(createBody), Cookie: cookie },
      body: createBody,
    });
    assert.strictEqual(created.statusCode, 200);
    assert.ok(fs.existsSync(path.join(process.env.DOWNLOAD_DIR, 'docs', 'tmpcat')));

    const deleted = await request(server, '/api/admin/categories/docs%2Ftmpcat', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    assert.strictEqual(deleted.statusCode, 200, `删除应成功，实际 ${deleted.statusCode}: ${deleted.body}`);
    assert.ok(!fs.existsSync(path.join(process.env.DOWNLOAD_DIR, 'docs', 'tmpcat')));
  });

  it('穿越路径的分类删除应被拒绝', async () => {
    const res = await request(server, '/api/admin/categories/docs%2F..%2Fescape', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    assert.ok(res.statusCode >= 400, `应返回 4xx，实际 ${res.statusCode}`);
    assert.ok(!fs.existsSync(path.join(process.env.DOWNLOAD_DIR, '..', 'escape')));
  });

  it('未登录访问后台 API 应返回 401', async () => {
    const res = await request(server, '/api/admin/stats');
    assert.strictEqual(res.statusCode, 401);
  });
});
