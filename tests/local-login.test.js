const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const http = require('http');

// 注意：NODE_ENV 在 config 模块加载时就确定 cookie.secure 等值
// 设为 test 而非 production，避免 secure cookie 在测试 HTTP 环境下被拦截
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.DB_PATH = path.join(__dirname, '..', 'data', 'test-local-login.db');
process.env.DOWNLOAD_DIR = path.join(__dirname, '..', 'downloads-local-login-test');
process.env.SESSION_SECRET = 'a'.repeat(32);
process.env.ADMIN_USERNAME = 'testadmin';
process.env.ADMIN_PASSWORD = 'testpass123';
process.env.ADMIN_ALLOWED_EMAILS = 'allowed@example.com';

const request = (server, options) =>
  new Promise((resolve, reject) => {
    const address = server.address();
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: address.port,
        path: options.path,
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

describe('local login', () => {
  let server;

  before(async () => {
    const dataDir = path.join(__dirname, '..', 'data');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(process.env.DOWNLOAD_DIR, { recursive: true });

    const { db } = require('../src/db');
    db.data.download_logs = [];
    db.data._nextId = 1;
    db._save();

    const app = require('../src/app');
    server = await new Promise((resolve) => {
      const instance = app.listen(0, () => resolve(instance));
    });
  });

  after(async () => {
    if (server) server.close();
    try { fs.unlinkSync(process.env.DB_PATH); } catch {}
    try { fs.rmSync(process.env.DOWNLOAD_DIR, { recursive: true, force: true }); } catch {}
    // 只清理本测试创建的 session 文件，不影响其他并行测试
  });

  it('GET /auth/config 应返回 localLogin: true', async () => {
    const res = await request(server, { path: '/auth/config' });
    assert.strictEqual(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.localLogin, true);
  });

  it('POST /auth/local-login 错误密码应返回 401', async () => {
    const body = JSON.stringify({ username: 'testadmin', password: 'wrongpass' });
    const res = await request(server, {
      path: '/auth/local-login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      body,
    });
    assert.strictEqual(res.statusCode, 401);
  });

  it('POST /auth/local-login 正确凭据应返回 200 并设置 cookie', async () => {
    const body = JSON.stringify({ username: 'testadmin', password: 'testpass123' });
    const res = await request(server, {
      path: '/auth/local-login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Forwarded-Proto': 'https', // 模拟 Cloudflare HTTPS 代理
      },
      body,
    });
    assert.strictEqual(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.strictEqual(data.ok, true);

    // 检查 Set-Cookie 头
    const setCookie = res.headers['set-cookie'];
    assert.ok(setCookie, '应返回 Set-Cookie 头');
    assert.ok(
      setCookie.some((c) => c.includes('connect.sid')),
      'Set-Cookie 应包含 connect.sid',
    );
  });

  it('登录后使用 cookie 访问 /auth/me 应返回用户信息', async () => {
    // 第一步：登录获取 cookie
    const body = JSON.stringify({ username: 'testadmin', password: 'testpass123' });
    const loginRes = await request(server, {
      path: '/auth/local-login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Forwarded-Proto': 'https',
      },
      body,
    });
    assert.strictEqual(loginRes.statusCode, 200);

    const cookie = loginRes.headers['set-cookie']
      .map((c) => c.split(';')[0])
      .join('; ');

    // 第二步：使用 cookie 访问 /auth/me
    const meRes = await request(server, {
      path: '/auth/me',
      headers: { Cookie: cookie },
    });
    assert.strictEqual(meRes.statusCode, 200, `/auth/me 应返回 200，实际返回 ${meRes.statusCode}，body: ${meRes.body}`);
    const userData = JSON.parse(meRes.body);
    assert.strictEqual(userData.user.username, 'testadmin');
  });

  it('本地管理员登录后应可访问后台 API', async () => {
    const body = JSON.stringify({ username: 'testadmin', password: 'testpass123' });
    const loginRes = await request(server, {
      path: '/auth/local-login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Forwarded-Proto': 'https',
      },
      body,
    });
    assert.strictEqual(loginRes.statusCode, 200);

    const cookie = loginRes.headers['set-cookie']
      .map((c) => c.split(';')[0])
      .join('; ');

    const statsRes = await request(server, {
      path: '/api/admin/stats',
      headers: { Cookie: cookie },
    });
    assert.strictEqual(statsRes.statusCode, 200, `/api/admin/stats 应返回 200，实际返回 ${statsRes.statusCode}，body: ${statsRes.body}`);

    const data = JSON.parse(statsRes.body);
    assert.ok(data.dashboard);
  });
});
